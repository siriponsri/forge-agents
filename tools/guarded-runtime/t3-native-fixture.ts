// Copied into matching T3 provider workspace. Actual native v2 adapter lifecycle;
// its provider connection is the separately running guarded OpenCode CLI.
import { readFileSync } from "node:fs"
import {pathToFileURL} from "node:url"
import assert from "node:assert/strict"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as Deferred from "effect/Deferred"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as NodeCrypto from "@effect/platform-node/NodeCrypto"
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator"
import * as Sessions from "@t3tools/provider-core/server/McpProviderSessions"
import * as Host from "@t3tools/provider-testing/TestProviderHost"
const boot=JSON.parse(readFileSync(3,"utf8"))
const {Adapter,Client,Server,resolveProfile}=await import(pathToFileURL(boot.nativeEntry).href)
let connections=0,current=true
const phases:string[]=[]
assert.throws(()=>resolveProfile({},{}),/PRIVATE_PROFILE_REQUIRED/)
const {installT3GuardedHost,observeInstalledT3Host}=await import(pathToFileURL(boot.hostBridgePath).href)
const handle=Object.freeze({}),host=installT3GuardedHost({resolveThread:()=>handle,assertCurrent:(input:any)=>{if(input!==handle||!current)throw Error("CURRENT_PROFILE_CHANGED");return boot.profile},runtimeDirectory:()=>boot.cwd})
const policy={runtimeMode:"approval-required",interactionMode:"default",cwd:boot.cwd,forgeGuard:resolveProfile({id:"thread"},{})} as any
const selection={instanceId:"fixture",model:"openai/forge-fixture",options:[{id:"variant",value:"default"}]} as any
const providerSessionId="provider_session_fixture" as any
const program=Effect.gen(function*(){
  console.log(JSON.stringify({kind:"phase",phase:"client"}))
  const api=yield* Client.make
  const server=Server.OpenCode2Server.of({withConnection:(use:any)=>{connections++;return use({...apiClient,url:boot.url,version:"2.4.1-forge-guarded.0",external:true})},forget:Effect.void})
  const apiClient=yield* api.connect({baseUrl:boot.url,password:boot.password})
  const adapter=yield* Adapter.make("fixture" as any).pipe(Effect.provideService(Server.OpenCode2Server,server))
  console.log(JSON.stringify({kind:"phase",phase:"adapter"}))
  const input={threadId:"thread",title:"Guarded fixture",providerSessionId,modelSelection:selection,runtimePolicy:policy} as any
  const missing=yield* adapter.openSession({...input,runtimePolicy:{...policy,forgeGuard:undefined}}).pipe(Effect.result)
  assert.equal(missing._tag,"Failure");assert.equal(connections,0)
  const runtime=yield* adapter.openSession(input)
  console.log(JSON.stringify({kind:"phase",phase:"opened"}))
  const badEnsure=yield* runtime.ensureThread({...input,runtimePolicy:{...policy,forgeGuard:undefined}}).pipe(Effect.result);assert.equal(badEnsure._tag,"Failure")
  const thread=yield* runtime.ensureThread(input)
  console.log(JSON.stringify({kind:"phase",phase:"ensured"}))
  const badResume=yield* runtime.resumeThread({providerThread:thread,runtimePolicy:{...policy,forgeGuard:undefined}}).pipe(Effect.result);assert.equal(badResume._tag,"Failure")
  yield* runtime.resumeThread({providerThread:thread,threadId:"thread" as any,runtimePolicy:policy,modelSelection:selection})
  console.log(JSON.stringify({kind:"phase",phase:"resumed"}))
  const badFork=yield* runtime.forkThread({sourceProviderThread:thread,targetThreadId:"thread" as any,runtimePolicy:{...policy,forgeGuard:undefined}}).pipe(Effect.result);assert.equal(badFork._tag,"Failure")
  const native=(thread.nativeThreadRef as any)?.nativeId
  console.log(JSON.stringify({kind:"native-session",thread,native}))
  // Parent has authoritative mapping before any prompt/model request.
  yield* Effect.promise(()=>new Promise<void>((resolve)=>process.stdin.once("data",()=>resolve())))
  const terminal=yield* Deferred.make<any>()
  yield* runtime.events.pipe(Stream.runForEach(e=>e.type==="turn.terminal"?Deferred.succeed(terminal,e):Effect.void),Effect.forkScoped)
  const turn={appThread:{id:"thread",title:"Guarded fixture",runtimeMode:"approval-required",interactionMode:"default"},threadId:"thread",runId:"run",runOrdinal:1,providerTurnOrdinal:1,attemptId:"attempt",rootNodeId:"node",providerThread:thread,message:{messageId:"message",text:"Run deterministic engineering protocol fixture.",attachments:[],createdBy:"user",creationSource:"web",scheduledTaskId:null,senderThreadId:null},modelSelection:selection,runtimePolicy:policy} as any
  current=false;const badStart=yield* runtime.startTurn(turn).pipe(Effect.result);assert.equal(badStart._tag,"Failure");current=true
  yield* runtime.startTurn(turn)
  console.log(JSON.stringify({kind:"phase",phase:"started"}))
  const outcome=yield* Deferred.await(terminal).pipe(Effect.timeout("40 seconds"))
  assert.equal(outcome.status,"completed")
  const fork=yield* runtime.forkThread({sourceProviderThread:thread,targetThreadId:"thread" as any,runtimePolicy:policy,modelSelection:selection})
  assert.ok(fork.nativeThreadRef)
  console.log(JSON.stringify({kind:"t3-done",phases:observeInstalledT3Host(host,handle).phases,connections,outcome,proof:null}))
}).pipe(Effect.scoped,
 Effect.provide(Layer.mergeAll(Host.layer({cwd:boot.cwd}),IdAllocator.layer,Sessions.layer)),
 Effect.provide(NodeServices.layer),Effect.provide(NodeHttpClient.layerNodeHttp),Effect.provide(NodeCrypto.layerDigest))
await Effect.runPromise(program)
