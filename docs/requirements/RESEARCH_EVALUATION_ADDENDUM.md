# OWNER ADDENDUM — FORGE Research and Evaluation Infrastructure

Accepted 2026-11-25 from `re_task.md`. Extends the active complete-product goal;
preserves all earlier Owner requirements and release authorization.

FORGE must support product operation and future scientific research:

1. Evidence-guided adaptive agent harness.
2. Evidence-verified cross-harness procedural memory.
3. Budget-aware dynamic multi-agent staffing.

Approved references (availability/version/license/protocol require verification):

- https://arxiv.org/abs/2605.27922
- https://arxiv.org/abs/2609.20804
- https://arxiv.org/abs/2609.32213
- https://github.com/Zhudongsheng75/ToolMaze
- https://github.com/benchflow-ai/skillsbench
- https://github.com/openai/mle-bench
- https://github.com/xiaowu0162/LongMemEval

| ID | Required implementation / acceptance |
|---|---|
| RES-01 | Configurable Experiment Runner: isolated workspaces, repeated trials, immutable configuration, resource limits and reproducible manifests. |
| RES-02 | Static harness, initial routing, rule-based adaptation and evidence-guided adaptive execution under shared contracts. |
| RES-03 | Controlled ablations for memory retrieval, skill selection, adaptation, multi-agent staffing and verification; mandatory security enforcement cannot be disabled. |
| RES-04 | Extensible public-benchmark/custom CPU-friendly AI engineering adapter registry; actual protocol/setup distinctions. |
| RES-05 | Independent deterministic/hidden-test/artifact/external-state validators; agent self-report cannot establish success. |
| RES-06 | Authorized model/tool/error/retry/outcome/token/cost/timing/memory/policy observations, including controller overhead; unknown accounting is not zero. |
| RES-07 | Isolated replayable tool failure, stale state, session interruption and checkpoint-recovery fault scenarios. |
| RES-08 | Research Lab GUI for configuration, monitoring, comparisons, ablation analysis, evidence and export. |
| RES-09 | Headless runner, pinned configs/benchmark versions, separate development/test data, machine-readable results. |
| RES-10 | Interfaces for rule-based policy, supervised routing and contextual bandits; preserve traces for future learning; no RL training without adequate evidence/data. |

Use existing FORGE services/contracts. No competing runtime/task store. Verify
with small deterministic engineering fixtures; label injected provider execution
and real local validators separately. Do not run large benchmarks, incur extra
benchmark API charges, rent GPUs or create CA-EWS/another pilot product.

Architecture: Research Lab → immutable Experiment/Trial manifest → existing
workspace/job/T3/Assistance/Adaptive owners → independent validators → canonical
telemetry/evidence → comparisons/export. Dataset adapters and execution policies
are versioned separately. Development and held-out data cannot silently mix;
fault injection stays in explicitly isolated trial state. Benchmark metadata,
dataset availability, install readiness, execution and measured research outcome
are different qualifications.

Milestones: verify sources/protocols and shared trial contracts; implement CPU
fixture path plus registry/headless runner/policies/ablation/telemetry; mount
authenticated GUI and existing runtime delegation; verify repeated/restarted/
faulted trials, held-out validators and export; synchronize acceptance/backlog/
research activation guide before final release documentation and main push.

P01 also confirmed: implement a **FORGE Guarded Route on T3/OpenCode**, initially
bounded read/propose/text edits, then expand. Native automatic execution stays
unqualified until actual mandatory dispatch/identity/path controls pass negative
tests; source inspection/configuration alone cannot mint enforcement proof.
