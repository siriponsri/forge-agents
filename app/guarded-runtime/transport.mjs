import {canonical,exact,fail,TOOLS} from './profile.mjs';

/** Bounded private pipe framing. Does not listen, launch, select an account or
 * accept a model-supplied host/server/tool name. The authenticated envelope is
 * verified again by broker.receive. Caller owns pipe identity and teardown.
 */
export function servePrivateBroker({readable,writable,broker,onFailure=()=>{}}){
  let bytes=Buffer.alloc(0),tail=Promise.resolve(),closed=false;
  const stop=()=>{closed=true;readable.off('data',data);readable.destroy();writable.end();};
  function data(chunk){
    if(closed)return;
    bytes=Buffer.concat([bytes,Buffer.from(chunk)]);
    if(bytes.length>300000){onFailure('FRAME_LIMIT');stop();return;}
    let end;
    while((end=bytes.indexOf(10))>=0){
      const frame=bytes.subarray(0,end);bytes=bytes.subarray(end+1);
      tail=tail.then(async()=>{
        if(closed)return;
        try{const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(frame));const result=await broker.receive(envelope);writable.write(canonical({ok:true,result})+'\n');}
        catch(e){writable.write(canonical({ok:false,error:/^[A-Z_]+$/.test(e.code??'')?e.code:'ACTION_DENIED'})+'\n');}
      });
    }
  }
  readable.on('data',data);readable.once('error',()=>{onFailure('PIPE_FAILED');stop();});
  return {async close(){await tail;stop();}};
}

// Only these schemas may be advertised by a future authenticated native MCP
// bridge. Discovery does not itself authenticate or qualify that bridge.
export const boundedToolSchemas=Object.freeze(TOOLS.map(tool=>({
  name:tool,
  inputSchema:{type:'object',additionalProperties:false,required:tool==='read_text'?['path']:['path','expectedRevision','text'],properties:{path:{type:'string',minLength:1,maxLength:512},...(tool==='read_text'?{}:{expectedRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},text:{type:'string',maxLength:65536}})}},
})));

export function boundedMcpRequest(name,args){
  if(!TOOLS.includes(name))fail('TOOL_DENIED');
  exact(args,name==='read_text'?['path']:['path','expectedRevision','text']);
  return {tool:name,...args};
}
