import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,trustedPlugin,form,id,deferred} from './plugins-fixture.test.mjs';
import {createPluginService,dispatchPluginRequest,createBuiltinPlugins} from '../app/plugins/index.mjs';
import {compatible} from '../app/plugins/contracts.mjs';

test('real SQLite: scoped configuration, receipts and rationale persist after restart without executing a factory',async t => {
  const f=await fixture(t), configure=f.binding({config:{mode:'two'}});
  const binding=await f.service.configure(configure);assert.equal(binding.enabled,false);assert.equal(binding.revision,1);
  assert.deepEqual(await f.service.configure(configure),binding);
  await f.enable({expectedRevision:1});
  const input=f.input({requires:[{capability:'fixture',version:'^1.0.0'}]}), selected=await f.service.resolve(input);
  assert.equal(selected.plugins[0].config.mode,'two');assert.equal(selected.receipt.authorization,'not_granted');assert.match(selected.rationale,/no execution permission/);
  assert.equal(f.calls.length,0);
  await f.restart();assert.deepEqual(await f.service.resolve(input),selected);assert.equal(f.service.list({projectId:f.p.id}).plugins[0].revision,2);
  await assert.rejects(f.service.resolve({...input,taskId:f.task.id}),{code:'OPERATION_REUSE'});
  assert.equal(f.store.read().events.filter(e => e.type==='plugin.selection').length,1);
});

test('revision conflicts, malformed payloads and route allowlist fail without effects',async t => {
  const f=await fixture(t);await f.enable();
  await assert.rejects(f.service.disable(f.binding()),{code:'REVISION_CONFLICT'});
  const before=f.store.read().events.length;
  for(const value of [null,[],{}, {projectId:f.p.id,scope:{kind:'filesystem',id:'x'}}, {projectId:f.p.id,scope:{kind:'project',id:f.other.id}}]) assert.throws(()=>f.service.list(value));
  await assert.rejects(f.service.configure(f.binding({expectedRevision:1,config:{token:'do-not-save'}})));
  await assert.rejects(f.service.configure(f.binding({expectedRevision:1,config:{mode:'invalid'}})));
  await assert.rejects(f.service.configure(f.binding({expectedRevision:1,config:{mode:'one'},module:'https://untrusted/plugin.mjs'})),{code:'VALIDATION'});
  await assert.rejects(dispatchPluginRequest(f.service,'invoke',{}),{code:'NOT_FOUND'});
  assert.equal((await dispatchPluginRequest(f.service,'list',{projectId:f.p.id})).plugins.length,1);
  assert.equal(f.store.read().events.length,before);assert.equal(f.calls.length,0);
});

test('project/session/agent/task scopes merge configuration and enforce ancestor Off',async t => {
  const f=await fixture(t);await f.enable();
  await f.service.configure(f.binding({scope:{kind:'session',id:f.session.id},config:{mode:'two'}}));
  await f.enable({scope:{kind:'session',id:f.session.id},expectedRevision:1});
  assert.equal((await f.resolve({sessionId:f.session.id})).plugins[0].config.mode,'two');
  assert.equal((await f.resolve()).plugins[0].config.mode,undefined);
  await f.service.disable(f.binding({scope:{kind:'agent',id:f.bot.id}}));
  await assert.rejects(f.resolve({taskId:f.task.id}),{code:'CAPABILITY_DISABLED'});
  await assert.rejects(f.enable({scope:{kind:'task',id:f.task.id}}),{code:'CAPABILITY_DISABLED'});
  await f.enable({scope:{kind:'agent',id:f.bot.id},expectedRevision:1});
  const scoped=await f.resolve({sessionId:f.session.id,taskId:f.task.id});assert.equal(scoped.context.agentId,f.bot.id);
  await f.service.disable(f.binding({expectedRevision:1}));
  await assert.rejects(f.resolve({sessionId:f.session.id,taskId:f.task.id}),{code:'CAPABILITY_DISABLED'});
});

test('foreign and contradictory scope claims fail before factory or authorization',async t => {
  let auth=0;const f=await fixture(t,{authorize:()=>{auth++;return true;}});await f.enable();
  await assert.rejects(f.resolve({taskId:f.foreign.id}),{code:'SCOPE'});
  await assert.rejects(f.resolve({taskId:f.task.id,agentId:f.bot2.id}),{code:'SCOPE'});
  await assert.rejects(f.resolve({sessionId:f.session.id,agentId:f.bot2.id}),{code:'SCOPE'});
  await assert.rejects(f.enable({scope:{kind:'task',id:f.foreign.id}}),{code:'SCOPE'});
  assert.equal(auth,0);assert.equal(f.calls.length,0);
});

test('declared version dependencies resolve topologically and reject missing or disabled providers',async t => {
  const calls=[], a=trustedPlugin('a',{calls,consumes:[{capability:'b',version:'^1.0.0'}]}),b=trustedPlugin('b',{calls});
  const f=await fixture(t,{builtins:[a,b]});
  await assert.rejects(f.enable({pluginId:'fixture.a'}),{code:'CAPABILITY_DISABLED'});
  await f.enable({pluginId:'fixture.b'});await f.enable({pluginId:'fixture.a'});
  const s=await f.resolve({requires:[{capability:'a',version:'1.0.0'}]});assert.deepEqual(s.plugins.map(x=>x.pluginId),['fixture.b','fixture.a']);
  assert.equal((await f.service.health({projectId:f.p.id,pluginId:'fixture.a'})).status,'ready');
  assert.deepEqual(calls.filter(x=>x[0]==='create').map(x=>x[1]),['b','a']);
  await f.service.disable(f.binding({pluginId:'fixture.b',expectedRevision:1}));
  assert.deepEqual(calls.filter(x=>x[0]==='dispose').map(x=>x[1]),['a','b']);
  await assert.rejects(f.resolve({requires:[{capability:'a',version:'*'}]}),{code:'CAPABILITY_DISABLED'});
});

test('cycles, missing dependency and service/host incompatibility never execute factories',async t => {
  const cases=[
    {code:'DEPENDENCY_CYCLE',builtins:[trustedPlugin('a',{consumes:[{capability:'a',version:'*'}]})]},
    {code:'CAPABILITY_MISSING',builtins:[trustedPlugin('a',{consumes:[{capability:'absent',version:'*'}]})]},
    {code:'HOST_VERSION',builtins:[{...trustedPlugin('a'),requiresHost:'^2.0.0'}]},
  ];
  for(const c of cases){const f=await fixture(t,{builtins:c.builtins});await assert.rejects(f.enable({pluginId:'fixture.a'}),{code:c.code});assert.equal(f.store.read().events.length,0);}
  const f=await fixture(t);await f.enable();await assert.rejects(f.resolve({requires:[{capability:'fixture',version:'^2.0.0'}]}),{code:'DEPENDENCY_VERSION'});
  assert.equal(compatible('0.2.2','^0.2.1'),true);assert.equal(compatible('0.3.0','^0.2.1'),false);assert.equal(compatible('0.0.2','^0.0.1'),false);
  assert.equal(compatible('1.1.0','^1.2.0'),false);assert.equal(compatible('1.3.0','^1.2.0'),true);
});

test('runtime authorization is independent of successful selection and tool visibility',async t => {
  const f=await fixture(t,{authorize:()=>false});await f.enable();await f.resolve();
  await assert.rejects(f.invoke(),{code:'AUTHORIZATION_REQUIRED'});assert.equal(f.calls.length,0);
  const noAuth=createPluginService({store:f.store,builtins:[trustedPlugin()]});
  await assert.rejects(noAuth.invoke(f.input({capability:'fixture',method:'inspect',arguments:{}})),{code:'AUTHORIZATION_REQUIRED'});await noAuth.close();
  assert.equal(f.store.read().events.filter(e=>e.type==='plugin.call').length,0);
});

test('TOCTOU: authorization must be repeated after configuration changes',async t => {
  const gate=deferred(),entered=deferred();const f=await fixture(t,{authorize:async()=>{entered.resolve();return gate.promise;}});await f.enable();
  const call=f.invoke();await entered.promise;
  await f.service.configure(f.binding({expectedRevision:1,config:{mode:'two'}}));gate.resolve(true);
  await assert.rejects(call,{code:'REVISION_CONFLICT'});assert.equal(f.calls.length,0);
});

test('task revision changes during authorization invalidate the selected harness',async t => {
  const gate=deferred(),entered=deferred(),f=await fixture(t,{authorize:async()=>{entered.resolve();return gate.promise;}});await f.enable();
  const call=f.invoke({taskId:f.task.id});await entered.promise;
  await f.store.transaction(s=>{const task=s.tasks.find(x=>x.id===f.task.id);task.revision++;task.title='New owner requirements';});gate.resolve(true);
  await assert.rejects(call,{code:'REVISION_CONFLICT'});assert.equal(f.calls.length,0);
});

test('malformed methods/arguments and foreign native targets fail without execution',async t => {
  const f=await fixture(t);await f.enable();
  await assert.rejects(f.invoke({method:'unregistered'}),{code:'METHOD_UNKNOWN'});
  await assert.rejects(f.invoke({arguments:{value:7}}),{code:'CONTRACT'});
  await assert.rejects(f.invoke({arguments:{value:'x',approved:true}}),{code:'VALIDATION'});
  const polluted=JSON.parse('{"__proto__":{"approved":true}}');await assert.rejects(f.invoke({arguments:polluted}),{code:'VALIDATION'});
  assert.equal(f.calls.length,0);
});

test('disabled task and inferred agent scope cannot be bypassed through method arguments',async t => {
  const p=trustedPlugin('fixture',{methods:{inspect:form({taskId:id},['taskId'])}}),f=await fixture(t,{builtins:[p]});await f.enable();
  await f.service.disable(f.binding({scope:{kind:'task',id:f.task.id}}));
  await assert.rejects(f.invoke({arguments:{taskId:f.task.id}}),{code:'CAPABILITY_DISABLED'});
  await assert.rejects(f.invoke({arguments:{taskId:f.foreign.id}}),{code:'SCOPE'});
});

test('active calls drain before disposal, prevent replacement and never claim cancellation',async t => {
  const native=deferred(),entered=deferred();const f=await fixture(t,{invoke:async()=>{entered.resolve();return native.promise;}});await f.enable();
  const calling=f.invoke();await entered.promise;
  await f.service.disable(f.binding({expectedRevision:1}));
  assert.equal(f.calls.some(x=>x[0]==='dispose'),false);
  assert.equal(f.service.list({projectId:f.p.id}).plugins[0].runtime[0].status,'draining');
  await assert.rejects(f.invoke(),{code:'CAPABILITY_DISABLED'});
  await f.enable({expectedRevision:2});
  assert.equal((await f.service.health({projectId:f.p.id,pluginId:'fixture.fixture'})).code,'PLUGIN_DRAINING');
  native.resolve({done:true});assert.equal((await calling).status,'completed');
  assert.equal(f.calls.filter(x=>x[0]==='dispose').length,1);
  assert.equal((await f.service.health({projectId:f.p.id,pluginId:'fixture.fixture'})).status,'ready');
  assert.equal(f.calls.filter(x=>x[0]==='create').length,2);
});

test('operation reservations prevent concurrent duplicate effects and output never enters snapshots',async t => {
  const native=deferred(),entered=deferred();const f=await fixture(t,{invoke:async()=>{entered.resolve();return native.promise;}});await f.enable();
  const input=f.input({capability:'fixture',method:'inspect',arguments:{value:'private-input-never-persist'}});
  const one=f.service.invoke(input);await entered.promise;
  const duplicate=await f.service.invoke(input);assert.equal(duplicate.replayed,true);assert.equal(duplicate.status,'pending');
  native.resolve({value:'private-output-never-persist'});assert.equal((await one).status,'completed');
  assert.equal(f.calls.filter(x=>x[0]==='invoke').length,1);
  const snapshot=JSON.stringify(f.store.read());assert.ok(!snapshot.includes('private-input-never-persist'));assert.ok(!snapshot.includes('private-output-never-persist'));
  await assert.rejects(f.service.invoke({...input,arguments:{value:'changed'}}),{code:'OPERATION_REUSE'});
  await f.restart();const after=await f.service.invoke(input);assert.equal(after.replayed,true);assert.equal(after.status,'completed');assert.equal(f.calls.filter(x=>x[0]==='invoke').length,1);
});

test('unconfirmed native outcome persists across restart and never retries the effect',async t => {
  const f=await fixture(t,{invoke:()=>{throw new Error('private-native-secret');}});await f.enable();const input=f.input({capability:'fixture',method:'inspect',arguments:{}});
  await assert.rejects(f.service.invoke(input),{code:'NATIVE_OUTCOME_UNCONFIRMED'});await f.restart();
  const prior=await f.service.invoke(input);assert.equal(prior.replayed,true);assert.equal(prior.status,'unknown');assert.equal(f.calls.filter(x=>x[0]==='invoke').length,1);
  assert.ok(!JSON.stringify(f.store.read()).includes('private-native-secret'));
});

test('actual missing adapter, bad health and native health messages cannot become fake healthy',async t => {
  const f=await fixture(t), absent=createPluginService({store:f.store});
  await assert.rejects(absent.enable(f.binding({pluginId:'forge.provider'})),{code:'ADAPTER_MISSING'});
  assert.equal((await absent.health({projectId:f.p.id,pluginId:'forge.provider'})).status,'unavailable');await absent.close();
  const broken=await fixture(t,{health:()=>{throw Object.assign(new Error('private-access-token'),{code:'SECRET_TOKEN'});}});await broken.enable();
  const health=await broken.service.health({projectId:broken.p.id,pluginId:'fixture.fixture'});assert.equal(health.code,'HEALTH_FAILED');assert.ok(!JSON.stringify(health).includes('private-access-token'));
  const unvalidated=await fixture(t,{health:()=>({status:'invented'})});await unvalidated.enable();assert.equal((await unvalidated.service.health({projectId:unvalidated.p.id,pluginId:'fixture.fixture'})).code,'CONTRACT');
});

test('disposal failure is visible and blocks silent replacement',async t => {
  const f=await fixture(t,{dispose:()=>{throw new Error('fixture cleanup failed');}});await f.enable();await f.service.health({projectId:f.p.id,pluginId:'fixture.fixture'});
  await assert.rejects(f.service.disable(f.binding({expectedRevision:1})),{code:'DISPOSAL_FAILED'});
  assert.equal(f.service.list({projectId:f.p.id}).plugins[0].enabled,false);
  assert.equal(f.service.list({projectId:f.p.id}).plugins[0].runtime[0].status,'disposal_failed');
  await assert.rejects(f.enable({expectedRevision:2}),{code:'DISPOSAL_FAILED'});
});

test('trusted builtin adapter receives scoped config but no account/context migration',async t => {
  const f=await fixture(t), observed=[];
  const service=createPluginService({store:f.store,adapters:{models:{health:async ctx=>{observed.push(ctx);return {status:'ready',token:'must-discard'};},invoke:async(method,args,ctx)=>{observed.push({method,args,ctx});return {models:[]};}}},authorize:()=>true});
  await service.configure(f.binding({pluginId:'forge.models',config:{providerInstanceId:'fixture-instance'}}));
  await service.enable(f.binding({pluginId:'forge.models',expectedRevision:1}));
  const health=await service.health({projectId:f.p.id,pluginId:'forge.models'});assert.equal(health.status,'ready');assert.ok(!JSON.stringify(health).includes('must-discard'));
  const result=await service.invoke(f.input({capability:'models',method:'catalog',arguments:{providerInstanceId:'fixture-instance'}}));assert.deepEqual(result.result,{models:[]});
  await assert.rejects(service.invoke(f.input({capability:'models',method:'catalog',arguments:{providerInstanceId:'other-instance'}})),{code:'SCOPE'});
  assert.equal(observed[0].scope.projectId,f.p.id);assert.equal(observed[0].config.providerInstanceId,'fixture-instance');assert.ok(observed[0].signal instanceof AbortSignal);
  await service.close();assert.equal(createBuiltinPlugins({}).length,7);
});

test('shutdown rejects new calls and drains the existing lease before disposal',async t => {
  const native=deferred(),entered=deferred(),f=await fixture(t,{invoke:async()=>{entered.resolve();return native.promise;}});await f.enable();
  const call=f.invoke();await entered.promise;const shutdown=await f.service.close();assert.equal(shutdown.status,'draining');assert.equal(shutdown.activeCalls,1);
  await assert.rejects(f.invoke(),{code:'CLOSED'});native.resolve({done:true});await call;
  assert.equal((await f.service.close()).status,'disposed');
});

test('startup SQLite recovery marks orphaned pending reservations unknown without native execution',async t => {
  const f=await fixture(t);await f.enable();const input=f.input({capability:'fixture',method:'inspect',arguments:{}});
  const result=await f.service.invoke(input);
  // Trusted crash-state fixture: the external effect may have happened but its
  // terminal record did not commit. Reopen the actual SQLite database.
  await f.store.transaction(s=>{const e=s.events.find(e=>e.id===result.callId);e.status='pending';delete e.finishedAt;});
  await f.restart();
  const pending=f.store.read().events.find(e=>e.id===result.callId);assert.equal(pending.status,'unknown');assert.equal(pending.code,'PROCESS_RESTART_RECONCILIATION_REQUIRED');
  assert.equal((await f.service.invoke(input)).status,'unknown');assert.equal(f.calls.filter(x=>x[0]==='invoke').length,1);
  assert.deepEqual((await f.service.recover()).unknownCalls,[]);
});

test('malformed versions, contracts and catalog snapshot mutation cannot expand services',async t => {
  const f=await fixture(t);await f.enable();
  for(const version of [12,null,{},'^invalid','2','1.0.999999999999999999999999']) await assert.rejects(f.resolve({requires:[{capability:'fixture',version}]}),{code:'VERSION'});
  const view=f.service.list({projectId:f.p.id});view.plugins[0].provides[0].methods.injected=form();view.plugins[0].configSchema.properties.injected=id;
  await assert.rejects(f.invoke({method:'injected'}),{code:'METHOD_UNKNOWN'});
  await assert.rejects(f.service.configure(f.binding({expectedRevision:1,config:{injected:'x'}})),{code:'VALIDATION'});
  assert.throws(()=>createPluginService({store:f.store,builtins:[trustedPlugin(),trustedPlugin()]}),{code:'CONTRACT'});
  assert.throws(()=>createPluginService({store:f.store,builtins:[{...trustedPlugin(),configSchema:{type:'object',additionalProperties:true,properties:{}}}]}),{code:'CONTRACT'});
});

test('malformed factory instance cleans up, blocks execution and reports failed cleanup truthfully',async t => {
  let disposed=0;const p={...trustedPlugin(),create:async()=>({services:{},health:async()=>({status:'ready'}),dispose:async()=>{disposed++;}})},f=await fixture(t,{builtins:[p]});await f.enable();
  const h=await f.service.health({projectId:f.p.id,pluginId:p.id});assert.equal(h.code,'ACTIVATION_FAILED');assert.equal(disposed,1);
  const bad={...p,create:async()=>({services:{},health:async()=>({status:'ready'}),dispose:async()=>{throw new Error('private-dispose-error');}})},g=await fixture(t,{builtins:[bad]});await g.enable();
  const failed=await g.service.health({projectId:g.p.id,pluginId:p.id});assert.equal(failed.code,'DISPOSAL_FAILED');
  assert.equal(g.service.list({projectId:g.p.id}).plugins[0].runtime[0].status,'disposal_failed');
});

test('scope-bound native IDs reject wrong project/configured target before adapters run',async t => {
  let dispatches=0;const f=await fixture(t),service=createPluginService({store:f.store,adapters:{browser:{health:async()=>({status:'ready'}),invoke:async()=>{dispatches++;return {status:'ready'};}}},authorize:()=>true});t.after(()=>service.close());
  await service.configure(f.binding({pluginId:'forge.browser',config:{targetId:f.target.id}}));await service.enable(f.binding({pluginId:'forge.browser',expectedRevision:1}));
  await assert.rejects(service.invoke(f.input({capability:'browser',method:'inspect',arguments:{targetId:'another-target'}})),{code:'SCOPE'});
  assert.equal(dispatches,0);
  assert.equal((await service.invoke(f.input({capability:'browser',method:'inspect',arguments:{targetId:f.target.id}}))).status,'completed');assert.equal(dispatches,1);
});
