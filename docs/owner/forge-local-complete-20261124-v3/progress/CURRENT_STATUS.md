# Current Status — Complete Local FORGE

## Developer checkpoint — 2026-11-24

Latest lead checkpoint supersedes the older sequencing below: Office MCP queue
is mounted at `/mcp/office` and GUI review/apply/save uses the actual domain
receipt/lease guard. Native Sheets and Docs MCP->GUI->save->Undo/Redo passed;
local full bundle image manifest and native drawing URLs remap/reopen passed
after service close/reopen. Evidence `docs/evidence/office-agent-gui-smoke.json`.
28 integrated Office/domain/shutdown checks passed, production build passed.
Actual LLM Office tool invocation remains NOT_RUN, separate from this SDK test.

Backend worker commits for governance, official Colab MCP, MCP OAuth, KOB API,
and Assistance Strategy are on integration; their HTTP/GUI/T3 seams are being
integrated and are not yet accepted as complete. Owner confirmed all connected
models, balanced quality/cost, suitable Executor first, Asst only difficult/stuck;
KOB uses API key; Hermes Agent/OpenClaw mobile work enters Inbox and requires
Owner approval in its originating channel. See `docs/ASSISTANCE_STRATEGY.md` and
`docs/MOBILE_RELAY.md`. No new product prototype, public listener or push.

Next executable task: mount provider/governance/OAuth routes and T3 setup/role
context, then integrate compute/strategy/mobile GUI and qualify combined flows.
Overall IMPLEMENTATION_INCOMPLETE / HOME_UAT_NOT_RUN remain explicit.

Latest integrated checkpoint: serving09fc17e/0cd8cce, storage998762d/bd0f7be,
protocol86515ae. Lead GUI serving actual Windows LitServe REST+MCP weighted fixture,
hash-verified result download, Stop/Restart PASSED. Local storage GUI two full
backups, selected manifest restore to NEW project/folder, identical file download,
native artifact-ID remap and retention preview PASSED. Drive OAuth/DPAPI and REST
adapter fixture pass; LIVE_DRIVE_NOT_RUN. Native/browser workerfd10045 passed10
tests incl actual selected-window Windows and owned Chromium; lead integration
pending. Adaptive and remote compute workers are active in isolated worktrees.

Protocol now has actual native feed tools/messages/state, durable source receipts,
explicit interruption/reconnect and question/once-only permission responses.
Worker live provider lifecycle PASSED. Lead HTTP live display cursors/domain deltas
PASSED without effect replay. Exact remaining protocol blocker: pinned T30.1.11
has no arbitrary frontend tool-result return payload. Capability false and409;
full A21/A22 remains incomplete for this part. This is a dependency contract gap,
not a missing-account/home-UAT excuse. Remaining tasks below are older dependency
observations; use the latest acceptance checkpoint to distinguish resolved gaps.

Next executable task: commit integrated Storage/AG-UI HTTP/GUI evidence, integrate
native driverfd10045 routes/GUI/runtime packaging, then adaptive context validation
and compute APIs. Inspect the integrated app after each boundary change. Continue
remaining gaps in ACCEPTANCE_EVIDENCE rather than treating them as UAT.

Latest owner steering: improve visual design, provide named **VS Code themes**,
default **Dark Modern**, plus a landing page using Orca/T3/Paseo as structural
references and real Windows/macOS launcher downloads. These are active tasks in
TASK_ASSIGNMENTS; they augment the original complete-product objective.
GUI, native reports, landing and theme workers have been integrated. Lead reran
core GUI/Univer/Python/persistence smoke, real report generation/download/rotation
and decoded native PNG preview: PASSED. Multiline validation fixed0603f71; the PDF
preview now uses real rendered PNG bytes instead of relying on a PDF browser plugin.
Overview and all 15 pinned VS Code builtin themes are integrated10e38aa. Dark Modern
is default/fallback; theme selection survives reload and process restart. Bundled
Manrope/IBM Plex Sans Thai and live Univer theme switching preserve editor state.
Responsive checks at320/375/414/768/1440 and theme source/contrast verification pass.

Landing /welcome uses an actual app screenshot with labelled engineering data;
TH/EN, responsive layouts, /app navigation, and actual browser downloads for both
platform ZIPs pass. Bytes, SHA256 and source commit match metadata. Clean Windows
archive install/start/occupied-port/restart/stop passed; macOS launchers and Unix
permissions are packaged but native Mac execution is NOT_RUN.36ad386 fixes shutdown
with preconnected HTTP sockets, verified with active SSE and durable reopen.

Overall **IMPLEMENTATION_INCOMPLETE**, **HOME_UAT_NOT_RUN**. Active branch
`integration/forge-local-complete`; main stays efcd132. No push. Requirements and
contracts9d0a90f, backend22bb87c, T3/launcher9857bdd, catalog/Git evidence de14a95.
Legacy protected payloads untouched; no prototype product created.

Lead and isolated workers use codex/**gpt-6.1-sol**, **reasoningEffort=xhigh**.
Lead configuration observed from orchestration capabilities and successful live
execution. New isolated workers now implement serving/LitServe, AG-UI lifecycle,
and storage bundles/Drive/recovery. Worker completion is separate from integration.

Implemented/checked on Windows, Node24.19.0: SQLite domain/revisions/operation
receipts, project scope, evidence-backed task completion, real local Python jobs,
artifact hashes, metadata backup/restore, catalog fallback and explicit selected-file
Git commit/push to a bare engineering-fixture remote. MCP transport/discovery/call
reservations and target ownership/capability filtering have local fixture evidence;
this does not qualify live MCP services or native desktop targets.

Actual pinned T3 v0.1.11 GUI/server starts with FORGE-only machine state. Actual MCP
handshake/discovery and read-only provider run PASSED:
`3ca650f9-801e-4c8b-8e8c-acf0dd733d61`, reply FORGE_ENGINEERING_BRIDGE_OK.
AG-UI1.0/core1.0.5 validates actual start/message snapshots/finish.
Evidence: repository-root `docs/evidence/t3-live-smoke.json`. Full tool/frontend-tool,
interrupt, delta and live stop/reconnect qualification remain incomplete.

`npm test`, `npm run check`, `npm run build` and zero-vulnerability `npm audit`
passed on the integrated tree before the shutdown regression was added; that new
regression also passes. Real report suite13 passed/1 acquisition opt-in skipped;
separate real no-code acquisition passed. Evidence is in repository-root
`docs/evidence/` and task notes `docs/worker-{ui,reports,themes,landing}.md`.

G0–G4/G6 IN_PROGRESS; G5 partial ownership/capability implementation. Required code
gaps: unified T3 navigation, complete AG-UI lifecycle, cloud compute/provider setup,
Drive sync/conflict/retention, inference/LitServe, native/guest/browser drivers and
effective in-flight stop, adaptive evaluation and remaining office/report acceptance.
Missing implementation is not deferred home UAT.

Next executable task: integrate serving worker's artifact/preprocessor binding and
LitServe REST/MCP lifecycle into HTTP/GUI, verify actual weighted inference and
owned stop; integrate protocol/storage workers after scoped review. Continue the
remaining implementation gaps in ACCEPTANCE_EVIDENCE rather than treating them as UAT.

## Historical handoff snapshot (superseded by the checkpoint above)

Initial handoff state: **READY_FOR_LOCAL_IMPLEMENTATION_AUDIT / OWNER_CHECKOUT_NOT_INSPECTED**.

This record starts the v3 handoff. It does not claim that application work in the owner's local repository has been inspected or completed. Reconcile any existing implementation and v1/v2 progress before updating it; preserve work already done.

## Current owner target

- Complete FORGE no-code localhost product across G0–G6.
- Use all confirmed concepts/requirements and assess all named upstream references.
- Do not create CA-EWS or another prototype product in this round.
- Developer build/local verification precede main delivery; the owner pulls at home and performs full-flow UAT later.
- Required v3 additions: AG-UI harness/UI bridge, embedded Univer Sheets/Docs and WordCraft/PdfCraft report pipelines, with no-code engine setup.
- Model default: use the owner's actually selectable/runnable GPT 6.1 xhigh and record its exact ID rather than assuming a variant. Astra/6.2 configurations are optional when the same authenticated route supports them. Actual T3/account catalog remains unknown here.
- T3 6.2 visibility: matching upstream issue found, user-machine diagnosis NOT_RUN; linked PR was open/unmerged at research time. Product development need not wait for it.

## Actual environment to record

| Item | Initial state |
|---|---|
| Owner development path | `C:\Users\siripon.sri\Desktop\my_project\forge-agents` |
| Local HEAD/branch/dirty work | NOT_INSPECTED |
| Integration branch/worktree | NOT_CREATED_BY_THIS_HANDOFF |
| Active model/provider/options | NOT_INSPECTED |
| T3 source revision and integration layout | NOT_INSPECTED |
| AG-UI/document/report contracts and engine pins | RESEARCHED_TARGETS; IMPLEMENTATION_NOT_AUDITED |
| Installed development T3 6.2 diagnostic | OWNER_REPORTED; LOCAL_CAUSE_NOT_DIAGNOSED |
| Package manager/runtime/commands | DISCOVER_FROM_ACTUAL_CHECKOUT |
| Worker tool access and assignments | NOT_STARTED |
| Application implementation coverage | NOT_AUDITED |
| Main commit/push | NOT_PERFORMED_BY_THIS_HANDOFF |
| Home UAT | HOME_UAT_NOT_RUN |

## Goal status

| Goal | Status | Evidence |
|---|---|---|
| G0 repo/reuse/contracts | NOT_STARTED in owner checkout | None supplied to this handoff |
| G1 persistent T3 foundation + protocol/document contracts | NOT_AUDITED | Inspect actual code and previous progress |
| G2 teams/conversations/planning | NOT_AUDITED | Inspect actual code |
| G3 connections/MCP/AG-UI/Settings | NOT_AUDITED | Maintain integration ledger; model catalog freshness is explicit |
| G4 AI engineering, office/reports and storage | NOT_AUDITED | No prototype execution required; actual artifacts required |
| G5 desktop/adaptation | NOT_AUDITED | Target-specific evidence required |
| G6 localhost/release/home handoff | NOT_AUDITED | Development and home verification separate |

## Next executable task

Inspect actual checkout and current work, establish the selected T3 foundation and complete-scope gap map including specifications 10 and 11, then implement the next dependency-ready task in the same session. If foundation/contracts permit parallelism, create isolated assignments for two workers. Continue beyond the first slice toward all G0–G6 requirements. Diagnose installed T3's model picker separately when useful; do not block implementation on selecting 6.2.

## Update at each checkpoint

Record changed paths and purpose, actual app launch method, commands/results, acceptance evidence, implementation gaps, external checks pending, active worktree ownership and next executable task. Central status has one integration owner; worker notes are consolidated here rather than edited concurrently.
