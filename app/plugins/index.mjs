import { randomUUID } from 'node:crypto';
import { createBuiltinPlugins } from './builtins.mjs';
import { HOST_VERSION, fail, object, text, keys, json, digest, version, range, compatible, schemaDefinition, validate, context, scope, scopeContext, scopes, find } from './contracts.mjs';
export { createBuiltinPlugins, HOST_VERSION };

const time = () => new Date().toISOString();
const base = ['projectId','scope'];
const ctxKeys = ['projectId','sessionId','agentId','taskId'];
function latest(state, pluginId, projectId, s) {
  return state.events.findLast(e => e.type === 'plugin.binding' && e.pluginId === pluginId && e.projectId === projectId && e.scope.kind === s.kind && e.scope.id === s.id);
}
function effective(state, pluginId, ctx) {
  const bindings = scopes(ctx).map(s => latest(state,pluginId,ctx.projectId,s)).filter(Boolean);
  return {enabled:bindings.some(b => b.enabled) && bindings.every(b => b.enabled),config:Object.assign({},...bindings.map(b => b.config)),bindings:bindings.map(b => ({id:b.id,revision:b.revision,scope:b.scope}))};
}
function event(state, kind, projectId, data) {
  const e = {id:randomUUID(),type:`plugin.${kind}`,projectId,createdAt:time(),...data}; state.events.push(e); return e;
}
function replay(state, method, input) {
  text(input.operationId,'operationId');
  const fingerprint = digest({method,input}), prior = state.receipts.find(r => r.operationId === input.operationId);
  if (prior && prior.fingerprint !== fingerprint) fail('OPERATION_REUSE','Operation ID has a different payload or scope',409);
  return {fingerprint,prior};
}
function receipt(state, input, fingerprint, result) {
  state.receipts.push({operationId:input.operationId,type:'plugin',fingerprint,result:structuredClone(result)}); return result;
}
function definition(p) {
  object(p,'trusted plugin'); text(p.id,'pluginId'); version(p.version); range(p.requiresHost ?? '^1.0.0');
  if (typeof p.create !== 'function' || !Array.isArray(p.provides) || !p.provides.length || !Array.isArray(p.consumes ?? [])) fail('CONTRACT','Invalid trusted plugin definition');
  schemaDefinition(p.configSchema);
  const provides = p.provides.map(service => {
    text(service.capability,'capability'); version(service.version); object(service.methods);
    if (!Object.keys(service.methods).length) fail('CONTRACT','Service must expose methods');
    for (const [method,schema] of Object.entries(service.methods)) { text(method,'method'); schemaDefinition(schema); }
    return structuredClone(service);
  });
  const consumes = (p.consumes ?? []).map(c => { keys(c,['capability','version']); text(c.capability,'capability'); range(c.version); return {...c}; });
  return {...p,requiresHost:p.requiresHost ?? '^1.0.0',provides,consumes,configSchema:structuredClone(p.configSchema)};
}

/**
 * Trusted factory result. No module URL, path, package installation or discovery
 * result is ever executable here. Config and receipts live only in FORGE state.
 * @typedef {{services:Record<string,Record<string,Function>>,health:Function,dispose:Function}} PluginInstance
 * @param {{store:object,adapters?:object,builtins?:object[],authorize?:Function}} options
 */
export function createPluginService({store,adapters = {},builtins = createBuiltinPlugins(adapters),authorize} = {}) {
  if (!store?.read || !store?.transaction) throw new TypeError('Durable FORGE store required');
  const plugins = new Map(), providers = new Map(), instances = new Map();
  let queue = Promise.resolve(), closing = false;
  for (const source of builtins) {
    const p = definition(source);
    if (plugins.has(p.id)) fail('CONTRACT','Duplicate trusted plugin ID');
    plugins.set(p.id,p);
    for (const cap of p.provides) {
      if (providers.has(cap.capability)) fail('CONTRACT','Ambiguous capability provider');
      providers.set(cap.capability,p);
    }
  }
  // Serializes lifecycle admissions, not native executions or store transactions.
  const locked = fn => { const job = queue.then(fn); queue = job.catch(() => {}); return job; };
  const open = () => { if (closing) fail('CLOSED','Plugin service is closing',503); };
  const plugin = id => { text(id,'pluginId'); const p = plugins.get(id); if (!p) fail('PLUGIN_UNKNOWN','Only compiled trusted plugins are supported',404); return p; };

  function select(state, ctx, required) {
    ctx = context(state,ctx);
    if (!Array.isArray(required) || !required.length || required.length > 32) fail('VALIDATION','Select 1–32 required capabilities');
    const selected = new Map(), visiting = new Set(), order = [];
    const visit = req => {
      keys(req,['capability','version']); text(req.capability,'capability'); range(req.version);
      const p = providers.get(req.capability);
      if (!p) fail('CAPABILITY_MISSING',`No trusted provider for ${req.capability}`,409);
      const provision = p.provides.find(c => c.capability === req.capability);
      if (!compatible(provision.version,req.version)) fail('DEPENDENCY_VERSION',`Incompatible ${req.capability} service version`,409);
      if (visiting.has(p.id)) fail('DEPENDENCY_CYCLE','Plugin dependency cycle detected',409);
      if (selected.has(p.id)) return;
      if (!compatible(HOST_VERSION,p.requiresHost)) fail('HOST_VERSION','Plugin is incompatible with this registry version',409);
      const binding = effective(state,p.id,ctx);
      if (!binding.enabled) fail('CAPABILITY_DISABLED',`Enable ${p.id} for this scope; ancestor Off cannot be overridden`,409);
      if (p.available === false) fail('ADAPTER_MISSING',`Register the native adapter for ${p.id}`,409);
      validate(p.configSchema,binding.config,'configuration');
      validateConfigReferences(state,binding.config,ctx.projectId);
      visiting.add(p.id); p.consumes.forEach(visit); visiting.delete(p.id);
      const item = {pluginId:p.id,pluginVersion:p.version,capabilities:p.provides.map(c => ({capability:c.capability,version:c.version})),...binding};
      selected.set(p.id,item); order.push(item);
    };
    required.forEach(visit);
    const scopeRevisions = [['projectId','projects'],['sessionId','conversations'],['agentId','bots'],['taskId','tasks']].filter(([key]) => ctx[key]).map(([key,collection]) => {
      const item = find(state,collection,ctx[key],collection === 'projects' ? undefined : ctx.projectId);
      return {collection,id:item.id,revision:item.revision};
    });
    return {context:ctx,scopeRevisions,plugins:order,signature:digest({ctx,scopeRevisions,order}),rationale:'Trusted compatible providers; all declared dependencies enabled in matching scope. Selection grants no execution permission.'};
  }
  function validateConfigReferences(state, config, projectId) {
    for (const [k,c] of [['connectionId','connections'],['targetId','desktopTargets']]) if (config[k]) find(state,c,text(config[k],k),projectId);
    for (const id of config.skillIds ?? []) find(state,'skills',text(id),projectId);
    if (config.providerInstanceId) text(config.providerInstanceId,'providerInstanceId'); // Native catalog owns this identity.
  }
  async function disposeRecord(rec) {
    if (rec.disposeFailed) fail('DISPOSAL_FAILED','Native plugin cleanup remains unresolved; reconcile its resources',409);
    if (rec.disposing) return rec.disposing;
    rec.retiring = true;
    if (rec.active) return; // No forced release while a native operation is running.
    rec.disposing = (async () => {
      try { rec.controller.abort(); await rec.value.dispose(); instances.delete(rec.key); }
      catch { rec.disposeFailed = true; fail('DISPOSAL_FAILED','Native plugin cleanup failed; reconcile its resources before reactivation',409); }
    })();
    return rec.disposing;
  }
  async function sweep() {
    const state = store.read();
    // Consumers are inserted after dependencies; dispose in reverse order.
    for (const rec of [...instances.values()].reverse()) {
      let stale = rec.retiring;
      try { stale ||= select(state,rec.ctx,rec.required).signature !== rec.signature; } catch { stale = true; }
      if (stale) { rec.retiring = true; if (!rec.active) await disposeRecord(rec); }
    }
  }
  async function activate(selection, required) {
    await sweep();
    const acquired = [];
    try {
      for (const item of selection.plugins) {
        const p = plugin(item.pluginId), key = digest({ctx:selection.context,pluginId:p.id});
        let rec = instances.get(key);
        if (rec?.retiring) fail(rec.disposeFailed ? 'DISPOSAL_FAILED' : 'PLUGIN_DRAINING','Previous plugin instance still owns resources',409);
        if (!rec) {
          const controller = new AbortController(), dependencies = {};
          for (const dep of p.consumes) {
            const found = acquired.find(r => r.plugin.provides.some(c => c.capability === dep.capability));
            // Calls remain behind authorization. Factories may inspect declared
            // dependency contracts but cannot obtain an unguarded service handle.
            dependencies[dep.capability] = {version:found.plugin.provides.find(c => c.capability === dep.capability).version,
              invoke:(method,args,operationId) => service.invoke({...selection.context,capability:dep.capability,method,arguments:args,operationId})};
          }
          const ctx = {scope:structuredClone(selection.context),config:structuredClone(item.config),dependencies,signal:controller.signal};
          let value;
          try {
            value = await p.create(ctx);
            if (!value || typeof value.health !== 'function' || typeof value.dispose !== 'function') fail('CONTRACT','Plugin needs health and disposal methods');
            for (const cap of p.provides) for (const method of Object.keys(cap.methods)) if (typeof value.services?.[cap.capability]?.[method] !== 'function') fail('CONTRACT','Plugin does not implement its declared service');
          } catch {
            controller.abort();
            try { await value?.dispose?.(); } catch {
              // A returned but malformed instance can still own native resources.
              // Retain a failed cleanup record so it cannot be silently replaced.
              instances.set(key,{key,plugin:p,value,controller,ctx:selection.context,signature:selection.signature,required,active:0,retiring:true,disposeFailed:true,disposing:Promise.resolve()});
              fail('DISPOSAL_FAILED',`Failed factory cleanup for ${p.id}; reconcile native resources`,409);
            }
            fail('ACTIVATION_FAILED',`Native factory failed for ${p.id}`,409);
          }
          rec = {key,plugin:p,value,controller,ctx:selection.context,signature:selection.signature,required,active:0,retiring:false};
          instances.set(key,rec);
        }
        acquired.push(rec);
      }
      return acquired;
    } catch (e) {
      // Partially activated dependencies are safely disposed if idle.
      for (const rec of acquired.reverse()) if (!rec.active) await disposeRecord(rec);
      throw e;
    }
  }
  async function mutation(method, raw) {
    json(raw); const input = structuredClone(raw);
    keys(input,[...base,'pluginId','operationId','expectedRevision',...(method === 'configure' ? ['config'] : [])]);
    const p = plugin(input.pluginId);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('REVISION_REQUIRED','Use the current binding revision (0 for new)',409);
    if (method === 'configure') {
      validate({...p.configSchema,required:[]},input.config,'configuration');
      // Config is restricted to bounded IDs/enums/bools/numbers. Secret material,
      // prompts and URLs belong to native adapter-owned configuration boundaries.
      for (const k of Object.keys(input.config)) if (/secret|token|password|credential|authorization|prompt|instructions|api.?key/i.test(k)) fail('SECRET_CONFIG','Use native adapter setup for credentials and context');
    }
    return locked(async () => {
      open();
      const result = await store.transaction(state => {
        const s = scope(state,input), {fingerprint,prior} = replay(state,method,input);
        if (prior) return prior.result;
        const old = latest(state,p.id,input.projectId,s);
        if ((old?.revision ?? 0) !== input.expectedRevision) fail('REVISION_CONFLICT','Plugin configuration changed; reload before editing',409);
        const config = method === 'configure' ? input.config : old?.config ?? {};
        validateConfigReferences(state,config,input.projectId);
        const enabled = method === 'enable' || method === 'configure' && old?.enabled === true;
        const binding = event(state,'binding',input.projectId,{pluginId:p.id,scope:s,config,enabled,revision:(old?.revision ?? 0)+1,operationId:input.operationId});
        if (enabled) select(state,scopeContext(input.projectId,s),p.provides.map(c => ({capability:c.capability,version:c.version})));
        return receipt(state,input,fingerprint,binding);
      });
      // Binding commits before disposal, immediately preventing new admissions.
      // Existing active calls may finish; disabling never claims cancellation.
      await sweep();
      return result;
    });
  }

  const service = {
    // Pure reservation-time check for existing native owners. This does not
    // activate a factory, grant permission or publish a second execution record.
    check(raw,state=store.read()){
      open();json(raw);keys(raw,[...ctxKeys,'requires']);return structuredClone(select(state,context(state,raw),raw.requires));
    },
    list(input) {
      open(); json(input); keys(input,base); const state = store.read(), s = scope(state,input), ctx = scopeContext(input.projectId,s);
      return structuredClone({scope:s,plugins:[...plugins.values()].map(p => {
        const own = latest(state,p.id,input.projectId,s), binding = effective(state,p.id,ctx);
        let compatibility = {status:'ready'};
        try { select(state,ctx,p.provides.map(c => ({capability:c.capability,version:c.version}))); } catch (e) { compatibility = {status:'blocked',code:e.code,message:e.message}; }
        return {id:p.id,name:p.name ?? p.id,description:p.description ?? '',version:p.version,requiresHost:p.requiresHost,provides:p.provides,consumes:p.consumes,configSchema:p.configSchema,revision:own?.revision ?? 0,enabled:own?.enabled ?? false,effectiveEnabled:binding.enabled,config:own?.config ?? {},effectiveConfig:binding.config,compatibility,
          runtime:[...instances.values()].filter(r => r.ctx.projectId === input.projectId && r.plugin.id === p.id).map(r => ({activeCalls:r.active,status:r.disposeFailed ? 'disposal_failed' : r.retiring ? 'draining' : 'active'}))};
      })});
    },
    configure:input => mutation('configure',input),
    enable:input => mutation('enable',input),
    disable:input => mutation('disable',input),
    async health(raw) {
      json(raw); const input = structuredClone(raw); keys(input,[...base,'pluginId']); const p = plugin(input.pluginId);
      return locked(async () => {
        open(); const state = store.read(), s = scope(state,input), ctx = scopeContext(input.projectId,s), required = p.provides.map(c => ({capability:c.capability,version:c.version}));
        try {
          const selection = select(state,ctx,required), records = await activate(selection,required), results = [];
          for (const rec of records) {
            let result;
            try { result = await rec.value.health(); } catch { fail('HEALTH_FAILED','Native health failed; inspect native adapter setup',409); }
            if (!['ready','degraded','unavailable'].includes(result?.status)) fail('CONTRACT','Native adapter returned an invalid health status');
            results.push({pluginId:rec.plugin.id,status:result.status,...(typeof result.code === 'string' && /^[A-Z_]{1,80}$/.test(result.code) ? {code:result.code} : {})});
          }
          // Discard provider messages and arbitrary fields: health is not a vault.
          if (select(store.read(),ctx,required).signature !== selection.signature) fail('REVISION_CONFLICT','Capabilities changed during health check',409);
          return {pluginId:p.id,status:results.every(r => r.status === 'ready') ? 'ready' : 'unavailable',checkedAt:time(),results};
        } catch (e) { return {pluginId:p.id,status:'unavailable',checkedAt:time(),code:e.code ?? 'HEALTH_FAILED',message:e.code ? e.message : 'Native adapter health failed; inspect native setup'}; }
      });
    },
    async resolve(raw) {
      json(raw); const input = structuredClone(raw); keys(input,[...ctxKeys,'operationId','requires']);
      return locked(async () => {
        open(); return store.transaction(state => {
          const ctx = context(state,input), {fingerprint,prior} = replay(state,'resolve',input); if (prior) return prior.result;
          const selection = select(state,ctx,input.requires);
          const record = event(state,'selection',ctx.projectId,{operationId:input.operationId,context:ctx,scopeRevisions:selection.scopeRevisions,plugins:selection.plugins,signature:selection.signature,rationale:selection.rationale,authorization:'not_granted',qualification:'native factory contracts; live provider NOT_RUN'});
          return receipt(state,input,fingerprint,{...selection,receipt:{id:record.id,operationId:input.operationId,authorization:'not_granted'}});
        });
      });
    },
    /** INTERNAL admission boundary; never expose as an unauthenticated HTTP tool. */
    async invoke(raw) {
      open();
      json(raw); const input = structuredClone(raw); keys(input,[...ctxKeys,'operationId','capability','method','arguments']);
      text(input.operationId,'operationId'); text(input.capability,'capability'); text(input.method,'method');
      const p = providers.get(input.capability); if (!p) fail('CAPABILITY_MISSING','No trusted capability provider',409);
      const contract = p.provides.find(c => c.capability === input.capability)?.methods[input.method];
      if (!contract) fail('METHOD_UNKNOWN','Method is not in this service contract',400);
      validate(contract,input.arguments);
      const invocationContext = state => {
        const nativeRun = input.arguments.runId && find(state,'runs',input.arguments.runId,input.projectId);
        const taskId = input.taskId ?? input.arguments.taskId ?? nativeRun?.taskId;
        if (input.taskId && input.arguments.taskId && input.taskId !== input.arguments.taskId || nativeRun?.taskId && taskId && nativeRun.taskId !== taskId || nativeRun?.botId && input.agentId && nativeRun.botId !== input.agentId) fail('SCOPE','Native operation and caller context do not match',403);
        return context(state,{...input,...(taskId ? {taskId} : {}),...(input.agentId ? {} : nativeRun?.botId ? {agentId:nativeRun.botId} : {})});
      };
      const required = [{capability:input.capability,version:'*'}], before = store.read(), ctx = invocationContext(before), selection = select(before,ctx,required);
      if (typeof authorize !== 'function') fail('AUTHORIZATION_REQUIRED','Native runtime authorization is required independently of selection',403);
      // Do not persist args (may contain private text), authorization tokens or native context.
      const authorized = await authorize({context:structuredClone(ctx),selection:structuredClone(selection),capability:input.capability,method:input.method,arguments:structuredClone(input.arguments),operationId:input.operationId});
      if (authorized !== true) fail('AUTHORIZATION_REQUIRED','Native runtime did not authorize this exact operation',403);
      let lease;
      const admission = await locked(async () => {
        open();
        const current = store.read(), currentCtx = invocationContext(current), currentSelection = select(current,currentCtx,required);
        if (currentSelection.signature !== selection.signature) fail('REVISION_CONFLICT','Capabilities changed during authorization',409);
        // Validate target identities and pinned native config before factory effects.
        validateConfigReferences(current,input.arguments,ctx.projectId);
        for (const [k,c] of [['taskId','tasks'],['runId','runs']]) if (input.arguments[k]) find(current,c,input.arguments[k],ctx.projectId);
        if (ctx.taskId && input.arguments.taskId && ctx.taskId !== input.arguments.taskId) fail('SCOPE','Operation targets another task',403);
        const chosen = currentSelection.plugins.find(x => x.pluginId === p.id);
        for (const k of ['connectionId','targetId','providerInstanceId']) if (chosen.config[k] && input.arguments[k] && chosen.config[k] !== input.arguments[k]) fail('SCOPE','Operation targets another configured native resource',403);
        if (chosen.config.skillIds && input.arguments.skillIds?.some(id => !chosen.config.skillIds.includes(id))) fail('SCOPE','Skill is outside this binding',403);
        const check = replay(current,'invoke',input);
        if (check.prior) return {replayed:true,...current.events.find(e => e.id === check.prior.result.callId)};
        const records = await activate(currentSelection,required);
        // Pin every dependency for the entire call so no provider is disposed first.
        records.forEach(r => r.active++);
        lease = records;
        return store.transaction(state => {
          const live = select(state,invocationContext(state),required);
          if (live.signature !== currentSelection.signature) fail('REVISION_CONFLICT','Capabilities changed before execution reservation',409);
          validateConfigReferences(state,input.arguments,ctx.projectId);
          for (const [k,c] of [['taskId','tasks'],['runId','runs']]) if (input.arguments[k]) find(state,c,input.arguments[k],ctx.projectId);
          const {fingerprint,prior} = replay(state,'invoke',input); if (prior) return {replayed:true,...state.events.find(e => e.id === prior.result.callId)};
          const call = event(state,'call',ctx.projectId,{operationId:input.operationId,nativeOperationId:`plugin-native:${digest(input.operationId)}`,context:ctx,capability:input.capability,method:input.method,requestHash:digest(input.arguments),selectionSignature:live.signature,plugins:live.plugins,status:'pending'});
          receipt(state,input,fingerprint,{callId:call.id}); return call;
        });
      }).catch(async e => { if (lease) { await locked(async () => { lease.forEach(r => r.active--); await sweep(); }); } throw e; });
      if (admission.replayed) { if (lease) await locked(async () => { lease.forEach(r => r.active--); await sweep(); }); return admission; }
      try {
        const rec = lease.find(r => r.plugin.id === p.id);
        let result;
        try {
          result = await rec.value.services[input.capability][input.method](structuredClone(input.arguments),{nativeOperationId:admission.nativeOperationId});
          json(result); // Runtime check even for trusted adapters; never record output.
        } catch {
          await store.transaction(s => Object.assign(s.events.find(e => e.id === admission.id),{status:'unknown',finishedAt:time(),code:'NATIVE_OUTCOME_UNCONFIRMED'}));
          fail('NATIVE_OUTCOME_UNCONFIRMED','Native operation outcome requires reconciliation; do not retry automatically',409);
        }
        await store.transaction(s => Object.assign(s.events.find(e => e.id === admission.id),{status:'completed',finishedAt:time()}));
        return {callId:admission.id,status:'completed',result};
      } finally {
        await locked(async () => { lease.forEach(r => r.active--); await sweep(); });
      }
    },
    /** Startup-only recovery of reservations, never an external process claim. */
    async recover() {
      return locked(async () => {
        open();
        if ([...instances.values()].some(r => r.active)) fail('RECOVERY_BUSY','Recovery is only valid before admitting native calls',409);
        return store.transaction(state => {
          const pending = state.events.filter(e => e.type === 'plugin.call' && e.status === 'pending');
          for (const call of pending) Object.assign(call,{status:'unknown',recoveredAt:time(),code:'PROCESS_RESTART_RECONCILIATION_REQUIRED'});
          return {status:'reconciled_reservations',unknownCalls:pending.map(e => e.id),externalProcesses:'not_recovered',effectsReplayed:0};
        });
      });
    },
    async close() {
      closing = true;
      return locked(async () => {
        for (const rec of [...instances.values()].reverse()) { rec.retiring = true; if (!rec.active) await disposeRecord(rec); }
        return {status:instances.size ? 'draining' : 'disposed',activeCalls:[...instances.values()].reduce((n,r) => n+r.active,0)};
      });
    },
  };
  return service;
}

/** Lead mounts POST /api/plugins/:action after existing localhost/origin checks. */
export async function dispatchPluginRequest(service, action, body) {
  if (!['list','configure','enable','disable','health','resolve'].includes(action)) fail('NOT_FOUND','Plugin route not found',404);
  return service[action](body);
}
