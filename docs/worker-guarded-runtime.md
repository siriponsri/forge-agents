# Guarded runtime implementation and private host handoff

2026-11-25. Isolated baseline `86c9c27`, checkpoint `64de47e`. Actual inherited
`gpt-6.1-sol / xhigh`; no switch/nested agent. Only assigned new app/tools/tests
guarded-runtime paths and this note were edited. Existing vendor, controllers,
contracts/lockfiles, global tools and legacy portable payload remain untouched.

**Implemented and exercised with matching compiled native components. Product
activation and shared orchestration/projection integration remain lead-owned.**
Installed qualifier stays null absent its actual current live installation
capability. Config/source/build/fixture JSON cannot recreate that capability.
No real provider/account/model-quality turn, credential migration, paid compute,
public service, prototype, push or deployment occurred. `HOME_UAT_NOT_RUN`.

## Executed results

| Check | Actual result |
| --- | --- |
| `node --test tests/guarded-runtime-broker.test.mjs tests/guarded-runtime-host.test.mjs` | 9/9 PASS, no Windows skips |
| Actual patched Tool/raw/hooks/central executor, TS and compiled module fixture | PASS; module-only evidence never qualifies a runtime |
| Actual native executor -> authenticated pipe -> compiled Windows broker | PASS; read/propose/edit/replay and outside denials |
| `cli-fixture.mjs <cache> t3` | Final compiled CLI + compiled matching T3 entry PASS, 15 deterministic loopback requests |
| `run-supervisor.mjs <cache> --current-node` | Actual root Node24.19.0 PASS, real completed native terminal |
| Same with `--stop-during` | Node24.19.0 PASS, real interrupted native terminal during held local protocol request |
| `probe-package-import.mjs <cache>` | Node24.19.0 standalone import PASS; all 45 .mjs copied outside node_modules/source ancestors |

Broker checks cover actual held-parent/file rename, write and hardlink races;
junction/ADS/traversal/outside/stale revision; HMAC/run/tool/account/route/code/
policy/manifest/context/expiry/governance swaps; Stop during acquisition; completed
receipt replay across restart; actual write with lost acknowledgement -> durable
unknown/no replay; canonical receipt callback lost acknowledgement -> same receipt
redelivered without another edit. Recovery inspection exposes metadata, no text.

CLI fixture proves only three advertised tools, bounded positive operations,
zero outside read/write/shell effects, alias/unknown/future/Code Mode/task/
background/alternate namespace denials. Poisoned AGENTS/config and file inputs
never enter protocol requests. Identity/context/expiry/Stop/revoke/foreign-session
negatives cause zero further requests. Native lifecycle covers open/ensure/
resume/start/send/submit/final-send/fork; absent private profiles refuse.

Live installation checks execute 17 zero-effect native negatives (including
direct nested/background/delegated/Code Mode, alias/rewrite, future permission
alias, alternate MCP attachment), two compiled T3 connection/profile negatives,
seven broker checks and **zero provider turns**. It creates no FORGE task/run.
Positive/Stop supervisor runs create engineering canonical fixtures only and
make one deterministic loopback protocol request each, never a real provider call.

Final checked artifacts, with actual root Node24.19.0 in the T3 fingerprint:

| Component | SHA256 |
| --- | --- |
| OpenCode executable | `309f61f0fc52f849256a9e4e26af55365da32d9ff4773f273bd6a186ae296def` |
| T3 graph + actual Node aggregate | `3494a3e4bce00e971a999fe51f5334d471e8d7a220db43e90f50f535314b0bf9` |
| Checked Windows broker | `0c8a796db59f0829ac4b28b97be774523210f5ff99b7e6139e3fc442e8d2e08d` |

`app/guarded-runtime/qualification-evidence.json` is sanitized engineering
evidence, explicitly proof:null; it grants no product execution authority.

## Enforced boundaries

Windows `ConfinedText.cs`: drive-root-to-leaf relative NtCreateFile with held
parents, FILE_OPEN_REPARSE_POINT, same-handle metadata/read/write, parent handles
without write/delete sharing and exclusive final file. Rejects reparse points,
multiple hardlinks, nonlocal/nonfixed/non-NTFS roots, ADS/device/traversal and
non-UTF8/NUL/oversized content. No lstat followed by a pathname reopen.
Only existing UTF8 files <=64KiB; revision-checked whole-text replacement.
No create/list/shell/scripts/URL/config/delegation/approval/Memory tools.
Interrupted writes can be partial and remain unknown; atomic replace is not claimed.

Native gates cover raw dispatch before hooks, aliases/post-rewrite, nested
dispatch, discovery and central executor. Unknown/future executors default-deny.
Only private authenticated fixed-MCP schema/provenance registrations survive;
their executor invokes the bounded broker rather than generic MCP callTool.
Attached MCP clients/external imports/Code Mode are disabled. Native Config has
no project/global/URL/env/file substitution/discovery. AGENTS/instruction/skill/
command expansion is disabled before reads; file/skill/agent prompt input refuses
before expansion. Cached session metadata binds the exact profile. Only primary
requests on the exact provider/model/variant are allowed. Static bootstrap config
is private transport configuration, not project instructions or model authority.
Initial transport is the built-in OpenAI-compatible chat package; other transport
families are unqualified. Runtime/home/code/receipt paths stay outside workspace.

Every native phase rechecks canonical state/current code/authorizeCurrent.
Every bounded action additionally requires actual run attestation and canonical
authorizeAction under root's SAME Stop/policy fence through file operation and
durable receipt. Ordinary governance and approval-required remain root authority.
No helper creates a canonical run, sends a model turn or starts an inference loop.

## Exact private APIs

Install `installT3GuardedHost` from t3-host.mjs in the SAME canonical process
before importing matching T3. Private nonreplaceable process slot, no HTTP/MCP
install method. Synchronous callbacks: resolveThread(thread,selection) -> exact
opaque lease; assertCurrent(lease) -> runtimeHost.assertCurrent; runtimeDirectory;
resolveConnection(input) -> exact private URL/password/binary/directory match.
Never replace synchronous canonical callbacks/fence with guessed IPC semantics.

`createGuardedInstallationHost({t3Host,observeSelectedRoute,artifacts,stateDirectory})`:

- `await check({leaseMs})`: opaque machine setup handle; purpose installation-check,
  null project/task/thread, machine job ID, quarantined text, unreachable no-account
  provider endpoint and model authority disabled. Actual compiled T3 connection,
  live native gates and Windows broker execute checks. It retains a live child.
- `readiness(handle)`: metadata only while child/route/policy/tool/code/expiry current.
- `qualifyRoute(handle,request)`: initial synchronous route proof BEFORE any run.
  Request has projectId/taskId/envelopeDigest/identitySnapshot,
  scope `{paths,capabilities}`, limits `{maxRunMs,maxTokens,maxCost}`. No execution
  authority. Evidence ID stays stable for SAME selected route/generations/manifest
  when setup lease renews; only expiry renews. Stored reports cannot restore handles.
- `close(handle)`: immediate invalidation, then cleanup.

`createGuardedRuntimeHost({t3Host,readRun,validateReservation,authorizeCurrent,
authorizeAction,recordReceipt,withFence,artifacts})`:

- `reserve(input)` synchronous/memory-only inside canonical reservation Tx.
  Input: profile, operationId, workspace, runtimeDirectory, homeDirectory,
  receiptPath, private provider, toolManifest, limits. validateReservation must
  check canonical reservation/governance/initial route evidence. No shadow run.
  Non-null cost/token limits fail closed. Wall time 1s..1h is enforced. Only exact
  typed variant (or empty options) is supported; unsupported options refuse.
- `await bind(lease)` AFTER commit. readRun(runId) returns REAL
  `{projectId,taskId,operationId,status,profile,stopRequested,revoked}`. Only actual
  submitting/running accepted. Orphan/rolled-back lease refuses before effects.
  Starts private native child/gateway/broker, no model request. Returns PRIVATE
  `{url,password,binaryPath,runtimeDirectory,profileHandle}`.
- `assertCurrent(lease)` repeats code/current canonical profile and synchronous
  authorizeCurrent({profile,run,workspace,runtimeDirectory}) === true: ordinary governance, actual selected
  route/account/policy/SAME initial route evidence and canonical workspace against
  the supplied actual bound workspace. authorizeAction receives that workspace too.
  Do not demand exact final run
  attestation in this bootstrap check; authorizeAction separately demands it.
  `runtimeDirectory(lease)` supplies exact sterile native cwd.
- `await attest(lease,{nativeSessionId,threadId,modelSelection})` AFTER actual T3
  ensureThread/session, BEFORE startTurn. Verifies actual session permission rules,
  model/variant/location/profile stamp, then nonce/PID/binary/profile/context/
  manifest/tool/policy and actual 17-negative native probe. No provider call.
- `qualify(lease,request)` separately binds exact canonical run, actual native T3
  open/ensure observations, live attested session and SAME scope/limits. Its run
  attestation goes into guardedReceipt, never replaces initial route evidenceId
  in proactiveContext/guardedContext. Persist no opaque lease.
- `close(lease,reason)` invalidates synchronously then cleans up. No status mutation,
  replacement run, provider send or automatic retry.

Private phases reserved -> binding -> bound -> attesting -> attested -> closed.
Canonical status stays real submitting until actual launch/events justify its
next state. Pending dispatch after restart is unknown, never replayed. New runs
need fresh native sessions/leases/attestation; stale/cross-run context refuses.

Profile fields/schema: profile.mjs. Route binds instance/native API provider/
implementation/account generation/full model/typed options/both revisions/binaries.
Scope, identity/envelope, exact run/thread, policy/tool/manifest/context and expiry
bind profile. Context digest = digest({provider,runtimeDirectory,toolManifest});
private provider contains fixed id/model/compatibility/settings, never model args.
Root binds package/broker changes into selected tool generation. No secrets in DB.

## Concrete glue and actual event ownership

Executable example: tools/guarded-runtime/supervisor-fixture.ts. Its canonical
records/TestProviderHost and true admission callbacks are ENGINEERING FIXTURES;
production root supplies real canonical store/services/ordinary policies.

```js
const t3Host = installT3GuardedHost({
  resolveThread:root.lookupPreparedLease,
  assertCurrent:lease=>runtimeHost.assertCurrent(lease),
  runtimeDirectory:lease=>runtimeHost.runtimeDirectory(lease),
  resolveConnection:root.matchesPrivatePreparedConnection,
});
const native = await import(pathToFileURL(artifacts.t3.entry).href);
const {Effect,Layer,Stream} = native;
// Initial setup/qualifyRoute happens BEFORE canonical run allocation.
const check = await installation.check();
const routeProof = installation.qualifyRoute(check,qualificationRequest);
// Root allocates canonical runId ONCE; reserve lease in SAME reservation Tx.
const lease = root.reservationTx(run=>runtimeHost.reserve(preparedInput(run)));
const connection = await runtimeHost.bind(lease); // AFTER commit
const policy = {runtimeMode:'approval-required',interactionMode:'default',
  cwd:connection.runtimeDirectory,
  forgeGuard:native.resolveProfile(canonicalThread,modelSelection)};
```

Private entry exports SAME compiled Effect/Layer/Stream/Scope/Deferred, Node
services, ProviderHost, IdAllocator, McpProviderSessions, ProviderContinuationRequests.
Root needs no Effect/pnpm install. Provide its real ProviderHost/settings/policy
services and keep a long-lived Effect scope for the native runtime:

```js
const api = yield* native.Client.make;
const server = yield* native.Server.make({binaryPath:connection.binaryPath,
  serverUrl:connection.url,serverPassword:connection.password,
  directory:connection.runtimeDirectory,environment:{}})
  .pipe(Effect.provideService(native.Client.OpenCode2Client,api));
const adapter = yield* native.Adapter.make(instanceId)
  .pipe(Effect.provideService(native.Server.OpenCode2Server,server));
const session = yield* adapter.openSession({threadId,providerSessionId,
  modelSelection,runtimePolicy:policy});
yield* session.events.pipe(Stream.runForEach(root.consumeActualProviderEvent),
  Effect.forkScoped); // subscribe BEFORE ensure/start, retain until terminal
const providerThread = yield* session.ensureThread({threadId,title,
  modelSelection,runtimePolicy:policy});
const guardedReceipt = yield* Effect.promise(()=>runtimeHost.attest(lease,{
  nativeSessionId:providerThread.nativeThreadRef.nativeId,threadId,modelSelection}));
yield* session.startTurn({...canonicalTurnInput,providerThread,
  modelSelection,runtimePolicy:policy}); // returns void, NOT completion
```

TurnInput uses canonical appThread/threadId/runId/runOrdinal/providerTurnOrdinal/
attemptId/rootNodeId/message. Never create a second run. Real events include
provider_session.updated/provider_thread.updated/provider_turn.updated/node.updated/
message.updated/turn_item.updated/turn.terminal and other native contract variants.
Match provider turns by exact runAttemptId/nodeId/providerThreadId: ProviderTurn
has NO runId field. Persist actual id/nativeTurnRef/nativeThreadRef/status/ordinal/
usage. Terminal carries providerThreadId/providerTurnId/runOrdinal/status/failure/
threadDisposition. Native ref may be weak `msg_t3_turn_<session>:<attempt>`;
do not relabel strong or invent refs/completion from timestamps/startTurn return.

Stop: root records Stop under SAME withFence (immediate authority denial), then
actual session.interruptTurn({providerThread,providerTurnId,requestRuntimeRestart:true})
using observed active turn ID, consume real terminal and close lease. Missing
terminal/pending send is unknown. Do not turn process close into completed.

**Projection gap:** private entry emits actual T3 v2 adapter events; it does not
register a second MCP controller or automatically publish into installed ordinary
T3 orchestration/AGUI projection. Matching T3 adapter remains provider-turn owner.
Root must deliberately wire guarded canonical dispatch/reconciliation/projection,
preserving existing controllers/claims/ordinary t3_thread_launch routes. That
shared integration/release activation is outside worker paths; until installed
and live qualified there, product/Research execution stays blocked.

## Receipts and Memory

HMAC envelopes bind exact run/operation/request. SQLite WAL/FULL persists unknown
BEFORE file open. Exact completed replay never repeats effects; collision/unknown
refuse after restart. recordReceipt is mandatory, synchronous/idempotent under
root fence. Callback failure after local completion permits same receipt delivery,
not another edit. v1 receipt: owner guarded-file-broker; deterministic id;
project/task/run/operation; request/profile/route/scope/manifest/context digests;
policy/tool generations; capability/path; before/after revisions; outcome/effect.
This is local evidence, NOT a Research canonical owner action/resource proof.
Root correlates exact admission and issues its own receipts when warranted.
Private owner receipt metadata is stripped from model-visible tool results.
inspectGuardedReceipt({receiptPath,runId,operationId}) opens read-only metadata
for recovery, no text/proof/lease/retry grant. Unknown retains null receipt.

Memory forwarding is UNSUPPORTED in initial three-tool profile. Internal pinned
McpProviderSessions is privileged; private external OpenCode connection never
attaches broad T3 namespace. Attached/alternate MCP denied. No arbitrary safe
Memory hook is exported. Separate ordinary supervised transport must not broaden
this manifest.

## Exact artifacts, acquisition and rebuild

Qualified cache: `%TEMP%/forge-guarded-build` (machine-only, never committed).
Minimal EXTRA private runtime payload:

| Cache/source path | Use |
| --- | --- |
| t3/apps/server/dist/*.mjs (ALL 45) | Preserve chunk names; entry forge-guarded-host.mjs |
| opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe | Checked native CLI |
| windows/ConfinedText.exe | Checked Windows broker |
| artifact-manifest.json | File/graph/node/broker/source/compiler/patch hashes, proof null |
| app/guarded-runtime/*.mjs | Host/gateway/broker in normal FORGE source packaging |
| native/T3-LICENSE.txt, native/OPENCODE-LICENSE.txt, FORGE LICENSE | Preserve derivative notices |

Reuse root qualified Node24.19.0; actual exe hash is part of T3 fingerprint. No
Node26/toolchains required at runtime. Preserve Node/third-party notices too.
Maps/source/node_modules/pnpm/Bun are unnecessary for checked private entry.
This minimal payload does NOT replace/package the whole ordinary T3 CLI, which
retains its original external dependencies and global installation.

Descriptor: t3={entry:absoluteEntry,files:[{name,path},...ALL mjs,
{name:'node.exe',path:process.execPath}]}, opencode={path:absoluteExe},
fileBroker={path:absoluteExe,sha256:checkedHash}. T3 profile hash = canonical
SHA256 of sorted {name,sha256} records, including ALL mjs and actual Node. Code
and private state stay outside editable scope. Copy, rehash, run live setup check;
inventory never qualifies a package. No binaries/cache/credentials committed.

Pinned sources: T3 `59651c1761f6c63e9b6056839067066968e6a406` tag0.1.11
(server manifest says0.1.10), effect4.1.3; OpenCode
`6f0514052a3c859894ad01bb14cc14dda1e44b96`, package2.4.1/effect4.1.0,
observed opencode v2.4.1-forge-guarded.0. Build: Windows x64/NTFS, existing
Framework64 csc, isolated Bun1.4.4 + Node26.13.1/pnpm12.14.0. Public download
digests pinned in acquisition scripts. All 31 previous source pins and additional
native/patch-inputs.json preimages validate before writes; reports bind exact bytes.

```powershell
node tools/guarded-runtime/acquire.mjs <absolute-cache>
node tools/guarded-runtime/acquire-t3-toolchain.mjs <absolute-cache>
node tools/guarded-runtime/prepare-native.mjs <cache>/t3 <cache>/opencode <cache>/patch-report.json
# In cache/opencode, use LOCAL cache/bun/bin/bun.exe:
<cache>/bun/bin/bun.exe install --frozen-lockfile --ignore-scripts --filter @opencode/core --filter @opencode/cli
node tools/guarded-runtime/build-t3.mjs <cache> install
node tools/guarded-runtime/build-native.mjs <cache>/opencode <cache>/bun/bin/bun.exe
node tools/guarded-runtime/build-t3.mjs <cache> build
node tools/guarded-runtime/run-supervisor.mjs <cache> --current-node
node tools/guarded-runtime/run-supervisor.mjs <cache> --current-node --stop-during
node tools/guarded-runtime/cli-fixture.mjs <cache> t3
node tools/guarded-runtime/probe-package-import.mjs <cache>
node tools/guarded-runtime/artifact-manifest.mjs <cache>
```

For changed patches, reset-native.py <cache> restores only verified previous
derivative files from pinned archives, then prepare/build again. Never rebuild a
running image. Harnesses reject failed/stale patchDigest reports. Commands/inputs
are pinned/reproducible; legacy csc PE bytes can differ, so acquire the NEW hash
and qualify that actual image. Do not claim bit-identical Windows rebuilds.
Exact source seams: T3 RuntimePolicy/ProviderAdapter/OpenCode2Server/v2 adapter/
private entry; OpenCode Tool/raw/runtime/MCP, Config/plugin modules, Session/
context/prompt/model-request/private authenticated probe route. Only isolated
source trees are patched. Lead owns final checksum acquisition/activation.

## Follow-up: 30-second transport and uncertain acknowledgement

The lead and independent application run reproduced the original5s abort AFTER
actual local completed receipts under build contention. This narrow correction
changes only bootstrap transport/error classification and its bounded Tool error
mapper. Broker authority, canonical expiry/wall/action caps (including root's240s
fixture), Stop, scope, admission and receipt/replay semantics are unchanged.

Private fetch waits at most30000ms for response/body. Abort/network/unreadable
acknowledgement, server failure, malformed success and explicit broker unknown
become `FORGE_BOUNDED_ACTION_OUTCOME_UNKNOWN`. Explicit policy HTTP403 remains
`FORGE_BOUNDED_ACTION_DENIED`. Model errors contain only fixed diagnostics;
private owner receipts remain excluded. There is exactly one fetch per invocation,
no retry/backoff/replacement operation. A timeout can still occur and cannot prove
no effect. Root reconciles the ORIGINAL durable operation; unresolved stays unknown,
never an automatic replay/new-operation grant. Transport patience extends no
canonical expiry or Stop deadline.

NEW isolated cache: `%TEMP%/forge-guarded-timeout30s-20261125`.
Executable: `opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe`.

| Trust pin | New checked value |
| --- | --- |
| OpenCode SHA256 | `33ef775f30afbf7808773e97bc4d70e1dc990155541162c92e5b6e2dc1c18ad3` |
| T3 aggregate (unchanged) | `3494a3e4bce00e971a999fe51f5334d471e8d7a220db43e90f50f535314b0bf9` |
| Broker (unchanged) | `0c8a796db59f0829ac4b28b97be774523210f5ff99b7e6139e3fc442e8d2e08d` |
| Patch changes digest | `93dd03f0c868158be340019d8bbaea7a86b3c8681104dfd5d3da5d3d62631582` |
| Bootstrap source SHA256 LF | `733c714e30cf6dd5389ec3085639ec6d08123330c09a56c99a86227cc650f1a3` |
| Native guard source SHA256 LF | `a1f6992ea6c0c17d15e430732da265b31579322f1b3810fa4fcc7952d7c9f470` |

Fresh archive/preimage checks and filtered frozen Bun install ran in NEW source
and dependency trees. Unchanged pinned T3 compiled files/broker were verified and
copied; T3 fixture dependencies reuse read-only old paths. Extended Windows paths
handled a long pinned T3 fixture directory; no source was omitted/substituted.
Final byte hashes confirm original OpenCode309f61..., broker and all45 T3 compiled
files unchanged. No current old image/cache output was overwritten.

Actual new compiled image + matching T3 lifecycle checks PASS:

- Positive read/propose/edit acknowledgements each held6500ms AFTER durable
  receipt: three completed tool items, no failed positive, three distinct requests/
  operations/receipts, one edit effect.
- Dropped edit connection AFTER local completion, and separately an acknowledgement
  held31000ms: both yield exact OUTCOME_UNKNOWN; one edit effect; zero automatic
  retry/new operation. This tests actual network loss AND actual30s timeout.
- Explicit canonical action policy403 still yields DENIED and no read receipt.
- Every transport mode runs15 deterministic loopback requests, all17 zero-effect
  native negatives, identity/context/expiry/Stop refusals, exact3-tool discovery
  and no private receipt metadata in model context. No real provider/account call.
- Node24.19 supervisor completion and Stop both pass with this exact new image,
  real completed/interrupted native terminals, and proof null after Stop.

Actual root installer source stayed READ-ONLY. Its real code executed in a private
source-overlay copy preserving root's pipeline (including its current LICENSE),
with only explicit proposed trust pins and module/source relocation. Old pins
refuse PIPELINE_CHANGED; wrong patch digest refuses PATCH_CHANGED; proposed exact
pins yield ready and verified copied artifacts. Production installer was NOT
repinned: lead must deliberately update APPROVED.opencode, PATCH_DIGEST and the
two PIPELINE source hashes. Root's full application contention recheck for this
generation remains separate; these engineering records grant no authority.

Sanitized results: `app/guarded-runtime/timeout30s-evidence.json`, proof:null.
Full reports/manifests/staging scripts remain in the NEW cache only:
`artifact-manifest.json`, `installer-trust-{proposal,report}.json`,
`transport-{delay,drop,timeout,policy}-report.json`,
`supervisor-current{,-stop}-report.json`, `old-generation-preservation.json`,
`stage-generation.mjs`, `stage-transport-fixture.mjs`, `transport-fixture.mjs`,
`qualify-installer.mjs`, `collect-timeout-evidence.mjs`. Reproduce transport checks:

```powershell
$env:FORGE_TRANSPORT_FIXTURE_MODE='delay' # or drop, timeout, policy
node <new-cache>/transport-fixture.mjs <new-cache> t3
```

No root files, shared contracts, current cache images, broker semantics or accounts
were changed by this follow-up.
