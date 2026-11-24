// T3 0.1.11 / 59651c1: Effect RPC JSON framing (not JSON-RPC 2.0).
// Only the read surface is exposed. MCP remains the sole execution controller.
async function openSocket({url,ticket,onDisconnect=()=>{}},approvalOnly=false){
  const target=new URL('/ws',url);target.protocol='ws:';
  target.searchParams.set('orchestrationProtocol','2');target.searchParams.set('wsTicket',ticket);
  const socket=new WebSocket(target);let serial=0,closed=false;
  const pending=new Map();
  const send=frame=>socket.send(JSON.stringify(frame));
  const disconnected=()=>{
    for(const p of pending.values()){clearTimeout(p.timer);p.reject?.(new Error('T3 read feed disconnected; reconnect explicitly'));}
    pending.clear();if(!closed){closed=true;onDisconnect();}
  };
  socket.addEventListener('close',disconnected);
  socket.addEventListener('error',disconnected);
  socket.addEventListener('message',message=>{
    let frames;try{const frame=JSON.parse(message.data);frames=Array.isArray(frame)?frame:[frame];}catch{socket.close();return;}
    for(const frame of frames){
      if(frame._tag==='Ping'){send({_tag:'Pong'});continue;}
      const p=pending.get(String(frame.requestId));if(!p)continue;
      if(frame._tag==='Chunk'){
        // Serialize callbacks, then acknowledge so native feed backpressure works.
        p.queue=p.queue.then(async()=>{for(const value of frame.values??[])await p.onValue(value);if(!closed)send({_tag:'Ack',requestId:frame.requestId});}).catch(()=>socket.close());
      }else if(frame._tag==='Exit'){
        clearTimeout(p.timer);pending.delete(String(frame.requestId));
        if(frame.exit?._tag==='Success')p.resolve?.(frame.exit.value);
        else p.reject?.(new Error('T3 read RPC failed; inspect native T3 diagnostics'));
      }
    }
  });
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.close();reject(new Error('T3 read feed connect timeout'));},10000);
    socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
    socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('T3 read feed connection failed'));},{once:true});
  });
  function request(tag,payload,onValue){
    if(closed)throw new Error('T3 read feed disconnected; reconnect explicitly');
    const id=String(++serial);
    const promise=new Promise((resolve,reject)=>{
      const p={resolve,reject,onValue,queue:Promise.resolve()};
      if(!onValue)p.timer=setTimeout(()=>{pending.delete(id);send({_tag:'Interrupt',requestId:id});reject(new Error('T3 read RPC timeout'));},30000);
      pending.set(id,p);send({_tag:'Request',id,tag,payload,headers:[]});
    });
    return {id,promise};
  }
  const close=()=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject?.(new Error('T3 read feed closed'));}pending.clear();socket.close();};
  if(approvalOnly)return {
    respondApproval:({threadId,requestId,commandId,decision})=>request('orchestration.dispatchCommand',{type:'runtime-request.respond',threadId,requestId,commandId,decision}).promise,
    close,
  };
  return {
    projection:threadId=>request('orchestration.getThreadProjection',{threadId}).promise,
    item:(threadId,itemId)=>request('orchestration.getTurnItem',{threadId,itemId}).promise,
    subscribe(threadId,onValue){
      const {id,promise}=request('orchestration.subscribeThread',{threadId},onValue);
      // Even a clean stream exit ends observation, not the provider execution.
      promise.then(()=>{if(!closed)socket.close();},()=>{if(!closed)socket.close();});
      return ()=>{if(!closed)send({_tag:'Interrupt',requestId:id});pending.delete(id);};
    },
    close,
  };
}
export const openT3ReadFeed=options=>openSocket(options);
// Separate explicitly requested native approval response, never available on the
// read-only feed. No turn-control or arbitrary dispatch surface is exported.
export const openT3ApprovalChannel=options=>openSocket(options,true);
