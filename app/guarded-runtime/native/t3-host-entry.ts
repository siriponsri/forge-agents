// Private in-process bridge, built in the SAME graph as the matching T3 CLI.
// No HTTP/MCP registration, inference loop, policy override or model tools.
// Host bootstrap must install the private FORGE slot before using these APIs.
export * as Adapter from "../../../packages/provider-opencode/src/server/v2/adapter.ts"
export * as Client from "../../../packages/provider-opencode/src/server/v2/OpenCode2Client.ts"
export * as Server from "../../../packages/provider-opencode/src/server/v2/OpenCode2Server.ts"
export {resolveProfile} from "../../../packages/provider-core/src/server/forgeGuard.ts"
export * as RuntimePolicy from "./orchestration-v2/RuntimePolicy.ts"
// Root consumes the SAME compiled services; no pnpm/Effect dependency is needed
// in the portable FORGE application to embed this private adapter.
export {Effect,Layer,Stream,Deferred,Scope} from "effect"
export * as NodeServices from "@effect/platform-node/NodeServices"
export * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
export * as NodeCrypto from "@effect/platform-node/NodeCrypto"
export * as ProviderHost from "../../../packages/provider-core/src/server/ProviderHost.ts"
export * as IdAllocator from "../../../packages/provider-core/src/server/IdAllocator.ts"
export * as McpProviderSessions from "../../../packages/provider-core/src/server/McpProviderSessions.ts"
export * as ProviderContinuationRequests from "../../../packages/provider-core/src/server/ProviderContinuationRequests.ts"

import {Effect,Result} from "effect"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Client from "../../../packages/provider-opencode/src/server/v2/OpenCode2Client.ts"
import * as Server from "../../../packages/provider-opencode/src/server/v2/OpenCode2Server.ts"
import {assertProfile} from "../../../packages/provider-core/src/server/forgeGuard.ts"

// Bounded setup job in the actual compiled graph: authenticated /info only,
// foreign connection and absent private profile must refuse before effects.
export async function probeInstallationConnection(input:Parameters<typeof Server.make>[0]){
  return Effect.runPromise(Effect.gen(function*(){
    const client=yield* Client.make
    const server=yield* Server.make(input).pipe(Effect.provideService(Client.OpenCode2Client,client))
    const version=yield* server.withConnection(connection=>Effect.succeed(connection.version))
    const foreign=yield* Server.make({...input,serverPassword:input.serverPassword+"INVALID"}).pipe(Effect.provideService(Client.OpenCode2Client,client),Effect.result)
    if(!Result.isFailure(foreign))throw Error("FORGE_FOREIGN_CONNECTION_ACCEPTED")
    let denied=false
    try{assertProfile({runtimeMode:"approval-required",forgeGuard:{}},"openSession",{})}catch{denied=true}
    if(!denied)throw Error("FORGE_MISSING_PROFILE_ACCEPTED")
    return {version,negativeCount:2,providerTurns:0}
  }).pipe(Effect.scoped,Effect.provide(NodeHttpClient.layerNodeHttp),Effect.provide(NodeServices.layer)))
}
