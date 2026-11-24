# Office Workspace and Report Generation

Status: **required v3 implementation specification**. This file describes the target behavior; it does not assert that FORGE already implements it. Upstream research has not executed Univer, WordCraft or PdfCraft, and does not establish Windows, format or Thai compatibility results.

This extends the complete no-code localhost FORGE product. Preserve the existing AI coding, notebooks, training, inference/deployment, dashboards, persistent teams, temporary helpers, provider/harness selection, MCP, computer use, planning and storage scope. Do not create CA-EWS or another prototype product to implement or demonstrate these capabilities.

Read with [architecture and settings](05_ARCHITECTURE_AND_SETTINGS.md), [AG-UI harness protocol](10_AGUI_HARNESS_PROTOCOL.md), [Univer research](reference/research/UNIVER_INTEGRATION_RESEARCH.md) and [report-engine research](reference/research/REPORT_ENGINES_RESEARCH.md). The research files contain dated primary-source links and inspected commits. Select compatible released packages/binaries and record the versions actually used; observed development-branch versions are audit evidence, not automatic dependency choices.

## 1. Product experience and required surfaces

Add **Documents**, **Sheets** and **Reports** to the existing project/artifact workspace. Integrate them into FORGE's T3-derived shell, navigation, task attribution and appearance. Users must not open a separate demo application or edit configuration files to complete the normal workflow.

| Surface | Required behavior |
|---|---|
| Documents | Create, name, edit rich content, save, duplicate, close/reopen, inspect history, restore a revision and request agent edits |
| Sheets | Create/edit workbooks, manage sheets, edit values/formulas/styles, recalculate, save, duplicate, close/reopen and request agent edits |
| Reports | Choose a template and source revisions, select language/font profile, generate, preview, revise source, regenerate and export artifacts |
| Artifact detail | Show source/derived relationships, revision, author/bot/task/run, generation status, validation findings and verified storage locations |
| Settings | Explain editor/engine availability and configure supported dependencies, templates, fonts, conversion routes and destination policies |

Use Thai-first FORGE labels with working TH/EN switching. Inspect actual Univer locale support; provide missing application translations instead of claiming a complete Thai editor locale. Keep raw command JSON, executable paths and protocol details in diagnostics/advanced settings. Empty, loading, saving, saved, conflict, failed and unavailable states must be distinct and actionable.

## 2. Embed Univer Sheets and Docs

Use the open-source Sheets and Docs core and documented public Facade/extension APIs. Do not require a commercial account for native local editing or persistence. Do not infer entitlement to charts, pivots, Slides, Boards, AI SDK features or collaboration services from the core license or upstream demos. Qualify optional modules individually before enabling their UI.

Implement one reusable editor host with document identity and lifecycle ownership. Mount against the actual application container, lazy-load feature bundles, dispose subscriptions/resources on close and prevent duplicate instances on navigation. Register each capability once, using a coherent preset/manual composition strategy. Pin coordinated Univer packages to compatible matching versions and verify compatibility with the actual T3/React stack.

Required native save/reopen behavior:

1. Persist the complete supported workbook or document snapshot, including plugin resources and referenced images/assets needed to reopen it. Save the selected snapshot/schema and package versions with the document record.
2. Convert temporary browser asset references into durable project-owned resources before reporting a successful save. Resolve resources after process restart and after a supported backup/restore.
3. Reopen through the selected public API and recover content, formulas, sheets, styles, supported document structures and asset references. A cached editor tab is not proof of persistence.
4. Preserve the last acknowledged durable revision if a later save fails. Show dirty/unsaved state and a recoverable error without falsely marking content saved.
5. Version persistence schemas and handle incompatible snapshots through a tested migration or explicit recovery path. Do not silently discard unsupported fields to force a document open.

A **native snapshot** is the baseline editable format. XLSX, DOCX, PDF and CSV are exchange/output formats with separate mappings and fidelity limits. An export failure must not undo or invalidate a successful native save.

## 3. One human-agent command and revision boundary

FORGE owns document identity, durable revisions and storage routing; the mounted editor owns its live editing session under that authority. Human edits and agent edits must converge on the same authorized document session/command pipeline. Do not create an independent agent copy that later overwrites the user's snapshot.

The following records are proposed FORGE contracts, not names of existing upstream APIs:

| Record | Required information |
|---|---|
| Document | Project/artifact/document IDs, kind, current revision, snapshot schema/package versions, resource manifest and verified locations |
| Edit request | Operation ID, expected revision, actor, task/run/attempt, bounded operation, affected region and validated arguments |
| Mutation receipt | Operation outcome, base/result revision, changed regions, timestamp, actor and save/durability state |
| History entry | Reviewable change summary, source operation, before/after references and available undo/restore action |

Implement typed operations for supported ranges, values/formulas/styles, document sections and changes. Use pinned public APIs and runtime capability checks. A generic arbitrary-JavaScript tool is not the normal agent interface. Validate project/document scope, resource paths and arguments before mutation; publish the receipt only after the relevant action actually occurs.

For the local multi-bot baseline, serialize conflicting writes or use optimistic revision checks with one writer authority. If the user edits after an agent reads revision 12, an agent write expecting revision 12 must not overwrite revision 13. Return a conflict, refresh context and compute a deliberate new edit. Serialize an active document's command application so autosave, undo and agent changes cannot race snapshot replacement. Reuse operation IDs to recognize duplicate delivery without executing a mutation twice.

**Undo/redo is required in the shared live editing workflow.** Route supported human and agent changes through the editor's supported command/undo facilities, preserve origins and use sensible transaction boundaries for an agent batch. Test interleaved user/agent edits and redo invalidation. Do not implement agent changes as uncontrolled snapshot replacement that silently bypasses undo. If an operation cannot participate in the selected API's undo semantics, implement an explicit reviewed revision-restore path and disclose the boundary before applying it; required ordinary cell/text edits must still meet shared undo acceptance.

Persistent history/restore after restart is a separate contract from an editor's in-memory undo stack. Record durable revisions and restore as a new attributed revision. Do not claim that upstream automatically persists the full undo stack or supplies multi-user operational transformation. True simultaneous collaboration requires a separately qualified service/license/deployment; it is not necessary to disguise local serialized writes as collaboration.

AG-UI projects these receipts and authoritative state into chat, task cards and the open editor. A UI event is not proof of a successful save, and a protocol reconnect must not replay document mutations. Follow [the AG-UI contract](10_AGUI_HARNESS_PROTOCOL.md).

## 4. Office exchange and optional commercial modules

Implement conversion as a capability-qualified adapter distinct from native save. The current official Univer route uses separately licensed `@univerjs-pro/exchange-node`; local headless conversion can operate without Collaboration Server, but does not supply shared revisions or collaborative editing. Optional native PDF conversion has its own binding/package boundary. Consult the dated source links in [Univer research](reference/research/UNIVER_INTEGRATION_RESEARCH.md).

Do not label all Exchange use as immediately paid. At the inspected date, upstream documented Free mode without a configured license, **10 watermark-free exports per authorization month**, then watermarked exports; imports do not consume export quota. Recheck the selected release's current terms before distribution. Do not promise unlimited watermark-free output or hardcode a fabricated live quota counter.

The GUI must disclose the active route, supported format/content subset, converter readiness and applicable watermark/quota/license state before export. If the adapter cannot observe a remaining quota, display that limitation accurately. A configured package name is not proof of conversion readiness. Native editing must remain usable when optional Exchange is absent or its export fails.

Define a format-fidelity matrix for each implemented route. Cover at least document text/styles/tables/images and workbook values/formulas/types/styles/multiple sheets. Report unsupported constructs rather than quietly claiming a lossless round trip. An independent CSV/TSV adapter may be offered for simple tabular exchange; document values versus formulas, types and formatting behavior. It does not establish full Excel compatibility.

## 5. FORGE ReportSpec and explicit render adapters

Persist a versioned **ReportSpec** as the common report source. It contains report/project IDs, source revision, template/version, ordered sections, structured tables, figures/chart references, citations/evidence links, language, font profile and input-artifact revisions. Keep user-supplied data, computed results and agent-authored narrative attributable. Do not invent missing training metrics or research conclusions to populate a template.

Select input revisions explicitly. Converting a Univer snapshot into ReportSpec requires a deliberate adapter and supported-content mapping; neither WordCraft nor PdfCraft is assumed to consume that snapshot directly. Editing a published DOCX or PDF does not silently rewrite ReportSpec. Offer an explicit import/reconcile flow, or retain it as a separately edited artifact with clear lineage.

| Adapter | Required role and boundary |
|---|---|
| Univer-to-report | Extract supported document sections/tables/ranges with stable source revision and asset references |
| WordCraft report renderer | Map ReportSpec/template into supported document commands; generate DOCX and direct PDF from the same document/source revision |
| PdfCraft PDF adapter | Inspect/render PDFs and perform requested page/annotation/postprocessing operations, creating a new derived artifact revision |
| Optional Office conversion | Use PdfCraft's qualified native LibreOffice-backed route for supported inputs; record converter/font versions |
| Storage adapter | Commit verified local output, then perform configured transfers/commit/push as distinct tracked operations |

WordCraft's CLI/MCP command and script paths are the primary report-generation boundary. Its strict PDF/PNG checks for missing glyphs and omitted pictures should be part of export validation where applicable. Strict success is not a guarantee of correct pagination, Thai shaping, factual content or fidelity in Microsoft Word.

PdfCraft currently provides native Office conversion through an installed LibreOffice. Use the actual discovered automation/conversion operations, such as the verified `doc_create_multiple` path, rather than assuming ordinary `doc_open` converts Office files. This route is not available in its browser/WASM implementation. Its converter has its own timeout/output limits and dependencies; return actual failures with a recovery action. The pinned source evidence is in [report-engine research](reference/research/REPORT_ENGINES_RESEARCH.md); older README/parity claims must not override the inspected implementation.

Generate both primary formats from one frozen report source revision, then validate each output. This does not promise byte-identical regenerations, identical rendering in another application, PDF-to-DOCX round-trip fidelity or automatic parity between WordCraft, LibreOffice and Univer renderers. Publish route-specific fidelity findings and preserve the actual engine/template/font provenance.

## 6. Headless engines, setup and project scope

Run document engines behind FORGE-owned local adapters and the existing harness/tool policy. Do not add a second agent planner or provider-turn owner. Prefer deterministic document commands over using desktop clicks to generate routine reports; desktop control remains available under the separate target/controller contract where a task requires it.

WordCraft MCP at the inspected commit requires both existing automation read and write roots and refuses connection to the running desktop app. Use a confined headless session and document IDs. Do not expose a fabricated live desktop-sync option or bypass that refusal. PdfCraft MCP also runs its own headless stdio process and has no connect-to-existing-app route. Configure its supported combined or separate roots deliberately.

Give each report job or explicitly owned session scoped input/output roots. Resolve all file and asset operations through project scope; avoid handing a session the whole home directory as a convenience. Keep process/session ownership explicit so stopping one report cannot unintentionally terminate another bot's report. Discover current tool schemas and validate required operations against the actual executable.

No-code engine setup must provide:

- Compatible executable installation/discovery, version/checksum records and dependency checks; no manual Rust compilation or MCP JSON editing for ordinary users.
- Machine-local executable/font configuration separated from portable project settings. Do not embed the developer's home path or assume a CLI is on PATH.
- Readiness states such as not installed, checking, ready, incompatible, missing font/dependency and error, with concrete recovery actions.
- Separate availability for native editing, report generation, optional Office conversion and optional Exchange. One working capability must not make all badges green.
- Project/default settings for template, language, font profile, approved adapter, output format/destinations and retention. Historical jobs retain their original configuration.

Use qualified release binaries or a supported packaged distribution with notices. Developer source-build requirements remain a development concern. Resolve LibreOffice only when that route is selected; core WordCraft report generation must not accidentally become dependent on it.

## 7. Job state, cancellation and artifact commitment

Persist job/attempt IDs, input revision, adapter/process identity and outputs through queued, preparing, rendering, validating and ready states, with failed/interrupted/unknown outcomes as necessary. Emit actual phase transitions through AG-UI. Display percentages only when backed by a defined observed measurement.

PdfCraft's current MCP exports are synchronous and ignore progress-token/cancellation notifications. Show indeterminate progress during those operations. Stop must use the adapter's real process/control capability and then reconcile the result; sending a notification or closing a browser stream is not confirmed cancellation. If process-level stopping is needed, stop only the owned session/job and inspect its staged outputs. Preserve an unknown outcome until it can be resolved.

Artifact commitment sequence:

1. Freeze the source revision and record the generation attempt before side effects.
2. Write to a job-scoped staging location; do not expose a half-written file as ready.
3. Verify completion, expected files, format readability, content checks and required render/font diagnostics. Record hashes, byte sizes and engine/template/font/input versions.
4. Commit the immutable artifact record and verified local location using the existing artifact service. If source edits occurred meanwhile, keep the output linked to its older source revision and label it accordingly.
5. Execute requested Drive/local/Git delivery policies separately and track each destination. A generated file does not imply a download, Drive upload or Git push succeeded.

On crash/reconnect/retry, inspect the recorded attempt, staging and published manifest before repeating mutations or external transfers. Reconcile a completed output instead of blindly regenerating or duplicating it. Failed validation retains useful diagnostics and permits a deliberate new attempt. Source save, artifact generation, local commitment and destination transfer have independent outcomes.

## 8. Thai, fonts and notices

Qualify the exact binary/package build and font set used for release. WordCraft's shaping library alone does not prove Thai fidelity. PdfCraft documents Thai existing-text support and an optional Noto Sans Thai build input, but availability is build-dependent and does not establish Thai OCR support. System screen fallback is not proof that exported PDF text is correctly shaped, embedded, searchable or copyable.

Check Thai vowels/tone marks, mixed Thai/English, composition input, line wrapping, bold/italic availability, tables and page boundaries. Require an explicit replacement decision when a font is unavailable; do not silently substitute a user's institutional font. Store font identity/version and permitted redistribution information with the engine profile and output provenance. Test emitted files, not only the editor preview.

Maintain package/license notices for Univer and the report engines, plus dependencies, fonts and bundled assets. WordCraft/PdfCraft's MIT-or-Apache code declarations do not license ArtCraft marks; modified distributions must follow the upstream brand restrictions and use FORGE's identity. Review separately licensed Exchange modules, LibreOffice and additional assets for the actual distribution plan. Do not copy upstream demo branding into the product.

## 9. Required acceptance evidence

Record these in the main acceptance matrix/integration ledger with code paths, pinned versions, meaningful test commands, output artifacts/screenshots and observed results. Required unfinished implementation remains unfinished; a research citation is not a passing test. Use harmless generic fixtures, not a prototype product or a real training campaign.

| Gate | Required evidence |
|---|---|
| OFFICE-01 Native persistence | Create a workbook and rich document, edit/save, close the process, restart and reopen with matching supported content/resources; recalculate a formula |
| OFFICE-02 Shared editing | An agent changes the same open document/workbook; human and agent edits have receipts/revisions, coherent live undo/redo and reviewable durable history |
| OFFICE-03 Conflicts and recovery | Reject/reconcile stale writes, duplicate operation delivery and interrupted save without losing the last durable revision or erasing newer user edits |
| OFFICE-04 Real host lifecycle | Route changes, resizing, focus, theme switching and repeated open/close work inside FORGE without duplicate instances or lost edits |
| OFFICE-05 Exchange truthfulness | Native save works independently; any advertised exchange route passes its format/fidelity check and discloses actual watermark/license/quota behavior |
| REPORT-01 Primary generation | Persist ReportSpec, generate DOCX and PDF from one source revision, reopen/inspect both, preview actual PDF and expose verified local downloads |
| REPORT-02 PDF operations | A real PdfCraft inspect/render and page/postprocessing action produces attributable results and a new artifact revision |
| REPORT-03 Optional conversion | If advertised, exercise the actual installed LibreOffice route through the selected adapter and handle missing dependency/failed conversion accurately |
| REPORT-04 Failure semantics | Missing glyph/image, invalid input, wrong root, stale source, stopped process and reconnect produce truthful state with no false successful artifact or duplicate mutation |
| REPORT-05 Thai output | Exact-build/font Thai/English fixture passes semantic readback and visual layout review in emitted DOCX/PDF; document remaining fidelity limits |
| REPORT-06 Clean no-code setup | A clean supported Windows setup can locate/install dependencies through the supported flow, generate/preview/export and recover from one actionable setup failure |

A required feature with absent implementation cannot pass by hiding its button. A live check blocked by unavailable credentials or a particular home-machine environment is recorded as NOT_RUN with the exact prerequisite, separately from whether the implementation and local developer tests are complete. Preserve the later home UAT workflow and the full FORGE scope.
