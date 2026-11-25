import http from 'node:http';
import {createHmac} from 'node:crypto';
import {boundedToolSchemas} from './transport.mjs';
import {canonical,digest,secretEqual,fail} from './profile.mjs';

/** Explicit host-owned loopback gateway; no inference or provider-turn loop.
 * Binding, canonical proof and Stop/policy fence belong to the same run owner.
 * Gateway identity/key never enter model tool arguments or project config.
 */
export async function openLocalGateway({authority,handle,key,broker,withFence,nativeSessionId,authorizeNativePhase=()=>true}){
  if(!Buffer.isBuffer(key)||key.length!==32)fail('GATEWAY_KEY_REQUIRED');
  const secret=Buffer.from(key),token=secret.toString('hex');
  const runId=authority.assert(handle).runId;
  const session=()=>typeof nativeSessionId==='function'?nativeSessionId():null;
  const verifySession=id=>{if(typeof id!=='string'||id!==session())fail('NATIVE_SESSION_DENIED');};
  const server=http.createServer(async(req,res)=>{
    const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(canonical(value));};
    try{
      if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.origin||!secretEqual(req.headers.authorization,'Bearer '+token)||req.method!=='POST')fail('TRANSPORT_DENIED');
      let data=Buffer.alloc(0);for await(const chunk of req){data=Buffer.concat([data,chunk]);if(data.length>300000)fail('FRAME_LIMIT');}
      const text=new TextDecoder('utf-8',{fatal:true}).decode(data),body=JSON.parse(text);
      if(req.url==='/mcp'){
        // Discovery contains no file effects and still checks current authority.
        authority.assert(handle);
        if(body.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
        let result;
        if(body.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'forge-guarded',version:'1'}};
        else if(body.method==='tools/list')result={tools:boundedToolSchemas};
        else fail('MCP_METHOD_DENIED'); // calls go through authenticated /action
        return reply(200,{jsonrpc:'2.0',id:body.id,result});
      }
      if(!secretEqual(req.headers['x-forge-mac'],createHmac('sha256',secret).update(text).digest('hex')))fail('TRANSPORT_DENIED');
      if(req.url==='/fence'){
        const result=await withFence(runId,async()=>{
          const profile=authority.assert(handle);
          if(body.profileDigest!==digest(profile))fail('PROFILE_CHANGED');
          if(body.sessionID!==null)verifySession(body.sessionID);
          if(authorizeNativePhase(body)!==true)fail('NATIVE_ATTESTATION_REQUIRED');
          return {profileDigest:digest(profile),policyGeneration:profile.policyGeneration,toolGeneration:profile.toolGeneration};
        });return reply(200,{ok:true,result});
      }
      if(req.url==='/action'){
        const {nativeSessionId,...envelope}=body;verifySession(nativeSessionId);
        return reply(200,{ok:true,result:await broker.receive(envelope)});
      }
      fail('METHOD_DENIED');
    }catch(e){if(!res.headersSent)reply(403,{ok:false,error:/^[A-Z_]+$/.test(e.code??'')?e.code:'ACTION_DENIED'});else res.destroy();}
  });
  server.maxHeadersCount=20;server.requestTimeout=10000;server.headersTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));secret.fill(0);}};
}
