# Implementation Log

- Desktopfd10045 ->16ae6c9; lead added actual target setup/readiness/window/lease/
  action/Stop/Take over GUI, hash-verified common screenshot downloads, explicit
  screenshot owner capture in complete bundles and workspace-owned restore. Pinned
  Playwright moved to runtime dependencies; audit0 vulnerabilities. Lead GUI actual
  owned Chromium and UUID/PID-selected native window passed text/click/inspect/PNG,
  blocked-click Stop unknown, and in-flight native wait Take over cancelled. Guest
  live remains NOT_RUN. Screenshot backup/restore downloaded correct PNG bytes.
  Source checks and22 desktop/storage/shutdown regression tests passed before GUI.
  Adaptive272bcca and compute0b1ccd6 completed in isolated worktrees, integration next.

## Serving, storage and native protocol integration — 2026-11-24

- Serving40bf879 ->09fc17e; lead0cd8cce HTTP/GUI. Real weighted Windows LitServe
  REST/MCP GUI, measured latency, result hashes, owned stop/restart passed.
  Detached existing endpoint metadata never kills its remote server (contract test).
- Storageef47cdc ->998762d. Leadbd0f7be adds HTTP/OAuth callback and shutdown
  cancellation;20 storage/shutdown tests pass incl staged resume after service close.
  Lead local GUI two complete backups, manifest-selected independent restore,
  identical downloaded bytes, native resource remap and retention preview pass.
- Protocol4e6d9fe ->86515ae. Actual native read/tool/stream/state and interrupt/
  reconnect evidence preserved; lead startup recovery, live SSE display cursors,
  domain projection subscription, question/permission routes and Run controls added.
  HTTP fixture validates live domain deltas and unsupported frontend result409.
- Integration found ended-SSE write during shutdown; send/heartbeat now guard
  ended/destroyed response and unsubscribe on response close. Regression passes.
- Native/browser workerfd10045 passed actual owned Windows and Chromium10/10;
  real guest NOT_RUN. Lead integration next, followed by adaptive and compute workers.
  Missing provider/chat/MCP/Office implementation and frontend-result contract gap
  remain explicitly incomplete; independent work continues, no product/main release.

## Integrated visual, landing and launcher checkpoint — 2026-11-24

- Lead added no-code browser uploads, bounded saved Sheets range/Docs-text import,
  review before ReportSpec mutation, historical native snapshot/hash lineage at
  generation, TSV table editing, figure/caption/pagebreak forms. Real GUI run
  generated DOCX/PDF with uploaded screenshot + selected range/cached formula
  values, decoded preview and rotation: PASSED (report-gui-j45y7e). Core GUI/Univer
  regression also PASSED (forge-ui-worker-uAua9K). npm test27 passed/2 opt-in skips.
  Native Office drawing upload/insertion remains a separate missing capability;
  report figure upload does not qualify persistent drawings inside Univer.

- Combined GUI1b4faad/reports073960f; fixed real multiline validation0603f71.
  Native WordCraft/PdfCraft13 tests passed, acquisition separately passed.
  Lead GUI: actual DOCX/PDF, decoded PNG preview, verified downloads and rotation
  parent lineage passed after redesign; original core/Univer/Python smoke passed.
- Theme worker529327e/f325689 integrated037ec95/9137a38. Landing7755165 integrated
  c44260c. Lead Overview/fonts/persistence/live Univer theme integrated10e38aa.
 15 VS Code themes select/save/reload/process-restart; responsive320–1440 passed.
- Real app screenshot captured from labelled engineering fixture. Landing actual
  TH/EN download clicks pass byte/SHA/commit checks for both source+launcher ZIPs.
  Windows clean archive install/port/restart/stop passed; native Mac NOT_RUN.
-36ad386 closes this application's HTTP sockets before stopping services. New
  regression covers active SSE plus incomplete preconnected HTTP request and
  reopening the same SQLite data/port; repeat appearance smoke passed.
- Commands: npm run build; node app/vendor/vscode-themes/verify.mjs;
  node app/web/tests/{smoke,report-smoke,appearance-smoke,landing-smoke}.mjs;
  node --test tests/product-shutdown.test.mjs. Sanitized evidence in docs/evidence.
- Serving, protocol and storage workers use isolated branches, actual inherited
  codex gpt-6.1-sol/reasoningEffort=xhigh. Lead integrates shared contracts/HTTP/GUI.
  Next: real artifact-bound REST/MCP serving in the integrated workbench, then
  protocol and storage/recovery integration. IMPLEMENTATION_INCOMPLETE; no push.

## Developer implementation — 2026-11-24

- Inspected efcd132/main/origin/worktrees, owner dirty docs and legacy package;
  no applicable AGENTS.md existed. Created integration branch and scoped v3 docs
  commit9d0a90f. Source/contract map: repository-root `docs/FORGE_ARCHITECTURE.md`.
- Added durable SQLite service, scoped revision commands, Python jobs, artifacts,
  metadata backup/restore, MCP, desktop ownership and actual T3 bridge22bb87c.
- T3 Windows npm loader encountered transient EPERM after executable validation;
  retained MIT source and added bounded atomic rename retry. Actual T3 local OAuth
  PKCE grants only supervised orchestration in FORGE's own isolated control plane.
  No developer app credential/session imported. T3/launcher9857bdd.
- Live read-only provider smoke: gpt-6.1-sol/xhigh, completed expected reply; actual
  thread/run mapped to AG-UI. Sanitized result in `docs/evidence/t3-live-smoke.json`.
- Added catalog slow/failure handling and scoped output Git commit/push with
  disposable bare remote; product tests PASSED. de14a95.
- Commands actually run: `npm test`, `npm run check`, `npm audit`,
  `node tests/live-t3-smoke.mjs`, `git diff --check`. Product build/launcher combined
  verification awaits worker integration; do not reuse historical P11 counts.

## Original preparation log

No owner-machine coding or application verification was claimed by the starting log.

## Handoff v3 preparation — 2026-11-24

The documentation package adds AG-UI, Univer, WordCraft/PdfCraft and a T3 model-discovery diagnostic. Source research/pins are in `reference/research/` and `UPSTREAM_REFERENCE_PINS.json`. This is document preparation, not an application implementation session. No source push, owner-Windows test, report-engine execution or local T3 bug fix is claimed. Reconcile actual v1/v2 progress before starting new work.

## Session template

- Date / role / active model as observed:
- Branch / worktree / starting commit:
- Goal and task IDs:
- Changed paths and resulting behavior:
- Checks actually executed, commands and outcomes:
- UI/fixture/live-service evidence and its scope:
- Remaining implementation gaps:
- External or home checks not run, and why:
- Commits / integration outcome:
- Next executable task:

Keep result evidence and decisions. Do not record credentials, private chain-of-thought or full raw provider sessions. Workers use task-specific notes; the integration owner consolidates this log.
