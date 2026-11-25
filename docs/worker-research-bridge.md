# Research execution bridge handoff — 2026-11-25

Scope: `app/server/research.mjs`, `tests/product-research-bridge*.test.mjs`,
and this handoff. Base `4187912`, isolated branch
`t3/research-execution-bridge`. No shared contracts, main/App/T3/Workspace files,
lockfiles, protected legacy paths, provider/account calls or public listeners
were changed. No push or paid trial occurred.

## Exact host API

```js
import {createResearchExecutionBridge} from './research.mjs';

const bridge = createResearchExecutionBridge({
  store, dataDir, workspaces, t3,
  authorizeOwner, // async (request, opaqueCaller) -> {kind:'human', role:'owner'}
  registry,       // optional metadata registry; executable is always fixed builtin
  qualification, // optional synchronous trusted owner receipt lookup; absent = deny
});
// bridge.executionOwner.version === 1
// bridge.executionOwner.{dispatch,reconcile,stop,telemetry,validate}
// bridge.prepare({run,baseMessage}) -> Promise<{message}>
// bridge.validatePrepared(state,run) -> separate researchReceipt, or null (ordinary)
// bridge.memoryEnabled(run) -> canonical trial flag, or true (ordinary)
// await bridge.close()
```

Use `bridge.executionOwner` as `createResearchService({executionOwner})`.
Research HTTP does not expose `prepare`, proof injection or evidence writing.
Each executionOwner action authenticates the original opaque caller; serializing
an Owner-looking object cannot grant authority.

Dispatch's sole execution effect is:

```js
workspaces.start({
  projectId,
  workspaceId: canonicalWorkspace.id,
  operationId: `research-workspace-start:${canonicalTrial.id}`,
  expectedRevision: canonicalWorkspace.revision,
}, opaqueCaller, {researchContext: buildResearchContext(state, {projectId,trialId})})
```

The third argument is host-only. Workspace/T3 retain canonical task/worktree,
runOperationId (`workspace-run:${workspaceId}`), attempt, provider and Stop
ownership. Root must add and preserve this third argument; these tests explicitly
inject that seam while exercising the actual existing Workspace service.

Root-owned T3 hook order:

1. Call `admitResearchTrial(state,input)` during canonical reservation and persist
   the exact canonical `researchContext` on that run. Existing Workspace,
   Adaptive/Assistance, capability, Goals, Budget and other guards remain mandatory.
2. After reservation and before actual Context preparation, call
   `bridge.prepare({run: currentCanonicalRun,baseMessage: originalBaseMessage})`.
   Pass its returned `message` into the actual existing Context seam.
3. In `memoryForRun`, consult `bridge.memoryEnabled(currentCanonicalRun)` before
   calling Memory. False must prevent the memory input entirely. True still needs
   ordinary authorized scope/ref resolution and actual selected memory.
4. Persist actual `contextId`, `contextReceipt` and `contextMode` from Context.
   In the final transaction, assign
   `run.researchReceipt = bridge.validatePrepared(state,run)`. Do not replace the
   Context receipt. Run the mandatory final Research admission immediately before
   the native effect, alongside every existing owner guard.
5. Feed native accounting into existing Budgets. Bridge telemetry reads canonical
   Budget observations, not model text, token estimates or cost guesses.
6. Close this bridge before shutting down its underlying store. Restore must
   retain the existing Research safety merge and frozen admission semantics.

For ordinary canonical runs, prepare returns the base message unchanged,
validatePrepared returns null, and memoryEnabled returns true. A Research-bound
workspace/run cannot strip `researchContext` to take that ordinary route.

The separate Research receipt is exactly:

```js
{
  researchContextDigest: digest(run.researchContext),
  workspaceId,
  contextPolicyDigest,
  forgeContextId: run.contextId,
  forgeReceiptDigest: digest(run.contextReceipt),
}
```

No actual Context receipt or run-dependent receipt hash enters the immutable
pre-run manifest. Both native passthrough request hashes and FORGE active prefix
hashes must show consumption of the prepared message. Event/run/task/route,
policy ID, actual receipt shape and memory references are checked independently.

## Input and independent evidence

Only the builtin pinned `forge-table@1` implementation executes through this
bridge. A supplied registry cannot replace its code, add a command/module/path,
or turn public benchmark metadata into an executable adapter. Dataset and
implementation pins must match both canonical manifest and builtin registry.

Prepare generates `input.json` exclusively under
`dataDir/research/trials/<canonical UUID>`, after run reservation. It never writes
to the execution checkout before Workspace/T3 pristine admission. Prompt text
preserves the original base message verbatim, appends bounded labelled benchmark
DATA, and the trusted fixed adapter task. No reference answer is appended.
Prepared event stores immutable hashes and identities, not original prompt text.
Replay reconstructs the same message from verified immutable bytes. An orphaned
exclusive input file without its canonical preparation record fails rather than
being silently overwritten/regenerated after a crash.

Independent validation requires the exact completed run and attempt, retained
Research/Context binding and unchanged policy. It verifies actual Git worktree
registration/branch/base/source, reads bounded regular single-link `output.json`
bytes there, and snapshots those bytes with immutable input into a fresh private
checker directory. The pinned adapter's independent reference checker inspects
that snapshot. A second actual worktree/input read and Git inspection reject
changes during checking. The agent supplies neither a success boolean nor an
artifact path. Incorrect bytes produce failed independent evidence; missing,
linked, oversized or tampered inputs cannot mint passing evidence.

Canonical `research.evidence` includes exact project/trial/manifest/run/attempt,
workspace/head, input and output hashes, dataset and adapter pins, checks,
independent flag and immutable event digest. Return value is only `{evidenceId}`.
Historical evidence remains a snapshot; recheck reads current bytes again.

## Trusted qualification seam — deliberately no default producer

`qualification(state,request)` is a **synchronous trusted host lookup**, never an
HTTP/body value or a model tool. It returns `{version:1,requestDigest,receiptId}`
only when the actual owner currently enforces the exact request. It cannot return
a Promise or a blanket boolean. Request is:

```js
{
  version:1, projectId, trialId, manifestDigest, workspaceId, taskId,
  runOperationId, runId, attemptId, deadlineAt,
  route: canonicalManifest.contextPolicy.route,
  components: canonicalManifest.components,
  limits: canonicalManifest.limits,
}
```

`runId` and `attemptId` are null before reservation and exact IDs afterward.
Pre-run proof does **not** qualify a later run/attempt. `deadlineAt` is the actual
canonical absolute trial deadline, not a duration reset on restart.

Returned ID resolves to a canonical project event with:

```js
{
  type:'research.enforcement', version:1, requestDigest: digest(request),
  mechanism:'guarded-native/1',
  nativeComponents:{memory:'disabled',skills:'disabled',adaptation:'disabled',staffing:'disabled'},
  actions:{ownerReceiptId},
  limits:{ownerReceiptId,maxMs,maxSteps,maxRetries,maxAgents,maxTokens,maxCost},
}
```

Each referenced actual owner receipt must exist in the same project and bind
the same `requestDigest`, exact `runId` and `attemptId`. Limit values must equal
the immutable trial caps, including null where no token/cost cap was requested.
The host's actual action/limit owner must vouch for route, policy generation,
component controls and current consumption; this consumer cannot infer such
enforcement from event existence alone. No production code here creates these
qualification events. Test fixtures clearly label their injected receipts
`INJECTED_NATIVE_PROOF_NOT_LIVE`.

Matching Guarded worker reports real compiled bounded read/propose/text-edit
broker negatives and local effect receipts; that receipt is explicitly **not**
the canonical native action/limit/trial qualification above. Root must leave the
qualifier absent until its own mandatory Stop/route/policy fence and existing
owner receipts genuinely qualify the whole request. Do not mint this event from
Research config or copy an engineering test proof into production.

Even with a trusted proof, this bridge refuses skills/staffing/adaptation ON,
non-static agent policies and agent fault scenarios. Existing isolated Workspace
does not compose Adaptive/Assistance controllers. Their actual consumption is
an implementation gap; there is no bypass and no component-effect claim.
FORGE memory ON is separately qualified through actual Context selected refs;
native ambient memory/skills/staffing are never counted as FORGE ablation effects.

## Deadlines, replay and accounting

Before awaiting Workspace start the bridge persists `research.bridge-dispatch`
and arms its watchdog. Any replay/restart/lost acknowledgement returns
reconcile-required and never calls Workspace start a second time. Canonical
admission, profile/source binding, policy, Stop and current owner qualification
repeat after awaited file/setup operations. Root's final guard still owns the
native effect boundary.

The absolute elapsed deadline invokes Workspace Stop using exactly one retained
operation ID `research-workspace-stop:${trialId}`. A canonical
`research.bridge-stop` claim is persisted first; repeated stop/reconcile calls
reuse it without another Stop effect. Unknown acknowledgement remains unknown,
including after real SQLite reopen; no Budget holds are released by this bridge.
Reconcile can discover the owned effect and rearm an existing live deadline;
it cannot restart a turn. The timer needs a live host, so current native owner
elapsed-limit receipts are mandatory too. `close()` clears timers and drains
pending work, preserves identities/holds, and does not pretend running native
work stopped. Host/server recovery must reconcile retained trials.

Telemetry verifies canonical Budget binding (run, attempt, provider and model)
and immutable observation fingerprints. It returns actual tokens, cost and
currency with source receipt IDs and explicit native finality provenance.
Absent tokens/cost/currency/finality remain null. It does not combine currencies,
estimate unobserved tokens or infer free finality from terminal run status.

## Developer verification and remaining work

**Developer result:** 16/16 bridge tests and 15/15 existing Research core/safety
tests passed on Node v24.19.0 / Windows. Module/test syntax and staged diff checks
passed. Final bridge suite duration was 86.6 seconds; no skipped tests.

Run:

```powershell
node --test tests/product-research-bridge.test.mjs
node --test tests/research-core.test.mjs tests/research-safety.test.mjs
node --check app/server/research.mjs
git diff --check
```

The scoped suite uses actual Git checkouts, SQLite, Context, Memory, Budget
observations, regular files, hardlinks, input/output tamper, dev/held-out adapter
checks, opaque authority rejection, post-await policy drift, expired admissions,
once-only lost Stop acknowledgement, persistent replay identities and foreign IDs.
Native lifecycle, third-argument forwarding and native proof ownership are
explicitly injected. No agent/model/provider execution is measured by these tests.
Existing pinned dependencies are accessed through an ignored local node_modules
junction; no manifest/lockfile/install changed.

**Implementation integration gaps:** root-owned authenticated mount/routes,
Workspace host-only forwarding, mandatory T3 reservation/final hooks and actual
native Guarded owner component/action/resource enforcement; composable
Adaptive/Assistance skill/staffing/adaptation receipt consumption; public
benchmark adapters remain unavailable. These are code/qualification gaps,
not missing credentials. This module supplies concrete fixed input preparation,
actual Context receipt checks, independent file evidence, canonical Stop and
Budget telemetry needed for that integration; it does not mark agent mode ready.

**Live external checks NOT_RUN:** actual provider turn, official public dataset
protocol/score, paid resource or live native component/limit qualification.

**HOME_UAT_NOT_RUN:** mounted authenticated Research Lab configuration → reserve
→ supported execution → independent recheck → comparison/export → restart/Stop
on the owner's home machine remains a separate acceptance step after integration.
