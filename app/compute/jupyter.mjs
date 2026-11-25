import { randomUUID } from 'node:crypto';
import { request, secret, error, clean, checkRuntimeSignal } from './common.mjs';

const contents=(c,j,suffix)=>'/api/contents/'+[...c.workspace.split('/'),`.forge-${j.id}.${suffix}`].map(encodeURIComponent).join('/');
export async function jupyterHealth(c,runtime={}){
  const specs=await request(c,'/api/kernelspecs',{auth:'token'},runtime);
  return {verified:!!specs.kernelspecs?.[c.kernelName],execution:!!specs.kernelspecs?.[c.kernelName],kernelName:c.kernelName,kernels:Object.keys(specs.kernelspecs??{}).map(name=>clean(name,c,runtime))};
}
// Receipt survives a lost WebSocket. A missing receipt or kernel never proves completion.
function wrapped(j){return `import os as _fo, json as _fj, time as _ft, traceback as _fb, contextlib as _fc
_fr='.forge-${j.id}.json'
_fl='.forge-${j.id}.log'
def _fw(v):
    with open(_fr+'.tmp','w',encoding='utf8') as f:
        _fj.dump(v,f); f.flush(); _fo.fsync(f.fileno())
    _fo.replace(_fr+'.tmp',_fr)
_fw({'owner':${JSON.stringify(j.ownerToken)},'status':'running'})
with open(_fl,'w',encoding='utf8',buffering=1) as _f:
    try:
        with _fc.redirect_stdout(_f),_fc.redirect_stderr(_f):
            ${j.checkpoint?`_fo.environ['FORGE_CHECKPOINT_PATH']=${JSON.stringify(j.checkpoint.path)}`:'pass'}
            exec(compile(${JSON.stringify(j.code)},'forge-notebook.py','exec'),{'__name__':'__main__'})
        _fw({'owner':${JSON.stringify(j.ownerToken)},'status':'completed','finishedAt':_ft.time()})
    except BaseException as _e:
        _fb.print_exc(file=_f)
        _fw({'owner':${JSON.stringify(j.ownerToken)},'status':'interrupted' if isinstance(_e,KeyboardInterrupt) else 'failed','error':type(_e).__name__,'finishedAt':_ft.time()})
`;}
export async function jupyterStart(c,j,persist,isStopped=()=>false,runtime={}){
  const session=await request(c,'/api/sessions',{method:'POST',auth:'token',body:{path:`${c.workspace}/forge-${j.id}.ipynb`,name:`FORGE ${j.id}`,type:'notebook',kernel:{name:c.kernelName}}},runtime);
  if(typeof session.id!=='string'||typeof session.kernel?.id!=='string'||clean(session.id,c,runtime)!==session.id||clean(session.kernel.id,c,runtime)!==session.kernel.id)error('COMPUTE_RESPONSE','Jupyter did not return valid session/kernel identities',502);
  const remote={sessionId:session.id,kernelId:session.kernel.id,messageId:randomUUID()};await persist(remote);
  checkRuntimeSignal(runtime);
  const endpoint=new URL(`${c.baseUrl}/api/kernels/${encodeURIComponent(remote.kernelId)}/channels`);endpoint.protocol=endpoint.protocol==='https:'?'wss:':'ws:';endpoint.searchParams.set('session_id',j.ownerToken);endpoint.searchParams.set('token',secret(c.authEnv,runtime));
  return new Promise((resolve,reject)=>{
    // The browser-standard Node WebSocket supports Jupyter's token query auth. The URL is never persisted.
    let ws,sent=false,settled=false,timer,closeTimer;
    const uncertain=message=>Object.assign(new Error(message),{code:'COMPUTE_UNCERTAIN',statusCode:502});
    function finish(e){if(settled)return;settled=true;clearTimeout(timer);e?reject(e):resolve({status:'submitted',remote});}
    const abort=()=>{ws?.close();finish(uncertain('Jupyter channels cancelled; reconcile receipt without redispatch'));};
    try{ws=new WebSocket(endpoint);}catch{return finish(uncertain('Jupyter channels connection failed'));}
    timer=setTimeout(()=>{ws.close();finish(uncertain('Jupyter channels timed out; reconcile receipt without redispatch'));},c.timeoutMs);
    ws.addEventListener('open',async()=>{try{await runtime.beforeDispatch?.();if(isStopped()||runtime.signal?.aborted){ws.close();return finish(Object.assign(new Error('Execution cancelled before channels dispatch'),{code:'COMPUTE_CANCELLED',statusCode:409}));}ws.send(JSON.stringify({channel:'shell',header:{msg_id:remote.messageId,username:'forge',session:j.ownerToken,msg_type:'execute_request',version:'5.3',date:new Date().toISOString()},parent_header:{},metadata:{},content:{code:wrapped(j),silent:false,store_history:false,user_expressions:{},allow_stdin:false,stop_on_error:true},buffers:[]}));sent=true;finish();}catch{ws.close();finish(uncertain('Jupyter channels dispatch failed; reconcile receipt without redispatch'));}});
    ws.addEventListener('message',event=>{try{const msg=JSON.parse(String(event.data));if(msg.parent_header?.msg_id===remote.messageId&&msg.header?.msg_type==='execute_reply')ws.close();}catch{/* Binary rich output is retained by the notebook runtime, not interpreted as text. */}});
    ws.addEventListener('error',()=>{ws.close();finish(Object.assign(new Error('Jupyter channels connection failed'),{code:'COMPUTE_UNCERTAIN',statusCode:502}));});
    ws.addEventListener('close',()=>{clearTimeout(closeTimer);clearTimeout(timer);runtime.signal?.removeEventListener('abort',abort);if(!sent)finish(Object.assign(new Error('Jupyter channels closed before dispatch acknowledgement'),{code:'COMPUTE_UNCERTAIN',statusCode:502}));});
    // Closing the transport after dispatch does not cancel the owned kernel. Receipts remain authoritative.
    ws.addEventListener('open',()=>{closeTimer=setTimeout(()=>ws.close(),Math.min(c.timeoutMs,1000));closeTimer.unref();});
    runtime.signal?.addEventListener('abort',abort,{once:true});if(runtime.signal?.aborted)abort();
  });
}
export async function jupyterStatus(c,j,runtime={}){
  const [receipt,log]=await Promise.all([request(c,contents(c,j,'json'),{auth:'token',allow404:true},runtime),request(c,contents(c,j,'log'),{auth:'token',allow404:true},runtime)]);
  if(!receipt)return {status:'unknown',logs:clean(typeof log?.content==='string'?log.content:'',c,runtime),reason:'No durable execution receipt; never infer success or redispatch'};
  let state;try{state=typeof receipt.content==='string'?JSON.parse(receipt.content):receipt.content;}catch{error('COMPUTE_RESPONSE','Invalid Jupyter receipt',502);}
  if(state?.owner!==j.ownerToken)error('OWNERSHIP_MISMATCH','Jupyter receipt belongs to another execution',409);
  const status=state.status==='interrupted'&&j.stopRequested?'stopped':state.status;
  return {status:typeof status==='string'?clean(status,c,runtime):'unknown',logs:typeof log?.content==='string'?clean(log.content,c,runtime).slice(-200000):'',error:state.error===undefined?undefined:clean(state.error,c,runtime),finishedAt:typeof state.finishedAt==='string'?clean(state.finishedAt,c,runtime):typeof state.finishedAt==='number'?state.finishedAt:undefined};
}
export async function jupyterStop(c,j,runtime={}){
  if(!j.remote?.sessionId||!j.remote?.kernelId)error('COMPUTE_UNCERTAIN','No owned Jupyter kernel identity; reconcile before stop',409);
  const session=await request(c,`/api/sessions/${encodeURIComponent(j.remote.sessionId)}`,{auth:'token'},runtime);
  if(session.kernel?.id!==j.remote.kernelId)error('OWNERSHIP_MISMATCH','Selected session no longer owns the recorded kernel',409);
  await request(c,`/api/kernels/${encodeURIComponent(j.remote.kernelId)}/interrupt`,{method:'POST',auth:'token'},runtime);
  return {status:'stopping'};
}
