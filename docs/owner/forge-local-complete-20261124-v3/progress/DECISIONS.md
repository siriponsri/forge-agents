# Decisions

## D-009 — Observed implementation choices (2026-11-24)

Use the actually running codex gpt-6.1-sol/reasoningEffort=xhigh for lead and two
isolated worktree workers. Catalog exposure of6.2 is not a successful6.2 request
and does not change this selection. Keep development T3 separate from FORGE's
T3 v0.1.11 matching GUI/server distribution, source pin59651c1761f6c63e9b6056839067066968e6a406.
Reuse its MIT launcher with a documented Windows rename retry; never disable hashes.
Use SDK MCP1.32.2, AG-UI core1.0.5, Univer1.6.1, React19.2.4, Vite7.3.8, exact
lockfile. SQLite is the domain authority; T3 remains provider-turn authority.
Native office snapshots and versioned ReportSpec remain distinct representations.
Do not advance main or publish while required implementation remains incomplete.

## D-001 — Complete product replaces first-slice delivery

Owner correction, 2026-11-24: build the complete FORGE no-code localhost product now. G0–G1 remains an intermediate foundation. All requested product feature families remain in scope.

## D-002 — Prototype execution deferred

Do not create/train/deploy CA-EWS or another product prototype this round. Retain the earlier reference plan and selected Colab/Drive/Windows/Git profile as future-use input. Generic engineering fixtures may verify product behavior.

## D-003 — Main delivery, then home UAT

Developer verification precedes delivery through main. The owner pulls at home and tests system flows. Missing implementation is not converted into a pending-UAT label. No source push occurred when preparing these docs.

## D-004 — Multi-model development is a proposed operating configuration

Owner requested model recommendations and suggested Astra orchestration with branches. Use an actually runnable model first, currently the owner's GPT 6.1 xhigh label, and inspect its exact model ID. Astra lead/integration with available workers remains an option when the account/T3 supports it. Missing 6.2 is not a prerequisite for FORGE development. Use separate worktrees. This recommendation does not prove models were selected or worker sessions started.

## D-005 — AG-UI extends the existing harness/UI boundary

Owner v3 amendment adds AG-UI. Retain T3 provider-turn ownership, MCP tool connections, FORGE domain state and team scheduling. Map real lifecycle/state/tool events; implement application-level reconciliation instead of assuming automatic SSE resumption. Details: specification 10.

## D-006 — Embedded office editing and explicit report transformations

Univer Sheets/Docs supply the embedded editing surface and public agent-command APIs. Persist native document revisions. A versioned FORGE ReportSpec connects source data, templates and generated artifacts through explicit adapters; it is not identical to Univer snapshots or WordCraft's document model. Optional exchange capabilities retain their dependency and license boundaries.

## D-007 — Native report engines behind no-code setup

WordCraft provides the selected editable document/DOCX/PDF generation route. PdfCraft supplies qualified PDF operations and optional installed-LibreOffice conversion. Use current headless CLI/MCP contracts, project file scopes and truthful progress/cancellation. The owner should not compile Rust, configure raw MCP roots or manage binaries manually for routine use. Exact-build Windows/Thai fidelity remains an implementation qualification gate.

## D-008 — Upstream T3 issue is evidence, not a local diagnosis

Research on 2026-11-24 found issue #38609 explicitly reporting hidden gpt-6.2-sol after stale catalog fallback and PR #38889 still open/unmerged. Diagnose the actual installed T3/provider/executable/account route safely. Do not claim a shipped fix, erase caches blindly or assume the account has an unavailable model. Continue product work with a working model.

## New decision template

- ID / date / task:
- Problem and concrete options:
- Selected approach and reason:
- Scope and affected contracts:
- Supporting evidence:
- Revisit condition:

Do not re-ask settled product requirements. Record routine engineering decisions and continue; ask only for an unresolved material choice or account/resource binding when it becomes necessary.
