import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const sync=(fn,...args)=>{const v=fn(...args);if(v?.then)fail('RESEARCH_NATIVE_SYNC_REQUIRED');return v;};
const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function completionStream(){
  const decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',data=[],event='',done=false;
  function line(value){
    if(value===''){
      if(data.length){
        const payload=data.join('\n');
        if(done||event==='error')fail('RESEARCH_NATIVE_UPSTREAM_INCOMPLETE');
        if(payload==='[DONE]')done=true;
        else{let chunk;try{chunk=JSON.parse(payload);}catch{fail('RESEARCH_NATIVE_UPSTREAM_INCOMPLETE');}if(!chunk||!Array.isArray(chunk.choices))fail('RESEARCH_NATIVE_UPSTREAM_INCOMPLETE');}
      }
      data=[];event='';return;
    }
    if(value.startsWith(':'))return;
    const index=value.indexOf(':'),field=index<0?value:value.slice(0,index);let content=index<0?'':value.slice(index+1);if(content.startsWith(' '))content=content.slice(1);
    if(field==='data')data.push(content);else if(field==='event')event=content;
  }
  function consume(final=false){
    if(buffer.length>1048576)fail('RESEARCH_NATIVE_RESPONSE_LIMIT');
    for(;;){const index=buffer.search(/[\r\n]/);if(index<0)return;if(buffer[index]==='\r'&&index===buffer.length-1&&!final)return;const width=buffer[index]==='\r'&&buffer[index+1]==='\n'?2:1;line(buffer.slice(0,index));buffer=buffer.slice(index+width);}
  }
  return {push(bytes){buffer+=decoder.decode(bytes,{stream:true});consume();},finish(){buffer+=decoder.decode();consume(true);if(!done||buffer||data.length)fail('RESEARCH_NATIVE_UPSTREAM_INCOMPLETE');}};
}

/** Private egress only. Native retries reuse a prepared model request and do
 * not necessarily repeat the native phase fence. Every real HTTP attempt must
 * therefore also pass this gateway. The supported subset performs zero retries
 * after failed/partial/unknown upstream delivery; normal successful tool-loop
 * continuations are separate steps. No model/config controlled upstream URL.
 */
export async function openResearchModelGateway({provider,withFence,authorizeRequest,onFailure,clock=Date.now}={}){
  if(typeof withFence!=='function'||typeof authorizeRequest!=='function'||typeof onFailure!=='function')throw new TypeError('Canonical private resource callbacks required');
  const original=structuredClone(provider),base=new URL(original?.settings?.baseURL);
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||typeof original.settings.apiKey!=='string'||!original.settings.apiKey||original.settings.transport!=='http'||!original.id||!original.model||Object.keys(original.settings).some(k=>!['baseURL','apiKey','transport'].includes(k)))fail('RESEARCH_NATIVE_PROVIDER_UNSUPPORTED');
  const upstream=new URL(base.href.replace(/\/$/,'')+'/chat/completions');
  const secret=randomBytes(32).toString('base64url'),controllers=new Set();
  let binding=null,closed=false,failed=false,busy=false,attempts=0,contract=null;
  const server=http.createServer(async(req,res)=>{
    let controller,started=false,watchdog,acquired=false;
    const reply=(status,code)=>{if(!res.headersSent){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{message:code,type:'forge_resource_denial'}}));}else res.destroy();};
    const abort=()=>controller?.abort();
    try{
      if(closed||!binding||failed||busy||req.socket.remoteAddress!=='127.0.0.1'||req.headers.origin||req.method!=='POST'||req.url!=='/v1/chat/completions'||!equal(req.headers.authorization,'Bearer '+secret))fail('RESEARCH_NATIVE_EGRESS_DENIED');
      busy=true;acquired=true;
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1048576)fail('RESEARCH_NATIVE_REQUEST_TOO_LARGE');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks),body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(body.model!==original.model||body.stream!==true)fail('RESEARCH_NATIVE_MODEL_CHANGED');
      controller=new AbortController();controllers.add(controller);res.once('close',abort);
      // Launch under the SAME writer as Stop. Do not hold that writer while
      // awaiting provider I/O. The pending Promise stays in this private closure
      // and never enters the store transaction's serializable return value.
      // Local monotone attempts/failed state survive a failed canonical commit.
      let pending;
      await withFence(binding.runId,()=>{
        if(closed||failed)fail('RESEARCH_NATIVE_EGRESS_DENIED');
        const permit=sync(authorizeRequest,{...binding,priorAttempts:attempts});
        if(!permit||!Number.isSafeInteger(permit.deadlineAt)||permit.deadlineAt<=clock()||!Number.isSafeInteger(permit.maxSteps)||permit.maxSteps<1||!/^[a-f0-9]{64}$/.test(permit.requestDigest))fail('RESEARCH_NATIVE_EGRESS_UNQUALIFIED');
        const next={deadlineAt:permit.deadlineAt,maxSteps:permit.maxSteps,requestDigest:permit.requestDigest};
        if(contract&&JSON.stringify(contract)!==JSON.stringify(next)||attempts>=permit.maxSteps)fail('RESEARCH_NATIVE_EGRESS_LIMIT');
        contract=next;attempts++;started=true;
        watchdog=setTimeout(abort,Math.max(1,permit.deadlineAt-clock()));
        pending=fetch(upstream,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+original.settings.apiKey,'Content-Type':'application/json'},body:bytes,signal:controller.signal});
        // Prevent an unhandled rejection if the surrounding canonical Tx fails.
        pending.catch(()=>{});
      });
      const response=await pending;
      if(!response.ok||!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))fail('RESEARCH_NATIVE_UPSTREAM_FAILED');
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});
      let received=0;const completion=completionStream();
      for await(const chunk of response.body){
        received+=chunk.length;if(received>16777216||closed||controller.signal.aborted)fail('RESEARCH_NATIVE_RESPONSE_LIMIT');
        completion.push(chunk);
        if(!res.write(chunk))await new Promise((resolve,reject)=>{res.once('drain',resolve);res.once('close',()=>reject(new Error('closed')));});
      }
      completion.finish();
      res.off('close',abort);res.end();
    }catch(error){
      if(started){failed=true;abort();try{await withFence(binding.runId,()=>sync(onFailure,{...binding,priorAttempts:attempts}));}catch{/* Monotone local denial survives Stop/rollback. */}}
      reply(403,/^[A-Z_]+$/.test(error.code??'')?error.code:'RESEARCH_NATIVE_EGRESS_DENIED');
    }finally{clearTimeout(watchdog);controllers.delete(controller);if(acquired)busy=false;}
  });
  server.requestTimeout=15000;server.headersTimeout=5000;server.maxHeadersCount=20;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const wrapped={...original,settings:{baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKey:secret,transport:'http'}};
  return Object.freeze({
    provider:wrapped,
    bind(value){if(closed||!value||Object.keys(value).sort().join(',')!=='attemptId,runId'||![value.runId,value.attemptId].every(x=>typeof x==='string'&&x))fail('RESEARCH_NATIVE_EGRESS_BINDING');if(binding&&(binding.runId!==value.runId||binding.attemptId!==value.attemptId))fail('RESEARCH_NATIVE_EGRESS_REBIND');binding={...value};},
    snapshot(){return {bound:!!binding,attempts,failed,closed};},
    async close(){if(closed)return;closed=true;for(const c of controllers)c.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
  });
}
