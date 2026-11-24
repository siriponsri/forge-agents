# Report engines: WordCraft and PdfCraft

Research date: 2026-11-24. Scope: the FORGE local, no-code workbench; this does not create an AI project prototype. Evidence is read-only inspection of upstream documentation, manifests and source through the GitHub connector. No upstream binary was installed, built or executed, and no Windows/Thai runtime result is claimed.

## 1. Decision and inspected versions

Use **WordCraft as the primary structured report/document engine**, with DOCX and direct PDF output from the same report revision. Use **PdfCraft as the PDF inspection, preview and page-operation adapter**, and optionally for dependency-qualified Office conversion. Keep both behind FORGE-owned adapters. They are native Rust/egui applications with CLI/MCP interfaces and browser/WASM builds, not drop-in React document components.[W1], [W2], [P1], [P2]

| Repository | Default branch and inspected commit | Workspace version | Source build requirement | Code license |
|---|---|---|---|---|
| `storytold/wordcraft` | `main` / `bf2be3cad86d6c6a72d604676ab6ff3f0aa9478d` | 0.18.1 | Rust 1.95, edition 2024 | MIT OR Apache-2.0 |
| `storytold/pdfcraft` | `main` / `6e910675c68dd5092e889065cfe8d0274c1b2742` | 0.22.0 | Rust 1.95, edition 2024 | MIT OR Apache-2.0 |

The manifests and pinned documentation establish this snapshot; they do not establish that a particular distributed Windows executable contains every optional feature. Select a compatible release asset, record its version/checksum and qualify that actual build before enabling it in FORGE.[W1], [W2], [P1], [P2]

## 2. What can actually be reused

### WordCraft: editable documents and report generation

WordCraft reads and writes DOCX, reads legacy DOC, and provides other text/document format paths including ODT, RTF, HTML and Markdown. Its CLI can inspect or extract document text, execute document commands/scripts, render pages and export PDF. The report-relevant model includes text styling, tables, images, comments, tracking changes, citations and templates. Upstream's parity assessment remains an alpha assessment with fidelity gaps; FORGE must not describe this as complete Microsoft Word compatibility.[W1], [W3], [W4]

A script can load a template, apply commands and save both DOCX and PDF. This is a useful common document-model path for a report's two output formats. It does not promise identical layout in Microsoft Word, byte-identical regenerations, or lossless import of arbitrary documents.[W1], [W3]

Useful verified entry points include:

```text
wordcraft-cli convert report.docx report.pdf --strict
wordcraft-cli inspect report.docx
wordcraft-cli text report.docx
wordcraft-cli run --script job.json
```

Strict PDF/PNG export can refuse missing glyphs or omitted pictures; refusal exits with code 3 without producing the requested output. `file.strictReport` provides structured diagnostics. Installed fonts affect the result. This is an export-loss check, not proof of correct pagination, Thai shaping, table semantics or report conclusions.[W1], [W3]

**MCP integration constraint:** the current CLI requires both existing read and write roots:

```text
wordcraft-cli mcp --automation-read-root READ_DIR --automation-write-root WRITE_DIR
```

Use a headless session with document IDs. Available operations cover new/open/save, text and selection, commands/batches, inspection, page rendering and tables. The current CLI **refuses `--connect` to the running desktop app**, because that connection lacks equivalent confinement. Some documentation discusses connected GUI tools, but FORGE must follow the enforced refusal and must not claim live synchronization with an open WordCraft desktop window.[W3], [W5]

### PdfCraft: PDF operations, with qualified Office conversion

PdfCraft supplies PDF inspection/rendering, page manipulation, combining/splitting, text and object operations, annotations/forms and export facilities. PDF-to-DOCX export has layout limitations. Treat PDF editing as edits to PDF artifacts, not reconstruction of the original report model or a reliable DOCX round trip.[P1], [P3]

**Important documentation discrepancy:** an older README assessment still says Office-to-PDF is absent, and one parity passage says Office opening is limited to the desktop File/Open path. At the inspected commit, actual code supports a broader native conversion path:

- `crates/create/src/office.rs` recognizes Office/OpenDocument/RTF inputs and invokes an **installed LibreOffice**; PdfCraft does not implement those document parsers itself.
- Native automation `doc_create_multiple`, in combine or separate mode, calls `Session::convert_to_pdf`, which reaches that converter. CLI batch conversion uses the same engine.
- Ordinary `doc_open` directly opens document bytes through the PDF session; do not substitute it for the conversion operation.
- Browser/WASM Office conversion returns an unsupported error.[P4], [P5], [P6], [P7]

LibreOffice discovery checks `PDFCRAFT_SOFFICE`, then PATH, then standard installation folders. Each conversion uses a private temporary job folder and fresh profile, disables macros/untrusted links, and stops at 120 seconds or a 512 MB output cap. This is not a general process/network sandbox. The executable and its fonts remain real dependencies; FORGE should present Office conversion as available only after local capability checks.[P4]

PdfCraft MCP is a separate headless stdio process, without a connect-to-running-app option. It supports `--root` and separate automation read/write roots. Discover schemas through its command/tool catalog rather than embedding an assumed permanent tool list. Its MCP documentation states that exports are synchronous and that progress-token and cancellation notifications are ignored. FORGE therefore cannot promise native percentage progress or acknowledged per-operation cancellation.[P8]

## 3. Windows and Thai qualification

For no-code users, ship or locate a qualified CLI through a FORGE dependency manager; do not require them to compile Rust, edit MCP configuration or discover executable paths. PdfCraft's Windows CLI can be installed under `%LOCALAPPDATA%\Programs\ArtCraft\PdfCraft` or `C:\Program Files\ArtCraft\PdfCraft`, with installer/platform variations, and is not automatically on PATH. Resolve and verify the actual executable. Keep developer toolchain requirements separate from the user's launch requirements.[P9]

PdfCraft has documented Thai existing-text handling, including legacy THSarabunPSK cases. Its optional `craft-fonts` Thai input can expose Noto Sans Thai as `builtin:thai`; availability depends on the build. Retaining subset fonts can fail when required contextual glyphs are absent, requiring the complete original face or an explicit permitted replacement. This is not evidence of Thai OCR support. WordCraft uses HarfRust shaping, but that alone does not establish end-to-end Thai fidelity.[P10], [W6]

Screen appearance is insufficient evidence: PdfCraft distinguishes native screen font fallback from export/printing/automation behavior. A report must be checked in the emitted PDF, including embedded fonts and searchable/copyable text. Qualify Thai vowels/tone marks, mixed Thai/English, wrapping, tables, bold/italic availability and page breaks with the exact release and font set. Record font provenance/redistribution terms; do not silently replace an institution's font.[P10], [P11]

## 4. Proposed FORGE report architecture

The following is a FORGE design recommendation, not functionality already implemented by these repositories.

1. **Versioned report source:** persist a `ReportSpec` with sections, structured tables, chart/image artifact references, source-data revisions, template version, language and font profile. Keep supplied facts separate from model-generated narrative, and retain agent/user authorship and evidence links.
2. **Reproducible generation job:** resolve data and assets at one revision, create a job-scoped staging folder and start a confined WordCraft session. Produce DOCX and direct WordCraft PDF from that document revision. Store engine/build, template, inputs and output hashes in an artifact manifest.
3. **PDF work:** use PdfCraft to inspect/render or perform requested PDF operations. A changed PDF becomes a new derived artifact with its own parent/revision. Optional LibreOffice conversion is a separately qualified route with its converter/font versions recorded.
4. **Review and publication:** expose previews, diagnostics and output downloads in FORGE. Publish the artifact record only after the job and required validation succeed; incomplete files remain staging outputs. Revision checks prevent a stale agent job from overwriting a user's newer document.
5. **Editable state boundaries:** Univer document/workbook state, a WordCraft document model, and emitted DOCX/PDF bytes are distinct representations. Any import/export mapping needs its own fidelity contract. Generating a PDF does not make it a live editable Univer document, and changing one does not silently update the others.

FORGE's harness remains the owner of the run, permissions and tool dispatch. The report adapter should not start an independent agent loop. AG-UI exposes FORGE's persisted job state and actual tool results. Show indeterminate rendering/export where the backend provides no progress, then completed/failed/interrupted with concrete artifacts or errors. To interrupt a synchronous PdfCraft task, isolate process ownership, stop it deliberately and reconcile outputs; do not report success merely because a cancellation request was sent. Never blindly replay an unknown-outcome mutation.[P8]

## 5. No-code UI and acceptance gates

Provide a Reports workspace with template selection, data/section selection, language/font settings, Generate, Preview, Edit source, Regenerate and Export. Engine settings belong in advanced settings; ordinary users should see actionable messages such as “required font missing” or “Office conversion needs LibreOffice,” with a supported setup route. Preserve both the editable source and published artifact history.

Required qualification before calling this integration complete:

- Generate a meaningful Thai/English report with headings, long tables, figures/captions, page breaks, links and source references; reopen DOCX and inspect/render the PDF. Check content and layout separately.
- Test missing-font/image strict failure, stale revisions, read/write-root boundaries, process interruption, invalid inputs and failed dependency discovery. Confirm failed or partial jobs do not become successful downloadable reports.
- Verify the actual installed CLI's discovered tools and optional fonts; prove Office conversion with installed LibreOffice if that route is advertised.
- Exercise a clean Windows no-code launch and export workflow. Until performed, label these as pending qualification, not passing results.

## 6. Redistribution boundary

Both repositories declare dual MIT/Apache-2.0 code licensing. Retain the chosen license's required notices and inventory bundled dependencies/fonts/assets rather than assuming the top-level license covers every file. Their ArtCraft brand license expressly excludes marks from the open-source code grant and requires replacement/removal in distributed modified versions; plain-text attribution is treated separately. FORGE should use its own product identity and preserve appropriate attribution. LibreOffice and any redistributed font/binary dependencies need their own packaging review.[W2], [P2], [W7], [P12]

## Pinned primary sources

[W1]: https://github.com/storytold/wordcraft/blob/bf2be3cad86d6c6a72d604676ab6ff3f0aa9478d/README.md
[W2]: https://github.com/storytold/wordcraft/blob/bf2be3cad86d6c6a72d604676ab6ff3f0aa9478d/Cargo.toml
[W3]: https://github.com/storytold/wordcraft/blob/bf2be3cad86d6c6a72d604676ab6ff3f0aa9478d/apps/wordcraft-cli/src/main.rs
[W4]: https://github.com/storytold/wordcraft/blob/bf2be3cad86d6c6a72d604676ab6ff3f0aa9478d/docs/target-app-parity.md
[W5]: https://github.com/storytold/wordcraft/blob/bf2be3cad86d6c6a72d604676ab6ff3f0aa9478d/docs/mcp.md
[W6]: https://github.com/storytold/wordcraft/blob/bf2be3cad86d6c6a72d604676ab6ff3f0aa9478d/crates/fonts/src/lib.rs
[W7]: https://github.com/storytold/wordcraft/blob/bf2be3cad86d6c6a72d604676ab6ff3f0aa9478d/docs/brand/LICENSE-brand.txt
[P1]: https://github.com/storytold/pdfcraft/blob/6e910675c68dd5092e889065cfe8d0274c1b2742/README.md
[P2]: https://github.com/storytold/pdfcraft/blob/6e910675c68dd5092e889065cfe8d0274c1b2742/Cargo.toml
[P3]: https://github.com/storytold/pdfcraft/blob/6e910675c68dd5092e889065cfe8d0274c1b2742/docs/target-app-parity.md
[P4]: https://github.com/storytold/pdfcraft/blob/6e910675c68dd5092e889065cfe8d0274c1b2742/crates/create/src/office.rs
[P5]: https://github.com/storytold/pdfcraft/blob/6e910675c68dd5092e889065cfe8d0274c1b2742/crates/automation/src/assemble.rs
[P6]: https://github.com/storytold/pdfcraft/blob/6e910675c68dd5092e889065cfe8d0274c1b2742/crates/automation/src/batch.rs
[P7]: https://github.com/storytold/pdfcraft/blob/6e910675c68dd5092e889065cfe8d0274c1b2742/crates/automation/src/documents.rs
[P8]: https://github.com/storytold/pdfcraft/blob/6e910675c68dd5092e889065cfe8d0274c1b2742/docs/mcp.md
[P9]: https://github.com/storytold/pdfcraft/blob/6e910675c68dd5092e889065cfe8d0274c1b2742/crates/automation/README.md
[P10]: https://github.com/storytold/pdfcraft/blob/6e910675c68dd5092e889065cfe8d0274c1b2742/docs/editing-existing-text.md
[P11]: https://github.com/storytold/pdfcraft/blob/6e910675c68dd5092e889065cfe8d0274c1b2742/docs/development.md
[P12]: https://github.com/storytold/pdfcraft/blob/6e910675c68dd5092e889065cfe8d0274c1b2742/docs/brand/LICENSE-brand.txt

