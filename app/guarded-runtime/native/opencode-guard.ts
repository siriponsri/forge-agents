// Added to the MIT OpenCode derivative. Not a plugin or config authority.
import { Effect } from "effect"
import { Tool } from "@opencode/schema/tool"
import {hasBootstrap,fence,boundedAction,config as bootstrapConfig,acceptsMcp,assertModel as checkModel,sealMetadata,checkMetadata,checkCreate} from "./forge-bootstrap.js"

type Host = {
  assert: (input: { phase: string; rawName: string; resolvedName: string; tool: unknown; context: unknown }) => void
}
let host: Host | undefined
const authenticated=new WeakMap<Function,string>()
// Private native bootstrap only. The derivative refuses model turns/context
// until a complete, qualified host bridge exists. Never export through MCP.
export function installHost(value: Host) {
  if (host || !value || typeof value.assert !== "function") throw Error("FORGE_HOST_INVALID")
  host = value
}
export const assertTool = (phase: string, rawName: string, resolvedName: string, tool: unknown, context: unknown) =>
  Effect.tryPromise({
    try: async () => {
      if(host){host.assert({phase,rawName,resolvedName,tool,context});return}
      const info=tool as any,ctx=context as any,operation=authenticated.get(info?.execute)
      if(!hasBootstrap()||!operation||rawName!=="forge_guarded_"+operation||resolvedName!==rawName||ctx?.codemode||ctx?.background||ctx?.delegated||ctx?.parentCallId)throw Error("FORGE_NATIVE_ACTION_DENIED")
      await fence(phase,ctx?.sessionID)
    },
    catch: () => new Tool.Error({ message: "FORGE_NATIVE_ACTION_DENIED" }),
  })

// Initial guarded profile has no ambient project/global/URL/config input.
// Explicit context comes from the canonical task text and bounded file tools.
export const denyContext = () => Effect.die(new Error("FORGE_NATIVE_CONTEXT_UNQUALIFIED"))
export const privateConfig=()=>bootstrapConfig()
export const assertSession=(phase:string,sessionID:string)=>Effect.tryPromise({try:()=>fence(phase,sessionID),catch:()=>new Tool.Error({message:"FORGE_NATIVE_CONTEXT_DENIED"})})
export function trustedMcp(info:any,discovered:any){
  if(!hasBootstrap()||!acceptsMcp(discovered)||!["read_text","propose_change","edit_text"].includes(discovered.name))return info
  // Only the fixed privately bootstrapped MCP server is configured. Native
  // attached-client registration is disabled by the derivative patch.
  const operation=discovered.name
  const execute=(input:any,context:any)=>Effect.tryPromise({try:async()=>({output:await boundedAction(operation,input,context)}),catch:()=>new Tool.Error({message:"FORGE_BOUNDED_ACTION_DENIED"})})
  authenticated.set(execute,operation)
  return {...info,execute,output:{},options:{...info.options,codemode:false}}
}
export const assertModel=(ref:any)=>Effect.try({try:()=>checkModel(ref),catch:()=>new Tool.Error({message:"FORGE_MODEL_CHANGED"})})
export {sealMetadata}
export const assertCachedContext=(session:any)=>Effect.try({try:()=>checkMetadata(session),catch:()=>new Tool.Error({message:"FORGE_CACHED_CONTEXT_CHANGED"})})
export const assertCreate=(input:any)=>Effect.tryPromise({try:()=>checkCreate(input),catch:()=>new Tool.Error({message:"FORGE_NATIVE_CONTEXT_DENIED"})})
