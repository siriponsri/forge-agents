// Added to the MIT T3 derivative. Private process-local host capability.
type Host = {
  resolve: (thread: unknown, modelSelection: unknown) => object
  assert: (profile: object, phase: string, input: unknown) => void
}
let host: Host | undefined
const profiles = new WeakSet<object>()
export function installHost(value: Host) {
  if (host || typeof value?.resolve !== "function" || typeof value?.assert !== "function") throw Error("FORGE_HOST_INVALID")
  host = value
}
export function resolveProfile(thread: unknown, modelSelection: unknown) {
  if (!host) throw Error("FORGE_PRIVATE_PROFILE_REQUIRED")
  const profile = host.resolve(thread, modelSelection)
  if (!profile || typeof profile !== "object") throw Error("FORGE_PRIVATE_PROFILE_REQUIRED")
  profiles.add(profile)
  return profile
}
export function assertProfile(policy: { readonly runtimeMode?: unknown; readonly forgeGuard?: unknown } | undefined, phase: string, input: unknown) {
  const profile = policy?.forgeGuard
  if (!host || policy?.runtimeMode !== "approval-required" || !profile || typeof profile !== "object" || !profiles.has(profile)) throw Error("FORGE_PRIVATE_PROFILE_REQUIRED")
  host.assert(profile, phase, input)
}
