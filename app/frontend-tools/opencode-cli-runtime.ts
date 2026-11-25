// NEW private supervised runtime source. Added only by frontend patch script.
import { Effect } from "effect"
import { Tool } from "@opencode/schema/tool"
import { Client } from "FORGE_MCP_SDK_CLIENT"
import { StreamableHTTPClientTransport } from "FORGE_MCP_SDK_TRANSPORT"
import { makeOpenCodeFrontendTool } from "./forge-frontend/native-tool.mjs"
import { frontendBinding, frontendProfile, fence } from "./forge-bootstrap.js"

export function frontendTool(info: any, discovered: any) {
  if (!frontendProfile() || discovered.server !== "forge_frontend" || discovered.name !== "selection_read") return undefined
  const execute = (input: any, context: any) => Effect.gen(function* () {
    yield* Effect.tryPromise({ try: () => fence("frontend-dispatch", context.sessionID), catch: () => new Tool.Error({ message: "FRONTEND_NATIVE_BINDING" }) })
    const descriptor: any = yield* Effect.tryPromise({ try: () => frontendBinding(context), catch: () => new Tool.Error({ message: "FRONTEND_NATIVE_BINDING" }) })
    if (descriptor.binding?.identityKind !== "private-adapter" || descriptor.binding.nativeSessionId !== context.sessionID || descriptor.binding.nativeTurnId !== descriptor.binding.nativeTurnRef?.nativeId) return yield* new Tool.Error({ message: "FRONTEND_NATIVE_BINDING" })
    const client = new Client({ name: "forge-native-supervised-frontend", version: "1" })
    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({ try: async () => {
        const url = new URL(descriptor.endpoint)
        if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/mcp/frontend-tools") throw Error("FRONTEND_ENDPOINT")
        await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: descriptor.authorization } } }))
        return client
      }, catch: () => new Tool.Error({ message: "FRONTEND_OUTCOME_UNKNOWN" }) }),
      active => makeOpenCodeFrontendTool({ Effect, ToolError: Tool.Error, client: active, binding: descriptor.binding, assertCurrent: (binding: any, ctx: any) => frontendProfile() && Date.now() < descriptor.expiresAt && ctx.sessionID === binding.nativeSessionId }).execute(input, context).pipe(
        Effect.tap(() => Effect.tryPromise({ try: () => fence("frontend-return", context.sessionID), catch: () => new Tool.Error({ message: "FRONTEND_OUTCOME_UNKNOWN" }) })),
      ),
      () => Effect.promise(() => client.close().catch(() => {})),
    )
  })
  return { ...info, execute, output: {}, options: { ...info.options, codemode: false } }
}
