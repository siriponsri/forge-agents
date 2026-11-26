# FORGE: six selectable agent strategies — bounded source mapping

Inspection date: **26 November 2026 (Asia/Bangkok)**. FORGE baseline:
`378466061e575ffd3b429f73aaf623f51b5396fb`, branch
`t3/map-agent-orchestration-modes`, isolated research worktree.
Requirements: [selectable strategies](../requirements/AGENT_STRATEGIES_AND_LANDING.md),
[active owner brief](../owner/forge-local-complete-20261124-v3/00_START_HERE_TH.md)
and [full-product prompt](../owner/forge-local-complete-20261124-v3/prompts/START_FULL_PRODUCT.txt).

**Recommendation:** implement all six modes as a bounded coordination layer over
FORGE's existing owners. Retain different execution behavior, decisions and
evidence for each mode. Do not install another orchestration runtime. This is
research and a proposed implementation mapping, not evidence that the six modes
have shipped or that live providers passed verification.

## Inspected sources and adoption boundary

The adjacent [machine-readable register](agent-strategies-sources-20261126.json)
records inspected paths, revisions, commit dates, licenses, API symbols and
qualifications. Repository HEADs were resolved through GitHub's commits API;
subsequent repository reads used immutable SHA URLs.

| Reference | Inspected default-branch HEAD | Commit date (UTC) | Root license inspected |
| --- | --- | --- | --- |
| [Agent Orchestrator][ao-repo] | `107103b5859f55b4f26b49161b1704ed3d3ab737` | 2026-11-25 22:45:38 | Apache-2.0, `LICENSE` |
| [Awesome Agentic Patterns][patterns-repo] | `42690fd5270c0927d4073a7f3b21292217846711` | 2026-11-23 21:28:29 | Apache-2.0, `LICENSE` |
| [CrewAI][crew-repo] | `77237aecacb204684a80e334dcd8eefa90d7ee60` | 2026-11-25 18:41:44 | MIT, `LICENSE` |
| [LangGraph][graph-repo] | `3e3dbd42c5329dd404669ccd923c005c814bee3a` | 2026-11-25 20:48:14 | MIT, `LICENSE` |
| [Anthropic: Building effective agents][anthropic] | Web article; published 2024-12-19; read 2026-11-26 | No repository SHA asserted | No reusable code license asserted for article |

Concise source observations:

- **Anthropic:** distinguishes predefined workflows from dynamically directed
  agents; its examples cover chaining, routing, independent parallel work,
  repeated attempts, dynamic worker decomposition, and generation with
  evaluation feedback. It recommends environmental observations and stopping
  limits. The current article explicitly warns that tooling has changed since
  its original publication. Use these definitions as design vocabulary, not a
  current provider-support or comparative-quality guarantee. [Source][anthropic]
- **Agent Orchestrator:** documents per-session worktrees/branches, retained
  session history, shared repository-host effects, and cleanup that preserves
  dirty worktrees. Its current CLI guide describes individual `ao spawn`
  requests; it explicitly says there is no current `ao batch-spawn`. Adopt the
  isolation and visible ownership ideas through FORGE Workspace, without
  starting AO or changing legacy `adapters/ao`. The inspected Go workspace
  adapter exposes `Create` and default-branch resolution methods. [Parallel
  guide][ao-parallel], [worktree guide][ao-worktree], [adapter][ao-api]
- **Awesome Agentic Patterns:** the selected hybrid-coordinator entry is labeled
  `proposed`; typed judgment routing is `emerging`; the self-critique entry
  describes training a judge, not simply running a separate reviewer. These
  are catalogue definitions and editorial labels, not independently verified
  FORGE results. Retain typed decisions and code-controlled gates; do not
  import training, a judgment backend, claimed speedups or the catalogue's
  sample permission model. No broad catalogue audit was performed.
  [Hybrid][patterns-hybrid], [typed routing][patterns-routing],
  [self-critique][patterns-critic]
- **CrewAI:** the inspected `Process` enum contains `sequential` and
  `hierarchical`. Its crew implementation dispatches those processes and
  requires a manager model/agent for hierarchy. This supplies a useful
  manager-versus-fixed-order distinction, not a six-mode FORGE implementation.
  No CrewAI crew, delegation tool or lifecycle owner is adopted.
  [Processes][crew-processes], [enum][crew-enum], [runtime][crew-runtime]
- **LangGraph:** the workflow guide illustrates routing, `Send` worker
  allocation and evaluator feedback; `StateGraph.add_edge` accepts multiple
  prerequisites and waits for all. Its persistence docs separate checkpoints
  from cross-thread stores. Its fault-tolerance docs explicitly state that
  retries can repeat external effects and that missing acknowledgement is
  unknown. Adopt explicit prerequisites, durable identities and evidence joins
  in FORGE's store; do not add a graph/checkpointer runtime or automatic retry
  policy. [Workflows][graph-workflows], [API][graph-state],
  [persistence][graph-persistence], [fault tolerance][graph-faults]

No upstream code, assets, prompts, credentials or datasets were copied.
Repository licenses do not automatically license linked articles, dependencies
or external assets. A later code-copy proposal needs its own file-level review
and required notices. Remote repository instructions were not adopted;
popularity was not treated as capability evidence.

## Existing FORGE owners to preserve

All observations in this section refer to the baseline SHA, before concurrent
implementation work.

| Canonical owner | Existing authority and safe strategy use |
| --- | --- |
| [T3 service](../../app/server/t3.mjs) | Sole task-run reservation and native turn path; captures exact run/attempt, selected route, profile and contexts. Rechecks admission after asynchronous setup and at native dispatch. The strategy coordinator calls this owner through its qualified facade; it does not create provider turns. |
| [Conversation](../../app/providers/conversations.mjs) | Owns chat sends, bindings, exact provider run association, reconcile and Stop. A session prompt must still use this owner and its Budget/workspace checks. Conversation advice is not an isolated file-worker allocation. |
| [Session route](../../app/server/session-route.mjs), [roles](../../app/server/session-roles.mjs), [tools](../../app/session-tools/contract.mjs) | Owner-reviewed intent and child memberships are bound to one live parent attempt. The native manifest has only `session_children` and `session_prompt`. Roles are advisory; they do not approve plans, spend, tools or checkout access. |
| [Workspace](../../app/workspaces/service.mjs), [context](../../app/workspaces/context.mjs), [contracts](../../app/workspaces/contracts.mjs) | Owns isolated checkout identity, once-only start, capacity, actual checks and exact-head review/integration queue. A worktree separates files; it is not an OS security sandbox. |
| [Goals](../../app/goals/index.mjs), [evidence](../../app/goals/evidence.mjs) | Owns goal claims, bounded progress, criterion verification, independent authenticated QA and Owner review. Reuse criteria/evidence semantics; do not mark a Goal passed from a strategy summary or run a second active Goal controller over its task. |
| [Budget](../../app/budgets/admission.mjs) | Reserves exposure against canonical attempts and validates the current policy at dispatch. Unknown usage/cost remains unknown. Strategy limits may narrow admission but cannot override holds, currency checks or policy. |
| [Research](../../app/research/runner.mjs), [component runner](../../app/research-components/runner.mjs), [native owner](../../app/research-native/owner.mjs) | Provides bounded experiments/compositions and independently attributed results under its existing admission. Reuse result/provenance concepts for comparisons. Six GUI modes are product workflows, not permission to start benchmarks, train models or borrow Research's native authority. |
| [Assistance selection](../../app/assistance/selection.mjs), [handoff](../../app/assistance/index.mjs) | Retains reproducible role/model selection and explicit reviewed feedback. Policy quality/cost ranks are owner classifications, not measured superiority or prices. Can inform a specialist proposal; its execution context is not implicitly composable with Workspace. |
| [Adaptive loop](../../app/adaptive/loop.mjs), [evidence](../../app/adaptive/evidence.mjs) | Retains skill/harness decisions, bounded attempts and explicit revision feedback. Deterministic artifact/receipt checks are useful evidence primitives; model prose does not become a trusted verifier receipt. |

## Six functional GUI mappings

The following are proposed bounded behaviors, not new provider APIs. Keep the
existing Assistance, Adaptive, Goals and Context screens available alongside the
six-mode selector.

| Selectable mode (Thai / English) | Executable mapping and retained result | Material gap / acceptance condition at baseline |
| --- | --- | --- |
| ผู้ควบคุมและผู้ช่วย / Supervisor — Orchestrator–Workers | Main agent proposes a task-specific decomposition within approved work; Owner reviews the child set/scope. Execute the parent with `sessionRoute.createIntent/start`; send reviewed child prompts through the exact-attempt session tools and Conversation. Retain parent reasoning, child commands, actual outcomes and a review/synthesis record. Additional children or expanded scope require a new reviewed intent. | Fixed preselected tasks alone do not establish dynamic decomposition. Baseline child views expose IDs/status/model but not terminal result content. Add bounded read-only terminal assistant-result/evidence projection on replay of the same `session_prompt`, with unchanged two input schemas and no new dispatch. Retain original parent binding after it ends; do not remint live tool authority. Do not call parent completion or linked child commands successful synthesis. |
| แยกงานขนานและรวมผล / Parallel fan-out / fan-in | Select independent approved task allocations, each with its own ready Workspace and immutable base. Claim each stage before `Workspace.start`; admit only within Workspace/provider ceilings and Budget. Reconcile all exact attempts into an evidence manifest; synthesize from those records. | Need strategy-specific claims and an all-required-results join. An unresolved, failed or stopped branch must remain visible and block a successful required fan-in. Promise completion, last visible chat message or a returned run ID is insufficient. Never share writer checkout ownership. |
| เลือกผู้เชี่ยวชาญ / Router + Specialists | Persist input classification, eligible specialist roles/capabilities, exact connection/model/options, decision reason and deterministic tie-breaking. Owner reviews the selected allocation; execute through its existing Workspace/T3 or Conversation owner as applicable. | Need reproducible specialist decision and dispatch fence. Assistance's policy selection may inform the proposal, but changing a bot label does not change actual route/permissions. Missing, stale or unsupported catalogue routes require setup; never silently choose another provider. |
| ผู้สร้างและผู้ตรวจ / Generator + Verifier | Generator produces an exact committed head/artifact. A separate reviewer task/session in its own allocation inspects that pinned output and records reproducible findings. Host deterministic checks remain separately attributed. Owner reviews findings and either accepts or supplies bounded feedback for a fresh repair allocation. | Need producer-to-reviewer input provenance and distinct run/attempt/workspace identities. Separate role names or two prompts in one attempt are insufficient. A model reviewer is still a model reviewer; its verdict cannot mint trusted verification, independent human QA or Owner approval. |
| ลำดับงานและเงื่อนไข / Sequential pipeline / DAG | Persist explicit stage dependencies and reuse canonical task dependencies. Reject cycles before claims; release stages in a stable order only when prerequisites have the declared terminal evidence and canonical approval state. Run deterministic checks through existing host check owners when sufficient. | Domain task cycle validation already exists; the missing part is stage-level persisted release/evidence behavior. Do not mutate a failed/unknown task to `done` to unlock a stage. No arbitrary saved shell/eval executor is justified by a “code-only” step. |
| ทางเลือกอิสระและคัดเลือก / Independent candidates + selection | Create distinct approved candidate tasks and worktrees from a recorded comparable base/input. Retain shared rubric, candidate evidence, usage, unknown costs and explicit supported selection with reason. Keep unselected work. Selected changes enter the existing Workspace review/integration queue. | Same canonical task cannot own concurrent candidate attempts (`TASK_BUSY`). Need distinct task IDs, comparable evidence and a separate selection record. Do not expose one candidate's solution to the other during generation. Selection never merges or discards work automatically. |

The supervisor's existing Conversation children share the canonical root
workspace and its admission serialization. They may provide bounded supervised
advice; they must not be advertised as parallel isolated writers. Isolated
implementation work belongs to Workspace. Combining the two requires an
explicit qualified composition, not a role prompt.

## Concrete coordinator and feedback design

This is a proposal for the lead-owned contract. The implementation owner should
choose exact field names once, rather than create separate stores per mode.

1. Persist strategy revision, selected mode, project/approved plan, stage/task
   IDs, dependency list, role/route pins, immutable input references, limits,
   absolute deadline, expected evidence and selection policy. Keep only
   references to canonical entities.
2. Before effects, atomically retain a stage claim and immutable operation
   identity. Bind strategy revision, stage, task, Workspace or exact
   parent/child command, profile/role/route snapshot and dependencies to the
   request. A host-only context cannot be supplied as authority by HTTP/model
   JSON.
3. Validate that binding inside canonical reservation **and immediately before
   dispatch**, including after awaited setup. Invoke the validator even when
   a caller omits strategy context, so a held allocation cannot bypass its
   owner via an ordinary start request. Replay must compare the retained
   request/context; mismatched reuse fails.
4. Dispatch exactly once through Workspace/T3 or sessionRoute/Conversation.
   Reconcile reads existing exact identities; missing responses, ambiguous
   runs, crashes and restart become `unknown`, never proof of non-dispatch.
   Do not allocate a replacement operation or release a held checkout to
   “retry” an unknown effect.
5. Fan-in records one entry per required allocation: strategy/stage and
   operation IDs, canonical run/attempt, provider identity where observed,
   terminal status, source head/artifact digest, actual check/receipt IDs,
   reviewer provenance and usage qualification. Bind the aggregate to those
   entries; a summary is additional model output.
6. Store feedback as a separate reviewed record naming the **source**
   generator/reviewer/check attempt and exact output, plus the **target**
   task/allocation, recipient role and expected revision. Never write it into
   another candidate's task. Preserve the original output and findings;
   content edits invalidate the old review. A completed Workspace is
   once-only: repair uses a fresh reviewed allocation/base, not a second
   start on the same Workspace.
7. Selection names an eligible candidate and its exact checked head/evidence
   under the retained rubric. Require the supported explicit selector
   (bounded initial mapping: authenticated Owner), with a reason and stable
   operation identity. Defer merge to exact-head Workspace review, enqueue,
   combined checks and final Owner integration approval.

For candidates, total work includes every generator attempt, routing, reviewer,
synthesis and selection work. Show candidate count, concurrent ceiling,
per-attempt holds, observed usage/cost by currency and unknown amounts.
Duplicate work is a deliberate tradeoff; no promised speed, savings or quality
gain follows from choosing the mode. Assistance ordinals must not be presented
as monetary quotes.

## Stop, recovery and present admission limits

- Retain mode-level Stop before awaiting provider setup. It prevents new stage
  release and invalidates final admission. Stop every exact Workspace/run or
  retained child command; supervisor cancellation must cover the parent and
  existing child commands. `sessionRoute.cancel` alone stops the parent, not
  every child. Report requested versus observed terminal Stop separately.
- On shutdown/restart/restore, preserve consumed operation IDs, claims,
  contexts, exact run associations and unresolved Budget holds. Reconcile
  existing effects. Do not revive in-memory approvals, expired native leases,
  revoked memberships or restored pending stages automatically. Re-review
  cannot authorize redispatch of a consumed identity.
- Baseline `Workspace.assertNoMixedControllers` rejects independent
  Assistance/Adaptive/Goal contexts and conversation IDs, and blocks active
  conflicting controllers. Use their decisions/evidence as reviewed inputs;
  do not concatenate their contexts or weaken those guards.
- Guarded native profiles currently require `opencode2-api`, pinned T3
  `59651c1761f6c63e9b6056839067066968e6a406` and OpenCode
  `6f0514052a3c859894ad01bb14cc14dda1e44b96`, binary hashes and current
  attestation. Supervisor admission additionally checks its exact two-tool
  manifest and native parent turn. A provider catalogue entry or role label
  does not prove that route supports these native tools.
  [Profile](../../app/guarded-runtime/profile.mjs),
  [session qualification](../../app/server/session-route.mjs).
- Generic Adaptive artifact hashing resolves paths under `project.workspace`.
  It does not by itself establish isolated-worktree artifact provenance.
  Workspace's `check` binds run/attempt, clean head, base and evidence digest;
  use that owner for checkout changes. A no-change reviewer may retain
  canonical terminal findings without pretending it produced an implementation
  commit, but independent success still requires supported checks.
- No change to `bootstrap/payload`, the portable manifest, legacy `runtime/`
  or `adapters/ao` is needed. Do not activate prototypes or publish anything.

## Implementation acceptance and evidence status

At the baseline, `Strategies.jsx` has Assistance, Adaptive, Goals and Context
tabs; it does **not** implement the six-mode coordinator/selector.
Existing task dependency checks, isolated Workspace lifecycle, session tools,
Budget and evidence primitives are substantial foundations, not proof of the
new mode behavior.

The implementation needs a versioned coordinator record, authenticated API/UI
actions, canonical reservation/final-dispatch hooks, mode-specific validation,
read-only exact child result aggregation, explicit selection/feedback, and
recovery/restore/shutdown wiring. Lead owns those shared seams. The accepted
child projection should work after native parent qualification ends without
restoring permission to send new prompts.

Developer acceptance should cover these concrete cases:

| Mode / boundary | Meaningful check |
| --- | --- |
| Supervisor | Task-specific main-agent proposal and exact reviewed children; terminal result projection after parent ends; same prompt replay causes no send; parent plus all retained child commands receive Stop. |
| Parallel | Two distinct tasks/worktrees admitted within ceilings; each observed run/attempt included once; failed/unknown branch blocks successful fan-in; duplicate checkout/task ownership rejected. |
| Router | Identical snapshot yields stable specialist selection/reason; stale catalogue, changed route/model/options, missing capability and unavailable owner block admission rather than silently reroute. |
| Generator + Verifier | Distinct producer/reviewer attempts; reviewer sees exact producer output; stale output and self-issued “pass” cannot satisfy independent checks; feedback targets only its reviewed repair allocation. |
| DAG | Cycles rejected; stages release only after exact required evidence and canonical dependencies; failed/unknown/stopped prerequisite stays blocking; deterministic steps use existing host owners. |
| Candidates | Generation isolated; same base/rubric retained; duplicate-work exposure shown; unsupported selection or stale evidence rejected; explicit selection causes no merge. |
| Shared recovery | Concurrent advance, changed context, stripped context, lost reply, Stop during setup, crash/restart and restore never create a second effect or revive a consumed claim. |
| GUI | Thai-default/English labels and setup, selected-mode explanation, actual run/stage/evidence links, actionable blocked/setup state, reconcile and Stop visible; preserve current strategy tabs. |

**Evidence status:** source/API/license reads and FORGE code inspection only.
No native provider execution, accounts, official benchmark run, model-quality
comparison or home UAT was performed. Mode gaps are
`IMPLEMENTATION_INCOMPLETE_AT_BASELINE`; missing credentials/live routes are
separate `LIVE_NOT_RUN` conditions; home testing is `HOME_UAT_NOT_RUN`.
These research files do not certify later implementation commits.

[anthropic]: https://www.anthropic.com/research/building-effective-agents
[ao-repo]: https://github.com/OrchestratorInc/agent-orchestrator/tree/107103b5859f55b4f26b49161b1704ed3d3ab737
[ao-parallel]: https://github.com/OrchestratorInc/agent-orchestrator/blob/107103b5859f55b4f26b49161b1704ed3d3ab737/frontend/src/docs/content/guides/parallel-issues.mdx
[ao-worktree]: https://github.com/OrchestratorInc/agent-orchestrator/blob/107103b5859f55b4f26b49161b1704ed3d3ab737/frontend/src/docs/content/plugins/workspaces/worktree.mdx
[ao-api]: https://github.com/OrchestratorInc/agent-orchestrator/blob/107103b5859f55b4f26b49161b1704ed3d3ab737/backend/internal/adapters/workspace/gitworktree/workspace.go
[patterns-repo]: https://github.com/nibzard/awesome-agentic-patterns/tree/42690fd5270c0927d4073a7f3b21292217846711
[patterns-hybrid]: https://github.com/nibzard/awesome-agentic-patterns/blob/42690fd5270c0927d4073a7f3b21292217846711/patterns/hybrid-llm-code-workflow-coordinator.md
[patterns-routing]: https://github.com/nibzard/awesome-agentic-patterns/blob/42690fd5270c0927d4073a7f3b21292217846711/patterns/non-generative-judgment-routing.md
[patterns-critic]: https://github.com/nibzard/awesome-agentic-patterns/blob/42690fd5270c0927d4073a7f3b21292217846711/patterns/self-critique-evaluator-loop.md
[crew-repo]: https://github.com/crewAIInc/crewAI/tree/77237aecacb204684a80e334dcd8eefa90d7ee60
[crew-processes]: https://github.com/crewAIInc/crewAI/blob/77237aecacb204684a80e334dcd8eefa90d7ee60/docs/edge/en/concepts/processes.mdx
[crew-enum]: https://github.com/crewAIInc/crewAI/blob/77237aecacb204684a80e334dcd8eefa90d7ee60/lib/crewai/src/crewai/process.py
[crew-runtime]: https://github.com/crewAIInc/crewAI/blob/77237aecacb204684a80e334dcd8eefa90d7ee60/lib/crewai/src/crewai/crew.py
[graph-repo]: https://github.com/langchain-ai/langgraph/tree/3e3dbd42c5329dd404669ccd923c005c814bee3a
[graph-state]: https://github.com/langchain-ai/langgraph/blob/3e3dbd42c5329dd404669ccd923c005c814bee3a/libs/langgraph/langgraph/graph/state.py
[graph-workflows]: https://docs.langchain.com/oss/python/langgraph/workflows-agents
[graph-persistence]: https://docs.langchain.com/oss/python/langgraph/persistence
[graph-faults]: https://docs.langchain.com/oss/python/langgraph/fault-tolerance
