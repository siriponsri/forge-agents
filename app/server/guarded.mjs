import path from 'node:path';
import {realpathSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {installT3GuardedHost} from '../guarded-runtime/t3-host.mjs';
import {createGuardedRuntimeHost} from '../guarded-runtime/runtime-host.mjs';
import {createGuardedInstallationHost} from '../guarded-runtime/installation-host.mjs';
import {boundedToolSchemas} from '../guarded-runtime/transport.mjs';
import {inspectGuardedReceipt,inspectGuardedOperations} from '../guarded-runtime/broker.mjs';
import {checkProfile,canonical,digest,exact,fail} from '../guarded-runtime/profile.mjs';

const clone=structuredClone;
const sync=(fn,...args)=>{if(typeof fn!=='function')fail('GUARDED_HOST_CALLBACK_REQUIRED');const r=fn(...args);if(r?.then)fail('GUARDED_SYNCHRONOUS_CALLBACK_REQUIRED');return r;};
const terminal=new Set(['completed','failed','interrupted']);
const findRun=(s,id)=>s.runs.find(r=>r.id===id)??fail('GUARDED_CANONICAL_RUN_REQUIRED');
const toolManifest=boundedToolSchemas.map(x=>({operation:x.name,rawName:'forge_guarded_'+x.name,serverIdentity:'private-broker',schemaDigest:digest(x.inputSchema)}));
const same=(a,b)=>digest(a??null)===digest(b??null);
const inside=(a,b)=>{const r=path.relative(a,b);return r===''||!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep);};
function physical(file){let p=path.resolve(file);for(;;){try{return path.resolve(realpathSync(p),path.relative(p,file));}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(p);if(parent===p)throw e;p=parent;}}}

/** One trusted SAME-process owner per application. Nothing here is an HTTP,
 * model, MCP, account-management or alternate orchestration entry point.
 * Root must supply pure canonical admission at every stage, and project actual
 * native events into its existing domain/AG-UI via onEvent. No ordinary T3
 * controller, provider registry, credentials or legacy launcher is modified.
 */
export function createGuardedExecutionBridge({store,dataDir,artifacts,authorizeOwner,resolveProvider,observeSelectedRoute,validateAdmission,onEvent,onReceipt,onNativePhase,onBeforeAction,clock=Date.now}={}){
  if(!store||typeof store.read!=='function'||typeof store.transaction!=='function'||!path.isAbsolute(dataDir??''))fail('GUARDED_STORE_REQUIRED');
  const privateRoot=path.join(dataDir,'guarded-private'),installedArtifacts={},checks=new Map(),entries=new Map(),preparedValues=new WeakMap(),fenced=new AsyncLocalStorage();
  let closed=false,artifactIdentity,artifactPromise,reservation=null;
  const frame=()=>{const token=fenced.getStore();return token?.active?token.state:null;};
  const snapshot=()=>frame()??store.read();
  function selected(s,input){const value=sync(observeSelectedRoute,s,input);if(!value||value.projectId!==undefined&&value.projectId!==input.projectId)fail('GUARDED_ROUTE_REQUIRED');return clone(value);}
  function owner(s,detail){if(closed||sync(authorizeOwner,s,detail)!==true)fail('GUARDED_OWNER_DENIED');}
  function privatePaths(s){
    const editable=[...s.projects.map(p=>p.workspace),...s.runs.map(r=>r.workspace)].filter(Boolean).map(physical);
    const protectedDirectories=[privateRoot,fileURLToPath(new URL('../guarded-runtime',import.meta.url))];
    if(protectedDirectories.some(dir=>editable.some(root=>inside(root,physical(dir))||inside(physical(dir),root))))fail('GUARDED_PRIVATE_PATH_OVERLAP');
    for(const file of [fileURLToPath(import.meta.url),...Object.values(installedArtifacts).flatMap(a=>(a.files??[{path:a.path}]).map(f=>f.path))]){
      if(!path.isAbsolute(file??'')||editable.some(root=>inside(root,physical(file))))fail('GUARDED_PRIVATE_PATH_OVERLAP');
    }
  }
  async function loadArtifacts(){
    if(!artifactPromise)artifactPromise=(async()=>{
      const value=clone(typeof artifacts==='function'?await artifacts():artifacts);
      if(!value?.t3?.entry||!value.t3.files?.some(f=>f.path===value.t3.entry)||!value.opencode?.path||!value.fileBroker?.sha256)fail('GUARDED_ARTIFACTS_REQUIRED');
      const identity=digest(value);if(artifactIdentity&&identity!==artifactIdentity)fail('GUARDED_ARTIFACT_RESTART_REQUIRED');
      Object.assign(installedArtifacts,value);artifactIdentity=identity;privatePaths(store.read());return value;
    })().finally(()=>{artifactPromise=null;});
    return artifactPromise;
  }
  function proof(s,request){
    const check=checks.get(request?.projectId);if(!check?.handle)return null;
    // Qualifier observes current canonical route, never a cached supported flag.
    const now=selected(s,{projectId:request.projectId});if(!same(now,check.selected))return null;
    return check.host.qualifyRoute(check.handle,request);
  }
  function initial(e,s){
    const p=proof(s,e.request);if(!p||!same({...p,expiresAt:null},{...e.routeProof,expiresAt:null})||e.routeProof.expiresAt<=clock())fail('GUARDED_ROUTE_PROOF_CHANGED');return p;
  }
  function current(e,s,stage,extra={}){
    if(!e||e.revoked||closed)fail('GUARDED_AUTHORITY_REVOKED');
    const run=findRun(s,e.runId),c=run.guardedContext;
    if(!c||!same(c,e.context)||run.attemptId!==c.attemptId||run.threadId!==c.threadId||run.rootNodeId!==c.rootNodeId||run.operationId!==e.input.operationId||run.projectId!==e.input.projectId||run.taskId!==e.input.taskId||run.stopRequest||run.stopRequested||run.revoked||!['submitting','running'].includes(run.status))fail('GUARDED_CANONICAL_CONTEXT_CHANGED');
    if(!same(selected(s,e.input),e.selected))fail('GUARDED_SELECTED_ROUTE_CHANGED');
    if(!same(run.selection&&{instanceId:run.selection.instanceId,model:run.selection.model,options:run.selection.options??[]},e.selection))fail('GUARDED_SELECTION_CHANGED');
    if(e.dispatchReady&&(!run.guardedLaunch||run.guardedLaunch.messageDigest!==e.messageDigest||run.guardedLaunch.attemptId!==run.attemptId||run.guardedLaunch.contextId!==(run.contextId??null)||run.guardedLaunch.contextReceiptDigest!==digest(run.contextReceipt??null)))fail('GUARDED_FINAL_CONTEXT_CHANGED');
    if(physical(run.workspace??'')!==e.workspace||physical(s.projects.find(p=>p.id===run.projectId)?.workspace??'')!==e.sourceWorkspace)fail('GUARDED_WORKSPACE_CHANGED');
    privatePaths(s);initial(e,s);owner(s,{stage,input:clone(e.input),run});
    const detail={run,input:clone(e.input),stage,workspace:e.workspace,profile:clone(c.profile),routeProof:clone(e.routeProof),...extra};
    if(sync(validateAdmission,s,detail)!==true)fail('GUARDED_ADMISSION_DENIED');return run;
  }
  // All async native/broker operations acquire the authoritative store fence.
  // AsyncLocalStorage keeps a fenced snapshot private to its own async chain.
  // The runtime's synchronous current callback outside a fence reads the DB.
  const fence=(_runId,fn)=>store.transaction(async s=>{const token={state:s,active:true};try{return await fenced.run(token,fn);}finally{token.active=false;}});
  let runtimeHost;
  const t3Host=installT3GuardedHost({
    resolveThread(thread,selection){const e=[...entries.values()].find(e=>e.context.threadId===thread.id&&!e.revoked);if(!e||!same(selection,e.selection))fail('GUARDED_THREAD_DENIED');current(e,snapshot(),'current');return e.lease;},
    assertCurrent(lease){return runtimeHost.assertCurrent(lease);},
    runtimeDirectory(lease){return runtimeHost.runtimeDirectory(lease);},
    resolveConnection(input){return [...entries.values()].some(e=>{const c=e.connection;if(!c||e.revoked)return false;return input.serverUrl===c.url&&input.serverPassword===c.password&&input.binaryPath===c.binaryPath&&input.directory===c.runtimeDirectory&&same(input.environment??{},{})&&(current(e,snapshot(),'current'),true);});},
  });
  runtimeHost=createGuardedRuntimeHost({t3Host,artifacts:installedArtifacts,clock,
    readRun(id){const r=snapshot().runs.find(r=>r.id===id),e=entries.get(id);return r?{...r,profile:r.guardedContext?.profile,revoked:r.revoked||!e||e.revoked,stopRequested:!!(r.stopRequest||r.stopRequested)}:null;},
    validateReservation(input){if(!reservation||reservation.profile!==input.profile)return false;current(reservation.entry,reservation.state,'reservation');return true;},
    authorizeCurrent({profile,workspace}){
      const e=entries.get(profile.runId);if(e?.workspace!==workspace)return false;
      const s=snapshot(),run=current(e,s,'current');
      if(e.dispatchReady&&sync(validateAdmission,s,{run,input:clone(e.input),stage:'send',workspace:e.workspace,profile:clone(profile),routeProof:clone(e.routeProof),attestation:clone(e.attestation),messageDigest:e.messageDigest})!==true)fail('GUARDED_ADMISSION_DENIED');
      return true;
    },
    authorizeAction({profile,workspace,attestation,...action}){
      const s=frame();if(!s)fail('GUARDED_FENCE_REQUIRED');const e=entries.get(profile.runId);
      if(e?.workspace!==workspace||!same(attestation,e.attestation)||!e.attestation||!same(findRun(s,e.runId).guardedReceipt?.attestation,attestation))return false;
      const r=findRun(s,e.runId),turn=r.guardedProjection?.providerTurn;
      if(r.status!=='running'||turn?.status!=='running'||turn.runAttemptId!==r.attemptId||turn.nodeId!==r.rootNodeId||turn.providerThreadId!==e.providerThread?.id)fail('GUARDED_RUNNING_OBSERVATION_REQUIRED');
      current(e,s,'action',{...action,attestation:clone(attestation)});return true;
    },
    authorizeNativePhase({profile,workspace,...detail}){
      if(!onNativePhase)return true;
      const s=frame();if(!s)fail('GUARDED_FENCE_REQUIRED');const e=entries.get(profile.runId);
      if(e?.workspace!==workspace)return false;
      const run=current(e,s,'current');
      return sync(onNativePhase,s,{...clone(detail),run,profile:clone(profile),workspace})===true;
    },
    beforeAction:onBeforeAction?({profile,workspace,attestation,...detail})=>{
      const s=frame();if(!s)fail('GUARDED_FENCE_REQUIRED');const e=entries.get(profile.runId);
      if(e?.workspace!==workspace||!same(attestation,e.attestation))fail('GUARDED_RUN_ATTESTATION_REQUIRED');
      const run=current(e,s,'action',{capability:detail.capability,path:detail.path,attestation:clone(attestation)});
      if(sync(onBeforeAction,s,{run,profile:clone(profile),workspace,attestation:clone(attestation),...clone(detail)})!==undefined)fail('GUARDED_ACTION_CALLBACK_REQUIRED');
    }:undefined,
    recordReceipt(receipt){
      const s=frame();if(!s)fail('GUARDED_FENCE_REQUIRED');const e=entries.get(receipt.runId),run=current(e,s,'action',{capability:receipt.capability,path:receipt.path,attestation:clone(e.attestation)});
      if(receipt.owner!=='guarded-file-broker'||receipt.profileDigest!==digest(e.context.profile))fail('GUARDED_RECEIPT_CHANGED');
      const id='guarded-file:'+receipt.id,prior=s.receipts.find(r=>r.id===id);
      if(prior&&!same(prior.receipt,receipt))fail('GUARDED_RECEIPT_COLLISION');
      if(!prior)s.receipts.push({id,projectId:run.projectId,type:'guarded.file-receipt',runId:run.id,receipt:clone(receipt)});
      if(onReceipt&&sync(onReceipt,s,{run,receipt:clone(receipt)})!==undefined)fail('GUARDED_RECEIPT_CALLBACK_REQUIRED');
    },withFence:fence,
  });
  function metadata(e){return {runId:e.runId,attemptId:e.context.attemptId,threadId:e.context.threadId,rootNodeId:e.context.rootNodeId,profile:clone(e.context.profile),routeProof:clone(e.routeProof)};}
  async function consume(e,event){
    const result=await store.transaction(s=>{
      const run=findRun(s,e.runId);if(!same(run.guardedContext,e.context))fail('GUARDED_EVENT_CONTEXT_CHANGED');
      const p=run.guardedProjection??={version:1,providerSession:null,providerThread:null,providerTurn:null,nodes:[],messages:[],turnItems:[],terminal:null};
      const upsert=(key,v)=>{const i=p[key].findIndex(x=>x.id===v.id);if(i<0)p[key].push(v);else p[key][i]=v;};
      if(event.type==='provider_session.updated'){if(event.providerSession.id!==e.providerSessionId)return;p.providerSession=clone(event.providerSession);}
      else if(event.type==='provider_thread.updated'){if(event.providerThread.appThreadId!==e.context.threadId||e.providerThread&&event.providerThread.id!==e.providerThread.id)return;p.providerThread=clone(event.providerThread);}
      else if(event.type==='provider_turn.updated'){
        const t=event.providerTurn;if(t.runAttemptId!==e.context.attemptId||t.nodeId!==e.context.rootNodeId||t.providerThreadId!==e.providerThread?.id||p.providerTurn&&p.providerTurn.id!==t.id)return;
        p.providerTurn=clone(t);e.providerTurnId=t.id;
      }else if(event.type==='turn.terminal'){
        if(event.providerThreadId!==e.providerThread?.id||event.providerTurnId!==p.providerTurn?.id||event.runOrdinal!==e.context.runOrdinal||!terminal.has(event.status)||p.terminal)return;
        p.terminal=clone(event);e.terminal=clone(event);
      }else {
        const [key,v]=event.type==='node.updated'?['nodes',event.node]:event.type==='message.updated'?['messages',event.message]:event.type==='turn_item.updated'?['turnItems',event.turnItem]:[];
        if(!key||v.runId!==run.id||v.threadId!==e.context.threadId||v.providerThreadId&&v.providerThreadId!==e.providerThread?.id||v.providerTurnId&&v.providerTurnId!==p.providerTurn?.id)return;
        if(v.type==='reasoning'||v.kind==='reasoning')return;upsert(key,clone(v));
      }
      if(onEvent)sync(onEvent,s,{run,event:clone(event),projection:clone(p)});
      if(p.terminal)e.resolveTerminal?.(clone(p.terminal));
      return clone(p);
    });
    // Close outside the event consumer fiber/Tx so scope disposal never waits
    // on itself. Only an actual committed terminal can trigger this cleanup.
    if(e.terminal&&!e.cleanup)setImmediate(()=>{void cleanup(e,'native-terminal').catch(()=>{});});
    return result;
  }
  async function openNative(e){
    const n=await import(pathToFileURL(installedArtifacts.t3.entry).href),{Effect,Layer,Stream,Scope}=n;
    const scope=await Effect.runPromise(Scope.make());e.native={n,scope};
    // A real private ProviderHost; no TestProviderHost/default fixture policy.
    // This adapter consumes paths only. Settings/credential/background/attachment
    // services deny accidental expansion beyond the fixed private bootstrap.
    const denied=()=>Effect.die(new Error('GUARDED_NATIVE_SERVICE_UNSUPPORTED'));
    const host=n.ProviderHost.ProviderHost.of({paths:{cwd:e.runtimeDirectory,baseDir:e.homeDirectory,stateDir:e.homeDirectory,providerStatusCacheDir:e.homeDirectory,attachmentsDir:e.homeDirectory},settings:{get:denied(),withSnapshot:denied,changes:Stream.empty,subscribe:Effect.succeed(Stream.empty)},shouldRunBackgroundWork:()=>Effect.succeed(false),resolveAttachmentPath:()=>null,credentials:denied,compatibility:()=>Effect.succeed(undefined)});
    const layer=Layer.mergeAll(Layer.succeed(n.ProviderHost.ProviderHost,host),n.IdAllocator.layer,n.McpProviderSessions.layer).pipe(Layer.provide(n.NodeServices.layer),Layer.provide(n.NodeHttpClient.layerNodeHttp),Layer.provide(n.NodeCrypto.layerDigest));
    // Node services must also be present in the exported Context used by calls.
    const all=Layer.mergeAll(layer,n.NodeServices.layer,n.NodeHttpClient.layerNodeHttp,n.NodeCrypto.layerDigest);
    const context=await Effect.runPromise(Layer.build(all).pipe(Effect.provideService(Scope.Scope,scope)));
    e.native.run=effect=>Effect.runPromise(effect.pipe(Effect.provide(context),Effect.provideService(Scope.Scope,scope)));
    e.native.close=async()=>{const exit=await Effect.runPromise(Effect.exit(Effect.void));await Effect.runPromise(Scope.close(scope,exit));};
    await e.native.run(Effect.gen(function*(){
      const client=yield* n.Client.make;
      const server=yield* n.Server.make({binaryPath:e.connection.binaryPath,serverUrl:e.connection.url,serverPassword:e.connection.password,directory:e.runtimeDirectory,environment:{}}).pipe(Effect.provideService(n.Client.OpenCode2Client,client));
      const adapter=yield* n.Adapter.make(e.selection.instanceId).pipe(Effect.provideService(n.Server.OpenCode2Server,server));
      e.policy={runtimeMode:'approval-required',interactionMode:'default',cwd:e.runtimeDirectory,forgeGuard:n.resolveProfile({id:e.context.threadId},e.selection)};
      e.session=yield* adapter.openSession({threadId:e.context.threadId,providerSessionId:e.providerSessionId,modelSelection:e.selection,runtimePolicy:e.policy});
      yield* e.session.events.pipe(Stream.runForEach(event=>Effect.promise(()=>consume(e,event))),Effect.forkIn(scope));
      e.providerThread=yield* e.session.ensureThread({threadId:e.context.threadId,title:e.title,modelSelection:e.selection,runtimePolicy:e.policy});
    }));
  }
  async function cleanup(e,reason){e.revoked=true;if(e.cleanup)return e.cleanup;e.cleanup=(async()=>{try{await e.native?.close?.();}finally{await runtimeHost.close(e.lease,reason);e.provider=null;e.connection=null;}})();return e.cleanup;}
  const api={
    async check({projectId,leaseMs=300000}={}){
      if(closed)fail('GUARDED_CLOSED');if(!projectId)fail('GUARDED_PROJECT_REQUIRED');await loadArtifacts();
      const s=store.read(),choice=selected(s,{projectId});privatePaths(s);
      const prior=checks.get(projectId);if(prior?.checking)fail('GUARDED_CHECK_PENDING');
      const c={selected:choice,checking:true,host:createGuardedInstallationHost({t3Host,artifacts:installedArtifacts,clock,stateDirectory:path.join(privateRoot,'checks',digest(projectId)),observeSelectedRoute:()=>selected(store.read(),{projectId})})};
      checks.set(projectId,c);
      try{c.handle=await c.host.check({leaseMs});if(closed)fail('GUARDED_CLOSED');return c.host.readiness(c.handle);}
      catch(error){checks.delete(projectId);if(c.handle)await c.host.close(c.handle);throw error;}
      finally{c.checking=false;if(prior?.handle)await prior.host.close(prior.handle);}
    },
    readiness({projectId}={}){const c=checks.get(projectId);return c?.handle?c.host.readiness(c.handle):null;},
    qualifyProactive(s,request){try{return proof(s,request);}catch{return null;}},
    async prepare(input){
      const before=store.read();owner(before,{stage:'prepare',input});
      if(!artifactIdentity)fail('GUARDED_SETUP_REQUIRED');privatePaths(before);
      if(!input||input.projectId!==input.request?.projectId||input.taskId!==input.request?.taskId||typeof input.operationId!=='string'||!input.operationId||typeof input.message!=='string'||!input.message||Buffer.byteLength(input.message)>65536||!path.isAbsolute(input.workspace??''))fail('GUARDED_PREPARATION_INVALID');
      const request=clone(input.request);exact(request.limits,['maxRunMs','maxTokens','maxCost']);
      if(request.limits.maxTokens!==null||request.limits.maxCost!==null||!Number.isSafeInteger(request.limits.maxRunMs)||request.limits.maxRunMs<1000||request.limits.maxRunMs>3600000)fail('UNENFORCEABLE_LIMIT');
      const routeProof=proof(before,request);if(!routeProof)fail('GUARDED_ROUTE_UNQUALIFIED');
      const choice=selected(before,input),resolved=await (typeof resolveProvider==='function'?resolveProvider(clone(input),{selected:clone(choice)}):fail('GUARDED_HOST_CALLBACK_REQUIRED'));
      const after=store.read();owner(after,{stage:'prepare',input});if(!same(choice,selected(after,input))||!proof(after,request))fail('GUARDED_SELECTED_ROUTE_CHANGED');
      const provider=clone(resolved?.provider);exact(provider,['id','model','compatibility','settings']);
      if(resolved.accountGeneration!==choice.route.accountGeneration||typeof resolved.credentialRef!=='string'||!resolved.credentialRef||provider.id!==choice.route.apiProviderId||provider.id+'/'+provider.model!==choice.route.modelId)fail('GUARDED_PROVIDER_CHANGED');
      // Bootstrap supports a fixed compatible chat provider only. Secret env refs
      // must be resolved by the root vault; no env/config/file expansion is run.
      if(!provider.compatibility||!provider.settings||Object.keys(provider.settings).some(k=>!['baseURL','apiKey','transport','headers'].includes(k))||provider.settings.transport!=='http'||typeof provider.settings.apiKey!=='string'||!provider.settings.apiKey||/\{env:|\$\{|\{file:/.test(canonical(provider)))fail('GUARDED_PROVIDER_UNSUPPORTED');
      const url=new URL(provider.settings.baseURL);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('GUARDED_PROVIDER_UNSUPPORTED');
      // Fail options/profile shape before any canonical allocation or side effect.
      const workspace=physical(input.workspace),sourceWorkspace=physical(after.projects.find(p=>p.id===input.projectId)?.workspace??'');
      const runtimeDirectory=path.join(privateRoot,'runs',randomUUID(),'runtime'),homeDirectory=path.join(path.dirname(runtimeDirectory),'home'),receiptPath=path.join(path.dirname(runtimeDirectory),'effects','effects.sqlite');
      const profile={version:1,projectId:input.projectId,taskId:input.taskId,runId:'preparation',threadId:'preparation',envelopeDigest:request.envelopeDigest,identitySnapshot:request.identitySnapshot,scope:{...request.scope,maxBytes:65536},route:choice.route,policyGeneration:choice.policyGeneration,toolGeneration:choice.toolGeneration,manifestDigest:digest(toolManifest),contextDigest:digest({provider,runtimeDirectory,toolManifest}),expiresAt:Math.min(routeProof.expiresAt,clock()+request.limits.maxRunMs)};checkProfile(profile,clock());
      const handle=Object.freeze({});preparedValues.set(handle,{input:clone(input),selected:choice,provider,credentialRef:resolved.credentialRef,request,routeProof,workspace,sourceWorkspace,runtimeDirectory,homeDirectory,receiptPath,profile});return handle;
    },
    reserve(s,{run,input,prepared}){
      const p=preparedValues.get(prepared);if(!p||p.consumed||!same(input,p.input))fail('GUARDED_PREPARED_REQUIRED');
      if(s.runs.find(r=>r.id===run.id)!==run||s.runs.some(r=>r.id!==run.id&&r.operationId===run.operationId)||entries.has(run.id)||s.runs.some(r=>r.id!==run.id&&r.guardedContext?.threadId===run.threadId))fail('GUARDED_RESERVATION_COLLISION');
      for(const key of ['id','attemptId','threadId','rootNodeId'])if(typeof run[key]!=='string'||!run[key])fail('GUARDED_CANONICAL_IDENTITIES_REQUIRED');
      const profile=checkProfile({...p.profile,runId:run.id,threadId:run.threadId},clock());
      const context={version:1,profile,attemptId:run.attemptId,threadId:run.threadId,rootNodeId:run.rootNodeId,runOrdinal:run.runOrdinal??1,providerTurnOrdinal:run.providerTurnOrdinal??1,providerSessionId:run.providerSessionId??'guarded-session:'+run.id,storageId:path.basename(path.dirname(p.runtimeDirectory)),credentialRef:p.credentialRef,routeProof:clone(p.routeProof),inputDigest:digest(input)};
      const e={...p,context,runId:run.id,selection:{instanceId:profile.route.providerInstanceId,model:profile.route.modelId,options:profile.route.options},title:run.title??'FORGE guarded task',providerSessionId:context.providerSessionId,revoked:false};
      run.guardedContext=context;entries.set(run.id,e);
      try{current(e,s,'reservation');reservation={state:s,profile,entry:e};e.lease=runtimeHost.reserve({profile,operationId:input.operationId,workspace:e.workspace,runtimeDirectory:e.runtimeDirectory,homeDirectory:e.homeDirectory,receiptPath:e.receiptPath,provider:e.provider,toolManifest,limits:e.request.limits});p.consumed=true;return metadata(e);}
      catch(error){entries.delete(run.id);delete run.guardedContext;throw error;}finally{reservation=null;}
    },
    launch(runId,{message}={}){
      const e=entries.get(runId);if(!e)return Promise.reject(Object.assign(new Error('GUARDED_PRIVATE_LEASE_REQUIRED'),{code:'GUARDED_PRIVATE_LEASE_REQUIRED'}));
      if(typeof message!=='string'||!message||Buffer.byteLength(message)>65536)return Promise.reject(Object.assign(new Error('GUARDED_FINAL_MESSAGE_REQUIRED'),{code:'GUARDED_FINAL_MESSAGE_REQUIRED'}));
      if(e.launch)return e.messageDigest===digest(message)?e.launch:Promise.reject(Object.assign(new Error('GUARDED_LAUNCH_COLLISION'),{code:'GUARDED_LAUNCH_COLLISION'}));
      e.messageDigest=digest(message);
      e.launch=(async()=>{
        try{
          current(e,store.read(),'current');e.connection=await runtimeHost.bind(e.lease);await openNative(e);
          e.attestation=await runtimeHost.attest(e.lease,{nativeSessionId:e.providerThread.nativeThreadRef.nativeId,threadId:e.context.threadId,modelSelection:e.selection});
          if(!runtimeHost.qualify(e.lease,e.request))fail('GUARDED_RUN_ATTESTATION_REQUIRED');
          await store.transaction(s=>{const r=current(e,s,'current');r.guardedReceipt={version:1,owner:'guarded-native-session',profileDigest:digest(e.context.profile),routeEvidenceId:e.routeProof.evidenceId,providerThread:clone(e.providerThread),attestation:clone(e.attestation)};});
          e.terminalPromise=new Promise(resolve=>{e.resolveTerminal=resolve;});
          let messageId;
          await fence(runId,()=>{
            const r=current(e,frame(),'send',{attestation:clone(e.attestation),messageDigest:e.messageDigest});
            r.guardedLaunch={messageDigest:e.messageDigest,attemptId:r.attemptId,contextId:r.contextId??null,contextReceiptDigest:digest(r.contextReceipt??null)};messageId=r.messageId??'guarded-message:'+runId;
          });
          // Native RPCs acquire the SAME canonical fence through /fence. Never
          // await those while holding the store Tx (that deadlocks). The private
          // host and native phase callbacks revalidate send after this commit.
          e.dispatchReady=true;e.dispatchRequested=true;
          await e.native.run(e.session.startTurn({appThread:{id:e.context.threadId,title:e.title,runtimeMode:'approval-required',interactionMode:'default'},threadId:e.context.threadId,runId,runOrdinal:e.context.runOrdinal,providerTurnOrdinal:e.context.providerTurnOrdinal,attemptId:e.context.attemptId,rootNodeId:e.context.rootNodeId,providerThread:e.providerThread,message:{messageId,text:message,attachments:[],createdBy:'user',creationSource:'web',scheduledTaskId:null,senderThreadId:null},modelSelection:e.selection,runtimePolicy:e.policy}));
          return api.reconcile(runId);
        }catch(error){
          await store.transaction(s=>{const r=findRun(s,runId);if(!terminal.has(r.status)){r.guardedDispatch={status:e.dispatchRequested?'unknown':'not-dispatched',error:/^[A-Z_]+$/.test(error.code??'')?error.code:'GUARDED_NATIVE_FAILURE'};r.status=e.dispatchRequested?'unknown':'failed';}});
          await cleanup(e,'launch-failed');throw error;
        }
      })();return e.launch;
    },
    reconcile(runId){const r=findRun(store.read(),runId);return {runId:r.id,status:r.status,attemptId:r.attemptId,projection:clone(r.guardedProjection??null),receipt:clone(r.guardedReceipt??null),dispatch:clone(r.guardedDispatch??null),live:!!entries.get(runId)&&!entries.get(runId).revoked};},
    async stop(runId){
      const e=entries.get(runId);if(e)e.revoked=true; // immediate, before queued Tx
      if(e?.stopPromise)return e.stopPromise;
      const stopping=(async()=>{
      await store.transaction(s=>{const r=findRun(s,runId);r.stopRequest??={requestedAt:new Date(clock()).toISOString(),source:'guarded-owner'};});
      if(e?.session&&e.providerTurnId&&!e.terminal){
        try{await e.native.run(e.session.interruptTurn({providerThread:e.providerThread,providerTurnId:e.providerTurnId,requestRuntimeRestart:true}));await Promise.race([e.terminalPromise,new Promise(resolve=>{const timer=setTimeout(resolve,5000);timer.unref?.();})]);}catch{/* Absence of a real terminal remains unknown. */}
      }
      await store.transaction(s=>{const r=findRun(s,runId);if(!r.guardedProjection?.terminal&&!terminal.has(r.status)){r.status='unknown';r.guardedDispatch={status:'unknown',reason:'stop-without-native-terminal'};}});
      if(e)await cleanup(e,'stop');return api.reconcile(runId);
      })();if(e)e.stopPromise=stopping;return stopping;
    },
    async invalidateCredentials(predicate=()=>true){const affected=[...entries.values()].filter(e=>sync(predicate,{projectId:e.input.projectId,credentialRef:e.credentialRef,accountGeneration:e.selected.route.accountGeneration})===true);for(const e of affected)e.revoked=true;await Promise.allSettled(affected.map(e=>api.stop(e.runId)));},
    async recover(){return store.transaction(s=>{const recovered=[];for(const r of s.runs.filter(r=>r.guardedContext&&!entries.has(r.id)&&['submitting','running'].includes(r.status))){r.status='unknown';r.guardedDispatch={status:'unknown',reason:'process-lease-lost-no-redispatch'};recovered.push(r.id);}return recovered;});},
    inspectReceipt(runId,operationId){
      const s=store.read(),r=findRun(s,runId),c=r.guardedContext;
      if(c?.profile?.runId!==runId||!/^[a-f0-9-]{36}$/.test(c.storageId??''))fail('GUARDED_CONTEXT_REQUIRED');
      privatePaths(s);
      const receiptPath=path.join(privateRoot,'runs',c.storageId,'effects','effects.sqlite');
      return inspectGuardedReceipt({receiptPath,runId,operationId});
    },
    inspectOperations(runId){
      const s=store.read(),r=findRun(s,runId),c=r.guardedContext;
      if(c?.profile?.runId!==runId||!/^[a-f0-9-]{36}$/.test(c.storageId??''))fail('GUARDED_CONTEXT_REQUIRED');
      privatePaths(s);
      return inspectGuardedOperations({receiptPath:path.join(privateRoot,'runs',c.storageId,'effects','effects.sqlite'),runId});
    },
    async close(){if(closed)return;closed=true;for(const e of entries.values())e.revoked=true;await Promise.allSettled([...entries.values()].map(e=>cleanup(e,'shutdown')));await Promise.allSettled([...checks.values()].filter(c=>c.handle).map(c=>c.host.close(c.handle)));checks.clear();},
  };
  api.setup=api.check;return Object.freeze(api);
}
