# Six selectable strategies — worker handoff

Required base: `378466061e575ffd3b429f73aaf623f51b5396fb`. Inherited
gpt-6.1-sol/xhigh. Assigned new strategy modules/tests/CSS plus the explicitly
assigned existing Strategies.jsx only. The four existing strategy tabs remain.
No shared contract, migration, manifest/lock, central progress, protected legacy,
native installation, provider account, nested delegate, push or publication.

## Root hooks (integration is required)

```js
import {
  createStrategyService, dispatchStrategyRequest, validateStrategyContext,
  assertStrategySourceAvailable, strategyPrompt, mergeStrategySafety,
} from '../strategies/index.mjs';
const strategies = createStrategyService({
  store, workspaces, sessionRoute, sessionRoles, t3, dataDir,
  authorize: authority.goalAuthorize, // SYNC (request, opaqueCaller)
});
```

Authorization must return authenticated `{kind:'human',role:'owner'}`. JSON actor,
role or caller fields confer no authority. No HTTP context input is accepted.
All `/api/strategies/{state,create,advance,reconcile,stop,select,feedback}` routes
are POST; use the existing private browser session + CSRF gate and add strategies
to api.mjs Owner-header matching. Dispatch through the explicit allowlist.

Unconditionally call `validateStrategyContext(state,input,options)` in Workspace
preparation (`preparing:true`), canonical task AND Conversation reservation,
replay (`replay:true`), and final dispatch after all asynchronous setup. Save its
return value on the canonical run and include it in operation replay comparison.
Append `strategyPrompt(run.strategyContext)` in the existing prompt owner.
Unrelated work returns null; claimed operation/workspace/task stripping denies.
Preserve all existing Workspace/mixed-controller/role/Budget admission checks.

Root must add host-only `Workspace.start(body,opaqueOwner,{strategyContext})`,
forwarding that context into its existing T3 start. Advertise
`workspaces.strategyContextVersion = 1` only after all these checks/persistence
are wired. Public Workspace body input must reject strategyContext. `preparing`
checks the exact claim before Workspace changes ready → admitting; final checks
require exact `workspace-run:<workspaceId>`. This adds no checkout exception.

Supervisor start delegates the complete Owner intent flow to existing
`sessionRoute.createIntent/start/cancel`. Its pure reservation derives the
strategy envelope from the exact claimed sessionContext operation. Save that
returned envelope on the parent run. No native profile/manifest widening.
Conversation child reservation derives from the canonical session-role command,
its exact parent attempt and approved child pins. The child run MUST retain that
derived envelope for final admission/replay. Invoke the validator even when
strategyContext or sessionRoleContext is absent; stripped child operations deny.
Child total caps include the parent; concurrent child caps do not count the
non-file supervisor. Parent native qualification remains sessionRoute-owned.

Envelope, version 1:

```js
{
 version:1, strategyId, stageId, claimId, projectId, taskId,
 workspaceId, // null for supervisor
 operationId, allocationDigest, dependencyRefs, role,
 // only derived exact child Conversation envelopes additionally contain:
 parentRunId, parentAttemptId, childCommandId,
}
```

`dependencyRefs` retain actual claim/run/attempt/workspace/branch/path/base/head/
check/evidence/artifact/status/cost observations. They are data, not authority.
`role` is the immutable existing scoped session assignment. The pure source
guard `assertStrategySourceAvailable(state,projectId,input)` rejects ordinary
task/Workspace bypass of a held strategy allocation. It does not replace central
source/checkouts/controller admission or grant unrelated parallel execution.

Before restore call `strategies.beforeRestore()` (deny mutations, clear timers,
drain pending operations). Inside the existing restore writer call
`mergeStrategySafety(restored,current)` alongside Workspace/session/Budget safety.
After owner recovery call `strategies.afterRestore()` (recover then reopen only
the local mutation gate). No retained Owner or deadline timer is resurrected.
On ordinary process startup call `strategies.recover()`. Recovery never dispatches;
in-flight claims become unknown/review-required and cannot be retried. Reconcile
only observes canonical owners. Stop persists first, invokes exact Workspace
Stops or sessionRoute cancellation plus exact sessionRoles child command Stops.
Deadline timer retains the opaque Owner action, requests the same exact Stops,
and cannot dispatch. A failed/expired Owner Stop remains visible as pending;
root shutdown/recovery Stop authority must retain its existing owner policy.
Close strategies before canonical owners/store. The timer is process-local;
restart never revives a pending stage or its native authority.

## API inputs

Every input includes projectId. Mutations also need a globally unique operationId.
Exact operation replay returns the retained receipt; different input under an old
ID rejects. Unknown response/restart/concurrent calls never replay execution.

- state: `{projectId}`.
- create: `{projectId,operationId,mode,objective,stages?,supervisor?,limits,
  rubric?,requiredCapabilities?}`.
- advance: `{projectId,operationId,strategyId,expectedRevision,stageId}`.
- reconcile/stop: `{projectId,operationId,strategyId,expectedRevision}`.
- feedback: common + `{stageId,text}`; must name an actual terminal attempt.
- select: common + `{stageId,reason,rubricEvidence:[{criterion,checkId,note}]}`.

Modes: `supervisor`, `fan-out-fan-in`, `router-specialists`, `generator-verifier`,
`dag`, `independent-candidates`. Worker stage:
`{id,workspaceId,conversationId,dependsOn:[],purpose}`. Purpose is work/generator/
verifier/candidate/specialist; each task and Workspace is distinct. Existing
approved tasks, bots and session assignments are mandatory. No API creates tasks,
credentials, tools, roles or Workspace checkouts.

Supervisor: `{taskId,conversationId,children:[{conversationId,botId}]}`. Existing
orchestrator task and exact reviewed children; native parent performs dynamic
decomposition/prompting/synthesis. Fixed list iteration is not used as supervisor.

Limits: `{maxAttempts:8,maxConcurrent:2,maxMs:300000,
reportedCost:{unknown:'block'|'allow',maxAmount:null,currency:null}}`. Ceilings:
64 total, 16 concurrent, 10s–15min fixed total deadline. Existing Workspace and
Budget ceilings remain authoritative. Missing reported cost is unknown. Reported
caps narrow continuation but cannot guarantee a hard in-flight remote spend cap.

Fan-out joins actual terminal references. DAG rejects cycles and requires exact
completed dependencies while preserving canonical task dependencies. Reviewer is
a distinct bot with existing reviewer/tester role and receives exact generator
output/check references; its narrative is never trusted QA. Workspace.check owns
the deterministic check; model self-report cannot create one. Candidate selection
requires all candidates terminal and selected run completed + actual passing
Workspace check, fixed rubric coverage and explicit authenticated Owner reason.
Selection never enqueues, integrates or merges. Router requires authenticated
fresh actual provider catalog/options/capabilities and the existing scoped role;
it executes the already configured route, and never silently changes a model.

## Source/design qualification

Read the lead research worker's pinned primary source register at
`docs/research/agent-strategies-20261126.md` (lead commit 24d8cf9). Design/pattern
reference only; no CrewAI, LangGraph or AO code/runtime adoption. Native claims
are limited to existing canonical owner contracts.

Impeccable Operate context, new-work and craft-floor were read. Existing VS Code
tokens/Field/Heading/Badge/Json forms are reused. Workbench hierarchy: choose mode
and exact allocations, inspect saved strategy, dispatch eligible stages, inspect
joins/feedback, select evidence or Stop. Direction taken from explicit delegated
brief; no nested reviewer was permitted. Setup drift was observed and not repaired.

## Verification and outstanding qualification

Focused serial tests use actual canonical SQLite, Git Workspaces, role assignments
and Budget ledger. Native transport and host strategy hook wiring in worker tests
are explicitly INJECTED; no live provider/native execution claim. The supervisor
test uses actual sessionRoute intent/reservation plus an explicitly injected
ordinary parent/child lifecycle; it does not qualify private native attestation.
No fixture session bypass or native claim is exported into product code.

Commands (run serially; no heavy native job/full suite/expensive build):

```powershell
node --test --test-concurrency=1 tests/strategies.test.mjs tests/strategies-supervisor.test.mjs
node tests/strategies-ui.mjs
node --check app/strategies/service.mjs
node --check app/strategies/context.mjs
git diff --check
```

The backend checks cover real isolated fan-out, exact joins and usage unknown;
concurrency/replay; accepted/unobserved response loss; actual SQLite reopen and
restore safety; DAG cycles/exact predecessor results/checks; separate generator/
reviewer findings/feedback without QA; fresh catalog-backed specialist decision;
candidate fixed rubric/actual checks/explicit Owner selection with no merge;
scoped authority/stripped contexts; Stop and role drift during async setup;
total/concurrent/cost limits; supervisor exact parent/child envelopes, observed
decisions and bounded exact child Stops; and beforeRestore/afterRestore gates.

Results: full serial suite **12/12 PASS**, then final targeted checks **2/2**
(child-role wording + exact Stop/claim release) and **3/3** (DAG exact dependency,
new actual failed-diff blocker, generator/verifier). This covers **13 distinct
backend cases**. The unchanged serial command above now includes all 13. Final
candidate-selection check was rerun after the current-source evidence fence.

Actual production JSX/CSS Playwright pass: **PASSED**. It renders all six mode
setups and selected explanations; runs candidate creation, isolated execution,
actual checks, reconciliation and explicit Owner selection; proves unknown HTTP
outcome survives reload without send, then exact Stop. Thai-default/English,
labels/keyboard and widths 320/375/414/768/1280 pass with zero browser exceptions.
No production route, listener or manifest was written. A disposable Vite
test listener is closed in finally; the production component uses existing API
helpers. Installed root node_modules were reused through an ignored worktree
junction; no install/lock write.

Initial browser runs used Vite's default ignored `node_modules/.vite` cache via
that junction. The final harness explicitly sets `cacheDir` under its disposable
capture directory to keep subsequent dependency-cache writes outside the shared
dependency tree. No dependency install or shared-cache deletion was performed.

Final production-component captures (opened/inspected at desktop/mobile):
`%TEMP%/forge-six-strategies-ui-G9hiGQ/` contains en-candidate-selection.png,
th-mobile-selection.png and evidence.json. Exact refs stay in expandable details;
the main flow shows terminal count, actual check status and unknown cost. Draft
selection retains its reviewed revision; refresh cannot silently authorize newer
evidence. Mechanical Impeccable detector returned `[]`. No integrated main mount,
all-theme contrast audit, native attachment or external provider is certified.

Remaining root integration: all hooks above, authenticated route/CSRF, parent and
child canonical projections/native qualification, navigation and integrated app
verification. Missing live accounts and HOME_UAT_NOT_RUN are separate from those
implementation integration gaps.
