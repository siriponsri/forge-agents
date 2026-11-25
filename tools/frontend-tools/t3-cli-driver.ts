// Staged ONLY in the NEW matching T3 workspace. Actual private adapter owns
// ensure/start/terminal; no model call or second turn loop exists in this driver.
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import assert from "node:assert/strict"
import { Effect, Layer, Stream, Deferred } from "effect"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as NodeCrypto from "@effect/platform-node/NodeCrypto"
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator"
import * as Sessions from "@t3tools/provider-core/server/McpProviderSessions"
import * as Host from "@t3tools/provider-testing/TestProviderHost"
const boot = JSON.parse(readFileSync(3, "utf8"))
const { Adapter, Client, Server, resolveProfile } = await import(pathToFileURL(boot.nativeEntry).href)
const { installT3GuardedHost } = await import(pathToFileURL(boot.hostModule).href)
const handle = Object.freeze({})
let active = true
installT3GuardedHost({ resolveThread: () => handle, assertCurrent: (h: any) => { if (h !== handle || !active) throw Error("FRONTEND_CURRENT_DENIED"); return boot.profile }, runtimeDirectory: () => boot.cwd, resolveConnection: (i: any) => i.serverUrl === boot.url && i.serverPassword === boot.password && i.binaryPath === boot.binary, toolNames: (_h: any, p: any) => p.purpose === 'supervised-frontend-v1' ? ['forge_frontend_selection_read'] : undefined })
const selection = { instanceId: "fixture", model: "openai/forge-fixture", options: [{ id: "variant", value: "default" }] }
const policy = { runtimeMode: "approval-required", interactionMode: "default", cwd: boot.cwd, forgeGuard: resolveProfile({ id: "thread" }, selection) }
await Effect.runPromise(Effect.gen(function* () {
  const client = yield* Client.make
  const server = yield* Server.make({ binaryPath: boot.binary, serverUrl: boot.url, serverPassword: boot.password, directory: boot.cwd, environment: {} }).pipe(Effect.provideService(Client.OpenCode2Client, client))
  const adapter = yield* Adapter.make("fixture").pipe(Effect.provideService(Server.OpenCode2Server, server))
  const runtime = yield* adapter.openSession({ threadId: "thread", providerSessionId: "provider_session", modelSelection: selection, runtimePolicy: policy })
  const thread = yield* runtime.ensureThread({ threadId: "thread", title: "Supervised frontend native fixture", modelSelection: selection, runtimePolicy: policy })
  console.log(JSON.stringify({ kind: "thread", thread }))
  yield* Effect.promise(() => new Promise<void>(resolve => process.stdin.once("data", () => resolve())))
  const terminal = yield* Deferred.make<any>()
  let latestTurn: any
  yield* runtime.events.pipe(Stream.runForEach(event => Effect.sync(() => { if(event.type === 'provider_turn.updated')latestTurn=event.providerTurn; console.log(JSON.stringify({ kind: "native", event })) }).pipe(Effect.andThen(event.type === "turn.terminal" ? Deferred.succeed(terminal, event) : Effect.void))), Effect.forkScoped)
  yield* runtime.startTurn({ appThread: { id: "thread", title: "Frontend fixture", runtimeMode: "approval-required", interactionMode: "default" }, threadId: "thread", runId: "run", runOrdinal: 1, providerTurnOrdinal: 1, attemptId: "attempt", rootNodeId: "node", providerThread: thread, message: { messageId: "message", text: "Run the deterministic supervised frontend protocol fixture.", attachments: [], createdBy: "user", creationSource: "web", scheduledTaskId: null, senderThreadId: null }, modelSelection: selection, runtimePolicy: policy })
  if(boot.guardDefault){
    yield* Effect.promise(() => new Promise<void>(resolve => process.stdin.once('data', () => resolve())))
    if(!latestTurn?.id)throw Error('ACTUAL_NATIVE_TURN_REQUIRED')
    yield* runtime.interruptTurn({providerThread:thread,providerTurnId:latestTurn.id,requestRuntimeRestart:true})
  }
  const result = yield* Deferred.await(terminal).pipe(Effect.timeout("60 seconds"))
  assert.equal(result.status, boot.guardDefault ? "interrupted" : "completed")
  active = false
  console.log(JSON.stringify({ kind: "done", status: result.status, proof: null }))
}).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(Host.layer({ cwd: boot.cwd }), IdAllocator.layer, Sessions.layer)), Effect.provide(NodeServices.layer), Effect.provide(NodeHttpClient.layerNodeHttp), Effect.provide(NodeCrypto.layerDigest)))
