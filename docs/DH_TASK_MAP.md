# DeepSeek Harness: goal, plan, backlog and reuse map

Authority: [Owner addendum](owner/forge-local-complete-20261124-v3/13_DEEPSEEK_HARNESS_ADDENDUM.md).
Observed source pin/HEAD: `4b399c39a6d1479cd84ca591b4d7c88e24d38a96`.
Root package: MIT, `0.2.3-alpha.2`, Node `^24.22.3 || >=26.13.1`.
Current FORGE Node is 24.19.0. Optional runtime compatibility must qualify;
native P0 work continues independently. SAFETY.md says unaudited developer preview.

The active goal is still FORGE Complete Local v3 with all Owner additions. Extend
G0–G6 rather than restart. FORGE owns planning/tasks/acceptance/evidence/release;
T3 remains the default execution owner. Optional DSH stays disabled until qualified,
with explicit selection and no fallback after uncertain external dispatch.

| Task | Existing work to extend | Remaining acceptance / executable work |
|---|---|---|
| DH-01 P0 | Control/connection services | Scoped typed plugin registry, dependency/version checks, lifecycle and Settings Plugin Manager. Isolated worker assigned. |
| DH-02 P0 | Adaptive + Assistance selection, scoped MCP policies/profiles | Negotiate and persist task instructions/permitted schemas/capabilities; enforce independent backend admission. |
| DH-03 P0 | SQLite receipts, AG-UI native feed/replay/recovery | Complete session/message/tool identity across conversation/adapters; distinguish recovered state from owned process recovery. |
| DH-04 P0 | Versioned prompts and artifact provenance | Provider-aware context budget, permitted output spill/retrieval and critical-fact-preserving compaction; respect native context owner. |
| DH-05 P0 | Approved plans/DAG and bounded loops | Durable goal revisions, measurable progress/blockers/pause/resume, observed token/cost/time/attempt limits and unchanged-failure stopping. |
| DH-06 P1 | Canonical boards/team/handoffs | Atomic task checkout and isolated parallel coding qualification; advisory scope is not a sandbox. |
| DH-07 P1 | Default T3 and optional ACP route | Qualify exact SDK/profile/stdio approval/cancel/restore/cleanup in isolated runtime before enabling DSH adapter. |
| DH-08 P0 | Exact per-route catalogs/options/stale state | Preserve original source timestamp, distinguish provider/local/cache/live/timeout, show capabilities and discovery errors. |
| DH-09 P0 | Scope/revision/MCP/lifecycle regression suites | Plugin/context/goal/adaptor permission/isolation/disposal/replay tests; fixture/runtime/live evidence separate. |

All source paths below are relative to the pinned upstream. This map copies no
source. Verify each package's license before directly adopting code.

| Reuse | Source paths | Integration target / risk / verification |
|---|---|---|
| REFERENCE | `vendor/cordis/{package.json,src/index.ts}`, `packages/extensions/cordis-host-runner` | Native `app/plugins`; avoid framework rewrite, test graph/version/disposal semantics. |
| ADAPT pattern | `packages/compaction/{compaction,compaction-basic,compaction-tool-result-pruner}` | FORGE context service; immutable evidence independent of summaries, deterministic critical-fact and approval preservation tests. |
| ADAPT pattern | `packages/llm/token-meter` | Observed usage/context budgets; unknown cost/usage remains unknown, never estimated as actual. |
| REFERENCE | `packages/context/session-reference` | Scoped spill handles in canonical records; hash/scope/restart/tamper checks. |
| REFERENCE | `packages/team/{agent-team,tool-agent-team}` | Canonical task checkout/Team Room; no competing board/database. |
| REFERENCE | `packages/client/ui-model-selection` | Existing model GUI; exact IDs/options/source/freshness/error states. |
| ADAPT pending qualification | Official `@deepseek-ai/dsh-sdk-client` + SDK profile; exact package/version inspection pending | Disabled optional adapter; Node/platform/approval/process boundaries must qualify without paid startup calls. |
| DEFER optional | Office Kit, programmatic tool calls, persistent-job extensions | Only fill demonstrated gaps in Univer/WordCraft/PdfCraft; avoid duplicate engines. |

Backlog: finish current provider/MCP/governance/strategy integration; DH-01/02
registry and scoped assembly; DH-04/05 context/goals/observed budgets; DH-03/08/09
integrated Windows regression; qualify bounded DH-06/07; full no-code release checks.
Research and fixtures are not runtime/live qualification. IMPLEMENTATION_INCOMPLETE
and HOME_UAT_NOT_RUN remain explicit.
