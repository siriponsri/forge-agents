import {spawn} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {fileDigest} from './file-digest.mjs';
import {randomBytes,createHmac} from 'node:crypto';
import path from 'node:path';
import {checkProfile,createProfileAuthority,canonical,digest,secretEqual,exact,fail} from './profile.mjs';
import {assertInstalledT3Host,observeInstalledT3Host} from './t3-host.mjs';
import {createBoundedBroker} from './broker.mjs';
import {openConfinedText} from './windows-client.mjs';
import {openLocalGateway} from './local-gateway.mjs';
import {createNativeSessionDiagnostics} from './native-diagnostics.mjs';

/** Private prepared-route lifecycle; T3 alone creates canonical run/turn records
 * and sends prompts. `reserve` is synchronous and memory-only. `bind` never
 * sends a provider/model request. `attest` invokes the actual native gate probe.
 * No API here is mounted on HTTP/MCP or accepts model-owned configuration.
 */
export function createGuardedRuntimeHost({t3Host,readRun,validateReservation,authorizeCurrent,authorizeAction,authorizeNativePhase,beforeAction,recordReceipt,withFence,artifacts,createFrontendGateway,createSessionGateway,clock=Date.now}){
  assertInstalledT3Host(t3Host);
  if(![readRun,validateReservation,authorizeCurrent,authorizeAction,recordReceipt,withFence].every(x=>typeof x==='function'))fail('CANONICAL_HOST_REQUIRED');
  if([authorizeNativePhase,beforeAction].some(x=>x!==undefined&&typeof x!=='function'))fail('CANONICAL_HOST_REQUIRED');
  const leases=new WeakMap();
  const state=lease=>leases.get(lease)??fail('PRIVATE_ROUTE_LEASE_REQUIRED');
  const synchronous=(fn,...args)=>{const result=fn(...args);if(result?.then)fail('SYNCHRONOUS_CANONICAL_STATE_REQUIRED');return result;};
  const artifact=(name,expected)=>{const descriptor=artifacts[name];if(!descriptor)fail('RUNTIME_ARTIFACT_CHANGED');const actual=descriptor.files?digest(descriptor.files.map(file=>({name:file.name,sha256:fileDigest(file.path)})).sort((a,b)=>a.name.localeCompare(b.name))):fileDigest(descriptor.path);if(actual!==expected)fail('RUNTIME_ARTIFACT_CHANGED');};
  function current(s){
    if(s.phase==='closed')fail('ROUTE_CLOSED');
    artifact('t3',s.profile.route.t3BinarySha256);artifact('opencode',s.profile.route.opencodeBinarySha256);
    const run=synchronous(readRun,s.profile.runId);
    if(s.profile.purpose==='supervised-orchestrator-v1'&&run?.attemptId!==s.profile.attemptId)fail('CANONICAL_ATTEMPT_CHANGED');
    if(!run||run.operationId!==s.operationId||run.projectId!==s.profile.projectId||run.taskId!==s.profile.taskId||!['submitting','running'].includes(run.status)||run.stopRequested||run.revoked||digest(run.profile)!==digest(s.profile))fail('CANONICAL_RUN_NOT_DISPATCHABLE');
    checkProfile(run.profile,clock());
    if(synchronous(authorizeCurrent,{profile:run.profile,run,workspace:s.workspace,runtimeDirectory:s.runtimeDirectory})!==true)fail('CANONICAL_CURRENT_AUTHORITY_DENIED');
    return {profile:run.profile,runtimeMode:'approval-required',governanceAllowed:true};
  }
  function outsideWorkspace(workspace,target){let existing=path.resolve(target);for(;;){try{const actual=realpathSync(existing),rel=path.relative(realpathSync(workspace),path.resolve(actual,path.relative(existing,target)));if(rel===''||!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep))fail('PRIVATE_RUNTIME_OVERLAPS_WORKSPACE');return;}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(existing);if(parent===existing)throw e;existing=parent;}}}
  function close(lease,reason='closed'){
    const s=state(lease);if(s.closePromise)return s.closePromise;s.phase='closed';s.reason=reason;clearTimeout(s.timer);
    s.closePromise=(async()=>{
    if(s.child){s.child.kill();await s.childDone;}
    if(s.gateway)await s.gateway.close();if(s.broker)await s.broker.close();s.key.fill(0);
    // Canonical T3 status/recovery is the owner. Receipts are retained; unknown
    // dispatches/effects never become an automatic retry grant here.
    })();return s.closePromise;
  }
  async function api(s,endpoint,body,extra={}){
    current(s);if(!s.url||!s.child||s.child.exitCode!==null||s.child.signalCode)fail('NATIVE_PROCESS_NOT_LIVE');
    const response=await fetch(s.url+endpoint,{method:body===undefined?'GET':'POST',headers:{Authorization:'Basic '+Buffer.from('opencode:'+s.password).toString('base64'),'Content-Type':'application/json',...extra},...(body===undefined?{}:{body:canonical(body)}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)fail('NATIVE_ATTESTATION_DENIED');return response.json();
  }
  return Object.freeze({
    // Observation only: never calls current(), root admission, or a qualifier.
    privateSnapshot(lease){const s=state(lease);let live=s.phase==='attested'&&!!s.attestation&&!!s.child&&s.child.exitCode===null&&!s.child.signalCode&&clock()<s.profile.expiresAt;
      if(live)try{artifact('t3',s.profile.route.t3BinarySha256);artifact('opencode',s.profile.route.opencodeBinarySha256);}catch{live=false;}
      return structuredClone({profile:s.profile,attestation:s.attestation??null,phase:s.phase,phases:observeInstalledT3Host(t3Host,lease)?.phases??[],live,diagnostics:s.diagnostics.snapshot()});},
    assertCurrent(lease){return current(state(lease)).profile;},
    runtimeDirectory(lease){return state(lease).runtimeDirectory;},
    reserve(input){
      if(synchronous(validateReservation,input)!==true)fail('RESERVATION_DENIED');
      exact(input.limits,['maxRunMs','maxTokens','maxCost']);
      const profile=checkProfile(input.profile,clock());
      if(!['workspace','runtimeDirectory','homeDirectory','receiptPath'].every(k=>typeof input[k]==='string'&&path.isAbsolute(input[k])))fail('ABSOLUTE_PRIVATE_PATHS_REQUIRED');
      if(typeof input.operationId!=='string'||!input.operationId||input.limits?.maxTokens!==null||input.limits?.maxCost!==null||!Number.isSafeInteger(input.limits?.maxRunMs)||input.limits.maxRunMs<1000||input.limits.maxRunMs>3600000)fail('UNENFORCEABLE_LIMIT');
      artifact('t3',profile.route.t3BinarySha256);artifact('opencode',profile.route.opencodeBinarySha256);
      const lease=Object.freeze({});leases.set(lease,{...structuredClone(input),profile,phase:'reserved',key:randomBytes(32),password:randomBytes(32).toString('base64url'),nativeSessionId:null,diagnostics:createNativeSessionDiagnostics()});return lease;
    },
    async bind(lease){
      const s=state(lease);if(s.phase!=='reserved')fail('ROUTE_ALREADY_BOUND');current(s);
      // Host-owned paths and provider descriptor are hashed into the private
      // context binding. Config/import/environment expansion never grants scope.
      outsideWorkspace(s.workspace,s.runtimeDirectory);outsideWorkspace(s.workspace,s.homeDirectory);outsideWorkspace(s.workspace,path.dirname(s.receiptPath));
      for(const artifact of Object.values(artifacts))for(const file of artifact.files??[{path:artifact.path}])outsideWorkspace(s.workspace,file.path);
      await mkdir(s.runtimeDirectory,{recursive:true});await mkdir(s.homeDirectory,{recursive:true});await mkdir(path.dirname(s.receiptPath),{recursive:true});
      if(digest({provider:s.provider,runtimeDirectory:s.runtimeDirectory,toolManifest:s.toolManifest})!==s.profile.contextDigest||digest(s.toolManifest)!==s.profile.manifestDigest)fail('BOOTSTRAP_CONTEXT_CHANGED');
      s.phase='binding';
      try{
        const authority=createProfileAuthority({readCurrent:()=>current(s),clock}),handle=authority.bind(s.profile);
        if(['supervised-frontend-v1','supervised-orchestrator-v1'].includes(s.profile.purpose)){
          const createGateway=s.profile.purpose==='supervised-orchestrator-v1'?createSessionGateway:createFrontendGateway;
          if(typeof createGateway!=='function')fail(s.profile.purpose==='supervised-orchestrator-v1'?'SESSION_GATEWAY_REQUIRED':'FRONTEND_GATEWAY_REQUIRED');
          s.gateway=await createGateway({profile:structuredClone(s.profile),assertCurrent:()=>current(s).profile,
            withFence:fn=>withFence(s.profile.runId,fn),authorizePhase:(body,profile)=>{
              const p=current(s).profile;if(digest(profile)!==digest(p)||body.profileDigest!==digest(p))fail('FRONTEND_PROFILE_CHANGED');
              if(body.sessionID!==null&&body.sessionID!==s.nativeSessionId)fail('NATIVE_SESSION_CHANGED');
              const permitted=s.phase==='attested'||['create','discovery'].includes(body.phase);
              return permitted&&(!authorizeNativePhase||synchronous(authorizeNativePhase,{profile:p,run:synchronous(readRun,p.runId),workspace:s.workspace,runtimeDirectory:s.runtimeDirectory,body,phase:s.phase,attestation:s.attestation??null})===true);
            }});
          if(!s.gateway||!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(s.gateway.url)||typeof s.gateway.bootstrap!=='function'||typeof s.gateway.close!=='function')fail('FRONTEND_GATEWAY_REQUIRED');
          const bootstrap=s.gateway.bootstrap();exact(bootstrap,['key','brokerUrl']);
          if(bootstrap.brokerUrl!==s.gateway.url||!/^[a-f0-9]{64}$/.test(bootstrap.key))fail('FRONTEND_GATEWAY_REQUIRED');
          s.key.fill(0);s.key=Buffer.from(bootstrap.key,'hex');
        }else{
        const file=await openConfinedText({binary:artifacts.fileBroker.path,binarySha256:artifacts.fileBroker.sha256,root:s.workspace});
        s.broker=createBoundedBroker({authority,handle,key:s.key,file,receiptPath:s.receiptPath,withFence,recordReceipt,beforeAction:beforeAction?input=>{
          if(s.phase!=='attested')fail('NATIVE_ATTESTATION_REQUIRED');
          return synchronous(beforeAction,{...input,workspace:s.workspace,attestation:s.attestation});
        }:undefined,authorize:input=>{
          if(s.phase!=='attested')fail('NATIVE_ATTESTATION_REQUIRED');
          return synchronous(authorizeAction,{...input,workspace:s.workspace,attestation:s.attestation})===true;
        }});
        s.gateway=await openLocalGateway({authority,handle,key:s.key,broker:s.broker,withFence,nativeSessionId:()=>s.nativeSessionId,authorizeNativePhase:body=>{
          const permitted=s.phase==='attested'||['create','discovery'].includes(body.phase)||s.phase==='attesting'&&['attest','raw','resolved','executor'].includes(body.phase);
          return permitted&&(!authorizeNativePhase||synchronous(authorizeNativePhase,{profile:s.profile,run:synchronous(readRun,s.profile.runId),workspace:s.workspace,runtimeDirectory:s.runtimeDirectory,body,phase:s.phase,attestation:s.attestation??null})===true);
        }});
        }
        const env={SystemRoot:process.env.SystemRoot,TEMP:s.homeDirectory,TMP:s.homeDirectory,HOME:s.homeDirectory,USERPROFILE:s.homeDirectory,APPDATA:s.homeDirectory,LOCALAPPDATA:s.homeDirectory,XDG_CONFIG_HOME:s.homeDirectory,XDG_DATA_HOME:s.homeDirectory,XDG_CACHE_HOME:s.homeDirectory,FORGE_GUARDED_BOOTSTRAP_FD:'3',OPENCODE_PASSWORD:s.password,OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_DISABLE_MODELS_FETCH:'1',OPENCODE_DISABLE_FILEWATCHER:'1',OPENCODE_DISABLE_FFF:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL'};
        s.child=spawn(artifacts.opencode.path,['serve','--hostname','127.0.0.1','--port','0'],{cwd:s.runtimeDirectory,env,windowsHide:true,stdio:['ignore','pipe','pipe','pipe']});
        s.child.stderr.on('data',chunk=>s.diagnostics.push(chunk));
        s.childDone=new Promise(resolve=>s.child.once('close',resolve));
        s.child.once('exit',()=>{void close(lease,'native-exit');});
        s.timer=setTimeout(()=>void close(lease,'expiry'),Math.max(1,Math.min(s.profile.expiresAt-clock(),s.limits.maxRunMs)));
        const url=new Promise((resolve,reject)=>{let text='';const inspect=b=>{text+=b.toString();if(text.length>32000)text=text.slice(-32000);const match=text.match(/http:\/\/127\.0\.0\.1:[0-9]+/);if(match)resolve(match[0]);};s.child.stdout.on('data',inspect);s.child.stderr.on('data',inspect);s.child.once('error',reject);s.child.once('exit',()=>reject(Error('NATIVE_BOOTSTRAP_FAILED')));});
        s.child.stdio[3].end(canonical({version:1,profile:s.profile,key:s.key.toString('hex'),brokerUrl:s.gateway.url,provider:s.provider,runtimeDirectory:s.runtimeDirectory,toolManifest:s.toolManifest}));
        s.url=await Promise.race([url,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('NATIVE_BOOTSTRAP_TIMEOUT')),15000);s.childDone.then(()=>clearTimeout(timer));})]);
        current(s);const info=await api(s,'/api/info');if(!['2.4.1-forge-guarded.0','2.4.1-forge-frontend.0','2.4.1-forge-sessions.0'].includes(String(info.version??info.data?.version)))fail('NATIVE_VERSION_CHANGED');
        s.phase='bound';return Object.freeze({url:s.url,password:s.password,binaryPath:artifacts.opencode.path,runtimeDirectory:s.runtimeDirectory,profileHandle:lease});
      }catch(e){await close(lease,'bind-failed');throw e;}
    },
    async attest(lease,{nativeSessionId,threadId,modelSelection}){
      const s=state(lease);if(s.phase!=='bound')fail('NATIVE_BIND_REQUIRED');current(s);
      if(threadId!==s.profile.threadId||modelSelection.instanceId!==s.profile.route.providerInstanceId||modelSelection.model!==s.profile.route.modelId||digest(modelSelection.options??{})!==digest(s.profile.route.options))fail('NATIVE_SELECTION_CHANGED');
      const session=(await api(s,`/api/session/${encodeURIComponent(nativeSessionId)}`)).data;
      const variant=Array.isArray(s.profile.route.options)?s.profile.route.options.find(x=>x.id==='variant')?.value:s.profile.route.options.variant;
      if(session.location.directory!==s.runtimeDirectory||session.parentID||session.metadata?.forgeGuard?.profileDigest!==digest(s.profile)||session.model.providerID!==s.profile.route.apiProviderId||`${session.model.providerID}/${session.model.id}`!==s.profile.route.modelId||(session.model.variant??'default')!==(variant??'default'))fail('NATIVE_SESSION_CHANGED');
      const frontend=s.profile.purpose==='supervised-frontend-v1',orchestrator=s.profile.purpose==='supervised-orchestrator-v1';
      const purposeNames=orchestrator?['forge_sessions_session_children','forge_sessions_session_prompt']:['forge_frontend_selection_read'];
      const expectedRules=[{action:'*',resource:'*',effect:'deny'},...(frontend||orchestrator?purposeNames:['read_text','propose_change','edit_text'].map(name=>'forge_guarded_'+name)).map(action=>({action,resource:'*',effect:'allow'}))];
      if(digest(session.permissions)!==digest(expectedRules))fail('NATIVE_POLICY_CHANGED');
      s.nativeSessionId=nativeSessionId;s.phase='attesting';
      if(frontend||orchestrator){
        // The default three-tool negative probe cannot attest another purpose.
        // Observe the authenticated actual session and shared T3 lifecycle only.
        current(s);const native=observeInstalledT3Host(t3Host,lease);
        if(!native?.phases.includes('openSession')||!native.phases.includes('ensureThread')||s.child.exitCode!==null||s.child.signalCode)fail('NATIVE_PROCESS_NOT_LIVE');
        const p=s.profile,r={version:1,purpose:p.purpose,sessionID:nativeSessionId,pid:s.child.pid,binarySha256:p.route.opencodeBinarySha256,profileDigest:digest(p),manifestDigest:p.manifestDigest,contextDigest:p.contextDigest,toolGeneration:p.toolGeneration,policyGeneration:p.policyGeneration,runtimeDirectory:s.runtimeDirectory,names:purposeNames};
        s.attestation=Object.freeze({...r,evidenceId:(orchestrator?'orchestrator-session-v1:':'frontend-session-v1:')+digest(r)});s.phase='attested';return structuredClone(s.attestation);
      }
      const body={nonce:randomBytes(32).toString('hex'),sessionID:nativeSessionId},mac=createHmac('sha256',s.key).update(canonical(body)).digest('hex');
      try{
        const observed=await api(s,'/api/forge/attest',body,{'X-Forge-Probe':mac}),r=observed.result;
        if(!secretEqual(observed.mac,createHmac('sha256',s.key).update(canonical(r)).digest('hex'))||r.nonce!==body.nonce||r.sessionID!==nativeSessionId||r.pid!==s.child.pid||r.binarySha256!==s.profile.route.opencodeBinarySha256||r.profileDigest!==digest(s.profile)||r.manifestDigest!==s.profile.manifestDigest||r.contextDigest!==s.profile.contextDigest||r.toolGeneration!==s.profile.toolGeneration||r.policyGeneration!==s.profile.policyGeneration||r.effects!==0||r.negativeCount!==17)fail('NATIVE_PROBE_FAILED');
        s.attestation=Object.freeze({...r,evidenceId:'guarded-v1:'+digest(r)});s.phase='attested';return structuredClone(s.attestation);
      }catch(e){await close(lease,'attestation-failed');throw e;}
    },
    qualify(lease,request){
      const s=state(lease);try{current(s);if(s.profile.purpose||s.phase!=='attested'||!s.attestation||!s.child||s.child.exitCode!==null||s.child.signalCode)return null;
        const native=observeInstalledT3Host(t3Host,lease);if(!native?.phases.includes('openSession')||!native.phases.includes('ensureThread'))return null;
        const p=s.profile,scope={paths:p.scope.paths,capabilities:p.scope.capabilities};
        if(request.projectId!==p.projectId||request.taskId!==p.taskId||request.envelopeDigest!==p.envelopeDigest||request.identitySnapshot!==p.identitySnapshot||digest(request.scope)!==digest(scope)||digest(request.limits)!==digest(s.limits))return null;
        return {version:1,projectId:p.projectId,taskId:p.taskId,envelopeDigest:p.envelopeDigest,identitySnapshot:p.identitySnapshot,scopeDigest:digest(scope),mode:'mediated-actions',nativeActions:'guarded',normalizedActions:'guarded',evidenceId:s.attestation.evidenceId,expiresAt:p.expiresAt};
      }catch{return null;}
    },
    close,
  });
}
