# Release Report — Development checkpoint

## Current local checkpoint — 2026-11-26

**Development source packages prepared; NOT a complete-product release.**
This supersedes the old observed-status/template fields below. Version remains
1.1.0-alpha.3; no resumed push, public deployment, compute purchase, credential
migration or prototype activation. Public main remains the earlier `d928e9c`.

| Area | Observed result |
|---|---|
| Native parent | `246daac`, original approved image, PASS180.623s; 3 loopback model requests, one canonical child dispatch, completed parent, replay without duplication; account/catalog/model and child transport injected |
| Same-image compatibility | Guarded/default + frontend15/15 PASS, no skips, 290.218s, 9 loopback requests/3 broker callbacks; actual compiled runtime, controlled admission fixtures |
| Serial developer checks | 917 total: 905 PASS, 11 skipped, one old fixture ENOENT; corrected fixture complete3/3 PASS separately, not a retroactive all-green aggregate |
| Builds/site policy | App build PASS; website TypeScript/Vite/12 prerenders, source/CSP/licenses and release-policy2 PASS; noindex until publication authorized |
| Landing | Same reviewer resolved four findings; scoped ship. Windows-only setup copy/layout follow-up accepted, 24 layouts/four audits. Owner aesthetic acceptance unasserted |
| README/media | d502648 capture, 21 screenshots/four walkthroughs/providerCalls0; real local receipts; full decode/hash checks and independent21-image/12-keyframe review accepted at documentation scope; brand/layout checks pass |
| Actual Windows/macOS downloads | Source be617db; 420 committed files each, exact source/ZIP verification and HTTP200 hashes pass; unsigned source launchers requiring Node24.13+ and initial network |
| Legacy integrity | Protected bootstrap payload/manifest, legacy runtime and AO paths unchanged from public checkpoint |

Evidence: [developer checks](../../../evidence/developer-checks-20261126.json),
[native control correction](../../../evidence/session-control-transport-20261126.json),
[media review](../../../evidence/media-finish-review-20261126.json),
[home handoff](../../../HOME_HANDOFF_20261126_TH.md).

Remaining limits are not waived: bounded private native setup is Windows x64
only; actual macOS launcher execution is NOT_RUN. Native monetary billing finality
is unsupported (`cost:null`, `final:false`); unsupported hard caps fail closed.
External product/server/account/model-quality journeys and Home UAT are NOT_RUN
as explicitly deferred by the Owner. No signed desktop installer or complete
release approval is asserted.

## Observed status — 2026-11-24

**IMPLEMENTATION_INCOMPLETE / HOME_UAT_NOT_RUN**. Integration branch only;
no main advancement, remote push, public hosting or product prototype activation.
Source remote inspected: https://github.com/siriponsri/forge-agents.
Current product package version1.1.0-alpha.3; release revision not selected.

Developer evidence: npm build/check/test; combined browser core flow/office
restart/conflict/undo; actual isolated T3 Codex run; actual WordCraft0.18.1 and
PdfCraft0.22.0 Windows native report generation/strict failure/preview/rotation/
download/stop; explicit native acquisition API tests by worker B. Sanitized evidence
in repository-root docs/evidence; detailed worker commands in docs/worker-ui.md and
docs/worker-reports.md. Optional real tests are separate from ordinary fixture tests.

Clean Windows downloaded ZIP d23560b: npm ci from lockfile installed241 packages,
build passed, localhost readiness passed, busy-port fallback passed, restart/stop
passed, data outside source. No .git or developer node_modules needed at startup.
Auto-opening a system browser was suppressed in this disposable fixture.

Owner additions in progress: redesigned Overview/workbench, persisted named VS Code
themes (Dark Modern default), reference-inspired landing, Windows/macOS ZIP download
API with commit/hash and actual .cmd/.command launchers. macOS actual platform
qualification remains NOT_RUN. Pinned native report profiles remain Windows-only.

Required product gaps remain in ACCEPTANCE_EVIDENCE/INTEGRATION_LEDGER; do not call
this READY_FOR_HOME_UAT or advance main merely because local core checks passed.

## Original release checklist (historical template below)

State: **NO APPLICATION RELEASE PREPARED OR PUSHED BY THIS HANDOFF**.

Fill from actual implementation and evidence before reporting readiness.

| Field | Value to record |
|---|---|
| Product version / intended source commit | NOT_SELECTED |
| FORGE remote / target branch | Confirm actual remote / main |
| Implementation coverage | NOT_AUDITED |
| Developer build/start/UI checks | NOT_RUN_IN_OWNER_CHECKOUT |
| Clean-checkout setup evidence | NOT_RUN |
| Remaining implementation gaps | Populate from acceptance matrix |
| Live integration checks pending | Populate from integration ledger |
| Windows setup/start path | DISCOVER_FROM_IMPLEMENTATION |
| Local app URL behavior | NOT_VERIFIED |
| Migration/backup behavior | NOT_VERIFIED |
| AG-UI event/reconciliation evidence | NOT_RUN |
| Univer human/agent editing and save/reopen | NOT_RUN |
| WordCraft/PdfCraft builds, capabilities and setup | NOT_QUALIFIED |
| Report artifacts, Thai/English fonts and layout | NOT_RUN |
| Optional Office Exchange/LibreOffice dependencies and limits | NOT_CONFIGURED |
| Provider model discovery / installed T3 diagnosis | NOT_RUN; do not conflate installations |
| Commit and remote push result | NOT_PERFORMED |
| Home UAT | HOME_UAT_NOT_RUN |

Include concrete commands/results and evidence references. Report the actual observed remote commit after publication. Keep all pending external/home checks specific; do not use a blanket complete/verified claim when a required implementation gap remains.
