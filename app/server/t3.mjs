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

const launcher=fileURLToPath(new URL('../vendor/t3/bin/t3.mjs',import.meta.url));
// app/server -> repo root is two parent directories.
export async function availablePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
export function createT3Service({dataDir,store}){
  const home=path.join(dataDir,'t3');let child,client,startPromise,url,issueSession;let status='not_started',error;
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('T3CODE_')&&!key.startsWith('T3_ACP_')&&key!=='VITE_DEV_SERVER_URL'));
  env.T3CODE_HOME=home;env.T3CODE_NO_BROWSER='true';
  function cli(args,{timeout=30000}={}){return new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,[launcher,...args],{env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let out='',err='';
    const timer=setTimeout(()=>{p.kill();reject(new Error('T3 command timeout; reconcile before repeating a mutating command'));},timeout);
    p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);
    p.once('error',e=>{clearTimeout(timer);reject(e);});p.once('exit',code=>{clearTimeout(timer);code===0?resolve(out.trim()):reject(new Error(`T3 exited ${code}: ${err.slice(-1500)}`));});
  });}
  async function call(name,args){await start();const result=await client.callTool({name,arguments:args},undefined,{timeout:30000});if(result.isError)fail('T3_OPERATION',result.content?.find(c=>c.type==='text')?.text??'T3 operation failed',502);return result.structuredContent??JSON.parse(result.content.find(c=>c.type==='text').text);}
  async function start(){
    if(client)return {status,url,version:'0.1.11'};if(startPromise)return startPromise;
    startPromise=(async()=>{
      status='starting';await mkdir(home,{recursive:true});const port=await availablePort();url=`http://127.0.0.1:${port}`;
      child=spawn(process.execPath,[launcher,'serve','--host','127.0.0.1','--port',String(port),'--base-dir',home],{env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
      const log=path.join(dataDir,'t3.log');child.stdout.on('data',b=>appendFile(log,b).catch(()=>{}));child.stderr.on('data',b=>appendFile(log,b).catch(()=>{}));
      let exited;child.on('exit',code=>{exited=code;status='stopped';client=undefined;});child.on('error',e=>{error=e.message;status='failed';});
      const deadline=Date.now()+120000;
      while(Date.now()<deadline){if(exited!==undefined||status==='failed')throw new Error(`T3 did not start; inspect local t3.log (${error??exited})`);try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});await r.body?.cancel();if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
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
      issueSession=sessions.find?.(s=>s.label===label)?.sessionId;
      client=new Client({name:'forge-local-bridge',version:'0.2.0'},{capabilities:{}});
      await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',url),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
      status='ready';error=null;return {status,url,version:'0.1.11'};
    })().catch(e=>{status='failed';error=e.message;child?.kill();client=undefined;throw e;}).finally(()=>{startPromise=undefined;});
    return startPromise;
  }
  return {
    start,
    health(){return {status,url,version:'0.1.11',sourceRevision:'59651c1761f6c63e9b6056839067066968e6a406',error};},
    async tools(){await start();return (await client.listTools()).tools;},
    async catalog(){return call('orchestrator_capabilities',{});},
    async startRun(input){
      let replay=false;
      const run=await store.transaction(s=>{
        if(!input.operationId)fail('VALIDATION','operationId required');
        const prior=s.runs.find(r=>r.operationId===input.operationId);if(prior){if(prior.projectId!==input.projectId||prior.taskId!==input.taskId)fail('OPERATION_REUSE','Run operation ID belongs to different work',409);replay=true;return prior;}
        const p=find(s,'projects',input.projectId),task=find(s,'tasks',input.taskId,p.id);
        if(!task.planId || !find(s,'plans',task.planId,p.id).approved)fail('PLAN_REQUIRED','Review and approve the concrete plan before starting',409);
        if(s.runs.some(r=>r.projectId===p.id&&['submitting','running','unknown'].includes(r.status)))fail('WORKSPACE_BUSY','Reconcile the existing execution before starting another',409);
        for(const dep of task.dependsOn??[])if(find(s,'tasks',dep,p.id).status!=='done')fail('DEPENDENCY','Task has unfinished dependencies',409);
        const r=entity({operationId:input.operationId,taskId:task.id,botId:task.botId,conversationId:input.conversationId,status:'submitting',attemptId:crypto.randomUUID(),profileRevision:p.revision,profile:structuredClone(p.profile),protocolEvents:[],messages:[]},p.id);s.runs.push(r);task.runIds.push(r.id);changed(task);return r;
      });if(replay)return run;
      try{
        const s=store.read(),p=find(s,'projects',run.projectId),task=find(s,'tasks',run.taskId,p.id);
        await start();await cli(['project','add',p.workspace,'--base-dir',home,'--title',p.name]);
        const listed=await call('t3_project_list',{limit:100});const project=listed.projects.find(x=>path.resolve(x.workspaceRoot).toLowerCase()===path.resolve(p.workspace).toLowerCase());
        if(!project)throw new Error('T3 project registration not observed');
        const provider=p.profile.provider;
        const launched=await call('t3_thread_launch',{projectId:project.id,clientRequestId:run.id,title:task.title,message:`FORGE task ${task.id}. Work only within this selected workspace.\n${task.title}\n${task.description??''}`,runtimeMode:'approval-required',...(provider?.instanceId&&provider?.model?{modelSelection:{instanceId:provider.instanceId,model:provider.model,options:provider.options??[]}}:{})});
        await store.transaction(state=>{const r=find(state,'runs',run.id);r.threadId=launched.threadId;r.providerRunId=launched.runId;r.status='running';changed(r);const task=find(state,'tasks',r.taskId);task.threadId=r.threadId;task.status='running';changed(task);appendProtocol(state,r,{type:'RUN_STARTED',threadId:r.threadId,runId:r.id});});
      }catch(e){await store.transaction(s=>{const r=find(s,'runs',run.id);r.status='unknown';r.error=e.message;changed(r);appendProtocol(s,r,{type:'CUSTOM',name:'forge.execution.uncertain',value:{error:e.message,attemptId:r.attemptId}});});}
      return find(store.read(),'runs',run.id);
    },
    async reconcile(id){
      const r=find(store.read(),'runs',id);if(!r.threadId)return r;
      const observation=await call('t3_thread_read',{threadId:r.threadId,limit:100,view:'messages'});
      await store.transaction(s=>{const run=find(s,'runs',id);run.observation=observation;run.messages=observation.items??[];const observedRun=observation.recentRuns?.find(r=>r.runId===run.providerRunId);run.status=observedRun?.status??observation.thread?.status??run.status;changed(run);
        const messages=run.messages.filter(i=>['user_message','assistant_message'].includes(i.type)&&i.text).map(i=>({id:i.messageId??i.itemId,role:i.type==='user_message'?'user':'assistant',content:i.text}));
        appendProtocol(s,run,{type:'MESSAGES_SNAPSHOT',messages});
        appendProtocol(s,run,{type:'CUSTOM',name:'forge.t3.observation',value:{threadId:run.threadId,status:run.status,taskId:run.taskId,botId:run.botId}});
        if(!run.terminalEvent && ['completed','failed','cancelled','interrupted'].includes(run.status)){
          if(run.status==='failed')appendProtocol(s,run,{type:'RUN_ERROR',message:observation.thread?.error??'T3 run failed'});
          else appendProtocol(s,run,{type:'RUN_FINISHED',threadId:run.threadId,runId:run.id,outcome:run.status==='completed'?{type:'success'}:{type:'cancelled'}});
          run.terminalEvent=true;
        }
      });
      return find(store.read(),'runs',id);
    },
    async stop(id){const run=find(store.read(),'runs',id);if(!run.threadId)fail('OUTCOME_UNKNOWN','No observed thread; reconcile the T3 environment before retrying',409);await call('t3_thread_interrupt',{threadId:run.threadId,stop:true,clientRequestId:`stop-${id}`});return this.reconcile(id);},
    async shutdown(){await client?.close().catch(()=>{});client=undefined;if(issueSession)await cli(['auth','session','revoke',issueSession,'--base-dir',home]).catch(()=>{});child?.kill();},
  };
}
