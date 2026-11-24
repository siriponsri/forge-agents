# DH-05 P0 / compatible DH-06 checkout — worker handoff

Date: 2026-11-24. Actual model: `gpt-6.1-sol`, xhigh. Branch:
`t3/dh05-goals-checkout`; base `38cadb4`. No push, main change or PR.

## สถานะ

Implemented within assigned paths: durable versioned goals, measurable criteria,
bounded manual/automatic continuation, canonical task checkout, DAG validation,
actual evidence evaluation, independent QA and explicit Owner acceptance,
pause/resume/cancel, restart recovery, exact-owned Stop and elapsed watchdog.
No schema migration, second planner, task database, provider runtime, SDK install,
profile/model change, credential operation or prototype was introduced.

**IMPLEMENTATION_INCOMPLETE at product integration boundary:** this worker does
not own `main.mjs`, `t3.mjs`, domain admission, App navigation, shared styles,
manifests or progress. Lead must wire the exported seams described below. Merely
importing the UI does not qualify execution. Existing T3 in this checkout lacks
goal context support, and service refuses dispatch with
`GOAL_CONTEXT_UNSUPPORTED` until the authoritative owner supplies it.

**DH-06 qualification:** atomic task/workspace checkout and canonical dependency
and owner checks are implemented. Parallel coding isolation/worktree creation is
**NOT IMPLEMENTED / UNSUPPORTED** here. A claim is advisory ownership, never a
filesystem sandbox. Same, nested and existing symlink-resolved workspace roots
share the execution guard, including unknown chat runs without task IDs.
Independent ready tasks can proceed after a failed task's exact run is terminal;
unknown outcomes retain claims and block the shared workspace.

## Files / authority

- `app/goals/contracts.mjs`: definitions, bounds, canonical graph/plan/task
  signatures, ownership and overlapping-workspace checks.
- `app/goals/context.mjs`: synchronous authoritative T3 admission and prompt seam.
- `app/goals/evidence.mjs`: fixed criteria → existing adaptive evidence checker;
  observed run usage only.
- `app/goals/index.mjs`: service, recovery, scheduler, receipts and HTTP allowlist.
- `app/web/src/Goals.jsx`: functional `{t,state,projectId,run,busy}` surface using
  exact routes below; no hardcoded provider/profile, caller or approval claims.
- `tests/goals*.test.mjs`: SQLite, byte evidence and Chromium engineering fixtures.

All data lives in existing `events` and `receipts`. `goal.goal` is a mutable
versioned projection with immutable `goal.revision`, `goal.transition`,
`goal.verification`, `goal.qa` and `goal.owner-review` facts. `goal.claim` tracks
the held/released canonical task/bot/workspace owner. Canonical `tasks` retain
status/runIds/evidence. There is no new collection or database schema.

`revision` is optimistic concurrency for every goal transition. `goalRevision`
changes only when the definition is explicitly revised by the authenticated
Owner. Plan approval is reused from the existing canonical plan; goals never
approve or rewrite that plan. Plan revision/content or task definition/owner/DAG
changes invalidate dispatch. Goal revision resets its verification/QA, reopens
its previously QA-completed selected tasks, retains all old attempt records and
cannot extend the original elapsed deadline. Explicit Owner review is required
for definition/policy revision; no automatic policy expansion occurs.

## Lead integration — required before execution

```js
import {
  createGoalService, dispatchGoalRequest,
  validateGoalContext, goalPrompt,
} from '../goals/index.mjs';

const goals = createGoalService({store, t3, authorize: authorizeGoals});
// Recovery runs locally before commands; it never submits/replays a provider turn.

// Inside T3's existing serialized run reservation, before any provider effect:
const goalContext = validateGoalContext(state, input);
// Call unconditionally, including absent context, to prevent generic startRun
// from bypassing a held workspace or nonterminal goal task owner.
// Persist goalContext verbatim on the existing run, and include its digest in
// T3's existing operationId replay comparison, alongside other contexts.

// In the authoritative prompt assembly:
message += goalPrompt(run.goalContext);
// Advertise t3.goalContextVersion = 1 only after validation/persistence/prompt
// and inherited tool admission/Stop behavior are actually wired and tested.

// Authenticated localhost route, exact allowlist and private caller:
result = await dispatchGoalRequest(goals, method, jsonBody, privateCaller);
// Shutdown before store/T3 disposal:
await goals.close();
```

The service dispatches only `t3.startRun({projectId,taskId,conversationId,
operationId,goalContext})`, observes durable runs through the shared store,
and calls only exact owned `t3.reconcile(runId)` / `t3.stop(runId)`.
Assistance and Adaptive remain existing role/skill controllers. An active
independent controller blocks checkout; goals does not impersonate its context
or mutate its selection. Relay admission must also continue to run. Composing
these contexts into one trusted execution reservation is **lead-owned remaining
implementation**, not an asserted worker capability. Do not disable existing
validators to accommodate a goal.

Context version 1 binds `{version,goalId,goalRevision,criteriaDigest,taskId,
taskSignature,attemptId,attemptNumber,claimId,objective,criteria,feedback}` to the
exact persisted dispatching attempt, operation, bot, conversation, approved plan
and claim. `criteria` is limited to that task. Feedback is bounded observational
data, never authority. Recheck admission after any awaited pre-dispatch setup
that can invalidate these conditions. Existing T3 Stop remains the process owner.

## Exact HTTP contract

All routes are **POST** `/api/goals/{method}`; no kebab-case aliases.

| Method | JSON arguments |
|---|---|
| `state` | `{projectId}` |
| `create` | `{projectId,operationId,planId,objective,taskIds,criteria,policy?}` |
| `revise` | common + `{planId,objective,taskIds,criteria,policy?}` |
| `resume`, `pause`, `cancel`, `reconcile`, `review` | common |
| `advance` | common + optional `{taskId,conversationId}`; omitted task selects first ready canonical task |
| `blockTask` | common + `{taskId,reason}`; only quiescent known outcomes |
| `qa` | common + `{taskId}` |

Common: `{projectId,goalId,operationId,expectedRevision}`. Operation IDs are
bounded and global; a different payload under the same ID rejects. Exact replays
return the durable receipt without re-running an effect. Load current state for
the latest projection after an old receipt replay. `recover` and `close` are
private service lifecycle methods and excluded from the HTTP allowlist.

Criterion schema, one or more for every selected task (maximum 24 total):

```js
{id,taskId,description,kind:'artifactHash',sha256:expectedSha256}
// OR
{id,taskId,description,kind:'verifierReceipt',verifier:{id,version}}
```

No model text, free-form success assertion, runStatus-only check or executable
caller verifier qualifies. Actual artifact record must link to the exact
completed attempt and its confined bytes are hashed via existing
`adaptive/checkEvidence`. Receipt criterion selects existing trusted
`verification.result` for that run and exact verifier ID/version. Both QA and
final acceptance re-read the evidence. Model output cannot issue trusted
verification records through this API.

```js
policy = {
  mode:'manual', // or 'bounded-auto'; default manual
  maxAttempts:8, // service ceiling 64, lifetime attempts retained across revisions
  maxAttemptsPerTask:3, // ceiling 8
  maxMs:300000, // ceiling 3600000, starts on first resume; pauses do not extend it
  maxUnchangedFailures:2, // ceiling 8; normalized per-task failure fingerprints
  tokens:{unknown:'block',maxTotal:null},
  reportedCost:{unknown:'block',maxAmount:null,currency:null},
};
```

Unknown modes are `block` or explicitly `allow`. A cost cap requires a positive
finite amount and exact reported currency. Limits check observed totals before
further dispatch; they cannot guarantee a hard remote spend/token ceiling for
an in-flight run. No token prices, currency conversion or estimated actuals.
Only trusted existing `run.reportedUsage = {totalTokens,source}` and
`run.reportedCost = {amount,currency,source}` count. Missing usage remains null /
unknown with known subtotals and exact run/revision/digest refs. Current runtime
usage ingestion qualification is **NOT_RUN**; this adapter does not invent it.
Unknown usage blocks automatic continuation by default; evidence review itself
does not require purchasing resources or fabricating metrics.

Auto mode starts only after explicit resume. It responds to durable run changes,
inspects terminal results, retries bounded failed criteria and advances ready
tasks. It does not poll unknown outcomes, redispatch after restart or approve
QA/Owner review. Successful evidence sets canonical task `review`; authenticated
independent QA sets `done` and attaches its evidence receipt. Dependencies then
become ready. All selected tasks need QA before `awaiting_owner` acceptance.

Unchanged/per-task failure bounds mark that task blocked, allowing independent
ready work. Global attempt/token/spending/time bounds stop the goal. Unknown
usage produces an explicit blocker. Canonically blocked/done/review/running tasks
are not silently reopened by dispatch. A new Owner revision can reassess known
blockers. Unknown/foreign/context-mismatched dispatch must first be resolved by
the existing runtime owner; no `retryReservation` or automatic effect replay is
provided.

## Private human authorization

`authorize(request, privateCaller)` is injected, never supplied through JSON.
Request fields: `{action:'qa'|'review'|'revise',projectId,goalId,goalRevision,
taskId,expectedRevision}`. Return authenticated `{kind:'human',subject,
role:'qa'|'owner',independent:true /* required for QA */}` or deny. The callback
must attest actual independence from the executor; the service additionally
rejects QA whose subject is that task's executor bot/run actor. Omitting callback
fails `HUMAN_REVIEW_UNAVAILABLE`. Body `approved`, `reviewer`, `caller` or arbitrary
identity fields are rejected. The same actual local Owner may perform QA and
final acceptance as separate attributable actions, independent from the model
executor. No invented second human/account is required. Machine/agent QA is not
implemented in this worker and is not simulated by a body claim.

## Source inspection / reuse

Pin: `4b399c39a6d1479cd84ca591b4d7c88e24d38a96`, source and package manifests
fetched directly from upstream at that pin. Root LICENSE and relevant manifests
are MIT; goal, agent-team and tool-ralph packages are `0.2.3-alpha.2`.

| Decision | Inspected source at pin | Native target / qualification |
|---|---|---|
| REFERENCE | `packages/goal/goal/src/{domain,fold}.ts` | Durable revisions and lifecycle in existing FORGE event store; no copied source/runtime |
| REFERENCE | `packages/goal/goal-round-driver/src/index.ts` | Exact round reservation, durability and quiescence fences; native bounded goal driver |
| REFERENCE | `packages/goal/tool-goal/src/authority.ts` | Human/round authority separation; private review callback, never body authority |
| REFERENCE | `packages/team/agent-team/src/{task-board,task-graph}.ts` | Compare-and-set checkout and DAG checks over canonical FORGE tasks; no second board |
| REFERENCE / DEFER runtime | `packages/experimental/tool-ralph/src/index.ts` | Bounded rounds/handoff pattern; no model-report completion, fresh child runtime or recursive Ralph tool |
| DEFER | DSH SDK/runtime and direct Cordis package adoption | Not installed/enabled; Node/platform/approval/isolation qualification remains separate |

[Upstream source at pin](https://github.com/deepseek-ai/deepseek-harness/tree/4b399c39a6d1479cd84ca591b4d7c88e24d38a96)
and [MIT license](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/LICENSE).
`SAFETY.md` was inspected: preview is unaudited and not an isolation guarantee.
Current registry was inspected (`app/plugins/index.mjs`, `builtins.mjs`): only
compiled native trusted factories, schema/version/dependency/enablement guards,
separate authorize hook and disposal checks. Goals adds no dynamic plugin load,
SDK or registry bypass. Native pattern only; no DSH runtime qualification claim.

## Verification / remaining work

- `npm.cmd ci --ignore-scripts --no-audit --no-fund`: installed existing lockfile
  unchanged; required because isolated worktree initially had no node_modules.
- `npm.cmd run build`: PASS; existing upstream `use client` / chunk-size warnings.
  Root App does not import Goals yet, so the browser fixture separately compiles
  and executes `Goals.jsx` with esbuild.
- `node --test tests/goals*.test.mjs tests/adaptive*.test.mjs tests/assistance*.test.mjs`:
  PASS: 82 runner entries, including 31 Goals backend tests, one browser test and
  the Goals fixture module. Actual SQLite/file evidence and
  Chromium UI, injected T3 transport/lifecycle, no live provider or quality claim.
- Browser flow covers exact create/resume/advance/qa/review/state bodies, actual
  service/file evidence, same authenticated Owner QA + review, TH/EN, 375px
  viewport, labelled controls and project switching; browser closed afterwards.
- Backend checks cover graph/project/plan ownership, checkout and revision races,
  fixed criteria/tampering, unknown/lost submissions, pause/restart/cancel, no
  automatic replay, late-owned Stop, budgets, unchanged/changed failure bounds,
  independent ready work, QA and server-owned authorization.

Lead must integrate T3 context/replay/prompt + existing relay/role/skill/context
admission, authenticated HTTP route and App navigation; then rerun tests/build
and integrated product/browser regression. Do not classify those missing wires
as missing credentials. Actual T3 runtime goal seam, trusted usage ingestion,
live provider/model behavior and HOME_UAT are **NOT_RUN**, separately from these
implementation gaps. Independent external worker review of this patch is also
**NOT_RUN**; no subagent was spawned from this worker assignment.
