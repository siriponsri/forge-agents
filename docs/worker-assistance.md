# Assistance worker handoff — 2026-11-24

Base: `7e9452e`, isolated branch `t3/implement-forge-assistance`.
Development runtime inherited from the explicit assignment: Codex,
`model=gpt-6.1-sol`, `reasoningEffort=xhigh`. No model switch, provider run,
credential access/migration, cloud purchase, prototype, push or PR occurred.
Changes are confined to new `app/assistance/**`, `tests/assistance*.test.mjs`
and this note. Shared contracts, manifests, migrations, server, UI and central
progress remain lead-owned.

The authoritative owner answers supplied in the assignment supersede the
pending-choice status in `docs/ASSISTANCE_STRATEGY.md`: consider all connected
provider models; balance explicit quality/cost preferences; begin with an
Executor; use a larger Asst only for explicitly difficult or stuck work. Roles
belong to the same authoritative T3 task pipeline and preserve bot identity.

## Implemented behavior

`createAssistanceService({store,providers,t3,clock?})` is an executable service.
`providers` is the existing provider service (`catalog`, `validateSelection`);
`t3` is the existing T3 execution owner (`startRun`, `reconcile`, `stop`). This
module creates no provider runtime, project, bot or conversation of its own.

Policy versions, decisions and loops use `events` with types
`assistance.policy`, `assistance.decision`, `assistance.loop`; mutations use
existing `receipts` (`type=assistance.command`). T3 owns actual `runs`. No schema
change or parallel history database is necessary. Decisions preserve all
candidate classifications/rejections, constraints, provider/account catalog
signatures, policy provenance, selected role routes/options and explanations.
Loops preserve role snapshots, trigger/handoff provenance, stable operation IDs,
limits, actual run references and review records.

All enabled project provider connections are inspected. Each must have a fresh
complete catalog and fresh, instance-matched installation/enabled/authentication
check, plus advertised `approval-required` and `canRunChildTask=true`.
`omittedModels>0`, a failed refresh or unknown capability cannot qualify all-model
selection. An unready enabled connection conservatively blocks dispatch; GUI may
offer Check/Refresh or explicit Disable on that connection. Disabled connections
are outside this connected inventory. A model not present in that exact catalog
is never synthesized. Every present model needs a classification or explicit
exclusion (`roles:[]`). Newly discovered unclassified models ask the owner.

Each policy classification has exact `connectionId`, `model`, `roles` (Executor
`executor` / Asst `asst`), `sizeRank`, `qualityRank`, `costRank|null`, optional
`options`, optional `monetaryCost`, and provenance
`{source,recordedBy,reason}`. Ranks are owner-configured ordinals in 0..100;
they are **not measured quality, parameter counts, prices or confidence**.
Optional monetary cost is `{amount,currency,unit,provenance}` and remains null
when unknown. It is never used as a guessed per-run cost. Provenance applies to
each classification; monetary provenance is independently required if supplied.

Policy requires positive integer `qualityWeight` / `costWeight` (1..100), its own
provenance, and explicit `unknownCost:'ask-owner'|'allow-ranked-last'`. The utility
rule is `qualityRank*qualityWeight - costRank*costWeight`; permitted unknown cost
ranks last, with no numeric utility. Ties use quality ordinal then stable exact
route/model key. Feasible pairs are considered across providers, with Asst size
rank strictly greater than Executor and distinct route/model. Every selected
option and advertised default passes the existing exact-model catalog validator.
This is deterministic policy routing. **Automatic quality improvement is not
established or claimed.** Catalog availability is separate from live execution.

Task constraints: `minExecutorQuality`, `minAsstQuality`, `maxCostRank|null`,
`requiredCapabilities` and optional
`difficulty:{kind:'difficult',reason,provenance}`. This service qualifies only
`t3.run`, `t3.reconcile`, `t3.stop`, `supervised`; another capability asks for setup
rather than assuming a model supports it. Provider/MCP/desktop capability
qualification is not fabricated. Classification conflicts or unknown preferences
produce `ask_owner`; missing actual capability/auth/catalog produces `needs_setup`.
Only `status:'selected'` is executable, even if a blocked decision has candidate
pairs for explanation.

New loops begin with Executor. An attempt is durably reserved and separately
claimed before T3 dispatch. Attempt operation IDs are
`assistance:<loopId>:attempt:<number>`. Every role change requires a reconciled
terminal predecessor, then creates a fresh attempt. Active/unknown workspace runs
block another dispatch. Unknown submission, no durable run, missing durable
context, route mismatch or observed model fallback never causes redispatch.
There is deliberately no retry-reservation or automatic model fallback endpoint.

Human plan approval, helper/task scope, bot lifetime, conversation ownership,
dependencies and task/profile/plan signatures are checked before dispatch.
Changing plan content invalidates the decision even if its approval flag remains
true. Changes to policy, provider inventory/account generation/catalog/options or
task/profile require reselection; selections never update the project profile.
Catalog/check/decision TTL is five minutes. For expired or changed policy during
a loop: Stop/reconcile, select and create a new reviewed loop for the same task.
This version does not replace a decision mid-loop.

After completed/failed Executor work, `transition(escalate)` is allowed only for
saved difficult-work evidence or an explicit observed-stuck reason/provenance
attached to that exact terminal run. Running/stalled work must first be stopped
and reconciled by the existing T3 owner. A completed Asst can return with a
reviewed bounded handoff to Executor. A failed Asst asks the owner; no silent
retry. Only completed Executor work can be human-reviewed. Review records a
reviewer and verification evidence; it does not mark the domain task done or
substitute model advice for artifact validation.

Default limits: four attempts, one escalation, twelve dispatch/transition steps,
five minutes; hard maximums: eight / three / 32 / one hour. The watchdog requests
Stop on elapsed deadline and is restored by `recover()`. Bounded reported-cost
policy is optional:
`reportedCost:{mode:'allow-unknown'|'require-reported',maxAmount:null|number,currency:null|string}`.
T3 may durably provide `run.reportedCost:{amount,currency,source}`. Missing reports
remain unknown, currencies are never added or converted, and an explicit cap
checks only matching reported expenditure before the **next** dispatch. It is
not a prepaid reservation or a guarantee of a hard monetary ceiling. The
require-reported mode blocks continuation when prior cost is unknown.

Stop is persisted before control effects, has a once-only attempt stop claim,
and remains `stopping` until actual terminal observation. An unknown Stop is
reconciled without another Stop dispatch, including after SQLite restart. Stop
can target the exact durable operation/task/bot run even if its role context was
ignored. Foreign or ambiguous run identities cannot be stopped through a guessed
ID. Take over should call Stop, then wait for terminal reconciliation before
granting the existing desktop or task controller; this service grants no control.
Closing the service clears timers and drains in-flight methods; it never claims
the provider run was cancelled.

## Exact lead-owned T3 integration

Exported from `app/assistance/index.mjs`:
`validateAssistanceContext(state,input,clock?)` and `assistancePrompt(context)`.
The baseline `app/server/t3.mjs` has only adaptive context support, so assistance
dispatch currently refuses `ASSISTANCE_CONTEXT_UNSUPPORTED`. The lead must:

1. Advertise `assistanceContextVersion:1` only after implementing all below.
2. Include `assistanceContext` in operation replay fingerprint comparisons.
   Reject mixed assistance/adaptive loop contexts; do not bypass either owner.
3. In the same SQLite transaction that reserves a T3 run, call
   `const context=validateAssistanceContext(state,input)`. It verifies current
   `assistance.loop` reservation, `attempt.status==='dispatching'`, loop status,
   exact task/conversation/role route/options, human plan, freshness and deadline.
   No runtime/provider effect may precede this check.
4. Persist `run.assistanceContext=context` verbatim,
   `run.selection=context.selection` verbatim and
   `run.providerInstanceId=context.selection.instanceId` in that reservation.
   Preserve `projectId`, `taskId`, `botId`, `conversationId`, attempt/operation IDs,
   supervised runtime and existing `task.runIds` / protocol ownership.
5. Build provider `modelSelection` from
   `{instanceId:context.selection.instanceId,model:context.selection.model,options:context.selection.options}`.
   Do not send the ordinary project provider when assistance supplied a route.
   Append `assistancePrompt(context)` to the existing scoped task/bot prompt.
6. Retain normal T3 thread/run IDs, Stop receipts and native observation. Preserve
   observed `executedModel`; an unexpected fallback blocks continuation. Missing
   executedModel remains unknown, not a claim of validated execution.
7. Recheck the reserved context immediately before launch after awaited project
   registration, so Stop/plan revocation during setup cannot launch a turn. T3
   should keep its existing stable `clientRequestId` and unknown-outcome rules.
8. Before exposing ordinary `startRun` or the adaptive scheduler, reject competing
   active assistance reservations in that workspace. Assistance already rejects
   existing adaptive loops and active/unknown T3 task/chat runs. T3 remains the
   only execution owner; this local service cannot retrofit reciprocal admission
   checks into lead-owned server/adaptive paths.

Context payload is exactly:

```js
{
  version:1, decisionId, loopId, attemptNumber, role:'executor' /* or 'asst' */,
  taskSignature,
  selection:{instanceId,model,options,connectionId,connectionGeneration,
    catalogObservedAt,selectionVerified:'catalog-only',executionVerified:false},
  feedback:null /* or bounded reviewed handoff */,
  reason:{kind:'initial' /* difficult, stuck, return */,reason /* provenance/runId when applicable */},
  runtimeMode:'approval-required'
}
```

`startRun` input is
`{projectId,taskId,conversationId:null|string,operationId,assistanceContext}`.
A returned object alone cannot advance the loop: the service validates the
durable `runs` record with exact context and selection. Do not loosen this
contract to accept ignored routing as successful assistance execution.

## API and HTTP/GUI integration work (lead-owned, not implemented here)

All mutation methods require `projectId`, unique `operationId`. Public callers
must retain the same operationId for a transport replay. IDs cannot be reused
across different methods/input or existing run/command owners. `advance` and
`transition` also require the current loop `expectedRevision`.

| Method | Extra input | Result |
|---|---|---|
| `state` (read) | `projectId` only | latest policy, decisions, loops, qualification labels |
| `configure` | `expectedPolicyId:null|id`, `policy` | immutable policy event |
| `select` | `taskId`, optional `constraints` | decision event selected/ask_owner/needs_setup |
| `createLoop` | `taskId`, `decisionId`, optional `conversationId`, `limits` | loop ready for Executor |
| `advance` | `loopId`, `expectedRevision` | once-only pending-role attempt dispatch or exhausted |
| `reconcile` | `loopId` | observe durable mapped T3 state; never dispatch a turn |
| `transition` | `loopId`, `expectedRevision`, `action:'escalate'`, `trigger:'difficult'` | Asst pending only with saved difficult evidence |
| `transition` | same, `trigger:'stuck'`, `reason`, `provenance`, optional `feedback` | Asst pending with observed Executor reference |
| `transition` | same, `action:'return'`, `feedback`, `provenance` | reviewed return to Executor |
| `transition` | same, `action:'approve'`, `reviewer`, `evidence` | completed human-reviewed loop |
| `stop` | `loopId`, optional `reason:'budget'` (internal watchdog only) | stopped/stopping/exhausted |
| `recover` (internal) | no input | restore unknown states and timers; no turn redispatch |
| `close` (internal) | no input | drain methods and release timers |

Suggested new routes: `GET /api/assistance?projectId=...` -> state;
`POST /api/assistance/{configure,select,createLoop,advance,reconcile,transition,stop}`
-> corresponding method. These routes are a proposal, **not installed endpoints**.
Use the existing loopback/authenticated-session/CSRF/error boundaries and body
limits, scope the selected project, and do not expose `recover` or `close`.
Instantiate after providers/T3; `await assistance.recover()` during startup and
`await assistance.close()` before closing T3 or store. Shared snapshots/events
remain the GUI recovery source. No new store collection or migration is needed.

GUI needs Thai/English Settings controls for observed model classifications,
quality/cost weights and unknown-cost preference, with provenance and explicit
exclusion; no prefilled model IDs, guessed ranks or fabricated prices. Display
all discovered candidates including blocked/unclassified routes; offer existing
provider Check/Refresh. On task selection show role/model/options, classification
sources, trigger/constraint explanations and unknown monetary costs. Show limits,
role attempts, actual T3 links, human approval and review state. Bind actions to
the methods above and current revisions. Disable dispatch for any blocked
decision. Unknown requires Reconcile; Stop/Take over remains available through
the existing owner. An Asst message alone cannot approve a task or prove quality.

## Verification and exact gaps

Windows, Node `v24.19.0`, no npm install or dependency/manifest change required.

```
node --test tests/assistance-selection.test.mjs tests/assistance-workflow.test.mjs
node --test tests/assistance-selection.test.mjs tests/assistance-workflow.test.mjs tests/adaptive-selection.test.mjs tests/adaptive-loop.test.mjs tests/adaptive-context.test.mjs
```

20 assistance checks and 20 existing adaptive regression checks pass. These use
real disposable SQLite persistence/reopen, existing provider catalog validation,
real timer callbacks, and **injected** T3/catalog/model lifecycle. They establish
no live provider entitlement, monetary price, empirical model quality or public
service. Coverage includes all-connected selection, unclassified models,
incomplete/expired/failed catalogs, auth/capability/options refusal, role conflicts,
human plan/task/bot isolation, Executor/Asst/Executor handoff, escalation caps,
stable/concurrent operations, lost accepted responses and absent durable outcomes
across restart, ignored context/selection and observed fallback, active/racing
Stop and unknown Stop once-only effects, deadlines/steps/attempts, reported-cost
unknowns and currency separation.

Implementation gaps: lead T3 selected-route/context admission and reciprocal
workspace admission, authenticated HTTP bindings, no-code GUI controls/trace and
their integrated tests. This worker intentionally cannot edit those shared paths.
There is no automatic difficulty detector, empirical quality evaluator, monetary
estimator or automatic role-turn driver in this service. The bounded transitions
are executable commands; a future automatic driver must consume observed stuck
evidence through the same commands and limits, never start a second runtime.
Five-minute catalog expiry requires a new reviewed loop rather than a silent
mid-loop route change. These are product integration/behavior limits, not missing
credentials. Overall assistance feature is `IMPLEMENTATION_INCOMPLETE` until
required lead integration and integrated verification are finished.

Separate qualification: `LIVE_ASSISTANCE_NOT_RUN`, model quality improvement
`NOT_ESTABLISHED`, `HOME_UAT_NOT_RUN`. No external provider execution was authorized
for this worker. After integration, the owner can qualify a harmless bounded
task on actually connected routes, examine exact role/run/options trace, stop it,
restart FORGE and reconcile without repeating tool effects.
