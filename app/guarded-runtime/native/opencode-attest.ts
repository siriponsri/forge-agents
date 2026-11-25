// Private, authenticated component probe in the running native Tool service.
// No provider/model call and no workspace effect. Never exposed as a model tool.
import {Effect,Exit,Schema} from "effect"
import {HttpServerRequest,HttpServerResponse} from "effect/http"
import {Tool} from "@opencode/core/tool"
import {McpTool} from "@opencode/core/tool/mcp"
import {Mcp} from "@opencode/core/mcp/index"
import {PluginHooks} from "@opencode/core/plugin/hooks"
import {Plugin} from "@opencode/core/plugin"
import {execute} from "@opencode/core/tool/runtime"
import {assertSession} from "@opencode/core/forge-guard"
import {bootstrapObservation,verifyHostProbe,signObservation} from "@opencode/core/forge-bootstrap"

export const probe=Effect.suspend(()=>{let stage="authentication";return Effect.gen(function*(){
  const request=yield* HttpServerRequest.HttpServerRequest
  const body:any=yield* request.json
  yield* Effect.try(()=>verifyHostProbe(body,request.headers["x-forge-probe"]))
  yield* assertSession("attest",body.sessionID)
  stage="services"
  yield* Plugin.awaitActivation
  const registry=yield* Tool.Service,hooks=yield* PluginHooks.Service,mcp=yield* McpTool.Service,nativeMcp=yield* Mcp.Service
  // Startup grace is deliberately short upstream. A machine setup check must
  // await the one fixed authenticated endpoint, never qualify an empty catalog.
  yield* nativeMcp.connect("forge_guarded")
  yield* mcp.flush
  stage="snapshot"
  let effects=0,preHooks=0,rewrite=false
  const fake={name:"future",description:"private negative probe",input:Schema.Struct({}),output:Schema.String,options:{permission:"forge_guarded_read_text",codemode:false},execute:()=>Effect.sync(()=>{effects++;return {output:"UNSAFE"}})}
  yield* registry.transform(editor=>editor.add(fake))
  yield* hooks.register("tool","execute.before",event=>Effect.sync(()=>{preHooks++;if(rewrite)event.tool="future"}))
  const tools=yield* registry.snapshot([{action:"*",resource:"*",effect:"allow"}])
  const names=tools.definitions.map(x=>x.name).sort()
  stage=names.length===0?"snapshot_empty":"snapshot_manifest"
  if(names.join(',')!==["forge_guarded_edit_text","forge_guarded_propose_change","forge_guarded_read_text"].join(','))return yield* Effect.die(Error("FORGE_MANIFEST_UNQUALIFIED"))
  const context={sessionID:body.sessionID,agent:"build",messageID:"msg_forge_probe",id:"call_forge_probe",progress:()=>Effect.void} as any
  const denied=Effect.fn(function* (effect:any){if(!Exit.isFailure(yield* effect.pipe(Effect.exit)))return yield* Effect.die(Error("FORGE_GATE_PROBE_FAILED"))})
  stage="raw_denial"
  for(const name of ["shell","read","write","unknown","future","execute","task","alternate_read_text","forge_guarded_read_text_alias"]){
    yield* denied(tools.execute({...context,call:{type:"tool-call",id:context.id,name,input:{}}}))
  }
  if(preHooks!==0)return yield* Effect.die(Error("FORGE_PREHOOK_PROBE_FAILED"))
  yield* denied(execute(fake,{},context))
  stage="nested_denial"
  const bounded=(yield* registry.list()).find(x=>x.name==="read_text"&&x.options?.namespace==="forge_guarded")
  if(!bounded)return yield* Effect.die(Error("FORGE_BOUNDED_EXECUTOR_MISSING"))
  for(const extra of [{codemode:true},{background:true},{delegated:true},{parentCallId:"nested"}]){
    yield* denied(execute(bounded,{path:"../FORGE_PROBE_OUTSIDE"},{...context,...extra}))
  }
  stage="alternate_mcp_denial"
  yield* denied(nativeMcp.attach("forge_guarded",{start:async()=>{effects++},send:async()=>{effects++},close:async()=>{}} as any))
  stage="rewrite_denial"
  rewrite=true
  yield* denied(tools.execute({...context,call:{type:"tool-call",id:context.id,name:"forge_guarded_read_text",input:{path:"../FORGE_PROBE_OUTSIDE"}}}))
  rewrite=false
  stage="outside_denial"
  yield* denied(tools.execute({...context,call:{type:"tool-call",id:context.id,name:"forge_guarded_read_text",input:{path:"../FORGE_PROBE_OUTSIDE"}}}))
  if(effects!==0)return yield* Effect.die(Error("FORGE_EFFECT_PROBE_FAILED"))
  const result={version:1,nonce:body.nonce,sessionID:body.sessionID,...bootstrapObservation(),names,effects,preHooks,negativeCount:17}
  return HttpServerResponse.jsonUnsafe({result,mac:signObservation(result)})
}).pipe(Effect.scoped,Effect.catchCause(()=>Effect.succeed(HttpServerResponse.jsonUnsafe({error:"FORGE_ATTESTATION_DENIED",stage},{status:403}))))})
