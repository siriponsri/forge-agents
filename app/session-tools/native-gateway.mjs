import {createServer} from 'node:http';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {digest,exact} from '../guarded-runtime/profile.mjs';
import {PURPOSE,SESSION_TOOLS,toolManifest,bindingFor,identifier,endpointFor} from './contract.mjs';
const sync=(fn,...args)=>{const result=fn(...args);if(result?.then)throw Error('SESSION_NATIVE_SYNC_REQUIRED');return result;};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));

// One private native attempt, catalog and authenticated binding only. This does
// not own a provider turn or mint a role grant. Root issues the role capability
// using canonical current authority and retains its own lifecycle/Stop hooks.
export async function openSessionNativeGateway({assertCurrent,bindingProvider,attachmentProvider,authorizePhase,withFence,onClose=()=>{}}){
  if(![assertCurrent,bindingProvider,attachmentProvider,authorizePhase,withFence,onClose].every(x=>typeof x==='function'))throw TypeError('Private canonical callbacks required');
  const key=randomBytes(32);let closed=false,pinnedBinding;
  function current(){
    if(closed)throw Error('SESSION_NATIVE_CLOSED');
    const p=sync(assertCurrent);
    if(p?.purpose!==PURPOSE||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=Date.now()||p.manifestDigest!==digest(toolManifest()))throw Error('SESSION_NATIVE_AUTHORITY');return p;
  }
  const server=createServer(async(req,res)=>{
    // A role-tool round trip can outlive this listener's idle socket lease.
    // End each control acknowledgement's connection instead of depending on
    // native connection reuse across that gap. Uncertain POSTs are never retried.
    const reply=(status,value)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});res.end(JSON.stringify(value));};
    try{
      if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==new URL(url).host||req.headers.origin!==undefined||!equal(req.headers.authorization,'Bearer '+key.toString('hex')))return reply(401,{ok:false,error:'SESSION_NATIVE_AUTH'});
      current();
      if(req.method!=='POST'||!['/mcp','/fence','/session-binding'].includes(req.url))return reply(404,{ok:false,error:'SESSION_NATIVE_METHOD'});
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')||Number(req.headers['content-length']??0)>32768)return reply(413,{ok:false,error:'SESSION_NATIVE_LIMIT'});
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>32768)throw Error('SESSION_NATIVE_LIMIT');}
      const body=JSON.parse(raw);current();
      if(req.url==='/mcp'){
        if(body.jsonrpc!=='2.0')throw Error('SESSION_NATIVE_PROTOCOL');
        if(body.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
        const result=body.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'forge-sessions',version:'1'}}:body.method==='tools/list'?{tools:SESSION_TOOLS}:null;
        if(!result)throw Error('SESSION_NATIVE_CATALOG_ONLY');return reply(200,{jsonrpc:'2.0',id:body.id,result});
      }
      if(!equal(req.headers['x-forge-mac'],createHmac('sha256',key).update(raw).digest('hex')))throw Error('SESSION_NATIVE_AUTH');
      const result=await withFence(()=>{
        const p=current();if(body.profileDigest!==digest(p))throw Error('SESSION_NATIVE_PROFILE');
        if(req.url==='/fence'){
          exact(body,['profileDigest','phase','sessionID']);identifier(body.phase);
          if(sync(authorizePhase,body,p)!==true)throw Error('SESSION_NATIVE_PHASE');return {profileDigest:digest(p)};
        }
        exact(body,['profileDigest','sessionId','callId','messageId']);for(const k of ['sessionId','callId','messageId'])identifier(body[k]);
        const native={sessionId:body.sessionId,callId:body.callId,messageId:body.messageId};
        const binding=bindingFor(sync(bindingProvider,native,p));
        if(binding.projectId!==p.projectId||binding.runId!==p.runId||binding.attemptId!==p.attemptId||binding.threadId!==p.threadId||binding.nativeSessionId!==body.sessionId)throw Error('SESSION_NATIVE_BINDING');
        if(pinnedBinding&&pinnedBinding!==digest(binding))throw Error('SESSION_NATIVE_BINDING_CHANGED');
        // Callback is host-only, synchronous, and returns the preissued per-run
        // capability. It must NOT perform recursive canonical transactions.
        const descriptor=sync(attachmentProvider,binding,native,p),config=descriptor?.configuration;
        if(config?.type!=='http'||typeof config.headers?.Authorization!=='string'||!/^Bearer [A-Za-z0-9_-]{43}$/.test(config.headers.Authorization)||!Number.isSafeInteger(descriptor.expiresAt)||descriptor.expiresAt<=Date.now()||descriptor.expiresAt>p.expiresAt)throw Error('SESSION_NATIVE_ATTACHMENT');
        const endpoint=endpointFor(config.url).href;pinnedBinding=digest(binding);
        return {binding,endpoint,authorization:config.headers.Authorization,expiresAt:descriptor.expiresAt};
      });
      reply(200,{ok:true,result});
    }catch(e){if(!res.headersSent)reply(403,{ok:false,error:/^SESSION_NATIVE_[A-Z_]+$/.test(e?.message??'')?e.message:'SESSION_NATIVE_DENIED'});else res.destroy();}
  });
  server.requestTimeout=10000;server.headersTimeout=5000;server.maxHeadersCount=24;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const url=`http://127.0.0.1:${server.address().port}`;let closing;
  return Object.freeze({url,bootstrap(){current();return {key:key.toString('hex'),brokerUrl:url};},close(){return closing??=(async()=>{closed=true;key.fill(0);try{await onClose();}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}})();}});
}
