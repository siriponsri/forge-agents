// Added to the MIT T3 derivative. Private process-local host capability.
type Host = {
  resolve: (thread: unknown, modelSelection: unknown) => object
  assert: (profile: object, phase: string, input: unknown) => void
  directory?: (profile: object) => string
  connection?: (input: unknown) => void
}
export function runtimeDirectoryFor(profile:object){const active=currentHost();if(!active?.directory||!profiles.has(profile))throw Error("FORGE_PRIVATE_PROFILE_REQUIRED");return active.directory(profile)}
export function assertConnection(input:unknown){const active=currentHost();if(!active?.connection)throw Error("FORGE_PRIVATE_NATIVE_CONNECTION_REQUIRED");active.connection(input)}
let host: Host | undefined
const currentHost=()=>host??(globalThis as any)[Symbol.for("FORGE.GuardedRoute.T3Host.v1")] as Host|undefined
const profiles = new WeakSet<object>()
export function installHost(value: Host) {
  if (host || typeof value?.resolve !== "function" || typeof value?.assert !== "function") throw Error("FORGE_HOST_INVALID")
  host = value
}
export function resolveProfile(thread: unknown, modelSelection: unknown) {
  const active=currentHost()
  if (!active) throw Error("FORGE_PRIVATE_PROFILE_REQUIRED")
  const profile = active.resolve(thread, modelSelection)
  if (!profile || typeof profile !== "object") throw Error("FORGE_PRIVATE_PROFILE_REQUIRED")
  profiles.add(profile)
  return profile
}
export function assertProfile(policy: { readonly runtimeMode?: unknown; readonly forgeGuard?: unknown } | undefined, phase: string, input: unknown) {
  const active=currentHost()
  const profile = policy?.forgeGuard
  if (!active || policy?.runtimeMode !== "approval-required" || !profile || typeof profile !== "object" || !profiles.has(profile)) throw Error("FORGE_PRIVATE_PROFILE_REQUIRED")
  active.assert(profile, phase, input)
}
