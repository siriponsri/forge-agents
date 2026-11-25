import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileDigest} from './file-digest.mjs';
import {randomBytes,createHmac} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertInstalledT3Host,registerInstallationConnection} from './t3-host.mjs';
import {createBoundedBroker,signRequest} from './broker.mjs';
import {openConfinedText} from './windows-client.mjs';
import {openLocalGateway} from './local-gateway.mjs';
import {boundedToolSchemas} from './transport.mjs';
import {canonical,digest,bytesDigest,secretEqual,relativeTextPath,exact,fail} from './profile.mjs';

/** Machine-owned bounded installation/check job, NOT a FORGE task/run or a
 * provider turn. It retains a live, default-deny native component lease. No
 * persisted report/config/supported flag can restore its private capability.
 * Readiness carries no execution authority: product reserve/bind/attest and
 * canonical per-action admission remain independent mandatory gates.
 */
export function createGuardedInstallationHost({t3Host,observeSelectedRoute,artifacts,stateDirectory,clock=Date.now}){
  assertInstalledT3Host(t3Host);if(typeof observeSelectedRoute!=='function'||!path.isAbsolute(stateDirectory))fail('INSTALLATION_HOST_REQUIRED');
  const checks=new WeakMap();
  const state=handle=>checks.get(handle)??fail('PRIVATE_INSTALLATION_CHECK_REQUIRED');
  const selected=()=>{const value=observeSelectedRoute();if(!value||value.then)fail('SYNCHRONOUS_ROUTE_OBSERVATION_REQUIRED');return value;};
  function artifact(name){const d=artifacts[name];if(!d)fail('INSTALLATION_ARTIFACT_REQUIRED');return d.files?digest(d.files.map(f=>({name:f.name,sha256:fileDigest(f.path)})).sort((a,b)=>a.name.localeCompare(b.name))):fileDigest(d.path);}
  function current(s){if(s.closed||clock()>=s.expiresAt||digest(selected())!==s.selectedDigest||artifact('t3')!==s.profile.route.t3BinarySha256||artifact('opencode')!==s.profile.route.opencodeBinarySha256)fail('INSTALLATION_LEASE_CHANGED');return s.profile;}
  async function close(handle){const s=state(handle);if(s.closing)return s.closing;s.closed=true;s.revokeT3?.();clearTimeout(s.timer);s.closing=(async()=>{if(s.child){s.child.kill();await s.childDone;}if(s.gateway)await s.gateway.close();if(s.broker)await s.broker.close();s.key.fill(0);})();return s.closing;}
  async function api(s,endpoint,body,headers={}){current(s);const res=await fetch(s.url+endpoint,{method:body===undefined?'GET':'POST',headers:{Authorization:'Basic '+Buffer.from('opencode:'+s.password).toString('base64'),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:canonical(body)}),signal:AbortSignal.timeout(30000)});if(!res.ok){let diagnostic;try{diagnostic=await res.json();}catch{}fail('INSTALLATION_NATIVE_CHECK_FAILED'+(/^[a-z_]+$/.test(diagnostic?.stage??'')?'_'+diagnostic.stage.toUpperCase():''));}return res.json();}
  return Object.freeze({
    async check({leaseMs=300000}={}){
      if(!Number.isSafeInteger(leaseMs)||leaseMs<10000||leaseMs>3600000)fail('INSTALLATION_DEADLINE_REQUIRED');
      await mkdir(stateDirectory,{recursive:true});const root=await mkdtemp(path.join(stateDirectory,'guarded-check-')),runtimeDirectory=path.join(root,'runtime'),home=path.join(root,'home'),workspace=path.join(root,'quarantine');
      for(const dir of [runtimeDirectory,home,path.join(workspace,'allowed')])await mkdir(dir,{recursive:true});
      await writeFile(path.join(workspace,'allowed/check.txt'),'before');
      const choice=structuredClone(selected()),route=choice.route;
      if(route.providerImplementation!=='opencode2-api'||route.t3BinarySha256!==artifact('t3')||route.opencodeBinarySha256!==artifact('opencode'))fail('INSTALLATION_ROUTE_CHANGED');
      const key=randomBytes(32),checkId='installation:'+randomBytes(16).toString('hex'),expiresAt=clock()+leaseMs;
      // This descriptor belongs to the machine check job. Null project/task and
      // explicit purpose ensure it cannot stand in for a canonical task run.
      const provider={id:route.apiProviderId,model:route.modelId.slice(route.modelId.indexOf('/')+1),compatibility:{},settings:{baseURL:'http://127.0.0.1:1/NO_PROVIDER_AUTHORITY',apiKey:'installation-no-account',transport:'http'}};
      const toolManifest=boundedToolSchemas.map(x=>({operation:x.name,rawName:'forge_guarded_'+x.name,serverIdentity:'private-broker',schemaDigest:digest(x.inputSchema)}));
      const profile={version:1,purpose:'installation-check',checkId,projectId:null,taskId:null,runId:checkId,threadId:null,route,scope:{paths:['allowed'],capabilities:['read','propose','workspace.write'],maxBytes:1024},manifestDigest:digest(toolManifest),contextDigest:digest({provider,runtimeDirectory,toolManifest}),toolGeneration:choice.toolGeneration,policyGeneration:choice.policyGeneration,expiresAt};
      const handle=Object.freeze({}),s={root,profile,key,selectedDigest:digest(choice),expiresAt,password:randomBytes(32).toString('base64url'),closed:false,nativeSessionId:null};checks.set(handle,s);
      let tail=Promise.resolve();const fence=(_id,fn)=>{const work=tail.then(fn);tail=work.catch(()=>{});return work;};
      try{
        const file=await openConfinedText({binary:artifacts.fileBroker.path,binarySha256:artifacts.fileBroker.sha256,root:workspace});
        const authority={assert:()=>current(s)};
        s.broker=createBoundedBroker({authority,handle,key,file,receiptPath:path.join(root,'effects.sqlite'),withFence:fence,authorize:()=>true});
        const request=(id,request)=>signRequest(key,{version:1,runId:checkId,operationId:id,request});
        const read=await s.broker.receive(request('check-read',{tool:'read_text',path:'allowed/check.txt'}));
        await s.broker.receive(request('check-propose',{tool:'propose_change',path:'allowed/check.txt',expectedRevision:read.revision,text:'after'}));
        const edit=request('check-edit',{tool:'edit_text',path:'allowed/check.txt',expectedRevision:read.revision,text:'after'});
        await s.broker.receive(edit);const replay=await s.broker.receive(edit);if(!replay.replayed)fail('INSTALLATION_REPLAY_CHECK_FAILED');
        for(const requestBody of [{tool:'read_text',path:'../outside.txt'},{tool:'edit_text',path:'../outside.txt',expectedRevision:read.revision,text:'BAD'},{tool:'shell',command:'MUST_NOT_RUN'}]){
          let denied=false;try{await s.broker.receive(request('negative-'+randomBytes(8).toString('hex'),requestBody));}catch{denied=true;}if(!denied)fail('INSTALLATION_BROKER_CHECK_FAILED');
        }
        s.gateway=await openLocalGateway({authority,handle,key,broker:s.broker,withFence:fence,nativeSessionId:()=>s.nativeSessionId,authorizeNativePhase:body=>['create','attest','discovery','raw','resolved','executor'].includes(body.phase)});
        const env={SystemRoot:process.env.SystemRoot,TEMP:home,TMP:home,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:home,XDG_DATA_HOME:home,XDG_CACHE_HOME:home,FORGE_GUARDED_BOOTSTRAP_FD:'3',OPENCODE_PASSWORD:s.password,OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_DISABLE_MODELS_FETCH:'1',OPENCODE_DISABLE_FILEWATCHER:'1',OPENCODE_DISABLE_FFF:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL'};
        s.child=spawn(artifacts.opencode.path,['serve','--hostname','127.0.0.1','--port','0'],{cwd:runtimeDirectory,env,windowsHide:true,stdio:['ignore','pipe','pipe','pipe']});s.childDone=new Promise(resolve=>s.child.once('close',resolve));s.child.once('exit',()=>{void close(handle);});
        s.timer=setTimeout(()=>void close(handle),leaseMs);
        const url=new Promise((resolve,reject)=>{let text='';const output=b=>{text=(text+b).slice(-16000);const found=text.match(/http:\/\/127\.0\.0\.1:[0-9]+/);if(found)resolve(found[0]);};s.child.stdout.on('data',output);s.child.stderr.on('data',output);s.child.once('error',reject);s.child.once('exit',()=>reject(Error('INSTALLATION_NATIVE_EXIT')));});
        s.child.stdio[3].end(canonical({version:1,profile,key:key.toString('hex'),brokerUrl:s.gateway.url,provider,runtimeDirectory,toolManifest}));
        const timer=new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('INSTALLATION_TIMEOUT')),15000);url.then(()=>clearTimeout(t),()=>clearTimeout(t));});s.url=await Promise.race([url,timer]);
        if(!path.isAbsolute(artifacts.t3.entry??'')||!artifacts.t3.files?.some(f=>f.path===artifacts.t3.entry))fail('COMPILED_T3_ENTRY_REQUIRED');
        const connection={binaryPath:artifacts.opencode.path,serverUrl:s.url,serverPassword:s.password,directory:runtimeDirectory,environment:{}};
        s.revokeT3=registerInstallationConnection(t3Host,connection,()=>current(s));
        const nativeT3=await import(pathToFileURL(artifacts.t3.entry).href),t3Check=await nativeT3.probeInstallationConnection(connection);current(s);
        if(t3Check.negativeCount!==2||t3Check.providerTurns!==0||!['2.4.1-forge-guarded.0','2.4.1-forge-frontend.0'].includes(t3Check.version))fail('COMPILED_T3_CHECK_FAILED');
        const rules=[{action:'*',resource:'*',effect:'deny'},...['read_text','propose_change','edit_text'].map(name=>({action:'forge_guarded_'+name,resource:'*',effect:'allow'}))];
        const session=(await api(s,'/api/session',{location:{directory:runtimeDirectory},model:{providerID:provider.id,id:provider.model},permissions:rules})).data;s.nativeSessionId=session.id;
        const body={nonce:randomBytes(32).toString('hex'),sessionID:session.id},mac=createHmac('sha256',key).update(canonical(body)).digest('hex');
        const observed=await api(s,'/api/forge/attest',body,{'X-Forge-Probe':mac}),r=observed.result;
        if(!secretEqual(observed.mac,createHmac('sha256',key).update(canonical(r)).digest('hex'))||r.nonce!==body.nonce||r.pid!==s.child.pid||r.profileDigest!==digest(profile)||r.binarySha256!==route.opencodeBinarySha256||r.effects!==0||r.negativeCount!==17)fail('INSTALLATION_GATE_CHECK_FAILED');
        let denied=false;try{await api(s,`/api/session/${session.id}/prompt`,{text:'Installation check has no model authority.'});}catch{denied=true;}if(!denied)fail('INSTALLATION_MODEL_AUTHORITY_CHECK_FAILED');
        s.readiness={version:1,purpose:'installation-readiness',checkId,evidenceId:'guarded-route-v1:'+digest({selected:choice,toolManifest}),selectedDigest:s.selectedDigest,observedBinarySha256:r.binarySha256,nativePid:r.pid,negativeCount:r.negativeCount,t3NegativeCount:t3Check.negativeCount,brokerChecks:7,providerTurns:0,expiresAt};
        await writeFile(path.join(root,'check-receipt.json'),canonical(s.readiness)+'\n');return handle;
      }catch(e){await close(handle);throw e;}
    },
    readiness(handle){const s=state(handle);try{current(s);if(!s.readiness||!s.child||s.child.exitCode!==null||s.child.signalCode)return null;return structuredClone(s.readiness);}catch{return null;}},
    qualifyRoute(handle,request){
      const s=state(handle);try{current(s);if(request.purpose!==undefined||!s.readiness||!s.child||s.child.exitCode!==null||s.child.signalCode||request.limits?.maxTokens!==null||request.limits?.maxCost!==null)return null;
        exact(request.limits,['maxRunMs','maxTokens','maxCost']);if(!Number.isSafeInteger(request.limits.maxRunMs)||request.limits.maxRunMs<1000||request.limits.maxRunMs>3600000)return null;
        exact(request.scope,['paths','capabilities']);
        if(!request.scope?.paths?.length||request.scope.capabilities.some(c=>!['read','propose','workspace.write'].includes(c)))return null;request.scope.paths.forEach(p=>p==='.'?null:relativeTextPath(p));
        for(const key of ['projectId','taskId','envelopeDigest','identitySnapshot'])if(typeof request[key]!=='string'||!request[key])return null;
        return {version:1,projectId:request.projectId,taskId:request.taskId,envelopeDigest:request.envelopeDigest,identitySnapshot:request.identitySnapshot,scopeDigest:digest(request.scope),mode:'mediated-actions',nativeActions:'guarded',normalizedActions:'guarded',evidenceId:s.readiness.evidenceId,expiresAt:s.expiresAt};
      }catch{return null;}
    },
    qualifyFrontendRoute(handle,request){
      const s=state(handle);try{
        current(s);if(request.purpose!=='supervised-frontend-v1'||!s.readiness||!s.child||s.child.exitCode!==null||s.child.signalCode)return null;
        exact(request.scope,['paths','capabilities']);
        if(digest(request.scope)!==digest({paths:['.'],capabilities:['frontend_selection_read']}))return null;
        exact(request.limits,['maxRunMs','maxTokens','maxCost']);
        if(request.limits.maxTokens!==null||request.limits.maxCost!==null||!Number.isSafeInteger(request.limits.maxRunMs)||request.limits.maxRunMs<1000||request.limits.maxRunMs>3600000)return null;
        for(const key of ['projectId','taskId','envelopeDigest','identitySnapshot'])if(typeof request[key]!=='string'||!request[key])return null;
        return {version:1,purpose:request.purpose,projectId:request.projectId,taskId:request.taskId,envelopeDigest:request.envelopeDigest,identitySnapshot:request.identitySnapshot,scopeDigest:digest(request.scope),mode:'supervised-frontend',nativeActions:'selection-only',normalizedActions:'selection-only',evidenceId:'frontend-route-v1:'+digest({selected:selected(),scope:request.scope,installation:s.readiness.evidenceId}),expiresAt:s.expiresAt};
      }catch{return null;}
    },
    close,
  });
}
