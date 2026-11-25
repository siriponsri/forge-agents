# Research / Evaluation worker handoff — 2026-11-25

ขอบเขต: RES-01–10 infrastructure ตาม Owner addendum ใน lead checkout
`docs/requirements/RESEARCH_EVALUATION_ADDENDUM.md` (read-only input).
งานทั้งหมดอยู่ใน `app/research/**`, `app/web/src/ResearchLab.jsx`,
`app/web/src/research-lab.css`, `tests/research*.test.mjs` และเอกสารนี้เท่านั้น.
ไม่ได้แก้ shared App/main/contracts/migrations/lockfiles/progress หรือ protected
portable/runtime/credentials/prototype paths. ไม่ push/deploy/เรียก model API.

## Implemented and qualified locally

| Requirement | Implementation | Qualification |
|---|---|---|
| RES-01 | Versioned immutable experiment configuration and per-cell trial manifest; bounded matrix/repetitions; distinct managed trial directories; isolated canonical workspace references for agent mode | Real SQLite, real Node/file operations, restart/exact replay; no second task or inference store |
| RES-02 | `static`, `initial-route`, `rule-adapt`, `evidence-guided` policy decisions; versioned trace | Actual deterministic recovery decisions from independent trial observations; initial route uses declared capabilities; no learned routing claim |
| RES-03 | Immutable named switches for memory, skills, adaptation, staffing and optional verification; mandatory security/final validators remain enabled | Static vs adaptive fault recovery tested; disabled adaptation actually prevents recovery; other local switches are explicit policy fixture declarations, not measured memory/skill/staffing effects |
| RES-04 | Extensible versioned adapter registry; table-aggregation CPU executor and LongMemEval-format JSONL executor/independent checker | Two genuine executable local fixtures; four public source registrations are explicitly non-executable and cannot be selected for execution |
| RES-05 | Deterministic/held-out/external-state/artifact checks; bounded regular-file reads, hashes, input/checkpoint integrity | Real artifact and input tampering rejected. Agent reports/HTTP booleans cannot establish success |
| RES-06 | Actual tool/retry/error/outcome/timing/controller/validator observations; authorized owner telemetry bridge | Unknown tokens/cost stay `null`; local provider execution `NONE`; injected lifecycle labelled `INJECTED_T3_NOT_LIVE`; currency totals never silently combine |
| RES-07 | Replayable isolated tool failure, stale external state, session interruption, checkpoint recovery | All four tested; checkpoint survives actual store restart and explicit reconciliation; static policy cannot silently recover |
| RES-08 | Production TH/EN component with forms, bounded matrix, trial monitor/actions, evidence, comparison/ablation fractions and JSON download | Component compiled and exercised with real headless Chromium/React/SQLite via injected HTTP wire; mobile labels/project reset checked; shared App mount belongs to lead |
| RES-09 | Authenticated service runner and standalone explicit fixture CLI; JSON exports/pins; re-imported pinned export refuses changed implementation | Real child-process CLI; separate dev/test identities/generators/pins; private reference values are not included in state, prompts, traces or exports |
| RES-10 | Versioned observations/actions and supervised/contextual-bandit data contracts | Interface only, no learner/training, no RL, no outcome/superiority claim |

The local executors run fixed bounded JavaScript/file transforms. They accept no
shell command, module path, provider call, user code, arbitrary network target or
filesystem root. File separation is **not an OS sandbox**. `maxMs` is checked
before/after fixed operations; native turn/token/spending enforcement remains
with the existing runtime/Budgets owners. Private dev/test reference generation
is server-only and never sent through model context. This small synthetic fixture
split is not a public dataset or a scientific contamination guarantee.

## Exact integration contract for lead

```js
import {
  createResearchService, RESEARCH_HTTP_METHODS, dispatchResearchRequest,
  buildResearchContext, admitResearchTrial, researchContextPolicy,
  assertResearchRestoreAvailable, mergeResearchSafety,
} from '../research/index.mjs';

const research = createResearchService({
  store, dataDir,
  authorizeOwner: authority.goalAuthorize, // (request, opaqueCaller) -> human Owner
  executionOwner, // optional; agent mode fails closed without all required methods
});
await research.recover();
```

`ResearchLab` props are exactly `{t,state,projectId,run,busy}`. The component uses
`run(async()=>request(...))` and imports the shared `request`; there is no API
callback argument. Add `research` to shared api.mjs authenticated-CSRF service
families. Mount under the existing authenticated no-code application. All
Research HTTP requests, including private reads/export, should pass the existing
local-origin/session/CSRF layer; route POST only to the explicit allowlist:
`state, create, reserve, execute, reconcile, validate, stop, compare, export`.
`dispatchResearchRequest(service,method,input,opaqueCaller)` rejects unlisted
methods, extra fields and bodies above 64 KiB. No model-facing MCP route exists.

Agent `executionOwner` is trusted host code, never deserialized input:

```js
{
  version: 1,
  async dispatch({projectId, trialId, experimentId, taskId, workspaceId,
                  runOperationId, researchContext, policy}, opaqueCaller) {},
  async reconcile({projectId, trialId, workspaceId, runOperationId, runId}, opaqueCaller) {},
  async stop({projectId, trialId, workspaceId, runOperationId, runId}, opaqueCaller) {},
  async telemetry({projectId, runId, attemptId}, opaqueCaller) {},
  async validate({projectId, trialId, runId, attemptId, manifestDigest, dataset}, opaqueCaller) {},
}
```

`dispatch` must reuse the sole canonical Workspace/T3 dispatch. Lead agreed
host-only `workspaces.start(input,caller,{researchContext})`; it must never be
accepted from an HTTP body. Workspace owns task/worktree creation/base/locks;
Research reserves a distinct ready workspace per trial and fixes
`runOperationId = workspace-run:${workspaceId}`. No project task is created by
selecting/configuring an experiment. `policy` requests existing
Memory/Adaptive/Assistance behavior; it grants no additional authority. Preserve
all existing Goals/Workspace/Compute/Budgets/desktop/controller guards.

Mandatory central checks: `admitResearchTrial(state,input)` in both T3 run
reservation and final pre-launch checks, using canonical input
`{projectId,taskId,operationId,workspaceContext,researchContext}`. It returns the
canonical trial snapshot or `null` for ordinary runs; a bound workspace/run
operation cannot strip its research context. Stopped, expired, foreign,
modified-config, drifted-policy or restored/frozen trials fail closed.

`buildResearchContext(state,{projectId,trialId})` returns:

```js
{version:1, experimentId, trialId, configDigest, manifestDigest, split,
 adapterId, adapterVersion, policyVersion, workspaceId, contextPolicyDigest}
```

`researchContextPolicy` derives the exact project/provider/model route, latest
canonical `context.policy` snapshot (or explicit native-passthrough contract)
and declared components. No Owner/model-provided digest is accepted. The
pre-run immutable manifest contains this **policy** snapshot/digest, not the
run-dependent actual context receipt. A changed policy invalidates admission.

Keep existing `run.contextReceipt` untouched. After actual `prepareContext`,
persist `run.researchContext` plus separate:

```js
run.researchReceipt = {
  researchContextDigest: digest(run.researchContext),
  workspaceId, contextPolicyDigest,
  forgeContextId: run.contextId,
  forgeReceiptDigest: digest(run.contextReceipt),
};
```

Reconcile verifies exact canonical project/task/run/attempt/workspace, actual
`context.version` or `context.passthrough` event bound to run, original context
receipt/event ID, mode/policy ID and the separate digest binding. An unknown
response never redispatches. The service records `reconcile-required`; only
the existing owner can discover/reconcile the acknowledged effect.

Memory-enabled agent reservation requires a FORGE context policy; native
passthrough appends no optional memory and is rejected as
`RESEARCH_COMPONENT_UNAVAILABLE`. Memory-off must suppress the actual Context
`memoryForRun` input **before** launch. Native component enforcement must use
canonical flags, never prompt text. Actual `context.version.memoryGroups` and
`active` memory refs qualify memory use; absent refs record `NEEDS_SETUP`, not
retrieval success. Skills/staffing require actual existing-owner receipts;
current generic research bridge marks them `OWNER_RECEIPTS_REQUIRED`. Their
behavior cannot be claimed from switches alone. A missing owner component
implementation is an **implementation integration gap**, not missing credentials.

`telemetry` returns authorized actual `{tokens,cost,currency}` (unknown `null`).
It must read canonical runtime/Budgets observations, not model text. Local
telemetry has actual operation/timing counts. Unknown accounting is tested
before further agent trial admission; native per-turn caps remain enforced by
their current owner.

`validate` returns only `{evidenceId}`. The ID must reference a canonical
`research.evidence` event with exact `projectId,trialId,manifestDigest,runId,
attemptId,independent:true,status,checks` and
`digest = digest({...event,digest:undefined})`. A passed check must inspect actual
artifact/held-out/deterministic/external state through a trusted independent
validator. The HTTP adapter has no way to inject evidence or telemetry. Export
and comparisons describe recorded check results; use Recheck evidence to inspect
current file bytes. Historical check snapshots are intentionally retained.

Lifecycle: `suspendForRestore`, `afterRestore`, `cancelRestore`, `close`.
`assertResearchRestoreAvailable` guards the pre-run reserved-trial gap, too.
`mergeResearchSafety(restored,current)` returns a merged snapshot preserving
research operations/receipts/acknowledged run IDs and their context events;
restored nonterminal admissions are frozen. It does not migrate task ownership.
Call it alongside existing owner restore merges, not instead of them.

## Sources: verified primary revisions/licenses/protocols

All seven specified references were reachable on 2026-11-25. Exact transport
hashes for 15 primary pages/pinned protocol/license files are recorded in
`app/research/source-verification.json`. No source code or dataset was vendored.

| Source | Immutable pin | License/protocol qualification |
|---|---|---|
| [Harness-Bench](https://arxiv.org/abs/2605.27922v2) | `2605.27922v2` | CC BY 4.0; offline artifact-validated harness comparisons; reference only |
| [Harness design study](https://arxiv.org/abs/2609.20804v1) | `2609.20804v1` | arXiv nonexclusive distribution license; matched component ablations; reference only, no redistribution assumed |
| [HM-Router](https://arxiv.org/abs/2609.32213v1) | `2609.32213v1` | CC BY 4.0; model/harness routing and held-out routes; no learned implementation/training claimed |
| [ToolMaze](https://github.com/Zhudongsheng75/ToolMaze/tree/f8620d841b67a72ac921caee9df87af6ab9befbb) | `f8620d841b67a72ac921caee9df87af6ab9befbb` | License **NOT_AVAILABLE**: no LICENSE/COPYING found in pinned recursive tree. C1–C4/P0–P4 tool-DAG perturbations; source metadata only, reuse blocked |
| [SkillsBench](https://github.com/benchflow-ai/skillsbench/tree/2adce5ab404c0820cb791486f27c44f09df4cfde) | `2adce5ab404c0820cb791486f27c44f09df4cfde` | Apache-2.0 root; nested resources differ. Native task.md/BenchFlow oracle/verifier; Modal default, local Docker optional. Even hello-world verifier installs dependencies/network; not executed |
| [MLE-bench](https://github.com/openai/mle-bench/tree/507f92e1138bb6e40dac5c6ee7a6758e6424bf97) | `507f92e1138bb6e40dac5c6ee7a6758e6424bf97` | Raw LICENSE confirms MIT despite GitHub NOASSERTION. Explicitly excludes external datasets. Competition-specific prepared splits/submission grader; dataset access/terms unqualified |
| [LongMemEval](https://github.com/xiaowu0162/LongMemEval/tree/9e0b455f4ef0e2ab8f2e582289761153549043fc) | `9e0b455f4ef0e2ab8f2e582289761153549043fc` | MIT code; hosted dataset terms separate. question_id/hypothesis output; official evaluate_qa.py invokes a model judge. Local synthetic JSONL adapter is explicitly not official accuracy evaluation |

All four public datasets are currently **NOT_AVAILABLE locally**; installation,
dataset availability, upstream execution and measured outcome remain separate
fields. Public source registrations cannot execute and cannot mint outcome
metrics. Future setup needs explicit per-task data/license/protocol qualification,
bounded existing-owner runner integration and authorization for resources/charges.
No large downloads, benchmark campaign, provider call, GPU/account acquisition,
prototype activation or research improvement claim occurred.

## Verification and commands

**Developer result: 16/16 scoped tests passed**, Node `v24.19.0` on Windows;
all research `.mjs` syntax checks and `git diff --check` passed. This includes
actual junction-escape and hard-linked-artifact rejection. Source checks used
15 primary transport receipts, all available; unavailable ToolMaze license and
all four locally absent public datasets remain explicitly `NOT_AVAILABLE`.

Run the scoped developer suite:

```powershell
node --test tests/research-core.test.mjs tests/research-safety.test.mjs tests/research-ui.test.mjs
```

This uses real Node SQLite, fixed CPU/file operations and real Chromium/React.
T3 lifecycle and independent owner endpoint examples are explicitly injected;
browser HTTP routing is a fixture, not a product-server authentication test.
Dependencies come from the repository's existing pinned install; the worker
used a local ignored node_modules junction to that install without changing it.

Explicit standalone local qualification (JSON on stdout; isolated temporary
SQLite/files retained at the returned `dataDir`):

```powershell
node app/research/cli.mjs --fixture
node app/research/cli.mjs --fixture --config pinned-config-or-export.json
```

The config argument accepts raw version-1 config or this runner's exported
envelope. Pinned exports must match their original config/adapter/data digests
before a new trial starts. For programmatic production headless use, call
`runResearchExperiment({service,caller,projectId,config})` from
`app/research/runner.mjs`; it uses the same authenticated service. The standalone
CLI never opens product state or starts an agent runtime.

## Remaining work and activation

**Implementation integration owned by lead:** authenticated main routes and
CSRF family; App navigation/mount; Workspace host-only third argument; mandatory
T3 admission/final checks/separate receipt; actual Memory/Adaptive/Assistance
component dispatch receipts; production independent validator event writer;
restore/shutdown wiring and production negative tests. These are not proved by
worker injection tests. Unsupported public runner execution remains an explicit
adapter integration gap, rather than executable benchmark metadata.

**Live qualification pending:** no actual agent/model/provider execution,
official public benchmark protocol/score, hosted data terms/access or native
component effect is qualified by this work. None is needed to run the local
qualification command above. No missing credentials are represented as code
completion.

**HOME_UAT_NOT_RUN:** owner must exercise mounted TH/EN configuration → reserve
→ fixed local trial → independent recheck → comparison → JSON download and
restart/recovery in the delivered local application after lead integration.

Next executable task: cherry-pick the worker's scoped commit, bind the exact
seams above in lead-owned files, run production main/session/CSRF and real
Workspace/T3 native-transport negative tests, then synchronize RES acceptance,
backlog and activation guidance. Keep actual model dispatch disabled until those
mandatory identity/path/component/admission tests pass. Publication remains
subject to the active release authorization; this worker has not pushed.
