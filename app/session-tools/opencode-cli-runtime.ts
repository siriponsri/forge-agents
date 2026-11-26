import { Effect } from "effect"
import { Tool } from "@opencode/schema/tool"
import { Client } from "FORGE_MCP_SDK_CLIENT"
import { StreamableHTTPClientTransport } from "FORGE_MCP_SDK_TRANSPORT"
import { makeOpenCodeSessionTool } from "./forge-sessions/native-tool.mjs"
import { endpointFor, bindingFor } from "./forge-sessions/contract.mjs"
import { sessionBinding, sessionProfile, fence } from "./forge-bootstrap.js"

export function sessionTool(info:any,discovered:any){
  if(!sessionProfile()||discovered.server!=="forge_sessions"||!["session_children","session_prompt"].includes(discovered.name))return undefined
  const execute=(input:any,context:any)=>Effect.gen(function*(){
    yield* Effect.tryPromise({try:()=>fence("session-dispatch",context.sessionID),catch:()=>new Tool.Error({message:"SESSION_NATIVE_BINDING"})})
    const descriptor:any=yield* Effect.tryPromise({try:()=>sessionBinding(context),catch:()=>new Tool.Error({message:"SESSION_NATIVE_BINDING"})})
    const binding=yield* Effect.try({try:()=>bindingFor(descriptor.binding),catch:()=>new Tool.Error({message:"SESSION_NATIVE_BINDING"})})
    if(binding.nativeSessionId!==context.sessionID)return yield* new Tool.Error({message:"SESSION_NATIVE_BINDING"})
    const client=new Client({name:"forge-native-session-tools",version:"1"})
    // Scoped close also covers failed connect/handshake, native cancellation and
    // gateway rejection. No private descriptor is included in model output.
    return yield* Effect.acquireUseRelease(Effect.succeed(client),active=>Effect.gen(function*(){
      yield* Effect.tryPromise({try:()=>active.connect(new StreamableHTTPClientTransport(endpointFor(descriptor.endpoint),{requestInit:{headers:{Authorization:descriptor.authorization}}})),catch:()=>new Tool.Error({message:"SESSION_NATIVE_OUTCOME_UNKNOWN"})})
      return yield* makeOpenCodeSessionTool({name:discovered.name,Effect,ToolError:Tool.Error,client:active,binding,assertCurrent:(b:any,ctx:any)=>sessionProfile()&&Date.now()<descriptor.expiresAt&&ctx.sessionID===b.nativeSessionId}).execute(input,context).pipe(
        Effect.tap(()=>Effect.tryPromise({try:()=>fence("session-return",context.sessionID),catch:()=>new Tool.Error({message:"SESSION_NATIVE_OUTCOME_UNKNOWN"})})))
    }),()=>Effect.promise(()=>client.close().catch(()=>{})))
  })
  return {...info,execute,output:{},options:{...info.options,codemode:false}}
}
