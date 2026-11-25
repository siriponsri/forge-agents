# Canonical Guarded execution bridge

Implementation worker: `gpt-6.1-sol`, `xhigh`, inherited actual runtime. Base
`10e536b`; isolated `t3/guarded-execution-bridge` worktree. Assigned new
`app/server/guarded.mjs`, `tests/product-guarded-bridge*.test.mjs`, and this note
only. No nested delegates, live account/model requests, pushes, public service,
prototype, credential migration, legacy or ordinary T3 controller changes.

This is the root-owned private bridge implementation. Root integration in
`t3.mjs`/application/AG-UI/provider-vault/installer and independent review are
lead work. The bridge defaults deny unless trusted callbacks supply canonical
authority. Fixture callbacks in the tests are explicitly engineering fixtures.
`HOME_UAT_NOT_RUN`; live provider/account qualification NOT_RUN.

## Exact API

```js
const guarded = createGuardedExecutionBridge({
  store, dataDir, artifacts, authorizeOwner, resolveProvider,
  observeSelectedRoute, validateAdmission, onEvent, onReceipt,
});
```

Construct ONCE per application process: the underlying private T3 host slot is
nonreplaceable. One resolver holds all project/run leases. It must be installed
before loading the compiled matching T3 entry. Never expose this factory or its
callbacks/handles through HTTP/MCP/config/model arguments. `artifacts` is the
native worker descriptor or async `()=>descriptor` from the installer. Descriptor
changes after initial acquisition fail `GUARDED_ARTIFACT_RESTART_REQUIRED`;
restart with freshly qualified artifacts. Hash changes invalidate native leases.
No ordinary installed development T3/account access is used.

* `check({projectId,leaseMs})` (`setup` alias) creates the real machine-only native
  installation check for that project's exact observed route, with no FORGE
  run/task or model authority. Returns sanitized readiness; opaque check handle
  stays private. Root enforces HTTP Owner auth before this call.
* `readiness({projectId})`: current live metadata or null, never execution authority.
* `qualifyProactive(state,request)`: initial live route proof or null. Request is
  `{projectId,taskId,envelopeDigest,identitySnapshot,scope:{paths,capabilities},
  limits:{maxRunMs,maxTokens:null,maxCost:null}}`. Root adds exact accepted recipe
  limits to its existing `proactiveEnforcementRequest`. No stored report/hash
  recreates proof. Renewal retains SAME evidenceId for unchanged route/generations.
* `await prepare(input)` resolves private provider/config/key BEFORE canonical
  allocation. Input has `{projectId,taskId,operationId,workspace,request,message}`.
  It rechecks exact selected route/account/policy/tool generations after the
  async resolver. Returns an opaque in-memory prepared handle. It creates no
  native process, directory, canonical run, task, plan or provider turn.
* `reserve(state,{run,input,prepared})` is synchronous inside root's authoritative
  reservation transaction AFTER all ordinary guards/Budget. `run` must already
  be in `state.runs`, with final canonical `id,attemptId,threadId,rootNodeId`, real
  `status:'submitting'`, resolved `workspace`, and `selection`. Optional canonical
  `runOrdinal,providerTurnOrdinal,providerSessionId` are retained (otherwise 1,1,
  and a namespaced provider-session identifier derived from the sole run ID).
  It adds `run.guardedContext`; the existing project `run.profile` is unchanged.
  Returns safe `{runId,attemptId,threadId,rootNodeId,profile,routeProof}` only.
  Lease remains private. An orphan from a rolled-back reservation cannot bind.
* `await launch(runId,{message})` REQUIRES FINAL Context/Research prepared message,
  after root has persisted its real Context receipt. It binds native child,
  opens/ensures actual T3 session, attests exact native session, persists separate
  `guardedReceipt`, final-validates admission, then invokes actual native
  `session.startTurn` once. Duplicate exact launch uses the original promise;
  altered message refuses. `startTurn` returning void is NOT completion.
* `reconcile(runId)`: canonical status and persisted observed native projection,
  run receipt/dispatch uncertainty, live flag. Read-only, no native send/restart.
* `stop(runId)`: immediately revokes private authority synchronously before its
  first await, persists canonical `stopRequest`, sends native `interruptTurn`
  using OBSERVED providerTurnId, waits boundedly for actual terminal, then closes
  private resources. No persisted-PID kill, replacement, replay or automatic retry.
  Missing terminal remains unknown.
* `invalidateCredentials(predicate)`: immediately revokes every matching private
  lease before awaiting canonical Stop/interrupt cleanup. Predicate receives safe
  `{projectId,credentialRef,accountGeneration}`. Root invokes BEFORE vault/account
  generation rotation, under its credential operation ordering.
* `recover()`: missing in-process lease + pending canonical run becomes unknown,
  never recreates a lease/session or redispatches. `inspectReceipt(runId,opId)` is
  metadata-only, also after restart: a host-generated UUID `storageId` locates the
  private receipt DB beneath the fixed private root (no arbitrary body path).
  Receipt inspection cannot grant execution authority. `close()` revokes all and
  disposes private resources.

## Mandatory trusted callbacks

All authority/observation callbacks are synchronous and must return the specified
value; promises refuse. No built-in production `true` governance callback exists.

`observeSelectedRoute(state,{projectId,...input})` returns
`{route,policyGeneration,toolGeneration}`; optional projectId must match. Route is
the exact runtime profile schema, including credential ACCOUNT GENERATION and
actual packaged T3/OpenCode hashes/revisions, full model and typed options. Bind
broker/package changes into root toolGeneration. Observation has no invocation
authority/credentials. Each installation host closes over its own projectId.

`authorizeOwner(state,{stage,input,run?}) === true` verifies actual approved
canonical plan/recipe grant. This is distinct from HTTP auth and ignores model or
body asserted Owner flags. `validateAdmission(state,detail) === true` MUST repeat
all applicable ordinary guards (Adaptive/Assistance/Goals/relay/Proactive,
Workspace/Research/Budget/plugins/profile/settings/context/approval revisions).
Detail includes actual `run,input,stage,workspace,profile,routeProof` and when
applicable `attestation,capability,path,tool,messageDigest`. Stages are
`reservation`, `current`, `send`, `action`. It receives the CURRENT fenced state,
never read `store.read()` instead of this supplied state. The bridge independently
checks canonical IDs/context, actual status, Stop, selected route/generations,
physical workspace, scope proof and private path confinement.

Bootstrap `current` must permit real submitting/running without requiring final
attestation. `action` requires actual attestation + persisted matching native run
receipt, root's actual running/action scope/path governance. Root must accept
actual running in repeated send checks and use the exact approved-plan/bot and
started-task revision snapshot. Never substitute starting/running status in a
cloned record to evade a validator.

`resolveProvider(input,{selected})` is async ->
`{provider:{id,model,compatibility,settings},credentialRef,accountGeneration}`.
Root resolves its existing connection/vault, never installed development accounts.
Initial native transport is compatible OpenAI chat only. Settings allow resolved
`baseURL,apiKey,transport:'http',headers?`; env/file/config substitutions refuse.
Thus a root environment reference is supported ONLY by resolving it into private
provider settings before returning; child receives no credential environment and
no key is written to provider-management RPC. Raw provider/key stays memory/pipe
only. Persisted contextDigest is the native worker's exact provider/runtime/manifest
binding; it is never the raw descriptor, request body or secret.

## Fence and event contract

The SAME `store.transaction` serializes native gateway admission, broker actions,
Stop/policy mutations, file operation, and receipt recording. An AsyncLocalStorage
token exposes that Tx snapshot only to the active fenced async chain and expires
before commit; later adapter fibers read committed canonical state. Root's other
policy and Stop mutations MUST use the same store writer queue.

**Do not await native startTurn while holding the store transaction.** The actual
adapter performs native RPCs (including `/api/model`) whose private `/fence`
callback needs that SAME store transaction. Final pure admission and guardedLaunch
evidence commit under the fence; native `startTurn` follows immediately. Its
synchronous host checks and every native gateway phase revalidate current/send
admission; gateway phases and all bounded effects acquire that same canonical
fence. Holding the Tx around those awaited RPCs demonstrably deadlocks.

`onEvent(state,{run,event,projection})` is synchronous inside the canonical event
Tx. ROOT maps real pending/running/terminal events to canonical run/task/AG-UI
using existing owners. Bridge stores only `guardedProjection` with actual
providerSession/providerThread/providerTurn/nodes/messages/turnItems/terminal;
no second orchestration controller or run. Reasoning text is dropped. Match
providerTurn by `runAttemptId,nodeId,providerThreadId` (NO providerTurn.runId).
Terminal must match exact observed thread/turn and canonical runOrdinal. Message,
node and tool item identities remain actual native IDs. Native weak references
stay weak; no invented providerRunId, strong relabel or model-text success parsing.
Root must project real running before positive actions; absent observation denies.

`run.guardedReceipt` is separate exact-run/native-session attestation and carries
the original `routeEvidenceId`; it NEVER replaces the initial evidenceId in
Proactive/guarded context. `guardedLaunch` stores only final message hash and
Context receipt references/digest. They are rechecked at every send phase.

`onReceipt(state,{run,receipt})` is an optional synchronous undefined-returning
root callback under the SAME broker transaction. Bridge idempotently records the
actual local broker receipt in canonical `receipts` with type
`guarded.file-receipt`, namespaced id, exact owner/profile/run/operation/digests.
This is NOT Agent Research owner action/resource proof. Root separately validates
the actual Research admission and correlates its own proof when warranted.

Private state/artifacts/runtime modules must physically lie outside ALL editable project/run
workspaces. Paths are host-generated; no model/body executable/path is accepted.
All three initial tools are fixed. No Memory/arbitrary MCP attachment or generic
HTTP/model-tool provider route exists. Compiled Effect/Layer/Node services and
native adapter come from the same graph; the private ProviderHost explicitly
denies settings/credential/background/attachment expansion, without fixture host.

## Verification

Command: `node --test tests/product-guarded-bridge-deny.test.mjs tests/product-guarded-bridge-native.test.mjs tests/guarded-runtime-host.test.mjs tests/guarded-runtime-broker.test.mjs` on Node24.19.0,
using the native worker's final `%TEMP%/forge-guarded-build` artifacts. Native tests
skip explicitly only when the checked compiled cache is unavailable, never pass a
mock as native evidence. Fixture provider binds 127.0.0.1; no live account turn.

**Final exact-tree result: 22/22 PASS, zero failures/skips, 191.7 seconds**, on
actual root Node24.19.0. This includes the 13 bridge lifecycle checks and nine
existing runtime/broker checks. `node --check app/server/guarded.mjs` and
`git diff --check` also pass. These are deterministic native engineering checks,
not account/model quality evidence. The full bridge suite uses six loopback protocol requests:
one completed text turn, four requests for read/propose/edit plus completion,
and one held request interrupted by real native Stop. It checks:

* Real installation 17 native negatives + two T3 negatives, zero provider requests,
  before any canonical run exists; foreign project qualification refuses.
* Missing setup/callback/Owner, unsupported token/cost caps/options, async account
  race, reservation denial/orphan rollback and final-send denial: zero requests.
* Native completed events and exact canonical attempt/rootNode/provider thread /
  provider turn/weak native refs; final Context text only, original project profile
  retained, no raw key/prompt in canonical snapshot, duplicate launch once-only.
* Real running event BEFORE positive broker actions, real revision-checked write,
  three fenced canonical broker receipts, read-only receipt metadata, outside
  unchanged, private broker receipt not forwarded into provider context.
* Held native request Stop -> actual interrupted terminal; no replay or persisted
  PID authority. Current workspace/context/Stop/policy swaps refuse before bind.
* Missing process lease -> durable unknown, repeated recovery no redispatch.

Native testing is intentionally bounded (300-second suite timeout, <=300-second
per-run wall lease); full binary/profile requalification at every phase is
expensive. Product limits remain exact accepted limits, never raised by bridge.
The original native MIT notices are retained without editing native source.

The lead must still integrate factory/callbacks in actual product bootstrap,
installer, vault rotation, canonical dispatch/recovery and AG-UI, then review and
run integrated product tests. This worker does not claim those shared edits or
live provider/home UAT are done.
