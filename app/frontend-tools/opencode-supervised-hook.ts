// NEW derivative source. Stage into packages/core/src/forge-frontend-hook.ts in
// a SEPARATE supervised build, beside forge-frontend/{native-tool,contract}.mjs.
// Never include it in prepare-native.mjs's initial Guarded build/tool profile.
import { Effect } from "effect"
import { Tool } from "./tool.js"
import { makeOpenCodeFrontendTool, NATIVE_TOOL_NAME } from "./forge-frontend/native-tool.mjs"

// Called inside the existing native Location/Scope for the exact attached turn.
// client and assertCurrent come only from private authenticated host bootstrap;
// this API is not exposed as an MCP tool, RPC method or model-controlled config.
export const registerSupervisedFrontend = Effect.fn("FORGE.registerSupervisedFrontend")(function* (input: {
  readonly client: { callTool: (...args: any[]) => Promise<any> }
  readonly binding: Readonly<Record<string, unknown>>
  readonly assertCurrent: (binding: unknown, context: unknown) => boolean
}) {
  const registry = yield* Tool.Service
  const previous = yield* registry.list()
  if (previous.some(tool => tool.id === NATIVE_TOOL_NAME)) return yield* Effect.die(new Error("FRONTEND_TOOL_ALREADY_REGISTERED"))
  const info = makeOpenCodeFrontendTool({ Effect, ToolError: Tool.Error, ...input })
  yield* registry.transform(editor => { editor.add(info) })
  yield* Effect.addFinalizer(() => registry.transform(editor => {
    // Never remove a later registration installed by a different owner.
    if (editor.get(NATIVE_TOOL_NAME)?.execute === info.execute) editor.remove(NATIVE_TOOL_NAME)
  }))
  return { toolName: NATIVE_TOOL_NAME }
})
