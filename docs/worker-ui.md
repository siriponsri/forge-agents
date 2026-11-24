# Worker A — FORGE GUI and embedded Univer

Implementation: Thai-first React workbench under `app/web/`, orange/warm neutral FORGE identity, Segoe UI/Tahoma, semantic labels, visible errors/focus, reduced-motion styles and responsive navigation. No legacy changes, credentials, provider execution, prototype product, push or PR. Runtime model supplied by the T3 harness: **gpt-6.1-sol**, reasoning **xhigh**; no model switching or subagents.

## Implemented paths

- Project create/select/update and independent provider/compute/serving/storage/MCP/desktop profile. T3 provider instance/model/options remain distinct from bot identity. Real catalog/start controls use the independent backend-managed T3 surface. No iframe or competing provider-turn owner.
- Resident/helper identities, roles/instructions and task scope; private/team local messages. Messages are persisted user messages: no fabricated assistant response.
- Plan approval, phases, dependency-aware tasks, Canvas/Kanban/list from the same records; accountable bot ownership, acceptance evidence and backend-owned thread/run IDs. Start/stop/reconcile use actual service actions. Finite persisted AG-UI events are parsed for display only. SSE reconnect fetches authoritative state, never replays effects.
- Python notebook create/import/edit/save, saved-revision execution, actual job status/logs/stop; artifact verification/registration/download; run/job monitoring from actual records. No synthetic training/serving metrics.
- Connection forms, real dependency/transport check, MCP discovery/call with operation IDs; metadata backup and checksum-verified restore by ID and expected state revision. Advanced configuration is labelled.
- Native Univer Sheets and Docs: per-document lifecycle with lazy package imports, exactly one preset per mounted instance, resource/subscription disposal, full native snapshots, explicit matching package version, save/dirty/recovery states, rename/duplicate, revision history/restore, and rejection of temporary local assets. Navigation and unload protect unsaved document changes.
- Bounded `sheet.setValues` (A1 rectangle, maximum 1000 cells) and `doc.insertText` (single paragraph, maximum 10000 characters) use the actual mounted public Facade API. They check the durable revision before mutation, apply one command, and save through `document.save` with actor/summary and expected revision. Human and bounded edit undo/redo use the same live editor. Durable history is separate from session undo.
- ReportSpec source form, sections, citations, exact artifact input revisions, template/language/font selection, advanced table/figure input, explicit saved-Doc plain-text extraction with document/revision lineage. WordCraft/PdfCraft discover/install/configure, generation/jobs/stop, real PDF artifact preview/download, and inspect/render/rotate commands use worker B's exact endpoint contracts.

## Build and verification

Dependencies and lockfile belong to lead. Verified against the lead lockfile: Node **24.19.0**, React **19.2.4**, Vite **7.3.8**, coordinated Univer **1.6.1**. Installed declarations and published JS were inspected for `createUniver`, `createWorkbook/createDocument`, `save`, `addEvent(CommandExecuted)`, `range.setValues`, `document.insertText`, shared undo/redo, theme and disposal. Packages declare Apache-2.0; core editing does not require Exchange/commercial AI modules. Shipped locales contain no Thai: shell is bilingual, editor menus are explicitly English, actual Thai content was exercised.

Commands:

```powershell
npm ci
npm run build
node --test app/web/tests/boundaries.test.mjs
# Developer-only browser runner (not a product dependency):
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node app/web/tests/smoke.mjs
```

If using an already installed test browser, set `FORGE_TEST_BROWSER` to its executable. The test starts a real service on an ephemeral loopback port and uses a fresh `forge-ui-worker-*` directory in OS temp. It does not use developer T3 state or credentials. `npm run dev` uses Vite with a same-origin `/api` proxy to loopback port 4317; production is served by the lead service after build.

**PASSED browser walkthrough** on Windows/Chromium: Thai initial state and English switch; project/team/local message creation; approved plan/phases/tasks and Canvas/Kanban; actual bounded Python execution and persisted output; real embedded Sheets/Docs; values/formula/Thai edits, save/undo/redo; real human keyboard cell edit interleaved with bounded edit and redo invalidation; stale write rejection without replacing the newer durable snapshot; full service shutdown/restart and reopen of both native kinds; report source save; metadata backup; desktop and 390px render; no uncaught browser errors. Screenshots and SQLite fixtures: `%TEMP%/forge-ui-worker-d2LToF` (earlier full pass `%TEMP%/forge-ui-worker-bzZC0o`). Fixtures are disposable engineering verification, not an owner product.

Build emits lazy Univer bundles and upstream large-chunk warnings; the main application bundle remains separate. This is a performance limitation, not a build failure. Screenshots were inspected locally; report PDF output has not been visually qualified through this worker's browser.

## Integration and remaining gaps

Lead backend commit `22bb87c` and report worker commit `90832f7` were cherry-picked **only for local verification**. Do not reapply those commits from this branch. Integrate only the scoped Worker A UI commit. Final lead fixes `de14a95`/`9857bdd` were announced after this worker's initial smoke; they include bot instructions and the corrected T3 integration. Lead should re-run the included browser smoke against final integration.

- **IMPLEMENTATION GAP:** the bounded editor command adapter is wired to a reviewed GUI operation, not yet an inbound T3/MCP agent tool. Lead must bind authorized tool requests to this same mounted session and attribute task/run/attempt metadata; do not claim an autonomous provider edited a document from this manual verification.
- **IMPLEMENTATION GAP:** temporary browser image uploads are explicitly rejected; no durable image/resource upload route is provided in the current contract. Text/formulas/styles/native resource snapshots are retained, but full image upload/backup qualification needs the resource service.
- **IMPLEMENTATION GAP:** ReportSpec table entry, phase overrides and advanced provider options use labelled JSON fields; this is not the final fully guided no-code experience. Plain-text Doc extraction deliberately excludes rich formatting/tables/images; Sheets-to-report extraction is not implemented.
- **INTEGRATION NOT_RUN:** report native engines were independently qualified by worker B, but this worker's browser smoke covers report source persistence only. Lead must exercise configure/discover → generate → actual PDF preview → rotate → download/stop after merging worker B.
- **NOT_RUN:** actual provider-backed T3 run, live MCP servers, Drive/Git delivery, remote/cloud compute, serving, desktop controllers and skills are not qualified by this worker. Saving a connection/profile does not establish those adapters are implemented. Current local notebook compute is the implemented route; global product gaps remain lead-owned.
- **NOT_RUN:** full Thai IME composition, rich image/font/layout coverage, native report PDF visual inspection and home-machine flows. `HOME_UAT_NOT_RUN`.

Next executable task: cherry-pick the scoped UI commit into lead integration, build, run `node app/web/tests/smoke.mjs`, then complete the real report GUI flow against worker B and wire authorized bounded edit requests into the mounted document session. Keep incomplete product adapters separate from missing live accounts/home UAT.
