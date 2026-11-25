# Unified private runtime and installer handoff

Scoped implementation at base `a408ac2`. No nested agents, external model/account
calls, push, protected/legacy changes, shared manifests or cache mutations.
Existing native generations were read only. Test dependencies use an ignored
junction to the approved root dependency tree. HOME_UAT_NOT_RUN.

## Private APIs for root integration

Construct `createGuardedExecutionBridge` once per process before importing the
matching compiled T3 entry. It retains the installed nonreplaceable singleton.
The existing factory now accepts optional handle-scoped `toolNames`; the bridge
uses `purposeSeparatedToolNames` from frontend-tools/root-host-tools.mjs.
Default Proactive/Research profiles keep exactly the original three tools.
Only explicit `purpose:'supervised-frontend-v1'` permits the sole native tool
`forge_frontend_selection_read`, with exact scope
`{paths:['.'],capabilities:['frontend_selection_read']}`. It grants no file read,
proposal or write authority. `qualifyProactive` refuses all explicit purposes.

`createFrontendGateway({profile,assertCurrent,authorizePhase,withFence})` is a
trusted async bridge option. It returns `{url,bootstrap,close}`; bootstrap returns
only `{key,brokerUrl}` for the existing private child FD. Root/frontend facade
supplies bindingProvider. Gateway fences phase and synchronous binding metadata
under `withFence(fn)` using the existing canonical writer. Actual SDK tools/call,
Owner response waits and broker's own async transactions stay outside that fence.
Gateway close revokes only its own grant, never the application's shared broker.

`qualifyFrontend(state,request)` returns distinct installation route admission:
`purpose:'supervised-frontend-v1',mode:'supervised-frontend',
nativeActions:'selection-only',normalizedActions:'selection-only'`, normal exact
project/task/envelope/identity/scope fields, an expiring `frontend-route-v1:`
evidence ID. This is admission only, not Guarded automatic action qualification.

The frontend actual session attestation is purpose-separated:
`{version:1,purpose:'supervised-frontend-v1',sessionID,pid,binarySha256,
profileDigest,manifestDigest,contextDigest,toolGeneration,policyGeneration,
runtimeDirectory,names:['forge_frontend_selection_read'],evidenceId}`.
Evidence prefix is `frontend-session-v1:`. It observes the actual authenticated
session model/directory/permissions/profile metadata, live child/image and real
T3 openSession/ensureThread phases. It makes NO negativeCount17 claim and cannot
qualify Proactive or Research. Receipt owner is
`supervised-frontend-native-session`; default Guarded remains unchanged.

`privateSnapshot(runId)` is host-only read-only observation of the private entry:
`{profile,routeProof,attestation,phases,phase,live,providerThread,providerTurn}`.
It never calls root admission/current observers or a qualifier and cannot mint
proof. A pending reservation exposes its real profile with `live:false`.
Final live requires actual attestation, live process/images, unrevoked canonical
context/attempt/thread/root and unexpired profile. Root must verify committed
actual native thread/turn/root/attempt and preserve strong/weak refs before
binding. Never invent an orchestration providerRunId for the private adapter.

Requests optionally carry `deadlineAt` (absolute) and `maxBytes` (1..65536) at
request level. Scope remains exactly paths/capabilities for scopeDigest. Profile
expiry is clamped before reserve/bind to original absolute deadline, route lease
and bounded maxRunMs. Nothing resets accepted canonical deadlines.

resolveProvider may privately return `bind({runId,attemptId})` and `close()`.
Bind is synchronous and runs in launch AFTER canonical allocation commit and
before native bind/ensure. Close may be async; it runs on preparation/reservation
failure, terminal, Stop, restore and shutdown without returning a Promise through
structuredClone. Root MUST call `discardPreparation(handle)` if allocation fails
outside the bridge, including after successful bridge.reserve followed by outer
TX rollback. It closes orphan memory-only leases without finding/stopping a
noncommitted run. For an exact committed allocation discard is a no-op; use Stop.
Canonical state run is last in callback spreads; beforeAction's existing resource
hook and per-phase/current checks remain mandatory.

Private overlap checks and source generation cover guarded-runtime,
research-native, research-components, frontend-tools and server source. Policy
captures and rechecks the source generation; source drift requires restart.
Native image checks still stream every digest with no digest cache.

## Installer

Default source setup now calls runFrontendPipeline through the existing Windows
JobObject command owner. It preserves pinned acquire/base-patch/dependency/build
checks, prepares a private SDK1.32.2 dependency closure from the exact reviewed
root lock (95 packages, integrity checked by npm, scripts ignored), then clones,
patches, remaps and builds a NEW unified generation under private setup TEMP.
It independently verifies archive/source/patch/addition/build/report/image and
all45 T3 modules plus the actual root Node. Original caches are never overwritten.

Approved unified optimization is host-only and pins the matched pair:
CLI `edde02f4107862e229cbe5436fde8b3a28d94195dd6fba85e9f716acaf6cf934`;
T3 all45+root Node aggregate
`715c5c8657db3f2910b031e740f9391f04649914569a8c2a0da155d5f73179a5`.
The existing broker remains pinned unchanged. Private copies retain and verify
FORGE/T3/OpenCode/Node/MCP SDK notices. Setup inventory has proof:null and grants
no turn/route authority. Installation check accepts exact old and unified CLI
versions; the default three-tool negative probe is still required for that check.

## Executed validation and remaining work

- New unit checks: 3 PASS (purpose suppression, singleton handle scope,
  nonrecursive lifecycle observation, metadata writer fence, source drift in all
  enforcement families).
- New installer checks: 2 PASS, actual approved unified source/image/private copy,
  notices, reopen, tamper and minimal lock closure. The pinned acquired npm also
  accepted that closure in an offline dry-run.
- New rollback check: 1 PASS, actual native installation probe, zero model calls,
  consumed preparation outer-TX rollback and unused preparation close exactly once.
- Existing frontend SDK/host/deny checks: 17 PASS. Existing broker, Research native
  owner/egress and Guarded policy checks: 35 PASS.
- Existing installer checks excluding the obsolete injected old-only stage-sequence
  fixture: 7 PASS, including actual legacy private copy/restart/tamper, JobObject
  descendant Stop and application crash recovery. That stage fixture has not been
  adapted to the added unified build stages; no all-installer-suite pass claimed.
- Focused actual unified frontend/native check PASS: actual session + sole tool,
  committed weak refs, Owner-held SDK return, original native tool result/terminal.
- First combined native run exceeded its original300s test-harness timeout after
  all default Guarded tests passed. Harness increased to600s only; canonical
  deadlines unchanged. Final combined result is reported with the commit handoff.

Fresh source-to-binary expensive build was NOT rerun by this worker. The default
build pipeline is implemented, while actual install checks used the approved
read-only generation. Root main/T3/Research/frontend/UI/restore mounting and
whole-product qualification remain root-owned. The old frontend CLI engineering
fixture still calls extendT3HostSource on the pre-integration factory signature;
use the new unified bridge native test for this source, or update that fixture
before reusing it. No product completion or live credential/home UAT claim.
