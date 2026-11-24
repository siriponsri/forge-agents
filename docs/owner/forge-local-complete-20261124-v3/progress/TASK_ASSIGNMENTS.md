# Task Assignments

## Active assignments — 2026-11-24

AS-01 Assistance Strategy / Auto-Model Selection: owner confirmed larger Asst. and
smaller Executor roles. Two routing/assistance-frequency preferences are pending
in the user-input UI; dependent implementation waits for answers. Requirements,
invariants and next executable work are in repository-root docs/ASSISTANCE_STRATEGY.md.
This product task does not alter the development thread/worker model choices.

Owner addition: Paperclip PC-01 source/license audit completed at pinned7d26bdaa;
PC-02 organization/goal context and PC-05 action policy are next separated work.
PC-03 review inbox/PC-04 observed budgets/PC-06 checkout mapped in
reference/research/PAPERCLIP_INTEGRATION_RESEARCH.md. No Paperclip runtime or
integration check is claimed by this audit. Preserve the original G0–G6 objective.

Current continuation: SERVE-01 integrated09fc17e/0cd8cce and lead real GUI PASSED;
STORE-01 integrated998762d/bd0f7be, lead local GUI backup/restore PASSED;
PROTO-01 integrated86515ae, worker actual provider lifecycle and lead HTTP projection
PASSED. Desktop workerfd10045 completed (native/browser actual10/10); lead GUI
integration next. Adaptive worker and remote-compute worker are RUNNING in their
own worktrees. `git worktree list` is authoritative for absolute paths. Lead and
all workers remain gpt-6.1-sol/reasoningEffort=xhigh. No push/main advancement.

### Owner UI/landing additions (latest steering)

| Task | Owner | Executable scope | State |
|---|---|---|---|
| UX-01 VS Code themes | Theme worker + lead | 15 pinned builtin palettes, picker and semantic styles; default Dark Modern | INTEGRATED037ec95/9137a38; source/contrast checks PASSED |
| UX-02 Workbench redesign | Lead | Overview, shell hierarchy, bundled type, persistence, live Univer theme | INTEGRATED10e38aa; responsive/reload/restart PASSED |
| WEB-01 Landing | Landing worker + lead | TH/EN landing, actual screenshot and metadata-backed downloads | INTEGRATEDc44260c/10e38aa; combined browser checks PASSED |
| DIST-01 Windows/macOS downloads | Lead | Source+launcher ZIPs, SHA256/commit, portable rebuilding | IMPLEMENTED7abe954; Windows clean install PASSED; macOS live NOT_RUN |
| SERVE-01 A12/A13 | Serving worker | app/serving/**, tests/serving*, docs/worker-serving.md | RUNNING t3/serving-inference-mcp; weighted REST/MCP parity reported, integration pending |
| PROTO-01 A21/A22 | Protocol worker | t3.mjs/agui.mjs, app/protocol/**, protocol tests and own note | RUNNING isolated worktree; lead HTTP/GUI integration follows |
| STORE-01 A14/A15/A20 | Storage worker | app/storage/**, storage tests and own note | RUNNING isolated worktree; lead HTTP/GUI integration follows |

Earlier workers A/B completed and were integrated as1b4faad/073960f.
Lead combined GUI smoke and actual native report GUI generation/rotation/download
passed; sanitized report evidence is in `docs/evidence/report-gui-smoke.json`.
The redesign preserves these flows; regression tests must be rerun on the new UI.

Base9d0a90f, shared API in `app/CONTRACTS.md`. Lead owns integration branch,
server/schema/manifests/lockfiles/progress. Model for all: codex gpt-6.1-sol,
reasoningEffort=xhigh. Isolated worktrees prepared by delegate_task, not shared writes.

| Worker | Branch | Ownership | State |
|---|---|---|---|
| A GUI/office | t3/forge-gui-univer-workbench | app/web, docs/worker-ui.md | COMPLETED305f16f; INTEGRATED1b4faad; lead core browser/restart PASSED |
| B report engines | t3/implement-report-engines | app/reports, tests/reports*, docs/worker-reports.md | COMPLETED90832f7; INTEGRATED073960f; lead real native suite/GUI PASSED |

Absolute worktree locations discoverable via `git worktree list`; each worker
uses its own temporary runtime data and port. Neither may push main or edit
central progress. Lead reviews scoped commits and tests the combined tree.

## Historical initial assignment template

Initial state was **NO WORKER SESSIONS STARTED BY THIS HANDOFF**.

The integration owner fills assignments after inspecting the checkout and establishing shared contracts. Branch names are proposals until created and inspected. One mutable writer owns each worktree.

| Task ID | Goal and acceptance IDs | Owner / observed model | Branch / absolute worktree | Base commit | Owned paths / interfaces | Dependencies | Status / evidence |
|---|---|---|---|---|---|---|---|
| G0-foundation | Inspect repo, select T3 boundary and define contracts | Lead, to be selected | To be assigned | Unknown | To be mapped | Actual repo access | NOT_STARTED |

## Assignment requirements

Every delegated task needs a concrete outcome, allowed paths, shared-contract restrictions, evidence requirements and a task-specific handoff filename. Distinguish proposed role names from actually running sessions. Start with two independent worker tasks only after their interfaces are sufficiently defined.

The lead owns central status, schema/migration changes and root lockfiles unless it delegates a specific shared file to one worker. Coordinate ports, local state, databases and desktop target controllers separately from Git worktrees.

## Candidate workstreams after shared contracts

These are task proposals, not running workers. Schedule according to available capacity and dependency readiness.

| Workstream | Concrete outcome | Prerequisite |
|---|---|---|
| Protocol | Real T3 harness events and domain snapshots through AG-UI, correct stop/reconcile behavior | Run/attempt/tool/state contracts |
| Office UI | Embedded Univer Sheets/Docs with native persistence, public commands and revision conflicts | Document/asset/command contracts |
| Reports | ReportSpec adapters, WordCraft DOCX/PDF and PdfCraft operations, artifact validation | Source/template/artifact/job contracts |
| Engine packaging | Guided Windows engine/font setup, dependency readiness, clean-clone qualification | Selected native build and adapter interfaces |
| Catalog reliability | Same-provider discovery, freshness and slow-refresh handling in FORGE | Provider instance/lifecycle contracts |

The installed development T3 diagnostic is separately scoped and does not become a prerequisite for all workers. Lead ownership of shared schemas and lockfiles remains unchanged.

## Completion record per task

Record changed files, commits/diff, checks, findings, blockers and integration notes. The lead reviews and merges in dependency order, then verifies the combined tree. Mark integration separately from worker completion.
