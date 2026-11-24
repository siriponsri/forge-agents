# Univer Integration Research for FORGE

Reviewed: **2026-11-24, Asia/Bangkok**. This is source research and a proposed integration contract. No Univer package was installed, no application was built, and no Office-format or Windows compatibility test was performed in this research task.

## 1. Recommendation

Embed **Univer Sheets and Docs** as editable artifact surfaces inside FORGE's T3-based application. Let both the human and the agent operate the same persisted document through supported APIs. Keep FORGE responsible for project/task identity, tool authorization, revision records, storage routing and report-generation jobs.

Use the open-source core for the ordinary localhost editing path. Qualify separately distributed conversion, collaboration and advanced modules individually. Do not make a commercial account or an optional conversion service a prerequisite for opening FORGE or editing a local workbook.

This adds product capabilities; it does not activate CA-EWS or another prototype project.

## 2. Inspected source and feature boundary

The GitHub connector reported `dev` as the default branch. The observed branch commit was **`abcfd79f56f218920f9d3084a3ebbc2330a5f15a`**. The README fetched at that commit matched the inspected default-branch README blob. The root package identified version **1.6.1**; use this as an audit snapshot, not an instruction to depend on unreleased `dev` code. [Pinned repository](https://github.com/dream-num/univer/tree/abcfd79f56f218920f9d3084a3ebbc2330a5f15a) · [Package manifest](https://github.com/dream-num/univer/blob/abcfd79f56f218920f9d3084a3ebbc2330a5f15a/package.json)

| Capability | Inspected upstream boundary |
|---|---|
| Sheets and Docs editing, core models, commands, Facade APIs and headless content operations | Included in the Apache-2.0 repository |
| Charts, pivot tables and other advanced plugins | Selected capabilities are separately distributed commercial modules |
| Current Slides and Boards products | Separately distributed commercial products; the presence of shared core types does not grant these editors |
| Real-time collaboration and revision services | Server SDK boundary |
| Agent operations using open-source Facade APIs | Possible without adopting the commercial AI SDK |
| Commercial AI extensions | Separate distribution/license; do not infer entitlement from the core license |

The upstream README explicitly separates its open-source core from the wider demos and SDK family. The comparison page identifies individual open-source capabilities. [Pinned README](https://github.com/dream-num/univer/blob/abcfd79f56f218920f9d3084a3ebbc2330a5f15a/README.md) · [License](https://github.com/dream-num/univer/blob/abcfd79f56f218920f9d3084a3ebbc2330a5f15a/LICENSE) · [Feature comparison](https://univer.ai/compare/)

## 3. Saving a document is different from Office conversion

The core editor exposes serializable document snapshots. The README demonstrates saving workbook data and restoring that data into a workbook; the application owns persistence. Native snapshot persistence should therefore be FORGE's baseline save/reopen mechanism, with its own revision and storage contracts. It is distinct from producing an XLSX file. [Pinned README](https://github.com/dream-num/univer/blob/abcfd79f56f218920f9d3084a3ebbc2330a5f15a/README.md)

The current official conversion guide assigns Office import/export to **`@univerjs-pro/exchange-node`**. It documents Sheet import from XLS/XLSX/XLSM/CSV/TSV and export to XLSX/CSV/TSV, Doc import from DOC/DOCX and export to DOCX, and Slide conversion to/from listed PowerPoint formats. A local headless conversion route can bypass Collaboration Server, but that alone does not provide shared revisions or live collaborative preview. [Office file import/export](https://docs.univer.ai/server/import-export/node)

Separately licensed does not mean every conversion requires immediate payment. The current license guide describes a Free mode when no license is configured: **10 watermark-free exports per authorization month**, then watermarked exports. Imports consume no export quota. It also documents optional PDF native support through `@univerjs-pro/exchange-pdf-node-binding`. These are dated terms to recheck for the chosen release and deployment; do not promise unlimited watermark-free conversion. [Exchange licensing and PDF extension](https://docs.univer.ai/server/import-export/license)

For FORGE, expose conversion readiness, format compatibility and any applicable watermark/quota status before export. Preserve a successfully saved native document even if a later export fails. A file-generation success must not be confused with a successful local write, Drive transfer or download.

## 4. React integration and stable API use

The official React guide covers React 18/19 integration: initialize against a mounted container and dispose the instance during cleanup. It provides a lifecycle-aware example to avoid nested React-root cleanup problems. The installed T3/React version must still be checked against the selected Univer packages. [React integration](https://docs.univer.ai/guides/sheets/getting-started/integrations/react)

Univer offers presets and manual plugin composition. Avoid registering the same feature through both mechanisms. Coordinated SDK packages must resolve to matching versions. [Installation](https://docs.univer.ai/guides/sheets/getting-started/installation)

The repository's stability policy favors documented Facade APIs and public extension points, distinguishes internal/experimental exports, and warns that `dev` documentation can exceed a released package's API. It requires checking the relevant runtime and registered plugins. [API stability policy](https://github.com/dream-num/univer/blob/abcfd79f56f218920f9d3084a3ebbc2330a5f15a/docs/API_STABILITY.md)

**FORGE design proposal:** provide a reusable editor host in the artifact workspace, lazy-load its feature bundle, retain document identity across navigation and release subscriptions/resources when closing the surface. Do not clone the Univer demo application as a second FORGE shell. Exercise route switching, resizing, dark mode, keyboard focus and reopening documents without creating duplicate instances.

## 5. Proposed document and agent contract

Create a FORGE document record containing project ID, artifact ID, document type, native snapshot schema/version, revision, author/task/run links and verified storage locations. Store the complete content and plugin resources needed to reopen it. Keep export files as derived artifacts linked to the exact source revision.

Expose bounded operations such as reading ranges, updating cell values/formulas/styles, inspecting document sections, applying supported document changes and saving a revision. Implement each operation against the pinned public Facade API and validate its inputs. A generic executable-JavaScript tool should not become the normal interface for a no-code user or an agent.

The human editor and agent tool must share one document authority. For local multi-bot operation, serialize conflicting writes or use optimistic revision checks. An agent edit based on a stale revision should produce a conflict/rebase decision rather than silently overwrite the user's newer edit. Preserve undo/redo and a reviewable change summary.

Use a mutation receipt with document/revision IDs, changed regions, operation outcome and related task/run IDs. The AG-UI bridge can project these events into the UI, while the actual mutation is performed by the authorized content tool. Avoid treating a streamed UI event as proof that the document was durably saved.

The collaboration products described upstream use their own revision and concurrency mechanisms. FORGE's local serialized-write approach is a proposed baseline, not a claim that open-source core supplies an equivalent multi-user OT service. If true simultaneous collaboration is selected, qualify the appropriate server/license/deployment separately.

## 6. Relationship to report generation

Use Univer for editable spreadsheets and rich document content, and the separately researched Wordcraft/PDFcraft routes for report artifacts where suitable. Define a **FORGE report source model** containing sections, tables, figures, citations, locale, template/version and input-artifact references. Map supported content deliberately into each renderer.

Do not assume Univer's internal snapshot is natively understood by Wordcraft or PDFcraft, or that exporting a DOCX/PDF and importing it again reproduces all editor features. Make conversion adapters explicit and publish a fidelity matrix. A user should be able to inspect the editable source, select report language/template, generate, preview, revise and regenerate with provenance preserved.

For simple tabular exchange, FORGE may implement an independent CSV/TSV adapter, but it must document which values, formulas, styles and types it preserves. That proposal is not equivalent to full Excel compatibility. Avoid buying conversion services or silently adopting commercial modules solely to make a format button appear functional.

## 7. No-code and bilingual requirements

Add Documents/Sheets actions to the existing project/artifact navigation. Offer create, rename, duplicate, open, save, history/restore, relevant import/export and agent-edit controls through the GUI. Show accurate empty/loading/error/unsupported-format states.

Respect FORGE's Thai-default TH/EN behavior. Verify actual bundled locale coverage and provide appropriate application translations rather than assuming a complete Thai editor locale is shipped. Test Thai composition, mixed Thai/English text, long labels, numbers/dates, Thai fonts and report output rendering. The internationalization guide is the starting point for supported locale loading and customization. [Internationalization](https://docs.univer.ai/guides/sheets/getting-started/i18n)

## 8. Acceptance additions

Before developer release, verify a small workbook and rich document can be created, edited, saved, closed and reopened after process restart with matching content. Check a formula recalculates, agent edits appear in the same surface, undo/redo behaves coherently, and stale writes do not erase human changes.

Verify at least one report path from persisted source revision to preview and downloadable artifact, with correct input lineage and rendering checks. Test source save independently from export/transfer failure. For optional Exchange, verify the actual licensed/free behavior and watermark disclosure rather than inferring it from package installation.

Test the editor lifecycle inside the real T3-derived FORGE application, not only in a standalone Univer demo. Record package versions, code paths, commands, screenshots and outcomes. Native Office-format fidelity, Thai rendering, commercial modules and home-machine behavior remain unverified until exercised; missing required implementation must remain visible in the integration ledger.
