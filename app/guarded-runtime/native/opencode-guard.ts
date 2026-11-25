// Added to the MIT OpenCode derivative. Not a plugin or config authority.
import { Effect } from "effect"
import { Tool } from "@opencode/schema/tool"

type Host = {
  assert: (input: { phase: string; rawName: string; resolvedName: string; tool: unknown; context: unknown }) => void
}
let host: Host | undefined
// Private native bootstrap only. The derivative refuses model turns/context
// until a complete, qualified host bridge exists. Never export through MCP.
export function installHost(value: Host) {
  if (host || !value || typeof value.assert !== "function") throw Error("FORGE_HOST_INVALID")
  host = value
}
export const assertTool = (phase: string, rawName: string, resolvedName: string, tool: unknown, context: unknown) =>
  Effect.try({
    try: () => {
      if (!host) throw Error("FORGE_PRIVATE_PROFILE_REQUIRED")
      host.assert({ phase, rawName, resolvedName, tool, context })
    },
    catch: () => new Tool.Error({ message: "FORGE_NATIVE_ACTION_DENIED" }),
  })

// Deliberately no model-visible project/global/URL/config input in this
// intermediate derivative. The final sanitized context bridge is not supplied.
export const denyContext = () => Effect.die(new Error("FORGE_NATIVE_CONTEXT_UNQUALIFIED"))
