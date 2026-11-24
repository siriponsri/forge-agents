# A18 adaptive skills and bounded task loop — worker handoff

Date: 2026-11-24, Windows, Node v24.19.0.
Worker branch: `t3/adaptive-skill-harness`; isolated base `09fc17e`.
Owned files: new `app/adaptive/**`, `tests/adaptive*.test.mjs`, this note only.
No main/control/domain/store/web, lockfile, central-progress or protected legacy edits.

Actual development execution: Codex `gpt-6.1-sol`, with exact inherited options
`[{"id":"reasoningEffort","value":"xhigh"},{"id":"serviceTier","value":"default"},{"id":"cyberAccessProgram","value":"standard"}]`.
Confirmed by development T3 `orchestrator_capabilities` read on this worker.
This is development-environment metadata, not a product provider qualification.
No further workers, live product/provider turns, prototype or cloud execution.

## Implementation and evidence

`createAdaptiveService({store,t3?,connections?})` is exported from
`app/adaptive/index.mjs`. Uses built-ins and existing domain/store utilities only.
Existing SQLite `events`, `skills`, `receipts` hold all records; no new collection,
schema version or migration. The lead owns shared schema changes if later needed.

Implemented:

- Capability-aware selection of existing versioned skills and the actual configured
  T3 provider/model/options, with durable snapshots, rejected alternatives and reasons.
- Versioned inactive improvement candidates, bounded baseline/candidate evidence
  checks, explicit promotion, and explicit rollback retaining original provenance.
- Per-task `plan → execute → inspect → revise/review` state machine around the sole
  existing T3 `startRun/reconcile/stop` owner. Bot identities remain separate; helper
  scope is checked. It neither spawns bots nor changes conversations or provider accounts.
- Durable dispatch reservations and stable attempt operation IDs; duplicate commands
  and process restarts never automatically submit provider turns.
- Time watchdog requests stop through T3, persists uncertain outcomes, and re-arms
  active deadlines after restart. Attempts and stage transitions have independent caps.

Developer verification: `node --test tests/adaptive*.test.mjs` passed **26 test entries**
(25 named behavior scenarios plus the shared fixture module entry), zero failures/skips.
Tests use a clearly labelled injected T3 lifecycle double, actual temporary local file
bytes and actual SQLite close/reopen. They cover unavailable capabilities, configured
route/options, isolation, missing/foreign/changed evidence, stale revisions, regression,
promotion/rollback, arbitrary-code rejection, duplicate/restart/unknown outcomes,
stop-before/after-owner-reservation races, bounded attempts/steps/time, explicit replay,
context retention and resident/helper ownership. They also check that reconciliation
does not rewind review or reopen a completed loop.

Syntax checks of all five adaptive modules and `git diff --cached --check` passed.
Full application build/integrated GUI is **NOT_RUN in this worker**: dependency install,
   shared HTTP/UI integration and T3 context support remain lead-owned. No manifests changed.
Live provider/MCP execution, comparative model quality and **HOME_UAT_NOT_RUN** are
separate qualifications, never inferred from fixture test success.

## Lead integration — next executable work

1. Cherry-pick the scoped worker commit and instantiate one service using the existing
   `store`, `t3` and `connections`. Call `adaptive.shutdown()` during app teardown to
   clear watchdogs. This method does not claim it stopped a provider; T3 shutdown/stop
   still owns provider execution.
2. Add validated version-1 adaptive context to lead-owned `t3.mjs` as agreed below.
   Without that contract, dispatch fails `ADAPTIVE_CONTEXT_UNSUPPORTED`. This guard
   prevents a successful-looking selection that the provider never consumed.
3. Add HTTP adapters and no-code forms/buttons to these methods. Replace the old
   `control.select` route for adaptive task selection. Display setup reasons, versions,
   exact route/options, evidence, stage/budgets and all NOT_RUN qualifications.
4. Guard generic `skill.update`/other writes against changing candidate provenance,
   instructions/version/status or retired base records. The current generic command
   can bypass promotion unless the lead closes that shared boundary. Also prevent
   generic creation from impersonating candidate lineage or overwriting existing IDs.
   Use versioned adaptive APIs for managed history, keeping initial ordinary skill
   registration available. This is an **integration implementation gap**, not an
   authentication/home-UAT blocker.
5. Persist actual verifier receipts from trusted verifier adapters, or link actual
   output artifacts to their owning run. Do not accept a raw browser-submitted receipt
   as verification. Then verify the integrated HTTP/GUI flow and a bounded harmless
   provider operation if available. This worker intentionally did not execute one.

Loop completion stores a review/evidence record and leaves task board completion to
the existing domain command: lead can add the inspection/review record as evidence
and mark the task done only after explicit human approval. No task is silently marked
done by a successful provider process or by card movement.

## HTTP/no-code method contracts

All mutation inputs include `projectId`, globally unique `operationId`. An ID replay
with changed input fails `OPERATION_REUSE`; identical replay returns its saved result.
Create a fresh operation ID after changed data/revision. Status is read-only. Revision
conflicts return the existing domain `REVISION_CONFLICT` (409); reload current state.

| Proposed route | Method and input fields beyond common mutation fields | Result |
|---|---|---|
| POST `/api/adaptive/select` | `select({taskId,constraints?})` | Decision entity |
| GET `/api/adaptive/status?projectId=...&taskId=...` | `status({projectId,taskId?})` (no operation ID) | `{decisions,candidates,evaluations,history,loops,limits,loopLimits}` |
| POST `/api/adaptive/candidate` | `candidate({skillId,expectedRevision,version,instructions,lesson,evidenceRefs})` | Candidate skill entity |
| POST `/api/adaptive/evaluate` | `evaluate({candidateId,expectedRevision,baselineChecks,checks})` | Evaluation entity |
| POST `/api/adaptive/promote` | `promote({candidateId,expectedRevision,evaluationId,reason})` | Promotion audit entity |
| POST `/api/adaptive/rollback` | `rollback({promotionId,expectedRevision,reason})` (revision of currently active candidate) | Rollback audit entity |
| POST `/api/adaptive/loops/create` | `createLoop({taskId,decisionId,conversationId?,limits?})` | Loop entity, awaiting human plan approval |
| POST `/api/adaptive/loops/advance` | `advance({loopId,expectedRevision,checks?,feedback?,decisionId?,action?,reviewer?})` | Loop entity |
| POST `/api/adaptive/loops/reconcile` | `reconcile({loopId,expectedRevision})` | Loop entity, actual T3 observation |
| POST `/api/adaptive/loops/stop` | `stop({loopId,expectedRevision,reason?})` | Loop entity; may be `stopping` |
| POST `/api/adaptive/loops/resume` | `resume({loopId,expectedRevision,retryReservation?})` | Loop entity; never resets elapsed budget |

These routes are proposals for the lead, not claims they are already mounted here.

Selection constraints: `{requiredCapabilities?:string[],skillIds?:string[],maxSkills?:number,
providerInstanceId?:string,model?:string,candidateId?:string}`. Unsupported constraint
keys fail rather than being silently ignored. `candidateId` explicitly opts into testing
one inactive candidate; it does not promote it. No automatic fallback from an explicitly
configured or requested route. Change project Settings and select again instead.

Selection output: entity identity/revision plus `{taskId,botId,status:'selected'|'needs_setup',
skills:SkillSnapshot[],harness:null|HarnessSnapshot,availableCapabilities,rejections,
taskSignature,routeSignature,profileRevision,constraints,inventory,qualifications,method}`.
No bundled placeholder skill catalog: candidates come from actual project `skills`.
Automatic relevance is deterministic task/name token matching; explicit IDs take
priority. Missing prerequisites reject a skill; an explicitly requested missing skill
blocks execution. Empty skill selection is allowed when none is relevant.

Available capability names: `t3.run`, `t3.reconcile`, `t3.stop` require actual injected
methods and a discovered T3 catalog. `mcp:<connectionId>:<toolName>` requires an injected
connection service, the same project's enabled MCP record and a ready discovery less
than 15 minutes old. This is FORGE integration availability; it does **not** assert that
the selected provider directly sees those MCP tools or that calling them succeeded.
The service never executes a tool during selection/evaluation. Expose harness-native
tool availability separately when the T3 adapter has actual evidence for it.
Model/options are checked against the catalog from `t3.catalog()`. Both T3 and MCP
observations expire after 15 minutes. A partial catalog may require rediscovery of an
omitted configured model; name presence does not infer account entitlement.

Candidate evidence references: `[{kind:'run'|'artifact'|'verification',id}]`, 1..24.
Each resolves within the selected project and is retained with its revision, record
hash and record snapshot. Lessons may come from failures; they do not establish a
passed evaluation. New versions inherit prerequisites and link `parentId`, a complete
parent skill snapshot, lineage ID, lesson and originating operation ID. No in-place
instruction rewrite occurs. Candidate creation needs changed instructions and version.

Supported evaluation checks (unique bounded `key`, every check binds an actual run):

```json
[
  {"key":"completed","kind":"runStatus","runId":"actual-run-id"},
  {"key":"output","kind":"artifactHash","runId":"actual-run-id","artifactId":"actual-artifact-id","sha256":"64-lowercase-hex"},
  {"key":"verifier","kind":"verifierReceipt","runId":"actual-run-id","receiptId":"actual-verification-event-id"}
]
```

Unknown kinds/fields are rejected. No JS, shell, subprocess or submitted verifier
callback is executed. Missing/foreign/unlinked records and missing/changed bytes produce
durable FAILED outcomes. Artifact checks require `artifact.runId`, `artifact.source.runId`
or `run.artifactIds` linkage, a verified/ready record and actual bytes confined to the
project workspace. Reports stored outside that workspace require a separately qualified
trusted verifier receipt; the evaluator never broadens path access.

Trusted verifier event schema: existing `events` entity `{type:'verification.result',
projectId,runId,status:'PASSED',verifier:{id,version},checkedAt,checks:[{status:'PASSED',...}],...}`.
It must exist before evaluation and belong to that run and project. A failed/partial
or unversioned receipt fails. Receipt bytes/provenance are retained in the evaluation.
The upstream trusted adapter remains responsible for receipt authenticity and semantic
test quality; this service does not invent receipts from a run's success message.

Candidate and baseline evaluation runs must each have actually consumed their own exact
skill ID/version/content hash in persisted `run.adaptiveContext.skillSnapshots`.
Use matching check keys/kinds for baseline and candidate, including at least one artifact
or verifier check. A process status alone cannot qualify a candidate. Matching checks
establish only that those checks passed; they are not a causal/quality benchmark.
Promotion revalidates both suites against current bytes/statuses/receipts, exact candidate
and parent snapshots. Any failure blocks it; rollback validates current lineage before
restoring the previous active version. Histories and prior evaluations remain intact.

## T3 version-1 context contract (lead-owned change)

The T3 object must expose `adaptiveContextVersion:1` and continue owning durable
submission/idempotency/reconciliation/stop. Adaptive dispatch calls only:

```js
t3.startRun({
  projectId, taskId, conversationId,
  operationId: `adaptive:${loop.id}:attempt:${number}`,
  adaptiveContext: {
    version: 1, decisionId, loopId,
    skillSnapshots: [{
      id, revision, name, version, instructions, requires: [], sha256, provenance: null
    }],
    harness: {
      kind: 't3', providerInstanceId, model, options: [{id, value}],
      runtimeMode: 'approval-required', routeSignature
    },
    taskSignature, goal, feedback // feedback null or bounded human revision text
  }
});
```

Skill hash = SHA-256 of canonical JSON `{instructions,requires}` (sorted object keys,
array order retained); `routeSignature` = canonical hash of `project.profile.provider`.
Helpers `digest` and `snapshotSkill` are available from `app/adaptive/records.mjs`.
The selector uses the existing project route; no route/account/options mutation occurs.
No phase-specific route is silently substituted; add that shared contract deliberately
if supporting phase overrides at the T3 execution boundary.

T3 must validate context against actual project/task/loop/decision and snapshots,
preserve it verbatim on its durable run before provider dispatch, and include selected
instructions/feedback in the run prompt. The adaptive layer checks retained context
and bot/task/project ownership; context loss becomes `unknown`, never a successful
adaptive execution. T3's existing durable operation reservation, plan approval,
dependency and workspace-busy checks remain in force. Preserve this operation ID on
all restarts and provider calls; never create another T3 turn owner.

## Loop transitions and operational limits

Create → `plan/awaiting_plan`. Advance plan requires existing `task.planId` approved
by the human; then `execute/ready`. Next advance reserves one attempt and calls T3.
Reconcile observes the same owner run: completed → inspect; failed/interrupted → revise;
running/unknown stays attached to that attempt. Inspect requires supplied actual output
artifact/verifier checks for that exact current run. PASSED → review; FAILED → revise.
Review needs `action:'approve'` and a nonempty human `reviewer`, then rechecks evidence
before completion. Revise requires bounded feedback, optionally a newly selected scoped
decision after task/route changes, and returns through the human plan gate.

Stop records intent before contacting T3. No observed run, missing stop acknowledgement,
or a still-active provider leaves `stopping`; observation of terminal status permits
`stopped`/`exhausted`. Duplicate/restart never implies provider cancellation. Ordinary
resume refuses active/unknown owner outcomes. If a crash occurred before any owner run
reservation is visible, explicit `retryReservation:true` calls the **same** T3 operation
ID/context, does not allocate another attempt, and depends on T3's durable idempotency.
If a run is visible but uncertain, reconcile it; do not resubmit under a new operation.

Loop limits: defaults 2 attempts / 16 stage steps / 300,000 ms; hard configurable maxima
8 attempts / 64 stage steps / 3,600,000 ms. Minimum 1 for each. Elapsed budget starts when
the approved plan advances, includes human waits after that point, and survives restart.
Reconciliation/stop remain possible after budget exhaustion. Resume cannot extend budget.
Stage steps count plan/execute/inspect/revise/review transitions; read-only observations
and stop/reconciliation do not consume stage budget. Repeated GUI commands are still
audited; no automatic retention pruning erases provenance.

The watchdog is process-local enforcement and immediately re-arms elapsed persisted
deadlines on next process startup. FORGE cannot guarantee a remote provider was stopped
while FORGE itself was offline; actual stopped status requires T3 reconciliation. A
provider stop failure retains uncertainty and requires explicit reconciliation.

Evaluation limits per suite: 24 checks, 16 MiB/artifact, 64 MiB aggregate artifact reads,
10 seconds cooperatively checked between bounded reads. Baseline and candidate are
separate suites, so together at most 48 checks / 128 MiB. Promotion repeats both suites.
Filesystem calls cannot forcibly cancel an OS filesystem stall; no hard real-time
deadline is claimed for an unresponsive filesystem. Text limits: instructions 32,000,
lesson/feedback/reason 4,000, version 80; selected skills max 8 (default 3).

## Reuse disposition

Read v3 START_FULL_PRODUCT, architecture/settings, acceptance A18 and component reuse
map, plus the bundled Hermes adaptation research. The historical workbench contract
is superseded; no historical workbench runtime was restored.

- [Hermes skill availability source at inspected MIT revision a15b971](https://github.com/NousResearch/hermes-agent/blob/a15b9710395aa1c4858fb6dd9e4c5014c5ced4e9/agent/skill_utils.py):
  design-only on-demand instructions and explicit availability filtering. No Hermes
  runtime/code, credentials, memory or unrestricted self-modification copied/imported.
- [single-agent-loop-kit README](https://github.com/anthropics/single-agent-loop-kit):
  design-only bounded loops and comparable before/after evidence. Upstream describes
  a reference kit and exposes an Apache-2.0 license. FORGE preserves persistent bots,
  justified helpers and T3 execution ownership; no kit runtime, optimizer, support-desk
  application, paid benchmark or upstream code was imported.

These original modules implement rule-based selection and evidence gates. No learned
optimizer, measured model superiority or fixture-to-live qualification claim is made.
