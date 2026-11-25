# Research execution composition handoff

Scope: new `app/research-components/**`, `tests/research-components*.test.mjs`,
and this document, based on `74480a8`, isolated branch
`t3/research-execution-composition`. No shared module, migration, manifest,
lockfile, native source/cache, legacy payload, credential or central progress
file was edited. No provider turn, paid call, push, nested agent or prototype.

This service implements actual policy composition for RES-02/03/09 using the
existing Workspace/T3 execution owners, Adaptive selection, provider catalog
validator, Budget observations, canonical events and independent file validators.
It is **not mounted or native-qualified in this scoped commit**. Root must wire
the explicit seams below before product admission. Missing host integration is
an implementation gap, separate from missing live credentials/home UAT.

## Service and authority

```js
import {
  createResearchComponentService, resolveResearchAllocation,
  validateResearchComponentContext, runResearchComposition,
} from './app/research-components/index.mjs';

const components = createResearchComponentService({
  store, dataDir, workspaces, adaptive, providers, authorizeOwner,
  // optional clock and exact pinned adapter registry
});
```

`authorizeOwner(request, opaqueCaller)` must return an actual authenticated
`{kind:'human',role:'owner'}`. A JSON role/subject is not authority. All public
commands and state reads use the same opaque authority; internal prompt hooks
operate on exact canonical runs and are never HTTP/MCP endpoints.

`workspaces.researchComponentContextVersion === 1` is required. Do not advertise
it until host-only forwarding and both T3 admission guards below are installed.
The service creates no task/bot/workspace/provider runtime. Root/GUI first
creates Owner-approved primary/helper/revision tasks and isolated Workspace
records using existing owners. Each uses a distinct task, same approved plan,
source/common Git dir, immutable base and project execution profile. Only the
pinned `forge-table/1` agent protocol is supported; metadata-only public
benchmarks and native faults still refuse composition.

Every mutation takes `{projectId,trialId,operationId,...}`. Retain operation IDs
on transport replay. Reusing one with different work fails. Claims and results
are separate immutable events; no acknowledgement means reconcile, never a new
dispatch. `prepare` also takes:

```js
slots: [
  {workspaceId: primary.id, role:'primary', skillIds:[reviewedActiveSkillId]},
  {workspaceId: helper.id, role:'helper', skillIds:[reviewedActiveSkillId]},
  {workspaceId: revision.id, role:'revision', skillIds:[reviewedActiveSkillId]},
]
```

The primary must be the trial's existing immutable workspace/task. Up to four
pre-approved slots are accepted. Disabled slots can remain in an ablation plan
but are never allocated. Enabled slots must fit both maxAgents/maxSteps, and
revision slots must fit maxRetries. These are conservative lifetime allocation
ceilings: no completed/unknown slot returns capacity. There is no automatic
creation of helpers or opportunistic expansion of the reviewed cohort.

Methods: `prepare`, `advance`, `reconcile`, `validate` (adds `allocationId`),
`stop`, `state`, `recover(opaqueCaller)`, `close()`. `advance` starts at most one
actual Workspace attempt. Methods do not start background model loops.
`reconcile` observes existing Workspace/T3 records only. `recover` re-arms
persisted absolute deadlines or awaits exact Stop for already expired work;
it never redispatches. Host startup must restore
the opaque authority and reconcile retained compositions. `close()` clears
timers/drains methods and makes no claim of remote cancellation.

## Executed policy and ablation behavior

Every slot uses actual `adaptive.select` and `providers.validateSelection`.
Provider/account installation, enabled status, authentication, complete catalog,
`canRunChildTask:true`, supervised runtime, exact model/options and freshness are
checked. Catalog defaults must already be explicit in the reviewed project
selection. There is no model-name inference, guessed default or model fallback.
Only the configured project route is eligible in this version; cross-route
Assistance optimization is not implemented or claimed. Initial routing qualifies
that route against actual task/T3 capabilities before dispatch and records its
decision. Static mode retains the reviewed route without adaptive revisions.

Skills ON consumes the exact explicitly reviewed active skill versions selected
by Adaptive, with IDs/revisions/instructions/provenance/hashes pinned in the
composition, allocation and prompt-consumption receipts. Skills OFF always
consumes an empty instruction list. Adaptive's discovery audit may still show
relevant candidates; it cannot inject them into the OFF prompt. Skill/task/plan/
catalog/profile changes invalidate pending admission. No skill promotion or
self-modification occurs.

Staffing ON allocates actual pre-approved helper Workspaces and their actual
canonical task/run/attempt IDs. Staffing OFF allocates none. Current scheduling
is sequential and budget-aware, not a claim of speedup or parallel utilization.
Helpers independently perform the same bounded benchmark task in isolated
checkouts; their artifacts do not silently modify the primary checkout.

Adaptation ON under `rule-adapt` or `evidence-guided` can allocate a distinct
reviewed revision workspace after a terminal predecessor with canonical
independent failed-answer evidence. Rule mode uses that deterministic failure
rule. Evidence mode additionally requires intact input and observed bounded
artifact receipts. Successful primary/revision evidence suppresses unnecessary
revisions. Adaptation OFF, static and initial-route never allocate revisions.
An interrupted/failed native run or missing independent evidence does not
silently trigger another attempt. Agent self-report is never outcome evidence.

Revision prompts consume helper advice only from PASSED independent helper
evidence and a fresh bounded reread of those exact output bytes/hash. Each is
limited to 8192 bytes and labelled untrusted DATA, never instructions/authority.
Changed helper output blocks consumption after canonical run reservation and
before any model prompt is consumed. Claimed capacity stays retained.

Optional verification ON runs an additional deterministic output-schema check
and requires passed helper checks for a passing cohort. OFF suppresses this
extra check. Both preserve mandatory independent artifact/input/correct-answer
validation and all security/Stop controls. No setting disables those controls.

## Immutable records and resolver

Events use the existing store: `research.composition`, `research.allocation`,
`research.component-decision`, `research.component-consumption`,
`research.component-observation`, `research.component-stop`,
`research.component-stop-claim`, `research.controller-overhead`,
`research.component-operation`, `research.component-result`, and standard
`research.evidence` with composition/allocation/run/attempt/workspace bindings.
Each is sealed with a canonical digest. They are append-only: observations do
not update allocation/decision/consumption records. Existing Workspace/T3 and
Research trial status remain owned by their original services.

The synchronous trusted callback for root/native is:

```js
resolveResearchAllocation(state, {
  projectId, trialId, workspaceId, runOperationId,
  runId,     // optional; null means no canonical run is present yet
  attemptId, // optional; null means no canonical attempt is present yet
})
// -> null only for an ordinary exact primary WITHOUT a composition
// -> otherwise throws on foreign/stale/unclaimed membership, or returns:
{
  composition, allocation, workspace, task, trial,
  manifest: trial.manifest,
  envelope: {
    trialId, manifestDigest, limits, deadlineAt,
    allocationCount, allocationIds,
  },
}
```

Returned objects are copies of validated canonical records. `allocation.id` is
the stable member identity; `allocation.operationId` is the actual
`workspace-run:<workspaceId>`; its `envelope` is the fixed per-allocation slice.
The returned parent `envelope` is the GLOBAL immutable trial resource envelope.
No body-supplied record/path/role/model can establish cohort membership.

## Required root patches (not implemented in this scope)

1. **Workspace host forwarding.** Extend `start(input,caller,internal)` with
   host-only `internal.researchComponentContext`. Reject that field in the
   public input body just like `researchContext`. Include it in Workspace
   operation fingerprinting, forward it to `t3.startRun`, then advertise
   `researchComponentContextVersion:1`. Preserve ordinary Workspace identity,
   expected revisions, source checks, approved-task and mixed-controller guards.

2. **Canonical T3 reservation and final dispatch.** Call
   `validateResearchComponentContext(state,input)` INSIDE reservation and again
   after all awaited registration/preparation at the final effect boundary.
   Add it to replay comparisons and persist `run.researchComponentContext`
   verbatim. Persist exact `context.selection`, provider instance/model/options;
   do not send the ordinary profile route if it differs. Preserve canonical
   task/bot/workspace/operation/run/attempt identity. Do not wrap this in a
   blanket mixed-controller bypass: these are allocations, not Adaptive or
   Assistance loop contexts. Existing ordinary validators still execute.

3. **Research admission/bridge.** Extend the primary-only Research admission
   branch only after validating the exact allocation context/resolver. Keep the
   SAME root `buildResearchContext` and immutable trial/manifest/config/dataset
   for every member, while validating each actual member workspace/task/run
   operation separately. Retain Stop/restore/deadline/context-policy/profile
   fences. The base bridge's unconditional component/nonstatic rejection,
   primary-only snapshot, preparation directory, canonicalRun and telemetry/
   result reconciliation are not sufficient for cohorts. Branch to this service
   when an immutable composition exists; leave ordinary primary behavior intact.

4. **Prompt and Context integration.** For each actual reserved allocation call
   `await components.preparePrompt({run,baseMessage})`. This prepares the same
   pinned benchmark data, reviewed skill instructions and checked helper data.
   Feed its returned message through the existing Context owner. Retain the
   exact actual Context receipt and apply existing memory ON/OFF reference/
   hash checks to this member. Before native launch, call
   `components.validatePrompt(state,currentRun,prepared.message)` and persist
   the returned `{eventId,digest,messageDigest}` in
   `run.researchComponentReceipt`. Recheck native/Research/Workspace/Context
   admission immediately before effect. Never use message text to bypass policy.

5. **Native owner GLOBAL resource mediation.** Pass the trusted allocation
   resolver callback to the native owner. Require actual current route,
   action/path/component suppression, policy generation and native receipts for
   EVERY member. Count allocation claims before dispatch; count every actual
   native model request/action identity against the SAME parent limits and
   absolute deadline. Root must supply the union of cohort private guarded
   ledger identities including unknown/completed effects so rollback/restart
   cannot return capacity. Per-allocation slices are conservative reservations,
   not proof of actual provider enforcement. This module deliberately does not
   mint native qualification, call native egress or copy native controls.

6. **Result and headless mounting.** `components.validate` reads actual owned
   `output.json`, copies bounded input/output into a fresh private checker
   directory, runs the pinned independent validator, rereads originals and
   appends exact `research.evidence`. Reconcile root trial status/effective
   result against the cohort's latest primary/revision evidence and optional
   helper checks; export component decisions/allocations/consumption/usage as
   well as the root trial. A helper's self-report cannot mark it passed. Mount
   GUI/HTTP through existing authenticated-session/CSRF/scope boundaries.

7. **Recovery/Stop/restore.** Stop/reconcile this service as well as the original
   owner whenever a root trial Stop, deadline or restore freeze occurs. Claim
   each exact Workspace Stop once; missing acknowledgement stays unknown and
   is reconciled without retry, including after SQLite reopen. Keep Research
   append-only events in the existing restore safety merge, and include every
   cohort run/context/Budget hold in restore preservation (base primary-only
   run-ID gathering is insufficient). Do not release unknown Budget holds.

These patches are executable integration work, not live-account setup. Until
they are integrated/tested the product remains `IMPLEMENTATION_INCOMPLETE` for
agent component execution. The scoped service refuses an absent host marker;
it is not a planner-only feature claiming completion.

## Budget and accounting truth

Before a new allocation, actual cumulative canonical Budget receipts are
verified against their fingerprints and exact project/bot/run/attempt/provider/
model. Different currencies refuse aggregation; modified receipts refuse
continuation. Observed known expenditure and the global budget are checked.
Enabled slots reserve fixed non-overlapping slices of steps/tokens/cost, and
all claims count lifetime maxAgents before effects. Allocations never recycle
unknown, unused or completed reservations. Monetary/token hard caps also need
actual native enforcement qualification; partition metadata alone grants none.

With `unknownAccounting:'block'`, unknown tokens, cost or finality blocks further
cohort allocation. Explicit Owner `allow` permits continuation ONLY when both
maxTokens/maxCost are null, inside the already reviewed fixed native resource
envelope. All missing values remain null, finality remains unknown/false and
there is no spend guarantee. A terminal native run does not imply final billing.
The current native owner may therefore supply null cost/nonfinal telemetry
without inventing free execution. Non-null unqualified hard caps must refuse.

Controller wall-clock overhead is separately measured and recorded, including
selection/dispatch/check/Stop commands. Controller tokens/cost/currency remain
null; no unmeasured CPU or provider cost is guessed. Provider usage summaries
do not quietly turn controller overhead into zero-cost observations.

## Headless integration

```js
const result = await runResearchComposition({
  service: components, caller: opaqueOwner, projectId, trialId, slots,
  // To continue, pass existing compositionId instead of preparing another one.
  // maxCommands defaults to 24 (hard maximum 64), onProgress is optional.
});
```

This calls the SAME service/Owner/Workspace/validator path, not the old local-only
CLI and not a new provider runtime. It returns a pinned
`forge-research-components-json/1` object with data SHA-256, real run/attempt/
evidence references and usage. It drives synchronous engineering fixture owners
to completion. For a genuinely running native owner it returns `running` so the
host can resume after actual observation; it does not poll, redispatch or
pretend an asynchronous native turn finished. A resumed/unknown outcome uses
`reconcile` and the retained composition identity. No new credentials or account
bootstrap are supplied by the headless driver.

## Verification

Run `node --test tests/research-components.test.mjs tests/research-components-files.test.mjs` and
`node --test tests/research-core.test.mjs tests/research-safety.test.mjs tests/adaptive-selection.test.mjs`.
Syntax-check each new module and run `git diff --check`.

Tests use real disposable Git worktrees and SQLite reopen, actual Workspace,
Adaptive, provider catalog validation, Budget service and independent artifact
checking. Host-only forwarding and T3/provider lifecycle/catalog/account/usage
are explicitly INJECTED fixtures. No test qualifies native action mediation,
live provider entitlements/billing, model quality or research superiority.
The existing installed dependencies are read through an ignored `node_modules`
junction to the development checkout; no install, lockfile or cache changed.

Final developer verification on Windows / Node v24.19.0:

- **25/25 component checks PASS**, 339.9 seconds, no skipped/cancelled tests.
  Actual primary/helper/revision Workspace runs under explicitly injected T3;
  reviewed skill consumption and OFF suppression; static/initial/rule/evidence
  policies; independent check failure/advice hash tamper; optional verification;
  canonical usage/finality unknown block and explicit bounded allow; mixed
  currency subtotals/receipt tamper; exact context/run/attempt/manifest scope;
  concurrent/replayed/lost-acknowledgement operations; actual SQLite reopen;
  Stop during awaited preparation and once-only unknown Stop; absolute deadline
  recovery; self-report refusal; completed recovery past deadline without Stop;
  failed independent artifact recheck invalidating the old completion; final
  command overhead included in machine export; bounded-reader hardlink refusal.
- **19/19 existing Research core/safety and Adaptive selection checks PASS**,
  5.2 seconds, no skipped/cancelled tests.
- New module/test syntax checks and staged/unstaged diff whitespace checks PASS.

Earlier verification corrected a Workspace Stop-operation namespace collision,
a mixed-currency fixture that initially tried to alter one run's own currency,
and a fixture that expected another allocation after a successful outcome.
One overlapping heavy test run correctly hit the real 30-second watchdog; the
final isolated suite above passes with the actual bound intact. No deadline,
accounting guard or owner authority was relaxed to obtain the final result.

External provider/native/official public-benchmark checks: **NOT_RUN**.
Owner's actual-home GUI/start/restart/Stop comparison flow: **HOME_UAT_NOT_RUN**.
