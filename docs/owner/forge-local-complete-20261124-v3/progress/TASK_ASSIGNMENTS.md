# Task Assignments

## Active assignments — 2026-11-24

### Owner UI/landing additions (latest steering)

| Task | Owner | Executable scope | State |
|---|---|---|---|
| UX-01 VS Code themes | New isolated theme worker | Named builtin palettes, picker, theme-aware global styles; default Dark Modern | IN_PROGRESS |
| UX-02 Workbench redesign | Lead | Overview, shell hierarchy, bundled type, preference persistence, live Univer theme | IN_PROGRESS |
| WEB-01 Landing | New isolated landing worker | TH/EN landing inspired structurally by orca.dev/t3.codes/paseo.sh, actual screenshot, download UI | IN_PROGRESS |
| DIST-01 Windows/macOS downloads | Lead | Source+launcher ZIPs, SHA256/commit metadata, download API, platform setup | IN_PROGRESS; macOS live NOT_RUN |

Earlier workers A/B completed and were integrated as1b4faad/073960f.
Lead combined GUI smoke and actual native report GUI generation/rotation/download
passed; sanitized report evidence is in `docs/evidence/report-gui-smoke.json`.
The redesign preserves these flows; regression tests must be rerun on the new UI.

Base9d0a90f, shared API in `app/CONTRACTS.md`. Lead owns integration branch,
server/schema/manifests/lockfiles/progress. Model for all: codex gpt-6.1-sol,
reasoningEffort=xhigh. Isolated worktrees prepared by delegate_task, not shared writes.

| Worker | Branch | Ownership | State |
|---|---|---|---|
| A GUI/office | t3/forge-gui-univer-workbench | app/web, docs/worker-ui.md | Running; own browser/persistence evidence reported; lead integration pending |
| B report engines | t3/implement-report-engines | app/reports, tests/reports*, docs/worker-reports.md | Running; actual Windows engine evidence reported; lead integration pending |

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
