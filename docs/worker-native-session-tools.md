# Native session tools handoff

Base `9cf675b`, branch `t3/native-orchestrator-session-tools`. Assigned source only;
no nested agents, push, account/provider turn, global install or prototype.
Protected portable/legacy inputs and the retained timeout30s/guarded-build/VD6puQ
generations were read only. NEW build: `%TEMP%/forge-frontend-generation-Vmhthl`.

## Exact host contract

`supervised-orchestrator-v1` is a separate private native purpose. It REQUIRES
`profile.attemptId` and exact scope
`{paths:['.'],capabilities:['session_children','session_prompt'],maxBytes:65536}`
(maxBytes may be smaller). It grants no file capability. The schema uses the
existing profile version, route pins, context/manifest digests and expiry.

MCP server namespace `forge_sessions`, literal MCP tools `session_children` and
`session_prompt`; raw native names `forge_sessions_session_children` and
`forge_sessions_session_prompt`. The default Guarded3 and frontend1 manifests
remain separate. Root's EXISTING singleton host must select the exact two names
only for that handle's current session purpose; no replacement/global last-run
slot. The factory rejects cross-purpose names and a session fallback to undefined.

`app/session-tools/contract.mjs` exports `SESSION_TOOLS`, `toolManifest()`,
`PURPOSE`, `NATIVE_NAMES` and the private metadata key. Schemas match the role
worker: children `{}`; prompt `{membershipId,operationId,text}`, all required,
IDs 1..200, text 1..48000, no additional properties. Parent, role, project,
session and thread authority are never taken from model arguments.

`createGuardedRuntimeHost` accepts NEW `createSessionGateway` beside the existing
frontend factory. Root supplies:

```js
createSessionGateway({profile,assertCurrent,withFence,authorizePhase}) {
  // Runtime-host callbacks are mandatory, already bound to this exact lease.
  // Root supplies current canonical binding and role-service capabilities.
  return openSessionNativeGateway({
    assertCurrent,withFence,authorizePhase,
    bindingProvider(native,profile) { /* synchronous canonical mapping */ },
    attachmentProvider(binding,native,profile) { /* synchronous private grant */ },
    onClose() { /* revoke the exact role grant */ },
  });
}
```

`bindingProvider` receives actual native Tool.Context fields
`{sessionId,callId,messageId}`. Return exactly:

```js
{
  projectId,runId,attemptId,threadId,providerThreadId,providerTurnId,
  nativeSessionId,nativeTurnId,identityKind:'private-adapter',
}
```

Resolve the actual CURRENT committed private T3 providerThread/providerTurn,
their actual native refs, runAttemptId/root node, selected route and run profile.
Do not invent ordinary providerRunId or t3ProjectId. Binding is pinned for this
gateway; changed parent/attempt/session/turn is denied.

`attachmentProvider` returns the role worker's host-only `issueForRun(run,binding)`
descriptor `{configuration:{type:'http',url,headers:{Authorization}},expiresAt}`.
Memoize ONE descriptor privately for the exact active parent attempt. Bound its
reported expiry to `min(roleGrant.expiresAt,profile.expiresAt)`. The role lease
must independently recheck canonical Stop, role, qualification and membership.
This callback executes inside the existing writer via `withFence`; it must be
synchronous and must not open another transaction. No descriptor, bearer, key,
native runtime handle or private qualifier belongs in SQLite/domain/UI responses.

The role worker qualifier contract is:

```js
{purpose:'supervised-orchestrator-v1',manifestDigest,profileDigest,
 attestationDigest,binding}
```

These digests must come from the actual private runtime lease/attestation and
current canonical native mapping, never a model JSON proof or cached test report.
Full production qualification and mounting remain lead-owned.

The bootstrap gateway owns only a private loopback listener, exact catalog,
HMAC-authenticated `/fence` and `/session-binding`. It returns the role descriptor
only to the inherited-pipe authenticated native process. `tools/call` against
this catalog endpoint is denied. The actual compiled SDK tool privately calls
the role endpoint with `_meta['forge/session-native-v1'] =
{sessionId,turnId,callId,messageId}` from native context. It checks current
authority before/after awaiting, honours native cancellation, preserves
isError/error refusals as Tool.Error, verifies matching bounded text/structured
results, fences return, and closes the SDK client in the native scope.

## Build and pins

`runSessionPipeline` in `tools/session-tools/pipeline.mjs` plugs into the EXISTING
host JobObject setup command owner after pinned acquire/base patch/dependency
stages. It uses the existing clone/frontend patch/link steps read only, adds the
session patch in the NEW tree, and builds the CLI and matching T3 graph. No setup
inventory is runtime authority. Full installer source/image pin integration is
lead-owned; this worker did not edit installer manifests or lockfiles.

The build preserves the 30s native fence transport timeout and all base source
fences. Added native modules use matching Effect and Tool.Error identities.

Actual built image pair:

- CLI `2.4.1-forge-sessions.0`:
  `2224d7edb8a06f241c5ec764b506607af110bfec5300e91a03e00421854aef17`.
- All emitted T3 `.mjs` modules plus actual root Node, canonical name-sorted
  aggregate: `1435d81ad72b5838dd6f8b413bfda3576a4878f0845ec40e474758c333ba538e`.

`tools/session-tools/native-evidence.json` records every input archive, upstream
revision, actual Bun/build Node/root Node hash, MCP SDK1.32.2, source pins,
frontend/session patch preimages+postimages/additions, full T3 file inventory,
successful build reports and both sanitized protocol fixtures. Notices for
FORGE/T3/OpenCode/Node/MCP SDK were retained/copied to NEW `session-notices/` and
their hashes recorded. No secret is in this report.

Reproduce against a prepared read-only cache through `runSessionPipeline`, or:

```powershell
node tools/frontend-tools/clone-generation.mjs <prepared-cache>
node tools/frontend-tools/patch-generation.mjs <NEW-generation>
node tools/session-tools/patch-generation.mjs <NEW-generation>
node tools/frontend-tools/link-t3-dependencies.mjs <NEW-generation>
node tools/session-tools/build-generation.mjs <NEW-generation>
node tools/session-tools/cli-fixture.mjs <NEW-generation> <role-worker-or-integrated-root>
node tools/session-tools/cli-fixture.mjs <NEW-generation> <role-worker-or-integrated-root> --stop
node tools/session-tools/record-evidence.mjs <NEW-generation> <positive-evidence> <Stop-evidence>
```

The fixture consumes the role worker service/gateway and its explicitly injected
child-owner engineering fixture. Before integration a read-only module resolver
fallback uses this worker's already pinned dependency tree; it writes no source
or dependency link in the role worker checkout. In the combined root the extra
role-worker argument can be omitted.

## Executed evidence and limits

- Scoped checks: 24 PASS across session-tools, unified host, guarded-runtime host
  and existing frontend SDK/broker tests. No broad suite or UI build claimed.
- Actual NEW CLI and matching compiled T3 adapter: PASS, 13 loopback model
  protocol requests, only the exact two advertised tools, actual native
  Tool.Context/session/weak turn ref, successful role service submission returned
  as a tool-role message to the SAME native model turn, original terminal
  `completed`. Replay observed the same child run, one injected child-owner
  dispatch/effect total.
- Actual native negatives: unknown, alias, default Guarded file tool, frontend
  tool, foreign membership, revoked membership and foreign session binding.
  Undeclared model `parentRunId` is stripped by the pinned native schema decoder;
  the result still names the canonical parent, and cannot redirect authority.
- Separate actual Stop: PASS, one held loopback model request, canonical Stop
  invalidates attachment, T3 interrupt produces terminal `interrupted`, zero
  child effects.
- Temporary positive evidence: `%TEMP%/forge-session-cli-Zfz8gY/evidence.json`;
  Stop: `%TEMP%/forge-session-cli-jGw1iL/evidence.json`.
- Earlier development-only attempts: dependency preflight lacked worker resolver
  (no native turn); first native turn completed but driver stdin held process
  open; next assertion expected schema-stripped extra JSON to fail instead of
  verifying canonical parent. Harness corrected; only final runs above are PASS.
  Native timeout/policy was never extended.

The gateway service's unknown/refused/not-dispatched/failed-child result semantics
were subsequently hardened by the role worker (`f3f7276`); that worker's real SDK
test covers the added failure path. Positive native results above used its
preceding source, with the same successful result shape and exact private binding.

Lead-owned implementation integration still required: canonical approved
task/conversation reservation and final-send hooks, current native qualification,
per-run createSessionGateway+singleton purpose callback, cleanup/revoke at all
lifecycle edges, app route mounting, and full installer source/image/notices pins.
Default Guarded3/frontend1 source and unit fences are retained; running assembled
native regression for those purposes against this NEW image is lead-owned.
These are integration tasks, not missing-credential excuses.

Actual external parent/child provider/account turns, model quality and complete
Owner GUI flow: NOT_RUN. HOME_UAT_NOT_RUN. No production activation, role-based
file permission, live research claim, public service or release push occurred.
