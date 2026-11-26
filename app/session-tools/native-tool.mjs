import {META_KEY,SESSION_TOOLS,argumentsFor,bindingFor,resultFor} from './contract.mjs';

// Uses the exact native graph's Effect/Tool.Error. No secondary model loop.
export function makeOpenCodeSessionTool({name,Effect,ToolError,client,binding,assertCurrent}){
  if(!Effect?.tryPromise||typeof ToolError!=='function'||typeof client?.callTool!=='function'||typeof assertCurrent!=='function')throw TypeError('Matching native graph and private client required');
  const definition=SESSION_TOOLS.find(t=>t.name===name);if(!definition)throw Error('SESSION_NATIVE_TOOL_DENIED');
  const bound=Object.freeze(bindingFor(binding));
  function check(ctx){
    if(assertCurrent(bound,ctx)!==true||ctx?.sessionID!==bound.nativeSessionId||ctx.codemode||ctx.background||ctx.delegated||ctx.parentCallId)throw Error('SESSION_NATIVE_CONTEXT');
    return {sessionId:ctx.sessionID,turnId:bound.nativeTurnId,callId:ctx.id,messageId:ctx.messageID};
  }
  return Object.freeze({...definition,options:{namespace:'forge_sessions',codemode:false},input:structuredClone(definition.inputSchema),output:{},execute(input,ctx){
    const task=Effect.tryPromise({try:async signal=>{
      const native=check(ctx),args=argumentsFor(name,input);
      for(const k of ['callId','messageId'])if(typeof native[k]!=='string'||!native[k].trim()||native[k].length>200)throw Error('SESSION_NATIVE_CONTEXT');
      const result=await client.callTool({name,arguments:args,_meta:{[META_KEY]:native}},undefined,{signal,timeout:30000});
      check(ctx);return {output:resultFor(result),content:result.content};
    },catch:e=>new ToolError({message:/^SESSION_NATIVE_[A-Z_]+$/.test(e?.message??'')?e.message:'SESSION_NATIVE_OUTCOME_UNKNOWN'})});
    return ctx.cancel?Effect.raceFirst(task,Effect.flatMap(ctx.cancel,()=>Effect.fail(new ToolError({message:'SESSION_NATIVE_OUTCOME_UNKNOWN'})))):task;
  }});
}
