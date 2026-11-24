# Worker B: report engines handoff

Implemented on `t3/implement-report-engines`, from foundation `9d0a90f`.
Scope: `app/reports/`, `tests/reports*.test.mjs`, this note only. No push or PR.
Runtime reported by this T3/Codex session: **gpt-6.1-sol, xhigh**. No model switch,
subagents, provider turns, credentials, cloud purchases or public listeners used.

## Integration

Import `createReportService({dataDir,store})` from `app/reports/service.mjs`.
Requires the lead's **@modelcontextprotocol/sdk 1.32.2**; no additional dependency.
The worker did not change package manifests, locks, contracts, server or progress.
The service uses the contracted shared `jobs` and `artifacts` collections through
`read()` and serialized `transaction(fn)`. It also passed against the lead's actual
SQLite `openStore` implementation, including its synchronous `read()`.

Methods are async: `health`, `configure`, `generate`, `getJob`, `stop`,
`pdfOperation`, `download`; optional `shutdown()` stops currently owned jobs.
Call `await reports.shutdown()` **before** closing the store on application stop.
Errors carry `code`, `statusCode`, optional `details`.

`generate({operationId,projectId,reportId,expectedRevision})` returns the persisted
queued job immediately. Poll/invalidate from the authoritative store; do not replay
requests on SSE reconnect. Job fields include `id`, `owner:'reports'`,
`kind:'report'|'pdf'`, `attemptId`, `operationId`, `projectId`, `reportId?`,
`sourceRevision`, `frozenSource`, `sourceSha256`, `inputArtifacts`, `phase`, `status`,
`progress:{mode:'indeterminate',phase}`, `artifactIds`, `logs`, `error?`,
`validation?`, `provenance?`. There is no invented percentage.

Job states: queued → preparing → rendering → validating → ready; failures remain
failed/interrupted/unknown. Stop first records `stopRequestedAt` and stopping,
closes only handles registered to that job, checks process exit, inspects staged
file names/sizes and returns interrupted only with confirmed closure. Unknown
closure stays unknown. Native MCP cancellation acknowledgements are not assumed.
PIDs from a previous process are diagnostic only and are never killed on restart.

Duplicate operation IDs return the original job without engine calls; reusing an
ID for different arguments returns 409. Stale report/artifact revisions and
cross-project inputs fail. Editing the source while rendering preserves the newer
source and leaves outputs attributed to the frozen older revision. Consumers must
compare `sourceRevision` with the current report revision when labelling old output.

Artifacts include `id,projectId,kind,name,filename,path,locations,sha256,size,bytes`,
`status:'verified'`, `jobId,reportId?,sourceRevision,sourceSha256,parentArtifactIds`,
`lineage,provenance,validation`, standard revision/timestamps. `download(id)` returns
`{path,contentType,filename}` only after verifying published bytes/hash again.
Preserve this verification when mounting the common download route; returning a
raw artifact path through a generic fallback can bypass its changed-byte check.

## Setup API and qualification pins

`health()` returns `{schemaVersion:1,ready,engines,config,templates,setup,capabilities}`.
Each `engines.wordcraft/pdfcraft` has `status:'ready'|'not_installed'|'incompatible'`,
`ready`, optional `error:{code,message}`, `recovery`, `identity`, discovered tool
schemas and release/checksum guidance. WordCraft also exposes actual installed
`fonts.families`; top-level `fontProfiles` reports available/missing/changed font
profiles with recovery actions. Missing engines return actionable readiness, never
fake artifacts.

`configure` examples (HTTP routes are mounted by the lead):

```json
{"action":"install","engine":"wordcraft"}
{"action":"install","engine":"pdfcraft"}
{"action":"discover","engine":"wordcraft"}
{"action":"reset"}
```

Advanced local configuration can set `wordcraft:{path:"absolute CLI path"}`,
`pdfcraft:{path:"absolute CLI path"}`, or clear either with null. No arguments,
shell strings, generic scripts, arbitrary URLs or arbitrary MCP tools are accepted.
Only the actual pinned executable hash/version is allowed. Discovery checks PATH,
standard ArtCraft install folders and FORGE-owned acquired packages. Install
downloads a fixed official portable asset, verifies the pinned archive SHA-256,
uses bounded CRC/length/traversal-checked ZIP extraction, retains all notices, then
checks executable SHA-256 and discovered version/schemas. It does not run MSI,
install globally, modify PATH or require Rust. Automatic acquisition is Windows
x64; other platforms/builds are explicitly unqualified.

Machine settings live at `<dataDir>/reports/machine-settings.json`; package caches,
staging and published files are below that report data root. No developer home path
is embedded in application source. Historical jobs retain actual engine/font/source
provenance; source ReportSpec does not hold executable paths. These native settings
should stay machine-local when the lead implements portable backup/restore.

Font configuration accepts `fonts:[{family,version?,license?,paths?:[]}]`. Paths are
advanced, optional local files; configured files are hashed, and missing/changed
files fail generation. Font profiles do not import or redistribute fonts. Choose an
exact available family; the renderer refuses missing families, font substitution,
missing glyphs and omitted pictures. If version/files are not supplied, provenance
explicitly says `system-version-unrecorded`; that is not exact font qualification.

| Engine | Released source / build | Official portable archive SHA-256 | CLI SHA-256 |
|---|---|---|---|
| WordCraft | 0.18.1 / `079f478bd85df7bcc567e3bafa7d7219096f9c3c` | `257f670514057cb14967b88c85ac82d165da43ee7671e185acead61420af0389` | `30981622793de8ef7e1bda4aa577cef104527107b1f9fc89719208ab20081211` |
| PdfCraft | 0.22.0 / `ac140f809d554981a5276d748e6193fcf4d4bdfa` | `193394d15b923510e917912c0142b38119a8d4369b30693d97ef086444e9e314` | `256da95e1e7450b482e48578117923f88b3d430163316f7b34296a18d83ae371` |

These are released tag/source commits, not the later main-branch research snapshots.
Primary evidence: [WordCraft release](https://github.com/storytold/wordcraft/releases/tag/v0.18.1),
[released MCP docs](https://github.com/storytold/wordcraft/blob/v0.18.1/docs/mcp.md),
[WordCraft checksum manifest](https://github.com/storytold/wordcraft/releases/download/v0.18.1/SHA256SUMS.txt),
[PdfCraft release](https://github.com/storytold/pdfcraft/releases/tag/v0.22.0),
[released MCP docs](https://github.com/storytold/pdfcraft/blob/v0.22.0/docs/mcp.md),
[PdfCraft checksum manifest](https://github.com/storytold/pdfcraft/releases/download/v0.22.0/SHA256SUMS.txt).
API release metadata and actual archive/executable bytes were checked on 2026-11-24.
Pin changes require new build/API/fidelity qualification; readiness does not track
an unverified moving latest release.

Both engines declare **MIT OR Apache-2.0**. Retain their release LICENSE/NOTICE,
third-party font/asset notices and separate brand terms. ArtCraft marks are not
licensed by the code license. FORGE uses its own identity and does not redistribute
modified binaries or the local Windows fonts. SDK is MIT. Optional LibreOffice,
Exchange and additional fonts need their own qualification/license records.

## Supported render and PDF mapping

ReportSpec schemaVersion 1 is frozen with the selected report/project revision.
Supported template identities: `{id:'engineering',version:1}` and
`{id:'blank',version:1}`. These are FORGE deterministic styles applied to a new
blank WordCraft document, not upstream demo documents.

| Source | Implemented mapping / limit |
|---|---|
| Title / ordered section headings | WordCraft Title / Heading1 styles, body Normal, explicit family/language |
| Section text | Paragraph-aware insertion; source text verified before export and after DOCX reopen |
| `section.table` | `{values:[[scalar]],header?:true}`, rectangular up to 1000 rows × 63 columns, repeating header |
| `section.figure` | `{artifactId,revision,caption?,width?}`, verified project PNG/JPEG copied into the job; width max 450 pt |
| `section.pageBreakBefore` | Actual WordCraft `insert.pageBreak` command |
| `citations` | Text or `{title,url?}`; actual `insert.link` for HTTP(S) citation targets |
| `inputs` | Explicit `{artifactId,revision}`; project/revision/hash checked before staging |
| DOCX / PDF | Same in-memory WordCraft document/source; PDF uses `file.strictReport` and `file.exportPdf strict:true` |
| Univer native snapshots | Not consumed implicitly. Lead/UI must deliberately extract supported sections/ranges and retain selected document revisions; editing output never rewrites the native snapshot or ReportSpec |

Each headless session is confined to one job directory, including copied inputs.
Tool schemas are discovered and validated using the SDK's Ajv validator; WordCraft
commands are discovered from its actual command catalog. The service does not use
`--connect`, live desktop sync, shell execution or a second planner/provider loop.
DOCX ZIP integrity/required OOXML parts and re-opened content are checked. PdfCraft
reopens the PDF, checks unreadable/repair reports and extracted source text, then
renders PNG bytes. Format checks, sizes and hashes precede an atomic manifest and
publication. Recovery reconciles a complete verified manifest without rerendering;
partial/corrupt/uncertain attempts never automatically replay effects or publish.

`pdfOperation` accepts:

```json
{"operationId":"unique","projectId":"project-id","artifactId":"pdf-id","expectedRevision":1,"operation":"inspect"}
{"operationId":"unique-2","projectId":"project-id","artifactId":"pdf-id","expectedRevision":1,"operation":"render","page":1}
{"operationId":"unique-3","projectId":"project-id","artifactId":"pdf-id","expectedRevision":1,"operation":"rotate","degrees":90,"pages":[1]}
```

Inspect stores real metadata/text on the job without inventing an output artifact.
Render publishes a validated PNG; rotate saves/reopens a new PDF plus PNG, checks
that searchable text content is preserved, and records the parent PDF artifact.
Pages are 1-based. Rotation is 90/180/270 degrees (negative equivalents accepted).
Optional Office conversion and Univer Exchange return separate **unavailable**
capabilities; this worker enables neither and claims no quotas, entitlements,
LibreOffice route, native snapshot conversion or lossless Office round trip.

## Developer evidence (2026-11-24)

`node --test tests/reports-lifecycle.test.mjs`: **12 passed**. All adapter/format
payloads here are explicitly labelled lifecycle fixtures, not real-engine evidence.
Coverage: concurrent duplicate delivery, differing-payload ID conflict, frozen
source versus newer edits, persistence/restart, complete-manifest reconciliation,
unknown outcomes without replay, corrupt settings/outputs, partial engine failure,
missing fonts/engines, project/revision/path/junction boundaries, confirmed and
unconfirmed owned-process Stop, changed downloadable bytes and bounded ZIP checks.

PowerShell real qualification command, after engineering cache acquisition:

```powershell
$env:FORGE_REPORT_REAL='1'
$env:FORGE_REPORT_KEEP='1' # retain engineering output only if desired
node --test tests/reports*.test.mjs
```

`FORGE_REPORT_REAL` uses the official cached packages under
`%LOCALAPPDATA%/FORGE/report-engine-research/<engine>-<version>/<portable-name>/`.
It is optional so ordinary unit tests do not download/execute binaries silently.
It passed with SDK 1.32.2 and also with the lead's actual SQLite store by setting
`FORGE_REPORT_STORE_MODULE` to the integration checkout's `app/server/store.mjs`.
The real suite generated a 3-page mixed Thai/English report with 45 table rows,
figure/caption, page break and clickable citation; reopened DOCX and PDF;
checked searchable Thai and embedded Tahoma/Tahoma-Bold; rendered preview;
performed/reopened rotation with parent lineage; tested missing-glyph and missing-
picture strict failures; proved both native root refusals; stopped one owned real
session while another report completed; rejected a corrupted downloadable PDF.
The negative changed-byte test restores the original evidence bytes afterwards.
First-page native preview was also visually inspected; full pagination/copy-order
review remains home UAT.

Latest retained real/SQLite evidence: `%TEMP%/forge-report-real-CV8MMV/`.
The job's published directory contains `manifest.json`, `report.docx`, `report.pdf`,
`preview.png` and frozen staged source/figure input. Example original output hashes:

| Kind | Bytes | SHA-256 |
|---|---:|---|
| DOCX | 8214 | `d1d5c77d846081b6683e2285ea94c2425952c47eeb225ca94c5da68fbbda0675` |
| PDF | 63865 | `58d8915a54a674c9058b892bab60ec998190229a8e5d90ffccb54b3c7cf24e1a` |
| PNG | 96419 | `9fe9689053ead503f0c4b181cad5e0dd4f1ba07fb7ee8dc684e36e7551fb9e12` |

Exact local regular/bold font file hashes are stored in that manifest. They are
local Windows fonts, not redistributed assets. Strict success, embedded font flags
and searchable text do not prove all Thai layout, typography or Word pagination.
DOCX/PDF hashes can differ between regenerations; no byte-determinism is promised.

Actual no-code service acquisition was tested independently:

```powershell
$env:FORGE_REPORT_ACQUIRE='1'
node --test --test-name-pattern 'REAL no-code' tests/reports-real.test.mjs
```

**Passed**, about 61 seconds: `configure({action:'install',engine:...})` downloaded
both official packages into a disposable data root, checked/extracted them,
initialized the native tools, rediscovered the WordCraft installation, and reopened
settings after service restart with both engines ready. Evidence cache:
`%LOCALAPPDATA%/FORGE/report-acquisition-2H0Bqm/`. No package or binary is tracked.

## Remaining boundaries and exact next task

No external engine acquisition blocker remains for this Windows x64 development
machine. No live credentials are needed for the implemented local engine route.
Missing live credentials must not be used to describe these implemented engines as
untested; their binary/runtime checks above are real.

Integration tasks owned elsewhere: mount/present the service methods in the GUI,
preserve download verification, call shutdown before store close, wire deliberate
Univer-to-ReportSpec extraction rather than passing native snapshots, and exclude
machine executable/font settings from portable profile restore. This worker did
not edit those shared/UI paths. The initial PDF preview is page 1; additional pages
are rendered through explicit `pdfOperation` calls. There is no converter for
arbitrary rich Word/Univer structures or a general template/script editor.

**HOME_UAT_NOT_RUN**: clean home Windows installation/GUI flow, institution-specific
fonts, full Thai mark/line-wrap/page-break/copy-order review and Microsoft Word
rendering fidelity. Optional LibreOffice/Exchange conversion is disabled, not a
passed or credential-blocked feature. Non-Windows/x64 qualification is not provided.

Next executable task for lead: cherry-pick this scoped worker commit, run
`node --test tests/reports*.test.mjs`, then enable `FORGE_REPORT_REAL=1` using the
cached qualified builds and the integrated store. Exercise GUI Install → choose
template/font → Generate → Preview → Rotate → Download, including missing-font
and Stop/reload states. Record overall acceptance centrally after that integration;
the worker evidence alone does not close complete-product A25–A30 or home UAT.
