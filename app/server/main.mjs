import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {randomBytes} from 'node:crypto';
import { openStore } from './store.mjs';
import { command, find, fail } from './domain.mjs';
import { createJobService } from './jobs.mjs';
import { createT3Service } from './t3.mjs';
import { createConnectionService, integrationCatalog } from './connections.mjs';
import { createArtifactService } from './artifacts.mjs';
import { createControlService } from './control.mjs';
import { protocolEvents,protocolRecords } from './agui.mjs';
import { createCatalogService } from './catalog.mjs';
import { createGitStorageService } from './git-storage.mjs';
import {defaultDataDir} from './paths.mjs';
import {createDownloadService} from './downloads.mjs';
import {createOfficeService} from '../office/service.mjs';
import {createServingService} from '../serving/service.mjs';
import {createStorageService} from '../storage/service.mjs';
import {createDesktopService} from '../desktop/index.mjs';
import {createOfficeAgentService} from '../office/agent-service.mjs';
import {createOfficeAgentMcpHandler} from '../office/agent-mcp.mjs';
import {createProviderService} from '../providers/service.mjs';
import {createMcpOAuthService} from '../providers/mcp-oauth.mjs';
import {createGovernanceService} from '../governance/service.mjs';
import {createAdaptiveService} from '../adaptive/index.mjs';
import {createAssistanceService} from '../assistance/index.mjs';
import {createCapabilities} from './capabilities.mjs';
import {dispatchPluginRequest} from '../plugins/index.mjs';
import {createLocalAuthority} from './authority.mjs';
import {createMemoryService} from '../memory/index.mjs';
import {createOwnerMemoryService,OWNER_GRANT_PREFIX} from '../memory/owner.mjs';
import {createContextService,dispatchContextRequest} from '../context/index.mjs';
import {createT3ContextSeam} from '../context/pre-dispatch.mjs';
import {createGoalService,dispatchGoalRequest} from '../goals/index.mjs';
import {createComputeRouter} from './compute.mjs';
import {assertWorkspaceAvailable} from './admission.mjs';
import {createRelayService} from '../relay/index.mjs';
import {redact} from '../context/contracts.mjs';
import {createSecretService,dispatchSecretRequest} from '../secrets/index.mjs';
import {createMissionService,dispatchMissionRequest} from '../missions/index.mjs';
import {createProactiveService,dispatchProactiveRequest} from '../proactive/index.mjs';
import {createWorkspaceService,dispatchWorkspaceRequest,assertWorkspaceRestoreAvailable} from '../workspaces/index.mjs';
import {createBudgetService,dispatchBudgetRequest} from '../budgets/index.mjs';
import {createPlaybookService,dispatchPlaybookRequest} from '../playbooks/index.mjs';
export {defaultDataDir};
const root=fileURLToPath(new URL('../../',import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
async function body(req){let size=0;const parts=[];for await(const b of req){size+=b.length;if(size>24*1024*1024)fail('SIZE','Request exceeds 24 MB',413);parts.push(b);}try{return JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{fail('JSON','Invalid JSON request');}}
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
export async function createApplication({dataDir=defaultDataDir(),port=0,machineSecretDir}={}){
  await mkdir(dataDir,{recursive:true});const store=await openStore(dataDir);
  let providers,oauth,capabilities,compute,prepareContext,secrets,budgets;
  const authority=createLocalAuthority();
  secrets=await createSecretService({store,dataDir,...(machineSecretDir?{machineDir:machineSecretDir}:{})});
  const resolveProviderEnvironment=async c=>{const names=[...new Set([...(c.config?.envRefs??[]),...(c.config?.apiKeyEnv?[c.config.apiKeyEnv]:[])])],values={};for(const name of names)values[name]=await secrets.resolveEnv({projectId:c.projectId,name,purpose:'provider'});return values;};
  const mcpCredentialVersion=async c=>{const names=[...(c.config?.envRefs??[]),...(c.config?.authEnv?[c.config.authEnv]:[])];if(!names.length)return [];const rows=(await secrets.list({projectId:c.projectId,purpose:'mcp'})).secrets;return names.map(name=>{const row=rows.find(r=>r.envName===name);return row?{name,reference:row.reference,revision:row.revision,generation:row.generation}:{name,source:'explicit-machine-environment'};});};
  const governance=createGovernanceService({store});await governance.recover();
  const checkCapabilities=(s,input,required)=>capabilities?.check(s,input,required);
  const prepareCapabilities=projectId=>capabilities?.defaults(projectId);
  const admitCompute=(s,input,{jobId}={})=>{assertWorkspaceAvailable(s,input.projectId,{jobId});checkCapabilities(s,input,['environment']);};
  const onNotDispatched=input=>budgets?.confirmNotDispatched(input);
  const jobs=createJobService({store,dataDir,admit:admitCompute}),t3=createT3Service({store,dataDir,resolveProviderEnvironment,onNotDispatched,validateProviderSelection:async input=>{const c=find(store.read(),'connections',input.connectionId,input.projectId);await t3.providers.assertEnvironment(c);return providers.validateSelection(input);},checkCapabilities,prepareCapabilities,prepareContext:input=>prepareContext(input)}),connections=createConnectionService({store});
  budgets=createBudgetService({store,t3,authorize:authority.goalAuthorize});
  providers=createProviderService({store,dataDir,t3,onNotDispatched,authorizeTool:input=>governance.authorizeTool(input),validateAdmission:input=>governance.validateAdmission(input),mcpTransportOptions:c=>oauth?.transportOptions(c)??{},resolveEnv:(name,c)=>secrets.resolveEnv({projectId:c.projectId,name,purpose:c.kind==='mcp'?'mcp':'provider'}),mcpCredentialVersion,checkCapabilities,prepareCapabilities});
  const adaptive=createAdaptiveService({store,t3,connections}),assistance=createAssistanceService({store,providers,t3});
  const memory=await createMemoryService({store,dataDir,authorize:authority.authorize,adaptive});
  const ownerMemory=await createOwnerMemoryService({store,dataDir,authorize:authority.authorize});
  const context=await createContextService({store,dataDir,authorize:authority.authorize,
    memoryContext:async(input,caller)=>{const local=await memory.context(input,caller);if(input.scope.kind!=='project')return local;const central=await ownerMemory.projectContext({projectId:input.projectId,query:input.query,limit:input.limit,maxCharacters:input.maxCharacters,includeStale:input.includeStale},caller);return {...local,items:[...local.items,...central.items].slice(0,input.limit??12)};},
    memoryResolveRefs:async(input,caller)=>{const local=await memory.resolveRefs({...input,refs:input.refs.filter(r=>!r.id.startsWith(OWNER_GRANT_PREFIX))},caller);const refs=input.refs.filter(r=>r.id.startsWith(OWNER_GRANT_PREFIX));if(!refs.length||input.scope.kind!=='project')return local;const central=await ownerMemory.resolveProjectRefs({projectId:input.projectId,refs},caller);return {...local,items:[...local.items,...central.items],missing:[...(local.missing??[]),...(central.missing??[])]};},
    capabilities:async()=>({contextOwner:'native',acceptsForgePrefix:true,compactForgePrefix:true,source:{kind:'native-launch-contract',reference:'app/server/t3.mjs: T3 0.1.11 supervised message prefix; native history remains T3-owned',observedAt:new Date().toISOString()}})});
  prepareContext=createT3ContextSeam({service:context,callerContextForRun:run=>authority.forRun(run),allowNativePassthrough:true,
    memoryForRun:run=>[{kind:'project',id:run.projectId},...(run.botId?[{kind:'agent',id:run.botId}]:[]),...(run.conversationId?[{kind:'session',id:run.conversationId}]:[]),{kind:'task',id:run.taskId}].map(scope=>({projectId:run.projectId,scope:{projectId:run.projectId,...scope},query:find(store.read(),'tasks',run.taskId,run.projectId).title,limit:5,maxCharacters:8000}))});
  const goals=createGoalService({store,t3,authorize:authority.goalAuthorize});
  const relay=createRelayService({store,t3,resolveSecret:async reference=>{const binding=store.read().relay?.bindings.find(b=>b.secretRef===reference);if(!binding||!secrets)fail('RELAY_SECRET_UNAVAILABLE','Save a machine-only relay signing key in Settings',409);return secrets.resolveRef({projectId:binding.projectId,reference,purpose:'relay'});}});await relay.recover();
  const artifacts=createArtifactService({store,dataDir}),control=createControlService({store,connections});
  const missions=createMissionService({store,goals,t3,artifacts,authorize:authority.goalAuthorize});await missions.recover();
  const playbooks=createPlaybookService({store,missions,memory,adaptive,authorize:authority.goalAuthorize});
  const proactive=createProactiveService({store,t3,authorize:authority.goalAuthorize});await proactive.start();
  const workspaces=createWorkspaceService({store,dataDir,t3,authorize:authority.authorize});await workspaces.recover();
  compute=createComputeRouter({store,dataDir,jobs,artifacts,admit:admitCompute,secrets,resolveBearer:({vaultRef,projectId})=>secrets.resolveRef({projectId,reference:vaultRef,purpose:'compute'}),resolveEnvironment:({projectId,name})=>secrets.resolveEnv({projectId,name,purpose:'compute'})});
  const catalog=createCatalogService({load:()=>t3.catalog()});
  const gitStorage=createGitStorageService({store});
  const downloads=createDownloadService({sourceRoot:root,dataDir});
  const office=createOfficeService({store});
  const officeAgent=createOfficeAgentService({store,dataDir});await officeAgent.recover();
  const serving=createServingService({store,dataDir,connections,artifacts});
  const storage=await createStorageService({store,dataDir,artifacts});
  const desktop=createDesktopService({store,dataDir});
  capabilities=createCapabilities({store,t3,providers,adaptive,desktop,getCompute:()=>compute});await capabilities.service.recover();
  for(const project of store.read().projects)await capabilities.defaults(project.id);
  await t3.recover();
  await budgets.reconcile();
  await providers.conversations.recover();await providers.mcp.recover();await assistance.recover();
  await jobs.recover();
  let reports;try{const mod=await import('../reports/service.mjs');reports=await mod.createReportService({store,dataDir});}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
  let commit='unknown';try{commit=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();}catch{try{commit=JSON.parse(await readFile(path.join(root,'release-info.json'),'utf8')).commit.slice(0,7);}catch{}}
  const clients=new Set(),browserSessions=new Map(),relayWork=new Set();let closed=false,restoring=false,closingPromise,officeMcpHandler,offProjection=()=>{},projectionPromise,projectionAgain=false;
  function dispatchApprovedMobile(){for(const item of store.read().relay?.inbox??[])if(item.status==='approved'&&!item.reservation&&!item.stopRequested){const pending=relay.dispatch({projectId:item.projectId,inboxId:item.id}).catch(()=>{});relayWork.add(pending);pending.finally(()=>relayWork.delete(pending));}}
  function browserSession(req,res,{create=false}={}){
    const id=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('forge_session='))?.slice('forge_session='.length);
    let session=browserSessions.get(id);if(session&&session.expiresAt<Date.now()){browserSessions.delete(id);session=null;}
    if(!session&&create){const id=randomBytes(32).toString('base64url');session={id,csrf:randomBytes(32).toString('base64url'),expiresAt:Date.now()+86400000};if(browserSessions.size>=256)browserSessions.delete(browserSessions.keys().next().value);browserSessions.set(id,session);res.setHeader('Set-Cookie',`forge_session=${id}; Path=/; HttpOnly; SameSite=Lax`);}
    return session;
  }
  function humanSession(req,res){const s=browserSession(req,res);if(!s||req.headers['x-forge-csrf']!==s.csrf)fail('BROWSER_SESSION_REQUIRED','Refresh the FORGE page and perform this Owner action in the GUI',403);return s;}
  const app={store,t3,jobs,compute,connections,providers,governance,adaptive,assistance,memory,ownerMemory,context,goals,missions,playbooks,proactive,workspaces,budgets,relay,secrets,plugins:capabilities.service,reports,serving,storage,desktop,officeAgent,server:null,url:null,async close(){
    if(closingPromise)return closingPromise;closed=true;
    closingPromise=(async()=>{
    offProjection();await projectionPromise;
    // Stop accepting reconnects before closing SSE; browser retries must not keep
    // an application shutdown alive. Close only this server's HTTP connections.
    const stopped=new Promise(resolve=>app.server.close(resolve));
    for(const client of clients)client.end();
    app.server.closeAllConnections();
    await proactive.close();await playbooks.close();await missions.close();await workspaces.close();adaptive.shutdown();await assistance.close();await goals.close();await Promise.allSettled([...relayWork]);relay.close();await oauth?.close();await providers.close();
    await officeMcpHandler?.close();await desktop.shutdown();await storage.shutdown();await compute.shutdown();await jobs.shutdown();await t3.shutdown();await serving.shutdown();await connections.close();await reports?.shutdown?.();
    const pluginClose=await capabilities.service.close();if(pluginClose.status==='draining')throw new Error('Native plugin operations remain active; retain the store for reconciliation');
    await memory.close();await ownerMemory.close();await stopped;await store.close();
    })();return closingPromise;
  }};
  const server=http.createServer(async(req,res)=>{
    try{
      const host=req.headers.host??'';if(!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host))fail('HOST','Loopback Host required',403);
      if(req.headers.origin && req.headers.origin!==`http://${host}`)fail('ORIGIN','Cross-origin requests are blocked',403);
      const url=new URL(req.url,`http://${host}`),p=url.pathname,method=req.method;
      if(method==='POST'&&p==='/api/relay/bridge'){
        if(closed||restoring)fail('APPLICATION_BUSY','FORGE is not admitting relay work',409);
        if(!req.headers['content-type']?.startsWith('application/json'))fail('CONTENT_TYPE','Use application/json',415);
        let size=0;const chunks=[];for await(const part of req){size+=part.length;if(size>65536)fail('SIZE','Bridge body exceeds 64 KiB',413);chunks.push(part);}
        const result=await relay.bridge({body:Buffer.concat(chunks).toString('utf8'),signature:req.headers['x-forge-relay-signature']});json(res,result);dispatchApprovedMobile();return;
      }
      if(officeMcpHandler&&await officeMcpHandler(req,res))return;
      if(method==='OPTIONS')return json(res,{error:{code:'ORIGIN',message:'CORS is disabled'}},403);
      if(method==='GET'&&p==='/api/session'){const session=browserSession(req,res,{create:true});return json(res,{csrf:session.csrf});}
      if(method==='GET'&&p==='/api/workspaces/state'){
        const session=browserSession(req,res);if(!session)fail('BROWSER_SESSION_REQUIRED','Open FORGE in this browser before reading isolated workspaces',403);
        return json(res,await dispatchWorkspaceRequest(workspaces,'state',Object.fromEntries(url.searchParams),authority.owner(session),{httpMethod:method}));
      }
      if(method==='GET'&&/^\/api\/missions\/[^/]+\/download$/.test(p)){
        const session=browserSession(req,res);if(!session)fail('BROWSER_SESSION_REQUIRED','Open FORGE in this browser before downloading a Delivery Pack',403);
        const result=await missions.download({projectId:url.searchParams.get('projectId'),packId:p.split('/')[3]},authority.owner(session));
        res.writeHead(200,{'Content-Type':result.contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,'Content-Length':result.bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(result.bytes);
      }
      if(method==='GET'&&p==='/api/providers/routes')return json(res,providers.routes());
      if(method==='GET'&&p.startsWith('/api/governance/')){
        const methods={policy:'policy',organization:'organization',task:'taskContext',inbox:'reviewInbox'},name=methods[p.slice('/api/governance/'.length)];if(!name)fail('NOT_FOUND','Governance read not found',404);return json(res,governance[name](Object.fromEntries(url.searchParams)));
      }
      if(method==='GET'&&p==='/api/mcp/oauth/status')return json(res,await oauth.status(Object.fromEntries(url.searchParams)));
      if(method==='GET'&&p==='/api/mcp/oauth/callback'){
        const session=browserSession(req,res);if(!session)fail('OAUTH_SESSION','Return to the same FORGE browser session and begin sign-in again',403);
        await oauth.callback({callbackUrl:app.url+req.url,sessionId:session.id});
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end('<!doctype html><html lang="th"><meta charset="utf-8"><title>FORGE MCP</title><p>เชื่อมต่อแล้ว กลับไปที่ FORGE และตรวจสถานะก่อนเรียกเครื่องมือ</p><script>history.replaceState(null,"",location.pathname)</script></html>');
      }
      if(method==='GET'&&p==='/api/health')return json(res,{status:'ready',product:'FORGE',version:manifest.version,commit,dataPath:dataDir,t3:t3.health(),reports:reports?await reports.health():{status:'implementation_pending'},implementation:'IMPLEMENTATION_INCOMPLETE'});
      if(method==='GET'&&p==='/api/state'){const state=store.read();state.events=state.events.filter(e=>!e.type.startsWith('owner-memory.'));return json(res,state);}
      if(method==='GET'&&p==='/api/integrations')return json(res,integrationCatalog);
      if(method==='GET'&&p==='/api/downloads')return json(res,await downloads.metadata());
      if(method==='GET'&&p.startsWith('/downloads/')){const file=await downloads.file(p.slice('/downloads/'.length));res.writeHead(200,{'Content-Type':file.contentType,'Content-Disposition':`attachment; filename="${file.filename}"`,'X-Content-Type-Options':'nosniff'});createReadStream(file.path).pipe(res);return;}
      if(method==='GET'&&p==='/api/events'){
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});clients.add(res);
        const send=()=>{if(!res.writableEnded&&!res.destroyed)res.write(`data: ${JSON.stringify({type:'state.changed',revision:store.read().revision})}\n\n`);};send();
        const off=store.subscribe(send),timer=setInterval(()=>{if(!res.writableEnded&&!res.destroyed)res.write(': heartbeat\n\n');},15000);
        res.once('close',()=>{clients.delete(res);off();clearInterval(timer);});return;
      }
      if(method==='GET'&&/^\/api\/runs\/[^/]+\/events$/.test(p)){const id=p.split('/')[3];find(store.read(),'runs',id);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});for(const event of protocolEvents(store.read(),id))res.write(`data: ${JSON.stringify(event)}\n\n`);return res.end();}
      if(method==='GET'&&/^\/api\/runs\/[^/]+\/recovery$/.test(p))return json(res,t3.recovery(p.split('/')[3]));
      if(method==='GET'&&/^\/api\/runs\/[^/]+\/stream$/.test(p)){
        const id=p.split('/')[3];find(store.read(),'runs',id);let sequence=Number(url.searchParams.get('afterSequence')??0);
        if(!Number.isSafeInteger(sequence)||sequence<0)fail('VALIDATION','afterSequence must be a nonnegative integer');
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.flushHeaders();clients.add(res);
        const send=()=>{if(res.writableEnded||res.destroyed)return;for(const record of protocolRecords(store.read(),id,{afterSequence:sequence})){res.write(`id: ${record.sequence}\nevent: agui\ndata: ${JSON.stringify({sequence:record.sequence,event:record.event})}\n\n`);sequence=record.sequence;}};
        send();const off=store.subscribe(send);res.once('close',()=>{clients.delete(res);off();});return;
      }
      if(method==='GET'&&p==='/api/t3/status')return json(res,t3.health());
      if(method==='GET'&&p==='/api/t3/catalog')return json(res,catalog.read());
      if(method==='GET'&&p==='/api/reports/health')return json(res,reports?await reports.health():{status:'implementation_pending'});
      if(method==='GET'&&p==='/api/serving/health')return json(res,await serving.health(url.searchParams.get('projectId')));
      if(method==='GET'&&p==='/api/storage/drive/auth/callback'){
        const connected=await storage.finishDriveAuth({state:url.searchParams.get('state'),code:url.searchParams.get('code')});
        const payload=JSON.stringify({type:'forge.drive.connected',secretRef:connected.secretRef});
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
        return res.end(`<!doctype html><html lang="th"><meta charset="utf-8"><title>FORGE Drive</title><p>เชื่อมต่อ Google Drive แล้ว กลับไปที่ FORGE เพื่อตั้งค่าโฟลเดอร์</p><script>window.opener?.postMessage(${payload},location.origin);history.replaceState(null,'',location.pathname);</script></html>`);
      }
      if(method==='GET'&&/^\/api\/reports\/jobs\/[^/]+$/.test(p))return json(res,await reports.getJob(p.split('/')[4]));
      if(method==='GET'&&/^\/api\/jobs\/[^/]+$/.test(p))return json(res,find(store.read(),'jobs',p.split('/')[3]));
      if(method==='GET'&&/^\/api\/artifacts\/[^/]+\/download$/.test(p)){
        const id=p.split('/')[3];const artifact=find(store.read(),'artifacts',id);
        const ownedReport=artifact.jobId&&store.read().jobs.some(j=>j.id===artifact.jobId&&j.owner==='reports');
        const screen=artifact.type==='desktop-screenshot'&&!artifact.restoredFrom?await desktop.screenshot({projectId:artifact.projectId,targetId:artifact.targetId,artifactId:id}):null;
        const file=screen?{path:screen.path,filename:artifact.name,contentType:screen.mimeType}:ownedReport&&reports?await reports.download(id):await artifacts.download(id);
        res.writeHead(200,{'Content-Type':file.contentType,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'X-Content-Type-Options':'nosniff'});createReadStream(file.path).pipe(res);return;
      }
      if(method==='POST'){
        if(closed||restoring)fail('APPLICATION_BUSY','Application is shutting down or restoring metadata; retry after readiness',409);
        if(!req.headers['content-type']?.startsWith('application/json'))fail('CONTENT_TYPE','Use application/json',415);const input=await body(req);let value;
        let owner;
        if(/^\/api\/providers\/(configure|setup|select|preview-models)$|^\/api\/mcp\/oauth\/(begin|disconnect)$|^\/api\/governance\/(policy|bot|task|tool\/decide)$|^\/api\/(assistance|adaptive|plugins|memory|owner-memory|context|goals|compute|relay|secrets|missions|proactive|workspaces|budgets|playbooks)\//.test(p))owner=humanSession(req,res);
        if(p==='/api/command'){value=await command(store,input);if(input.type==='project.create')await capabilities.defaults(value.entity.id);}
        else if(p.startsWith('/api/plugins/'))value=await dispatchPluginRequest(capabilities.service,p.slice('/api/plugins/'.length),input);
        else if(p.startsWith('/api/secrets/')){
          const method=p.slice('/api/secrets/'.length);
          if(['set','remove'].includes(method)&&input.purpose==='provider'&&store.read().runs.some(r=>r.projectId===input.projectId&&!['completed','failed','cancelled','interrupted','rolled_back','stopped'].includes(r.status)))fail('PROVIDER_BUSY','Stop and reconcile provider runs before changing their key',409);
          value=await dispatchSecretRequest(secrets,method,input);
          if(['set','remove'].includes(method)&&!value.replayed&&input.purpose==='compute')compute.invalidateCredential({projectId:input.projectId,name:value.secret.envName});
          if(['set','remove'].includes(method)&&!value.replayed){await providers.mcp.invalidateCredential?.({projectId:input.projectId,name:value.secret.envName});await store.transaction(s=>{for(const c of s.connections.filter(c=>c.projectId===input.projectId&&c.kind==='provider'&&(c.config?.envRefs??[]).includes(value.secret.envName))){c.config.generation=(c.config.generation??0)+1;c.catalogError={code:'CREDENTIAL_CHANGED',message:'Check the provider and refresh its catalog after reviewing the saved key'};c.revision++;}});}
        }
        else if(p.startsWith('/api/memory/')){
          const method=p.slice('/api/memory/'.length),methods=['remember','recall','update','list','forget','export','configure','backend','status','rebuild','context','resolveRefs','retention','proposeLesson','setup','health'];if(!methods.includes(method))fail('NOT_FOUND','Memory operation not found',404);value=await memory[method](input,authority.owner(owner));
        }
        else if(p.startsWith('/api/owner-memory/')){
          const method=p.slice('/api/owner-memory/'.length);if(!['remember','list','recall','update','forget','grant','revoke','export','status'].includes(method))fail('NOT_FOUND','Owner memory operation not found',404);value=await ownerMemory[method](input,authority.owner(owner));
        }
        else if(p.startsWith('/api/context/'))value=await dispatchContextRequest(context,p.slice('/api/context/'.length),input,authority.owner(owner));
        else if(p.startsWith('/api/goals/'))value=await dispatchGoalRequest(goals,p.slice('/api/goals/'.length),input,authority.owner(owner));
        else if(p.startsWith('/api/missions/'))value=await dispatchMissionRequest(missions,p.slice('/api/missions/'.length),input,authority.owner(owner));
        else if(p.startsWith('/api/proactive/'))value=await dispatchProactiveRequest(proactive,p.slice('/api/proactive/'.length),input,authority.owner(owner));
        else if(p.startsWith('/api/workspaces/'))value=await dispatchWorkspaceRequest(workspaces,p.slice('/api/workspaces/'.length),input,authority.owner(owner),{httpMethod:method});
        else if(p.startsWith('/api/budgets/'))value=await dispatchBudgetRequest(budgets,p.slice('/api/budgets/'.length),input,authority.owner(owner));
        else if(p.startsWith('/api/playbooks/'))value=await dispatchPlaybookRequest(playbooks,p.slice('/api/playbooks/'.length),input,authority.owner(owner));
        else if(p.startsWith('/api/relay/')){
          const method={state:'state',readiness:'readiness',configure:'configure','link-task':'linkTask',dispatch:'dispatch',reconcile:'reconcile'}[p.slice('/api/relay/'.length)];if(!method)fail('NOT_FOUND','Owner relay operation not found',404);value=await relay[method](input);
        }
        else if(p.startsWith('/api/providers/')){
          const methods={configure:'configure',check:'check',setup:'setup',catalog:'catalog',refresh:'refresh',select:'select','discover-models':'discoverModels','preview-models':'previewModels'},method=methods[p.slice('/api/providers/'.length)];if(!method)fail('NOT_FOUND','Provider operation not found',404);value=await providers[method](input);
        }
        else if(p.startsWith('/api/conversations/')){
          const methods={send:'send',reconcile:'reconcile',stop:'stop',handoff:'handoff',list:'list'},method=methods[p.slice('/api/conversations/'.length)];if(!method)fail('NOT_FOUND','Conversation operation not found',404);value=await providers.conversations[method](input);
        }
        else if(p==='/api/mcp/oauth/begin'||p==='/api/mcp/oauth/disconnect')value=await oauth[p.endsWith('begin')?'begin':'disconnect']({...input,sessionId:owner.id});
        else if(/^\/api\/mcp\/(configure|enable|discover|call|stop)$/.test(p))value=await providers.mcp[p.split('/')[3]](input);
        else if(p.startsWith('/api/governance/')){
          const methods={policy:'configurePolicy','tool/request':'requestTool','tool/decide':'decideTool',bot:'setBotContext',task:'setTaskContext'},method=methods[p.slice('/api/governance/'.length)];if(!method)fail('NOT_FOUND','Governance operation not found',404);value=await governance[method]({...input,...(owner?{actor:{kind:'human',id:`local-owner:${owner.id.slice(0,12)}`}}:{})});
        }
        else if(p.startsWith('/api/adaptive/')||p.startsWith('/api/assistance/')){
          const strategy=p.startsWith('/api/adaptive/')?adaptive:assistance,name=p.split('/')[3],methods={state:'state',status:'status',configure:'configure',select:'select',candidate:'candidate',evaluate:'evaluate',promote:'promote',rollback:'rollback','create-loop':'createLoop',advance:'advance',transition:'transition',stop:'stop',reconcile:'reconcile',resume:'resume'},method=methods[name];if(!method||typeof strategy[method]!=='function')fail('NOT_FOUND','Task strategy operation not found',404);value=await strategy[method](input);
        }
        else if(p.startsWith('/api/office/agent/')){
          const methods={request:'requestEdit',read:'readDocument',status:'status',list:'list',claim:'claim',renew:'renew',release:'release',review:'review','begin-apply':'beginApply',ack:'ack',reject:'reject'};
          const method=methods[p.slice('/api/office/agent/'.length)];if(!method)fail('NOT_FOUND','Office agent operation not found',404);value=await officeAgent[method](input);
        }
        else if(p==='/api/jobs/start')value=await compute.start(input);
        else if(p.startsWith('/api/compute/')){
          const methods={configure:'configure',health:'health',start:'start',status:'status',logs:'logs',stop:'stop',reconcile:'reconcile',lifecycle:'lifecycle','export-notebook':'exportNotebook','import-result':'importResult','link-artifact':'linkArtifact','colab/upload-artifact':'uploadArtifact','colab/download-artifact':'downloadArtifact','colab/reconcile-transfer':'reconcileTransfer'},name=methods[p.slice('/api/compute/'.length)];if(!name)fail('NOT_FOUND','Compute operation not found',404);value=await compute[name](input);
        }
        else if(p==='/api/notebooks/import')value=await jobs.importNotebook(input);
        else if(/^\/api\/jobs\/[^/]+\/stop$/.test(p)){const j=find(store.read(),'jobs',p.split('/')[3]);value=j.computeAttempt?await compute.stop({projectId:j.projectId,jobId:j.id}):await jobs.stop(j.id);}
        else if(p==='/api/t3/start')value=await t3.start();
        else if(p==='/api/t3/catalog')value=await catalog.refresh();
        else if(p==='/api/runs/start')value=await t3.startRun(input);
        else if(/^\/api\/runs\/[^/]+\/reconcile$/.test(p)){const r=find(store.read(),'runs',p.split('/')[3]);value=r.kind==='conversation'?await providers.conversations.reconcile({projectId:r.projectId,runId:r.id}):await t3.reconcile(r.id);}
        else if(/^\/api\/runs\/[^/]+\/stop$/.test(p)){const r=find(store.read(),'runs',p.split('/')[3]);value=r.kind==='conversation'?await providers.conversations.stop({projectId:r.projectId,runId:r.id}):await t3.stop(r.id);}
        else if(/^\/api\/runs\/[^/]+\/observe$/.test(p))value=await t3.observe(p.split('/')[3]);
        else if(/^\/api\/runs\/[^/]+\/reconnect$/.test(p))value=await t3.reconnect(p.split('/')[3]);
        else if(/^\/api\/runs\/[^/]+\/disconnect$/.test(p))value=await t3.disconnect(p.split('/')[3]);
        else if(/^\/api\/runs\/[^/]+\/input$/.test(p))value=await t3.respondInput(p.split('/')[3],input);
        else if(/^\/api\/runs\/[^/]+\/approval$/.test(p))value=await t3.respondApproval(p.split('/')[3],input);
        else if(/^\/api\/runs\/[^/]+\/tool-result$/.test(p))value=await t3.returnToolResult(p.split('/')[3],input);
        else if(/^\/api\/connections\/[^/]+\/check$/.test(p)){const c=find(store.read(),'connections',p.split('/')[3]);value=await (c.kind==='mcp'?providers.mcp.discover({projectId:c.projectId,connectionId:c.id}):c.kind==='provider'?providers.check({projectId:c.projectId,connectionId:c.id}):connections.check(c.id));}
        else if(/^\/api\/mcp\/[^/]+\/discover$/.test(p)){const c=find(store.read(),'connections',p.split('/')[3]);value=await providers.mcp.discover({projectId:c.projectId,connectionId:c.id});}
        else if(/^\/api\/mcp\/[^/]+\/call$/.test(p))value=await providers.mcp.call({...input,connectionId:p.split('/')[3]});
        else if(p==='/api/artifacts/register')value=await artifacts.register(input);
        else if(p==='/api/artifacts/upload')value=await artifacts.upload(input);
        else if(p==='/api/storage/backup')value=await artifacts.backup();
        else if(p==='/api/storage/restore'){
          assertWorkspaceRestoreAvailable(store.read());
          if(store.read().runs.some(r=>!['completed','failed','cancelled','interrupted','rolled_back','stopped'].includes(r.status))||store.read().jobs.some(j=>['submitting','queued','running','starting','stopping','unknown','preparing','rendering','validating','publishing'].includes(j.status)))fail('RESTORE_BUSY','Stop and reconcile active runs/jobs before restoring metadata',409);
          restoring=true;
          try{await proactive.suspendForRestore();await playbooks.suspendForRestore();await missions.suspendForRestore();await goals.suspendForRestore();value=await artifacts.restore(input);await memory.afterRestore();await ownerMemory.afterRestore();await goals.afterRestore();await missions.afterRestore();await playbooks.afterRestore();await proactive.afterRestore();await governance.recover({invalidateUnconsumed:true});await officeAgent.recover();await providers.mcp.recover();await providers.conversations.recover();}finally{goals.cancelRestore();missions.cancelRestore();playbooks.cancelRestore();proactive.cancelRestore();restoring=false;}
        }
        else if(p==='/api/storage/configure')value=await storage.configure(input);
        else if(p==='/api/storage/health')value=await storage.health(input);
        else if(p==='/api/storage/status')value=await storage.status(input);
        else if(p==='/api/storage/inspect')value=await storage.inspect(input);
        else if(p==='/api/storage/sync')value=await storage.sync(input);
        else if(p==='/api/storage/bundles/backup')value=await storage.backup(input);
        else if(p==='/api/storage/bundles/restore')value=await storage.restore(input);
        else if(p==='/api/storage/retry')value=await storage.retry(input);
        else if(p==='/api/storage/retention')value=await storage.retention(input);
        else if(p==='/api/storage/drive/auth/begin')value=await storage.beginDriveAuth({...input,redirectUri:`http://${host}/api/storage/drive/auth/callback`});
        else if(p==='/api/storage/drive/folders')value=await storage.listDriveFolders(input);
        else if(p==='/api/storage/drive/folders/create')value=await storage.createDriveFolder(input);
        else if(p==='/api/storage/git')value=await gitStorage.run(input);
        else if(p==='/api/desktop/setup')value=await desktop.setup(input);
        else if(p==='/api/desktop/health')value=await desktop.health(input);
        else if(p==='/api/desktop/windows')value=await desktop.listWindows(input);
        else if(p==='/api/desktop/install-browser')value=await desktop.installBrowser(input);
        else if(p==='/api/desktop/acquire'||p==='/api/desktop/action'){const target=find(store.read(),'desktopTargets',input.targetId,input.projectId);checkCapabilities(store.read(),input,[target.kind==='browser'?'browser':'desktop']);value=await desktop[p.endsWith('acquire')?'acquire':'action'](input);}
        else if(p==='/api/desktop/stop')value=await desktop.stop(input);
        else if(p==='/api/desktop/takeover')value=await desktop.takeover(input);
        else if(p==='/api/desktop/release')value=await desktop.release(input);
        else if(p==='/api/skills/select')value=await control.select(input);
        else if(p==='/api/reports/configure'&&reports)value=await reports.configure(input);
        else if(p==='/api/reports/extract-document')value=office.extract(input);
        else if(p==='/api/serving/configure')value=await serving.configure(input);
        else if(p==='/api/serving/start')value=await serving.start(input);
        else if(p==='/api/serving/predict')value=await serving.predict(input);
        else if(/^\/api\/serving\/jobs\/[^/]+\/stop$/.test(p))value=await serving.stop(p.split('/')[4]);
        else if(/^\/api\/serving\/jobs\/[^/]+\/detach$/.test(p))value=await serving.detach(p.split('/')[4]);
        else if(p==='/api/reports/generate'&&reports)value=await reports.generate(input);
        else if(p==='/api/reports/pdf-operation'&&reports)value=await reports.pdfOperation(input);
        else if(/^\/api\/reports\/jobs\/[^/]+\/stop$/.test(p)&&reports)value=await reports.stop(p.split('/')[4]);
        else if(p==='/api/system/stop'){json(res,{status:'stopping'});setTimeout(()=>app.close().then(()=>{if(process.argv[1]===fileURLToPath(import.meta.url))process.exit(0);}),100);return;}
        else fail('NOT_FOUND','API operation not found',404);
        return json(res,value??{status:'ok'});
      }
      if(p.startsWith('/api/'))fail('NOT_FOUND','API route not found',404);
      const dir=path.join(root,'app','web','dist'),requested=path.resolve(dir,`.${decodeURIComponent(p)}`),relative=path.relative(dir,requested);
      if(relative.startsWith('..')||path.isAbsolute(relative))fail('PATH','Invalid asset path',403);
      let file=['/welcome','/welcome/'].includes(p)?path.join(dir,'welcome.html'):requested;try{if(!(await stat(file)).isFile())file=path.join(dir,'index.html');}catch{file=path.join(dir,'index.html');}
      const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(bytes);
    }catch(e){if(res.headersSent){res.end();return;}json(res,{error:{code:e.code??'INTERNAL',message:e.message,details:e.details}},e.statusCode??(Number.isInteger(e.status)&&e.status>=400&&e.status<=599?e.status:e.code==='ENOENT'?404:500));}
  });
  app.server=server;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});app.url=`http://127.0.0.1:${server.address().port}`;
  oauth=createMcpOAuthService({store,dataDir,callbackOrigin:app.url});
  officeMcpHandler=await createOfficeAgentMcpHandler({service:officeAgent,dataDir,endpoint:app.url+'/mcp/office'});
  offProjection=store.subscribe(()=>{
    if(closed)return;projectionAgain=true;if(projectionPromise)return;
    projectionPromise=(async()=>{while(projectionAgain&&!closed){projectionAgain=false;for(const record of store.read().runs.filter(r=>(r.taskId||r.kind==='conversation')&&r.threadId)){await t3.refreshState(record.id);if(record.kind==='conversation')await providers.conversations.projectRun(record.id);}
      for(const item of store.read().relay?.inbox??[]){if(!item.runId)continue;const s=store.read(),r=s.runs.find(r=>r.id===item.runId&&r.attemptId===item.attemptId);if(!r)continue;
        const last=(r.messages??[]).filter(m=>m.role==='assistant'&&typeof m.text==='string').at(-1),eventId=`${r.id}:${r.attemptId}:${r.status}:${last?.id??'status'}:${last?.text?.length??0}`;
        if(s.relay.outbox.some(o=>o.inboxId===item.id&&o.key===`report:${eventId}`))continue;
        const task=s.tasks.find(t=>t.id===r.taskId),content=redact(`${task?.title??'Task'}\n${last?.text??r.error??r.status}`).slice(0,6000);
        await relay.report({projectId:r.projectId,inboxId:item.id,runId:r.id,attemptId:r.attemptId,eventId,kind:['completed','failed','cancelled','interrupted','rolled_back'].includes(r.status)?'final':'progress',content});
      }
    }})().catch(error=>{app.projectionError=error.message;}).finally(()=>{projectionPromise=undefined;});
  });return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const app=await createApplication({port:Number(process.env.FORGE_PORT??4317)});console.log(`FORGE_READY ${app.url}`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
