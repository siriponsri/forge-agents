import { spawn } from 'node:child_process';
import { mkdir, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { entity, find, fail, changed } from './domain.mjs';
import { appendProtocol } from './agui.mjs';
import { createProtocolController } from '../protocol/controller.mjs';
import {validateAdaptiveContext,adaptivePrompt} from './adaptive-context.mjs';
import {digest as contextDigest} from '../adaptive/records.mjs';
import { openT3ReadFeed, openT3ApprovalChannel } from '../protocol/t3-rpc.mjs';
import {openT3ProviderChannel,validateSetupRequest} from '../providers/t3-setup-rpc.mjs';
import {validateAssistanceContext,assistancePrompt} from '../assistance/context.mjs';
import {assertWorkspaceAvailable} from './admission.mjs';
import {validateRelayAdmission,validateRelayDispatch} from '../relay/admission.mjs';
import {validateGoalContext,goalPrompt} from '../goals/context.mjs';
import {createNativeProviderCatalog} from '../providers/native-catalog.mjs';
import {validateProactiveContext,proactivePrompt,proactiveEnforcementRequest,validateProactiveEnforcement} from '../proactive/index.mjs';
import {validateWorkspaceContext,resolveWorkspaceForRun,workspacePrompt,assertIsolatedWorkspaceAvailable} from '../workspaces/index.mjs';
import {reserveBudget,validateBudgetAdmission} from '../budgets/index.mjs';

const launcher=fileURLToPath(new URL('../vendor/t3/bin/t3.mjs',import.meta.url));
// app/server -> repo root is two parent directories.
export async function availablePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
export function createT3Service({dataDir,store,validateProviderSelection,prepareCapabilities,checkCapabilities,prepareContext,resolveProviderEnvironment,onNotDispatched,nativeTransport}){
  // Host-only dependency seam for deterministic pinned-contract qualification.
  // createApplication never accepts it from HTTP, configuration or persisted state.
  if(nativeTransport&&['call','cli','openFeed'].some(key=>typeof nativeTransport[key]!=='function'))throw new TypeError('Native transport requires call, cli and openFeed');
  const home=path.join(dataDir,'t3');let child,client,startPromise,url,issueSession,shuttingDown=false;let status='not_started',error,readToken,readSession;
  const pendingRuns=new Set(),credentialEnv=new Map();
  const nativeCatalog=createNativeProviderCatalog({rpc:providerRpc,capabilities:()=>call('orchestrator_capabilities',{})});
  const osEnv=new Set(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA','APPDATA','ProgramFiles','ProgramFiles(x86)','ProgramW6432','CommonProgramFiles','ComSpec','PATHEXT','SystemDrive','LANG','LC_ALL','LANGUAGE','SSL_CERT_FILE','SSL_CERT_DIR']);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>osEnv.has(key)));
  const isolatedHome=path.join(home,'runtime-home');env.HOME=isolatedHome;env.USERPROFILE=isolatedHome;env.XDG_CONFIG_HOME=path.join(isolatedHome,'.config');env.XDG_DATA_HOME=path.join(isolatedHome,'.local','share');env.XDG_CACHE_HOME=path.join(isolatedHome,'.cache');env.CODEX_HOME=path.join(isolatedHome,'.codex');
  env.T3CODE_HOME=home;env.T3CODE_NO_BROWSER='true';
  function cli(args,{timeout=30000}={}){if(nativeTransport)return nativeTransport.cli(args);return new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,[launcher,...args],{env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let out='',err='';
    const timer=setTimeout(()=>{p.kill();reject(new Error('T3 command timeout; reconcile before repeating a mutating command'));},timeout);
    p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);
    p.once('error',e=>{clearTimeout(timer);reject(e);});p.once('exit',code=>{clearTimeout(timer);code===0?resolve(out.trim()):reject(new Error(`T3 ${args.slice(0,2).join(" ")} exited ${code}: ${err.slice(-1500)}`));});
  });}
  async function call(name,args){await start();if(shuttingDown)fail('SHUTTING_DOWN','T3 is shutting down',409);if(nativeTransport)return nativeTransport.call(name,args);const result=await client.callTool({name,arguments:args},undefined,{timeout:30000});if(result.isError)fail('T3_OPERATION',result.content?.find(c=>c.type==='text')?.text??'T3 operation failed',502);return result.structuredContent??JSON.parse(result.content.find(c=>c.type==='text').text);}
  async function assertEnvironment(connection){
    if(!resolveProviderEnvironment)return;
    const values=await resolveProviderEnvironment(connection);await start();
    for(const [name,value] of Object.entries(values))if(credentialEnv.get(name)!==value)fail('PROVIDER_RESTART_REQUIRED','This provider key changed after T3 started. Stop FORGE and reopen its launcher before using this key. No key is written into provider configuration.',409);
  }
  async function start(){
    if(shuttingDown)fail('SHUTTING_DOWN','T3 is shutting down',409);
    await protocol.recover();
    if(nativeTransport){status='ready';url=nativeTransport.url??null;return {status,url,version:'0.1.11',qualification:'INJECTED_NATIVE_TRANSPORT'};}
    if(client)return {status,url,version:'0.1.11'};if(startPromise)return startPromise;
    startPromise=(async()=>{
      status='starting';await mkdir(isolatedHome,{recursive:true});const port=await availablePort();url=`http://127.0.0.1:${port}`;
      credentialEnv.clear();
      for(const c of store.read().connections.filter(c=>c.kind==='provider'&&c.enabled!==false)){
        let values;try{values=await resolveProviderEnvironment?.(c)??{};}catch{continue;}
        for(const [name,value] of Object.entries(values)){if(credentialEnv.has(name)&&credentialEnv.get(name)!==value)fail('SECRET_NAME_CONFLICT','Different project keys use the same environment name. Save distinct generated names in Settings before starting T3.',409);credentialEnv.set(name,value);}
      }
      if(shuttingDown)fail('SHUTTING_DOWN','T3 is shutting down',409);
      for(const [name,value] of credentialEnv)env[name]=value;
      child=spawn(process.execPath,[launcher,'serve','--host','127.0.0.1','--port',String(port),'--base-dir',home],{env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
      const log=path.join(dataDir,'t3.log');child.stdout.on('data',b=>appendFile(log,b).catch(()=>{}));child.stderr.on('data',b=>appendFile(log,b).catch(()=>{}));
      let exited;child.on('exit',code=>{exited=code;status='stopped';client=undefined;});child.on('error',e=>{error=e.message;status='failed';});
      const deadline=Date.now()+120000;
      while(Date.now()<deadline){if(shuttingDown)fail('SHUTTING_DOWN','T3 is shutting down',409);if(exited!==undefined||status==='failed')throw new Error(`T3 did not start; inspect local t3.log (${error??exited})`);try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});await r.body?.cancel();if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
      // Issue a new short-lived credential only in FORGE's own fresh T3 control plane.
      // Never read, migrate or log credentials from the development application.
      const pairing=JSON.parse(await cli(['auth','pairing','create','--base-dir',home,'--label','FORGE local bridge','--ttl','1m','--scope','orchestration:read','--scope','orchestration:operate','--json']));
      const label=`FORGE local bridge ${crypto.randomUUID()}`;
      const post=async(route,input,form=false)=>{const r=await fetch(new URL(route,url),{method:'POST',headers:{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'},body:form?new URLSearchParams(input):JSON.stringify(input),signal:AbortSignal.timeout(10000)});const value=await r.json();if(!r.ok)throw new Error(`T3 local authorization ${route}: ${value.message??value.error_description??r.status}`);return value;};
      const callback='http://127.0.0.1:4317/forge-local-callback';
      const registered=await post('/oauth/mcp/register',{client_name:label,redirect_uris:[callback],token_endpoint_auth_method:'none'});
      const verifier=randomBytes(32).toString('base64url');
      const authorization={response_type:'code',client_id:registered.client_id,redirect_uri:callback,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state:randomBytes(16).toString('hex'),resource:`${url}/mcp`};
      const approved=await post('/oauth/mcp/decision',{authorization,decision:{_tag:'pairing-code',access:'approval-required',code:pairing.credential}});
      const code=new URL(approved.redirectTo).searchParams.get('code');
      const issued=await post('/oauth/mcp/token',{grant_type:'authorization_code',code,redirect_uri:callback,client_id:registered.client_id,code_verifier:verifier,resource:`${url}/mcp`},true);
      const token=issued.access_token;
      if(!token)throw new Error('T3 did not return an MCP access token for the FORGE bridge');
      const sessions=JSON.parse(await cli(['auth','session','list','--base-dir',home,'--json']));
      issueSession=sessions.find?.(s=>s.client?.label===label)?.sessionId;
      client=new Client({name:'forge-local-bridge',version:'0.2.0'},{capabilities:{}});
      await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',url),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
      status='ready';error=null;return {status,url,version:'0.1.11'};
    })().catch(e=>{status='failed';error=e.message;child?.kill();client=undefined;throw e;}).finally(()=>{startPromise=undefined;});
    return startPromise;
  }
  async function openApprovalChannel(input){
    await start();
    const label=`FORGE single permission response ${crypto.randomUUID()}`;
    const pairing=JSON.parse(await cli(['auth','pairing','create','--base-dir',home,'--label',label,'--ttl','1m','--scope','orchestration:operate','--json']));
    let channel,sessionId;
    try{
      const response=await fetch(new URL('/oauth/token',url),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',subject_token:pairing.credential,subject_token_type:'urn:t3:params:oauth:token-type:environment-bootstrap',requested_token_type:'urn:ietf:params:oauth:token-type:access_token',scope:'orchestration:operate',client_label:label}),signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error(`T3 permission authorization failed (${response.status})`);
      const token=(await response.json()).access_token;
      const sessions=JSON.parse(await cli(['auth','session','list','--base-dir',home,'--json']));sessionId=sessions.find?.(s=>s.client?.label===label)?.sessionId;
      const issued=await fetch(new URL('/api/auth/websocket-ticket',url),{method:'POST',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
      if(!issued.ok)throw new Error(`T3 permission ticket failed (${issued.status})`);
      channel=await openT3ApprovalChannel({url,ticket:(await issued.json()).ticket});
      return await channel.respondApproval(input);
    }finally{channel?.close();if(sessionId)await cli(['auth','session','revoke',sessionId,'--base-dir',home]).catch(()=>{});}
  }
  async function ensureProject(projectId,{workspace:isolatedWorkspace}={}){
    const p=find(store.read(),'projects',projectId);await start();
    const workspace=isolatedWorkspace??p.workspace;
    let listed=await call('t3_project_list',{limit:100});
    const matches=x=>path.resolve(x.workspaceRoot).toLowerCase()===path.resolve(workspace).toLowerCase();
    let project=listed.projects.find(matches);
    if(!project){await cli(['project','add',workspace,'--base-dir',home,'--title',p.name]);listed=await call('t3_project_list',{limit:100});project=listed.projects.find(matches);}
    if(!project)fail('T3_PROJECT','T3 project registration was not observed',502);return project;
  }
  async function providerRpc(tag,payload){
    validateSetupRequest(tag,payload);await start();
    const label=`FORGE provider setup ${crypto.randomUUID()}`,scopes=['providers:manage','orchestration:read'];
    let channel,sessionId;
    try{
      const pairing=JSON.parse(await cli(['auth','pairing','create','--base-dir',home,'--label',label,'--ttl','1m',...scopes.flatMap(s=>['--scope',s]),'--json']));
      const response=await fetch(new URL('/oauth/token',url),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',subject_token:pairing.credential,subject_token_type:'urn:t3:params:oauth:token-type:environment-bootstrap',requested_token_type:'urn:ietf:params:oauth:token-type:access_token',scope:scopes.join(' '),client_label:label}),signal:AbortSignal.timeout(10000)});
      if(!response.ok)fail('T3_SETUP_AUTH','Could not authorize the isolated provider setup channel',502);
      const token=(await response.json()).access_token,sessions=JSON.parse(await cli(['auth','session','list','--base-dir',home,'--json']));sessionId=sessions.find?.(s=>s.client?.label===label)?.sessionId;
      const ticket=await fetch(new URL('/api/auth/websocket-ticket',url),{method:'POST',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
      if(!ticket.ok)fail('T3_SETUP_AUTH','Could not issue the provider setup channel ticket',502);
      channel=await openT3ProviderChannel({url,ticket:(await ticket.json()).ticket});return await channel.request(tag,payload);
    }finally{channel?.close();if(sessionId)await cli(['auth','session','revoke',sessionId,'--base-dir',home]).catch(()=>{});}
  }
  const protocol=createProtocolController({store,call,sendApproval:openApprovalChannel,openFeed:async onDisconnect=>{
    if(nativeTransport)return nativeTransport.openFeed(onDisconnect);
    await start();
    const label=`FORGE read-only protocol feed ${crypto.randomUUID()}`;
    if(!readToken){
      const pairing=JSON.parse(await cli(['auth','pairing','create','--base-dir',home,'--label',label,'--ttl','1m','--scope','orchestration:read','--json']));
      const response=await fetch(new URL('/oauth/token',url),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',subject_token:pairing.credential,subject_token_type:'urn:t3:params:oauth:token-type:environment-bootstrap',requested_token_type:'urn:ietf:params:oauth:token-type:access_token',scope:'orchestration:read',client_label:label}),signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error(`T3 read-only feed authorization failed (${response.status})`);
      readToken=(await response.json()).access_token;
      const sessions=JSON.parse(await cli(['auth','session','list','--base-dir',home,'--json']));
      readSession=sessions.find?.(s=>s.client?.label===label)?.sessionId;
    }
    const response=await fetch(new URL('/api/auth/websocket-ticket',url),{method:'POST',headers:{Authorization:`Bearer ${readToken}`},signal:AbortSignal.timeout(10000)});
    if(!response.ok){readToken=undefined;throw new Error(`T3 read-only feed ticket failed (${response.status}); reconnect explicitly`);}
    const {ticket}=await response.json();
    return openT3ReadFeed({url,ticket,onDisconnect});
  }});
  const api={
    ...protocol,
    adaptiveContextVersion:1,
    assistanceContextVersion:1,
    relayContextVersion:1,
    goalContextVersion:1,
    proactiveContextVersion:1,
    proactiveEnforcementVersion:1,
    workspaceContextVersion:1,
    // Pinned T3 exposes supervision, not a FORGE all-action path sandbox.
    // Never manufacture route qualification from Owner approval or a prompt.
    qualifyProactive(){return null;},
    providers:{rpc:providerRpc,ensureProject,assertEnvironment,catalog:input=>nativeCatalog.read(input),call(name,args){if(!['orchestrator_capabilities','t3_thread_launch','t3_thread_send','t3_thread_read','t3_thread_interrupt','t3_thread_list'].includes(name))fail('T3_METHOD','Unsupported provider owner operation',403);return call(name,args);}},
    start,
    health(){return {status,url,version:'0.1.11',sourceRevision:'59651c1761f6c63e9b6056839067066968e6a406',error};},
    async tools(){await start();return (await client.listTools()).tools;},
    async catalog(){return call('orchestrator_capabilities',{});},
    async startRun(input){
      await prepareCapabilities?.(input.projectId);
      await protocol.recover();
      let replay=false;
      const run=await store.transaction(s=>{
        if(!input.operationId)fail('VALIDATION','operationId required');
        const prior=s.runs.find(r=>r.operationId===input.operationId);if(prior){if(prior.projectId!==input.projectId||prior.taskId!==input.taskId||['adaptiveContext','assistanceContext','relayContext','goalContext','proactiveContext','workspaceContext'].some(key=>contextDigest(prior[key]??null)!==contextDigest(input[key]??null))||(prior.conversationId??null)!==(input.conversationId??null))fail('OPERATION_REUSE','Run operation ID belongs to different work or context',409);replay=true;return prior;}
        const p=find(s,'projects',input.projectId),task=find(s,'tasks',input.taskId,p.id);
        const adaptiveContext=validateAdaptiveContext(s,input);
        const assistanceContext=validateAssistanceContext(s,input);
        const relayContext=validateRelayAdmission(s,input);
        const goalContext=validateGoalContext(s,input);
        const proactiveContext=validateProactiveContext(s,input);
        if(proactiveContext)validateProactiveEnforcement(s,input,api.qualifyProactive(s,proactiveEnforcementRequest(s,input)));
        const workspaceContext=validateWorkspaceContext(s,input);
        if(input.conversationId)find(s,'conversations',input.conversationId,p.id);
        if(!task.planId || !find(s,'plans',task.planId,p.id).approved)fail('PLAN_REQUIRED','Review and approve the concrete plan before starting',409);
        if(workspaceContext)assertIsolatedWorkspaceAvailable(s,p.id,input);
        else assertWorkspaceAvailable(s,p.id,{adaptiveLoopId:adaptiveContext?.loopId,assistanceLoopId:assistanceContext?.loopId,goalClaimId:goalContext?.claimId,proactiveOccurrenceId:proactiveContext?.occurrenceId});
        for(const dep of task.dependsOn??[])if(find(s,'tasks',dep,p.id).status!=='done')fail('DEPENDENCY','Task has unfinished dependencies',409);
        const selection=structuredClone(assistanceContext?.selection??p.profile?.provider??null);
        if(!selection?.instanceId||!selection?.model)fail('MODEL_REQUIRED','Connect a provider and select an observed model before starting',409);
        const harnessSelection=checkCapabilities?.(s,{...input,botId:task.botId},['provider',...(adaptiveContext?['skills']:[])]);
        const approvalSnapshot={taskRevision:task.revision,planRevision:find(s,'plans',task.planId,p.id).revision,botRevision:task.botId?find(s,'bots',task.botId,p.id).revision:null,...(relayContext?{relayTask:structuredClone(task)}:{})};
        const r=entity({operationId:input.operationId,taskId:task.id,botId:task.botId,conversationId:input.conversationId,...(adaptiveContext?{adaptiveContext}:{}),...(assistanceContext?{assistanceContext}:{}),...(relayContext?{relayContext}:{}),...(goalContext?{goalContext}:{}),...(proactiveContext?{proactiveContext}:{}),...(workspaceContext?{workspaceContext}:{}),...(harnessSelection?{harnessSelection}:{}),approvalSnapshot,selection,providerInstanceId:selection?.instanceId,status:'submitting',attemptId:crypto.randomUUID(),profileRevision:p.revision,profile:structuredClone(p.profile),protocolEvents:[],messages:[]},p.id);s.runs.push(r);reserveBudget(s,{run:r,input});task.runIds.push(r.id);changed(task);return r;
      });if(replay)return run;
      let launchRequested=false;
      try{
        const s=store.read(),p=find(s,'projects',run.projectId),task=find(s,'tasks',run.taskId,p.id);
        await start();
        const resolved=await resolveWorkspaceForRun({store,input,dataDir}),workspace=resolved?.workspace??p.workspace;
        await store.transaction(s=>{const r=find(s,'runs',run.id,p.id);r.workspace=workspace;r.sourceWorkspace=p.workspace;changed(r);});
        const project=await ensureProject(p.id,{workspace});
        const validateDispatch=()=>{const current=store.read();
        const reserved=find(current,'runs',run.id,p.id);if(reserved.status!=='submitting'||reserved.stopRequest)fail('RUN_CANCELLED','Run admission was cancelled before dispatch',409);
        validateBudgetAdmission(current,{run:reserved,input});
        const currentTask=find(current,'tasks',run.taskId,p.id),currentPlan=find(current,'plans',currentTask.planId,p.id);
        if(currentTask.revision!==run.approvalSnapshot.taskRevision+1||!currentPlan.approved||currentPlan.revision!==run.approvalSnapshot.planRevision||(currentTask.botId?find(current,'bots',currentTask.botId,p.id).revision:null)!==run.approvalSnapshot.botRevision||run.relayContext&&find(current,'projects',p.id).revision!==run.profileRevision)fail('REVISION_CONFLICT','Approved task, plan or bot changed during setup; review before a new attempt',409);
        validateAdaptiveContext(current,input);validateAssistanceContext(current,input);
        validateRelayDispatch(current,input,run.id);
        validateGoalContext({...current,runs:current.runs.filter(r=>r.id!==run.id)},input);
        validateProactiveContext({...current,runs:current.runs.filter(r=>r.id!==run.id)},input);
        if(run.proactiveContext)validateProactiveEnforcement(current,input,api.qualifyProactive(current,proactiveEnforcementRequest(current,input)));
        validateWorkspaceContext(current,input);
        const currentHarness=checkCapabilities?.(current,{...input,botId:currentTask.botId},['provider',...(run.adaptiveContext?['skills']:[])]);
        if(run.harnessSelection&&contextDigest(currentHarness?.plugins)!==contextDigest(run.harnessSelection.plugins))fail('REVISION_CONFLICT','Scoped capabilities changed before dispatch',409);
        if(run.workspaceContext)assertIsolatedWorkspaceAvailable(current,p.id,{...input,runId:run.id});
        else assertWorkspaceAvailable(current,p.id,{runId:run.id,adaptiveLoopId:run.adaptiveContext?.loopId,assistanceLoopId:run.assistanceContext?.loopId,goalClaimId:run.goalContext?.claimId,proactiveOccurrenceId:run.proactiveContext?.occurrenceId});
        if(contextDigest(find(current,'projects',p.id).profile)!==contextDigest(run.profile)||find(current,'projects',p.id).workspace!==p.workspace)fail('REVISION_CONFLICT','Execution settings changed during setup; review this attempt before starting again',409);
        };validateDispatch();
        const provider=run.selection;
        if(!provider?.instanceId||!provider?.model)fail('MODEL_REQUIRED','Connect a provider and select an observed model before starting',409);
        const providerConnectionId=provider.connectionId??store.read().connections.find(c=>c.projectId===p.id&&c.kind==='provider'&&c.providerInstanceId===provider.instanceId&&c.enabled!==false)?.id;
        if(validateProviderSelection){if(!providerConnectionId)fail('PROVIDER_SETUP_REQUIRED','Connect and select this provider in Project accounts & models before execution',409);await validateProviderSelection({projectId:p.id,connectionId:providerConnectionId,selection:provider});}
        const bot=task.botId?find(s,'bots',task.botId,p.id):null;
        let message=`FORGE task ${task.id}. Work only within this selected workspace: ${workspace}. Use this path explicitly as the working directory for commands.\n${task.title}\n${task.description??''}${bot?`\nAssigned bot: ${bot.name}. Role: ${bot.role??''}\n${bot.instructions??''}`:''}${adaptivePrompt(run.adaptiveContext)}${assistancePrompt(run.assistanceContext)}${goalPrompt(run.goalContext)}${proactivePrompt(run.proactiveContext)}${workspacePrompt(resolved)}`;
        if(prepareContext){const prepared=await prepareContext({run:find(store.read(),'runs',run.id,p.id),project:find(store.read(),'projects',p.id),baseMessage:message});if(typeof prepared?.message!=='string'||!prepared.message)fail('CONTEXT_INVALID','Dispatch context did not return a verified message',409);message=prepared.message;await store.transaction(s=>{const r=find(s,'runs',run.id,p.id);r.contextId=prepared.contextId;r.contextReceipt=structuredClone(prepared.receipt);r.contextMode=prepared.mode??'forge-prefix';changed(r);});}
        if(run.workspaceContext){const latest=await resolveWorkspaceForRun({store,input,dataDir});if(contextDigest(latest)!==contextDigest(resolved))fail('WORKSPACE_CHANGED','Isolated checkout identity changed during setup',409);}
        validateDispatch();
        launchRequested=true;
        const launched=await call('t3_thread_launch',{projectId:project.id,clientRequestId:run.id,title:task.title,message,runtimeMode:'approval-required',...(provider?.instanceId&&provider?.model?{modelSelection:{instanceId:provider.instanceId,model:provider.model,options:provider.options??[]}}:{})});
        await store.transaction(state=>{const r=find(state,'runs',run.id);r.t3ProjectId=project.id;r.threadId=launched.threadId;r.providerRunId=launched.runId;r.providerInstanceId=provider?.instanceId;r.status=launched.status??'running';changed(r);const task=find(state,'tasks',r.taskId);task.threadId=r.threadId;task.status='running';changed(task);appendProtocol(state,r,{type:'RUN_STARTED',threadId:r.threadId,runId:r.id});});
      }catch(e){await store.transaction(s=>{const r=find(s,'runs',run.id);r.status=launchRequested?'unknown':'failed';r.error=e.message;changed(r);if(!launchRequested){const task=find(s,'tasks',r.taskId,r.projectId);task.status='blocked';changed(task);}appendProtocol(s,r,{type:'CUSTOM',name:launchRequested?'forge.execution.uncertain':'forge.execution.setup-failed',value:{error:e.message,attemptId:r.attemptId}});});if(!launchRequested)await onNotDispatched?.({projectId:run.projectId,runId:run.id,attemptId:run.attemptId,sourceReceiptId:`forge-task:not-dispatched:${run.id}`});}
      const observed=find(store.read(),'runs',run.id);if(observed.threadId){try{await protocol.observe(run.id);}catch{/* Execution is retained; explicit recovery exposes the disconnected observation. */}}
      return find(store.read(),'runs',run.id);
    },
    async shutdown(){shuttingDown=true;await startPromise?.catch(()=>{});await Promise.allSettled([...pendingRuns]);await protocol.close();if(readSession)await cli(['auth','session','revoke',readSession,'--base-dir',home]).catch(()=>{});readToken=undefined;await client?.close().catch(()=>{});client=undefined;if(issueSession)await cli(['auth','session','revoke',issueSession,'--base-dir',home]).catch(()=>{});child?.kill();for(const name of credentialEnv.keys())delete env[name];credentialEnv.clear();},
  };
  const startRun=api.startRun;api.startRun=input=>{if(shuttingDown)return Promise.reject(Object.assign(new Error('T3 is shutting down'),{code:'SHUTTING_DOWN',statusCode:409}));const pending=startRun(input);pendingRuns.add(pending);pending.then(()=>pendingRuns.delete(pending),()=>pendingRuns.delete(pending));return pending;};return api;
}
