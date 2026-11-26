import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {sessionRoleRunDigest,qualifySessionRoleRun} from './session-roles.mjs';
import {digest as nativeDigest} from '../guarded-runtime/profile.mjs';

const id={type:'string',minLength:1,maxLength:200};
export const SESSION_ROLE_TOOLS=Object.freeze([
  {name:'session_children',description:'List only the Owner-approved child sessions of this exact parent run. Roles do not grant tool or plan authority.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'session_prompt',description:'Send bounded advice to one approved child membership. Reuse the SAME operationId and text after a lost response. This never approves a plan, grants a tool, or bypasses Budget/workspace admission.',inputSchema:{type:'object',properties:{membershipId:id,operationId:id,text:{type:'string',minLength:1,maxLength:48000}},required:['membershipId','operationId','text'],additionalProperties:false}},
]);
const fail=(code,message,statusCode=403)=>{throw Object.assign(new Error(message),{code,statusCode});};
const safe=e=>({error:{code:/^(SESSION_ROLE_|REVISION_CONFLICT|OPERATION_REUSE|BUDGET_|WORKSPACE_BUSY)/.test(e?.code??'')?e.code:'SESSION_ROLE_TRANSPORT',message:'Check this parent and its approved child link in FORGE. Reconcile uncertain delivery before another prompt.'}});
const output=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});

export function createSessionRoleMcpServer({service,scope,callerContext,checkActive,checkCall=()=>{}}){
  if(!service||!callerContext||typeof checkActive!=='function'||!scope?.projectId||!scope.parentRunId)throw new TypeError('Canonical role service, private caller and exact host scope required');
  const server=new Server({name:'forge-session-roles',version:'1.0.0'},{capabilities:{tools:{}},instructions:'Only Owner-approved children of the current parent attempt can receive prompts. Roles are advice, not authority. Prompts do not approve task plans or privileged tools. Retain operation IDs; reconcile unknown outcomes instead of issuing a new command.'});
  server.setRequestHandler(ListToolsRequestSchema,()=>{checkActive();return {tools:structuredClone(SESSION_ROLE_TOOLS)};});
  server.setRequestHandler(CallToolRequestSchema,async({params})=>{
    try{
      checkActive();checkCall(params);const tool=SESSION_ROLE_TOOLS.find(x=>x.name===params.name),args=params.arguments??{};
      if(!tool)fail('SESSION_ROLE_UNKNOWN_TOOL','Unsupported session tool');
      if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(tool.inputSchema.properties,k))||(tool.inputSchema.required??[]).some(k=>typeof args[k]!=='string'||!args[k].trim()||args[k].length>tool.inputSchema.properties[k].maxLength))fail('SESSION_ROLE_INPUT','Use only this tool’s exact bounded arguments');
      const result=await service[params.name==='session_children'?'children':'prompt']({...scope,...args},callerContext);checkActive();checkCall(params);
      if(params.name==='session_prompt'&&(!result.childRun?.threadId||!result.childRun?.providerRunId||result.error||result.stopRequested||['unknown','failed','cancelled','interrupted','rolled_back','stopped','submitting'].includes(result.childRun.status))){return {...output({...result,error:result.error??{code:'SESSION_ROLE_OUTCOME_UNKNOWN',message:'Child delivery is unconfirmed or refused. Inspect this command and reconcile its exact run; do not resend with a new operation ID.'}}),isError:true};}
      return output(result);
    }catch(e){return {...output(safe(e)),isError:true};}
  });
  return server;
}

function body(req){return new Promise((resolve,reject)=>{
  const chunks=[];let size=0;const clean=()=>{clearTimeout(timer);req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',error);};
  const data=chunk=>{size+=chunk.length;if(size>196608){clean();req.resume();resolve(null);}else chunks.push(chunk);};
  const end=()=>{clean();resolve(Buffer.concat(chunks));},error=()=>{clean();reject(new Error('Body unavailable'));};
  const timer=setTimeout(()=>{error();req.destroy();},10000);timer.unref?.();req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',error);
});}
function reply(res,status,code){if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({error:{code}}));}

/** Creates no listener or provider attachment. issueForRun is a HOST-ONLY seam;
 * never expose it to JSON callers. Returned bearer is transient and must only
 * be delivered to the native adapter for this exact run, never persisted. */
export function createSessionRoleMcpGateway({store,service,callerForRun,qualifyRun,endpoint,clock=Date.now,ttlMs=300000}){
  if(!store?.read||!service||typeof callerForRun!=='function'||typeof clock!=='function'||!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>300000)throw new TypeError('Canonical role service, private run authority and bounded TTL required');
  const url=new URL(endpoint);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname==='/')throw new TypeError('Exact loopback MCP endpoint required');
  const leases=new Map(),requests=new Set();let closed=false,generation=0;
  function active(lease,s){
    if(closed||lease.generation!==generation||leases.get(lease.runId)!==lease||clock()>=lease.expiresAt)return false;
    const r=s.runs.find(r=>r.id===lease.runId&&r.projectId===lease.projectId);
    if(!r||r.stopRequest||r.stopRequested||r.restoreReviewRequired||!['starting','running','waiting'].includes(r.status)||sessionRoleRunDigest(r)!==lease.digest)return false;
    try{return JSON.stringify(service.captureRole(s,r))===lease.role&&nativeDigest(qualifySessionRoleRun(s,r,qualifyRun))===lease.qualification;}catch{return false;}
  }
  function check(lease){if(!active(lease,store.read()))fail('SESSION_ROLE_LEASE_INACTIVE','Parent capability is inactive',401);}
  function issueForRun(run,nativeBinding){
    if(closed||leases.size>=32&&!leases.has(run.id))fail('SESSION_ROLE_GATEWAY_UNAVAILABLE','Gateway is closed or full',503);
    const s=store.read(),canonical=s.runs.find(r=>r.id===run.id&&r.projectId===run.projectId);
    if(!canonical||sessionRoleRunDigest(canonical)!==sessionRoleRunDigest(run)||!run.threadId||!run.attemptId)fail('SESSION_ROLE_BINDING','Establish the exact native parent attempt first');
    const qualified=qualifySessionRoleRun(s,canonical,qualifyRun);
    if(!qualified&&!run.providerRunId||nativeBinding&&(!qualified||nativeDigest(nativeBinding)!==nativeDigest(qualified.binding)))fail('SESSION_ROLE_BINDING','Exact established native binding is required');
    const lease={runId:run.id,projectId:run.projectId,digest:sessionRoleRunDigest(run),role:JSON.stringify(service.captureRole(s,run)),qualification:nativeDigest(qualified),binding:qualified?.binding??null,generation,expiresAt:clock()+ttlMs,token:randomBytes(32)};
    lease.caller=callerForRun(structuredClone(canonical),{active:state=>active(lease,state)});
    if(!lease.caller||typeof lease.caller!=='object'||lease.caller.then)fail('SESSION_ROLE_AUTHORITY','Private run handle unavailable');
    // This both proves role/scope authorization and rejects inactive parents.
    leases.set(run.id,lease);
    try{service.children({projectId:run.projectId,parentRunId:run.id},lease.caller);check(lease);}catch(e){leases.delete(run.id);throw e;}
    return {configuration:{type:'http',url:url.href,headers:{Authorization:`Bearer ${lease.token.toString('base64url')}`}},expiresAt:lease.expiresAt,nativeAttachmentStatus:'NATIVE_ATTACHMENT_NOT_CONFIGURED',revoke(){if(leases.get(run.id)===lease)leases.delete(run.id);}};
  }
  async function handler(req,res){
    if((req.url??'').split('?')[0]!==url.pathname)return false;
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers.host!==url.host||req.headers.origin!==undefined&&req.headers.origin!==url.origin){reply(res,403,'SESSION_ROLE_LOCAL_ONLY');return true;}
    if(closed){reply(res,503,'SESSION_ROLE_GATEWAY_UNAVAILABLE');return true;}
    let lease;const header=req.headers.authorization;
    if(typeof header==='string'&&/^Bearer [A-Za-z0-9_-]{43}$/.test(header)){const token=Buffer.from(header.slice(7),'base64url');for(const candidate of leases.values())if(token.length===candidate.token.length&&timingSafeEqual(token,candidate.token))lease=candidate;}
    if(!lease||!active(lease,store.read())){reply(res,401,'SESSION_ROLE_AUTH');return true;}
    if(req.url!==url.pathname){reply(res,400,'SESSION_ROLE_URL');return true;}
    if(req.method!=='POST'){res.setHeader('Allow','POST');reply(res,405,'METHOD_NOT_ALLOWED');return true;}
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')){reply(res,415,'CONTENT_TYPE');return true;}
    if(Number(req.headers['content-length']??0)>196608){req.resume();reply(res,413,'REQUEST_LIMIT');return true;}
    if(requests.size>=16){reply(res,429,'SESSION_ROLE_BUSY');return true;}
    const request={req,res,server:null};requests.add(request);
    try{
      const bytes=await body(req);if(bytes===null){reply(res,413,'REQUEST_LIMIT');return true;}check(lease);
      let parsed;try{parsed=JSON.parse(bytes.toString('utf8'));}catch{reply(res,400,'INVALID_JSON');return true;}
      if(!parsed||Array.isArray(parsed)||typeof parsed!=='object'){reply(res,400,'INVALID_JSONRPC');return true;}
      const checkCall=params=>{if(!lease.binding)return;const meta=params._meta?.['forge/session-native-v1'],keys=['sessionId','turnId','callId','messageId'];if(!meta||Object.keys(meta).sort().join()!==[...keys].sort().join()||keys.some(k=>typeof meta[k]!=='string'||!meta[k]||meta[k].length>300)||meta.sessionId!==lease.binding.nativeSessionId||meta.turnId!==lease.binding.nativeTurnId)fail('SESSION_ROLE_NATIVE_CALL','Native tool context does not match this exact session and turn');};
      const server=createSessionRoleMcpServer({service,scope:{projectId:lease.projectId,parentRunId:lease.runId},callerContext:lease.caller,checkActive:()=>check(lease),checkCall});request.server=server;
      const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await server.connect(transport);check(lease);
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');await transport.handleRequest(req,res,parsed);
    }catch(e){if(!res.headersSent)reply(res,e.statusCode===401?401:500,'SESSION_ROLE_TRANSPORT');else if(!res.writableEnded)res.end();}
    finally{await request.server?.close().catch(()=>{});requests.delete(request);}return true;
  }
  return Object.freeze({issueForRun,handler,invalidateForRestore(){generation++;leases.clear();},async close(){closed=true;generation++;leases.clear();for(const r of requests){r.req.destroy();r.res.destroy();await r.server?.close().catch(()=>{});}}});
}
