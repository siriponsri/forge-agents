// Executed in the actual patched OpenCode source workspace by run-native.mjs.
// No model/server/provider/account is created. This is a native module fixture,
// explicitly NOT full binary/lifecycle qualification.
import { Effect, Schema, Layer } from "effect"
import { Tool } from "@opencode/core/tool"
import { execute } from "@opencode/core/tool/runtime"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { Flag } from "@opencode/core/flag"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { installHost } from "@opencode/core/forge-guard"
import assert from "node:assert/strict"

const context={sessionID:"ses_guarded",agent:"build",messageID:"msg_guarded",id:"call_guarded",progress:()=>Effect.void} as any
let effects=0,hooks=0,allowed=0,current=true,rewrite=false
const evil={name:"shell",description:"MUST NOT EXECUTE",input:Schema.Struct({}),output:Schema.String,options:{codemode:false,permission:"read"},execute:()=>Effect.sync(()=>{effects++;return {output:"EVIL"}})}
const good={name:"read_text",description:"authenticated engineering fixture",input:Schema.Struct({}),output:Schema.String,options:{namespace:"forge",codemode:false},execute:()=>Effect.sync(()=>{allowed++;return {output:"bounded fixture"}})}
await assert.rejects(Effect.runPromise(execute(evil,{},context)),/FORGE_NATIVE_ACTION_DENIED/)
assert.equal(effects,0)
installHost({assert(input:any){
  if(!current||input.rawName!=="forge_read_text"||input.resolvedName!=="forge_read_text"||input.tool?.execute!==good.execute||input.context?.codemode||input.context?.background||input.context&&input.context.sessionID!==context.sessionID)throw Error("DENIED")
}})
for(const tool of [evil,{...evil,name:"unknown"},{...evil,name:"read_text",options:{namespace:"alternate"}},{...evil,name:"future",options:{permission:"read"}}])await assert.rejects(Effect.runPromise(execute(tool,{},context)),/FORGE_NATIVE_ACTION_DENIED/)
await assert.rejects(Effect.runPromise(execute(good,{}, {...context,codemode:true})),/FORGE_NATIVE_ACTION_DENIED/)
assert.equal((await Effect.runPromise(execute(good,{},context))).output,"bounded fixture")
// Native Tool and native PluginHooks run unchanged beyond the reviewed patches.
// Unrelated ambient services are replaced, so this fixture cannot load user or
// managed config, initialize a provider or inspect an account.
const layer=LayerNode.compile(LayerNode.group([Tool.node,PluginHooks.node]),{replacements:[
  Image.node.replace(Layer.succeed(Image.Service,{} as any)),
  Permission.node.replace(Layer.succeed(Permission.Service,{assert:()=>Effect.void} as any)),
  Flag.node.replace(Layer.succeed(Flag.Service,{enabled:()=>Effect.succeed(false)} as any)),
]})
await Effect.runPromise(Effect.gen(function*(){
  const tools=yield* Tool.Service,pluginHooks=yield* PluginHooks.Service
  yield* pluginHooks.register("tool","execute.before",event=>Effect.sync(()=>{hooks++;if(rewrite)event.tool="shell"}))
  yield* tools.transform(editor=>{editor.add(evil);editor.add(good)})
  const snapshot=yield* tools.snapshot()
  assert.deepEqual(snapshot.definitions.map(x=>x.name),["forge_read_text"])
  function call(name:string,definitions?:any){return snapshot.execute({...context,call:{type:"tool-call",id:"native_fixture",name,input:{}},definitions})}
  for(const name of ["read","write","shell","unknown","execute","t3_send","alternate_read_text","read_alias"]){
    const result=yield* call(name).pipe(Effect.result);assert.equal(result._tag,"Failure")
  }
  assert.equal(hooks,0)
  yield* call("forge_read_text");assert.equal(hooks,1)
  rewrite=true
  const denied=yield* call("forge_read_text").pipe(Effect.result);assert.equal(denied._tag,"Failure");rewrite=false
  const alias=yield* call("alias",new Map([["alias",{name:"forge_read_text"}]])).pipe(Effect.result);assert.equal(alias._tag,"Failure")
  current=false;const stale=yield* call("forge_read_text").pipe(Effect.result);assert.equal(stale._tag,"Failure")
}).pipe(Effect.scoped,Effect.provide(layer)))
assert.equal(effects,0);assert.equal(allowed,2)
console.log(JSON.stringify({nativeModuleGate:"PASS",effects,allowed,hooks,fullRuntimeQualification:null,contextAndT3Lifecycle:"NOT_QUALIFIED"}))
