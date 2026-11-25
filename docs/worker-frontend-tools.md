# A22 bounded frontend tool result return — worker handoff

2026-11-25. Branch `t3/frontend-tool-result-path`, baseline `74480a8`.
Inherited T3/Codex runtime: **gpt-6.1-sol, xhigh**. No model switch, nested
delegate, push, credential migration, compute purchase or public service.
Only new `app/frontend-tools/**`, `tools/frontend-tools/**`,
`tests/frontend-tools*.test.mjs` and this note are owned by this worker.

## Delivered path and evidence

This implements an actual bounded result channel, independent of the installed
T3 `runtime-request.respond` limitation. The matching native executor awaits its
original MCP SDK `tools/call`; an authenticated Owner result resolves that call;
OpenCode's existing executor and T3 adapter finish the original tool and turn.
There is no `t3_thread_send` imitation, second inference loop, second domain store
or synthesized provider run identity.

The initial capability is **one read-only mounted document selection**, at one
explicit saved document revision, up to 8192 UTF-16 code units. It returns
`source: owner-frontend-selection`, never evidence of a saved edit or a command
receipt. No arbitrary script, frontend mutation, URL, file path or tool name is
accepted. Sheets/edit tools would require separately reviewed contracts.

Developer checks:

| Check | Actual outcome |
| --- | --- |
| `node --test tests/frontend-tools.test.mjs` | **15 passed**, including real SDK/HTTP, SQLite reopen and real expiry timer |
| `node tools/frontend-tools/run-native.mjs <read-only-cache>` | Native registry/raw/resolved/hooks/central executor module **PASS** |
| New OpenCode CLI build + matching T3 bundle | Both **exit 0**, no unresolved-import warnings in final build |
| `node tools/frontend-tools/cli-fixture.mjs <new-generation>` | **Full compiled CLI + actual T3 private adapter PASS**, nine deterministic loopback model requests |
| `node tools/frontend-tools/run-guarded-regression.mjs <new-generation>` | Same new CLI's default Guarded route **PASS**, 15 requests, exactly original three tools, 17 native negatives, zero untrusted executor effects |
| `node tools/frontend-tools/cli-fixture.mjs <new-generation> --guarded-stop` | Same compiled CLI/T3 bundle, default Guarded profile, real Stop during held model request: **interrupted**, exactly three tools, zero frontend grants |

The full CLI fixture observes actual T3 `provider_thread.updated` and
`provider_turn.updated` identities, commits their mapping to canonical SQLite,
then enables the private native binding. It checks that the model remains held
before the Owner answer, receives the exact matching `role: tool` /
`tool_call_id` result, and that T3 observes the actual output and completed
terminal. Seven attempted shell/future/Code Mode/task/alias/alternate namespace/
Guarded-file tools produce **FORGE_NATIVE_ACTION_DENIED**. Poisoned AGENTS/config
do not enter model context. Credentials remain absent from model/domain output.

Sanitized committed evidence: [CLI](../tools/frontend-tools/cli-evidence.json),
[module](../tools/frontend-tools/native-evidence.json),
[default Guarded regression](../tools/frontend-tools/guarded-regression-evidence.json),
[actual default Stop](../tools/frontend-tools/guarded-stop-evidence.json),
[complete source/artifact pins](../tools/frontend-tools/source-provenance.json).
These are engineering observations with **proof:null**, never install/activation
capabilities. The loopback model is a deterministic protocol fixture, not an
external account or model-quality test. **HOME_UAT_NOT_RUN**.

`npm.cmd test` was also attempted on the inherited checkout. It did **not** pass:
the existing built Chat graph browser check and the Compute no-code browser check
reported long timeouts. The suite was interrupted after it stopped making
progress. Those unmodified browser paths are outside this worker's ownership;
no full-suite pass or baseline cause is claimed. Focused A22 checks above passed.

## Host and HTTP API

`createFrontendToolBroker({store, authorizeOwner, authorizeNativeBinding, clock?})`
in `app/frontend-tools/broker.mjs` requires the existing canonical store and
synchronous private authority callbacks. Use
`authorizeOwner: authority.goalAuthorize`. `authorizeNativeBinding(binding,state)`
must validate the **currently observed** native owner/attempt/root node/selected
provider/policy/credential generation and explicitly selected supervised frontend
capability. A client JSON flag or saved evidence file cannot establish authority.

| API | Contract |
| --- | --- |
| `await broker.recover()` | Before accepting native bindings at startup; persisted pending/accepted/released calls become unknown. Never redelivers. |
| `broker.bindNativeTurn(binding)` | Host-only activation; returns transient `{handle,authorization,expiresAt}`. Never persist/expose this return in Owner/domain/config/protocol responses. One attachment per exact attempt. |
| `broker.state({projectId,runId,attemptId},owner)` | Durable bounded pending-call projection; contains no bearer. Display/reconcile only. |
| `await broker.returnResult({...scope,pendingId,operationId,result},owner)` | Authenticates before result inspection; strict typed result; canonical transaction reserves one Owner receipt, then resolves only that live SDK call. |
| `await broker.revokeRun(scope,reason?)` | Deletes live authority **synchronously before awaiting** canonical invalidation. Call before existing real T3 Stop/Take over. Does not itself assert remote cancellation. |
| `await broker.sweep()` | Recheck current canonical authority/expiry after relevant native/domain changes; no scheduler, provider call or effect retry. |
| `broker.invalidateForRestore()` | Synchronously clears live grants before restore quiescence; await its invalidation. |
| `mergeFrontendToolSafety(restored,previous)` | Inside existing metadata restore transaction; retains consumed call/Owner receipt identities, never restores a live continuation. Lead must add to the existing restore safety merge. |
| `await broker.close()` | Invalidates live pending/delivery state as unknown. |

Two explicit binding variants are supported:

```js
// Ordinary native orchestration, only when the actual observed run has this ID:
{ projectId, runId, attemptId, threadId, providerRunId,
  nativeSessionId, nativeTurnId, documentId, documentRevision, ttlMs? }

// Matching private adapter: it has NO orchestration providerRunId:
{ projectId, runId, attemptId, identityKind: 'private-adapter', threadId,
  rootNodeId, providerThreadId, providerTurnId,
  nativeThreadRef: {driver:'opencode',nativeId, strength:'strong'|'weak'},
  nativeTurnRef:   {driver:'opencode',nativeId, strength:'strong'|'weak'},
  nativeSessionId, nativeTurnId, documentId, documentRevision, ttlMs? }
```

Private binding checks canonical `run.rootNodeId`, `nativeProviderThreadId`,
`nativeProviderTurnId`, `nativeThreadRef`, `nativeTurnRef`. Native reference
strength is preserved. `nativeSessionId/nativeTurnId` must equal the actual native
reference IDs. Extra `providerRunId` on the private variant is rejected. Never
derive a tool call ID from these turn refs: the tool ID is **Tool.Context.id**.
Maximum TTL is 120 seconds, at most four outstanding calls per turn and 32 total.

Mount `createFrontendToolsHttpHandler({broker,
endpoint: app.url+'/mcp/frontend-tools',authenticateOwner})` on the **existing
same-origin application server, before its generic body reader**. Existing
`humanSession(req,res)`/CSRF checking must run in `authenticateOwner` and produce
`authority.owner(session)`; do not trust `actor`, `role`, query/body flags or a
native bearer as Owner authority. Routes:

- `GET /api/frontend-tools/pending?projectId=…&runId=…&attemptId=…`
- `POST /api/frontend-tools/result` with `{projectId,runId,attemptId,pendingId,operationId,result}`
- `POST /mcp/frontend-tools` for private native SDK calls only.

Successful typed result:

```js
{status:'ok',documentId,revision,
 selection:{start:0,end:5,text:'hello'}}
```

`end-start` must equal JS string length. The frontend must refuse an unmounted,
dirty, changed-revision or unavailable editor rather than claiming a saved view.
Error result: `{status:'error',documentId,revision,error:{code}}`, with code one of
`EDITOR_UNAVAILABLE`, `REVISION_CONFLICT`, `NO_SELECTION`, `DECLINED`.
No broad confirmation prompt is introduced; established Owner execution policy
controls when the bounded selection may be read. Reload shows pending/history;
it must not execute historical tool events again.

The SDK transport supports authenticated stateless cancellation notifications,
scoped by the same bearer and original JSON-RPC request ID. That request ID stays
a transport identity; it is never promoted to the native tool ID. Duplicate
native call identities are refused; exact Owner `operationId` replay returns the
same durable receipt without resolving another continuation. Accepted/released
means **provider delivery unconfirmed**; only the actual native observation may
produce `TOOL_CALL_RESULT`. Crash, Stop, disconnect, expiry and changed binding
remain unknown with the receipt retained.

## Private native bootstrap and exact T3 extension

`openFrontendNativeGateway({broker,assertCurrent,bindingProvider,authorizePhase,
authenticateOwner})` creates a private loopback transport only. It owns no run or
turn. `gateway.bootstrap()` returns `{key,brokerUrl}` **only to private child FD 3**.
`assertCurrent()` returns the exact current profile with
`purpose:'supervised-frontend-v1'` after canonical policy/selection/artifact/Stop
checks. `authorizePhase(body,profile)` must enforce real phase/session identity;
`bindingProvider({sessionId,callId,messageId},profile)` returns the actual private
binding only after T3 observed it. Credentials and HMAC are validated before body
read or mutation. Unobserved/foreign session/turn/root node cannot mint a grant.

The gateway serves catalog-only `/mcp`, authenticated `/fence`, and HMAC-scoped
`/frontend-binding`. The latter supplies the short-lived real SDK endpoint and
bearer to the native executor. It cannot submit model turns. For production,
mount the Owner HTTP handler on the application's origin as above; the private
gateway can use `authenticateOwner:()=>null`. Do not have browser JS cross ports
to the private gateway.

NEW source/build patches in `tools/frontend-tools/patch-generation.mjs` target:

1. OpenCode `packages/core/src/forge-bootstrap.ts`: explicit supervised profile
   chooses only `forge_frontend_selection_read`; default Guarded config remains
   read/propose/edit. Private FD bootstrap still binds binary/provider/manifest/
   context hashes and expires. No ambient config/plugin/instruction expansion.
2. OpenCode `forge-guard.ts` / `tool/mcp.ts` existing trusted executor seam:
   actual discovered schema/name/namespace are checked; only a privately created
   executor function identity passes native raw/resolved/central gates.
   NEW `opencode-cli-runtime.ts` obtains binding privately and calls pinned
   MCP SDK **1.32.2**, awaiting the same native effect. It preserves cancellation.
3. T3 `provider-core/src/server/forgeGuard.ts`: NEW
   `sessionToolNames(policy)` checks the **opaque resolved profile handle**, then
   calls private `host.toolNames(handle)`. Only the exact supervised tool list is
   accepted. Absent this private method (or its returning `undefined` for a
   canonical Guarded profile), the default Guarded three-tool list remains.
4. T3 `provider-opencode/src/server/v2/adapter.ts`: carry `forgeGuard` through
   `RulesPolicy` and call `sessionToolNames(policy)` at `sessionRules`. Existing
   lifecycle gates and sole provider-turn owner remain in place.

The final full-CLI fixtures use **one existing shared private host**, with
`extendT3HostSource` from `app/frontend-tools/root-host-tools.mjs` applied to a
NEW temporary copy of `app/guarded-runtime/t3-host.mjs`. That exact patch adds
optional handle-scoped `toolNames(handle,currentProfile)` to the existing factory,
preserving its private installed-host marker, connection and lifecycle checks.
Use `purposeSeparatedToolNames` as this callback. It returns the fixed frontend
list only for an actual canonical `supervised-frontend-v1` profile; `undefined`
keeps default Guarded's three tools for all other handles. The patch validates
that a caller cannot return frontend tools for a Guarded profile. This is the
same-process production integration seam: **do not replace the global host**.
Both final positive and real default Stop fixtures used the same factory patch
and the same unified CLI/T3 image, in separate clean engineering processes.

`app/frontend-tools/t3-host.mjs` additionally supplies an explicit standalone
supervised-only host alternative, useful for a process dedicated to this route.
It cannot coexist with an installed host in that graph. Shared product bootstrap
should use the existing factory extension above. No process-global 'last run'
state or second host is needed. All lifecycle assertions recheck exact current
profile/selection/directory.

`opencode-supervised-hook.ts` is an additional explicit registry seam for an
ordinary supervised graph: stage beside `tool.ts` plus
`forge-frontend/{contract,native-tool}.mjs`, then call its
`registerSupervisedFrontend({client,binding,assertCurrent})` within the existing
matching native Location/Scope. It removes its own registration on scope close.
The actual CLI derivative instead uses the authenticated MCP-discovery/private
bootstrap seam above, which is fully exercised by the CLI fixture.

## Reproduction and remaining lead integration

Pinned upstreams remain T3 `59651c1761f6c63e9b6056839067066968e6a406` and OpenCode
`6f0514052a3c859894ad01bb14cc14dda1e44b96`, MIT. The retained cache
`%TEMP%/forge-guarded-timeout30s-20261125` is **read-only**. Acquisition archive
hashes are checked by the clone script; dependency links retain the pinned
external cache while workspace source links are remapped to the new generation.
No install or global changes occur. Build scripts use Bun 1.4.4 and the retained
Node26 toolchain for T3 build; qualification uses actual root Node24.19.0.

```text
node tools/frontend-tools/clone-generation.mjs <read-only-cache>
node tools/frontend-tools/patch-generation.mjs <printed-new-generation>
node tools/frontend-tools/link-t3-dependencies.mjs <new-generation>
node tools/frontend-tools/build-generation.mjs <new-generation>
node tools/frontend-tools/cli-fixture.mjs <new-generation>
node tools/frontend-tools/cli-fixture.mjs <new-generation> --guarded-stop
node tools/frontend-tools/run-guarded-regression.mjs <new-generation>
```

Actual generation: `%TEMP%/forge-frontend-generation-VD6puQ`.
Patch/build logs and default regression are retained there. Committed JSON has
sanitized hashes/results, no bearer. Full artifact/source matching must be
rechecked when packaging; copied fixture evidence grants no runtime authority.

The **unified** CLI binary SHA256 is
`edde02f4107862e229cbe5436fde8b3a28d94195dd6fba85e9f716acaf6cf934`.
Matching T3 aggregate uses the existing runtime-host convention: every sorted
emitted `.mjs` plus **the actual root `node.exe`**, each as `{name,sha256}`.
It is `715c5c8657db3f2910b031e740f9391f04649914569a8c2a0da155d5f73179a5`.
**It differs from existing `3494a3…`: bundle bytes are changed** by the scoped
tool-profile extension, and the compiled CLI version is
`2.4.1-forge-frontend.0`. Keep these as a matched new generation; never mix the
new CLI with an old T3 entry/qualification. Default file-broker source/binary is
unchanged. The source pin file includes every emitted `.mjs`/Node SHA and each
new worker source/patch SHA. These hashes are observations; the installer must
verify its own build/source generation and use actual installed capabilities.

`tools/frontend-tools/pipeline.mjs` exports the **no-code installer hook**:

```js
await runFrontendPipeline({
  preparedCache, buildDirectory, environment, signal,
  runCommand: spec => runner.run(spec), // existing Windows JobObject setup owner
  onProgress: stage => publishSetupStage(stage)
})
```

Run after the inherited pinned acquire/toolchain/base-patch/dependency stages.
Those existing stages produce the prepared cache on a fresh machine. This hook
clones it into a NEW isolated generation, applies owned frontend patches, remaps
workspace/importer links and builds both matching native components. It returns
`frontendArtifactInventory` with exact paths/hashes and **proof:null**. It does
not run a model fixture, qualify a live turn or require the no-code user to run
commands. The existing setup JobObject owns descendants/Stop; the hook does not
create another setup process owner. Root must add the new source scripts/hashes
to installer trust, recognize the new version and copy/verify this generation
through its existing artifact manifest flow. A native qualification must remain
purpose-bound; changing purpose invalidates old profile/context/manifest proof.

Lead-owned **implementation integration remaining**, independent of credentials:
apply the approved new source patches in the managed native build; extend the
shared private host/current profile selector for the explicit supervised route;
wire actual run/native events into canonical private identities before the
binding provider answers; mount existing Owner HTTP and mounted editor selection
handler; connect Stop/restore/shutdown; expose capability per actually attached
attempt and keep ordinary unsupported routes truthful. `app/protocol` must use
the real observed native output for tool-role projection. No global
`frontendToolResults:true` based on config or these evidence files.

External account/model-quality checks and home UAT remain **NOT_RUN**. The native
result-return mechanism and bounded transport are implemented and developer
verified; whole-product A22 completion awaits the above shared integration.
