# Native Office image persistence handoff

Worker: `t3/office-image-persistence`, base `6891b26`, 2026-11-24 (Asia/Bangkok).
Actual inherited runtime: **gpt-6.1-sol, xhigh**, through T3 Code / Codex. No model switch or nested worker.

Assigned paths only: `app/web/src/univer.mjs`, new `app/web/src/office-drawings.mjs`,
`tests/office-drawings.test.mjs`, `app/web/tests/drawings-smoke.mjs`, this handoff.
No Office.jsx, server/domain, manifest/lock, central progress, legacy or release changes.

## Lead dependency integration

Add exact root dependencies and regenerate the root lockfile in the lead worktree:

```text
@univerjs/preset-docs-drawing  1.6.1
@univerjs/preset-sheets-drawing  1.6.1
```

They match the existing `@univerjs/presets`, `preset-docs-core`, `preset-sheets-core` 1.6.1.
No other direct dependency is needed. Both drawing presets and their drawing plugins are Apache-2.0;
no pro, AI SDK, Exchange or collaboration package is added.
Worker verification installed locally with:

```powershell
npm.cmd install --no-save --package-lock=false @univerjs/preset-docs-drawing@1.6.1 @univerjs/preset-sheets-drawing@1.6.1
```

Inspected published 1.6.1 package declarations and ES implementations (not a guessed upstream API):

- `@univerjs/core/lib/types/services/image-io/image-io.service.d.ts`: public image I/O identifier/contract/statuses.
- `@univerjs/drawing/lib/types/services/image-io-impl.service.d.ts`: public `ImageIoService` implementation, observable/cache contract.
- `@univerjs/presets/lib/types/preset.d.ts`: `IPreset.plugins`, configuration tuples and `createUniver`.
- Both drawing preset `lib/es/index.js`: preset composition and public plugin re-exports.
- `@univerjs/docs-drawing/lib/types/facade/f-document.d.ts`: `insertImage`, text range and image Facade.
- `@univerjs/sheets-drawing/lib/types/facade/f-over-grid-image.d.ts` and `f-worksheet.d.ts`: builder, `insertImages`, `getImageById`.
- `@univerjs/sheets/lib/types/facade/f-workbook.d.ts`: `getSheetBySheetId`.

Primary guides: [Sheets images](https://docs.univer.ai/guides/sheets/features/images),
[Docs images](https://docs.univer.ai/guides/docs/features/images),
[drawing preset](https://docs.univer.ai/reference/packages/presets/univerjs/preset-sheets-drawing).
Published npm metadata verified both preset versions and their matching 1.6.1 dependency lists.

The native picker runtime test caught a significant configuration distinction: top-level
`createUniver.override` only overrides core-owned dependencies. Image I/O belongs to
`UniverDrawingPlugin`. We map that existing plugin's **public preset config tuple** to add its
`IImageIoService` override. We do not register any plugin twice or enable collaboration.
`mergeLocales` is shallow in 1.6.1; the one improved error message explicitly preserves the
drawing locale's other nested keys.

## Implementation and toolbar call shapes

The current return API is retained: `snapshot/rawSnapshot/undo/redo/dark/apply/dispose`.
Two bounded async methods are added:

```javascript
// Docs: default index is 0; explicit text offset and dimensions are optional.
const result = await editor.current.insertImage(file, { index: 0, width: 320 });
// Sheets: explicit sheet identity is recommended. Default anchor is A1.
const result = await editor.current.insertImage(file, {
  sheetId: 'sheet1', row: 2, column: 1, width: 320,
});
// result: { artifactId, sha256, source, imageId, region, summary }
// source is the real same-origin /api/artifacts/ID/download URL.

// Upload without inserting or modifying native content:
const asset = await editor.current.uploadImage(file);
// asset: { artifactId, projectId, source, sha256, bytes, name, mimeType, width, height }
```

Lead owns Office.jsx toolbar integration. Use its existing busy/lock/error handling, await
`insertImage`, and allow the normal dirty + revision-aware save path to persist the result.
`insertImage` calls the existing onChange callback; do not remount or replace the snapshot.
Keep the `File` object for a retry after a lost acknowledgment to reuse its upload operation ID.
The SDK's built-in Docs and Sheets file pickers are also wired through the same service and verified.

Both methods accept real PNG/JPEG files up to **5 MB**, sniff bytes, decode the image, and call
only the fixed `POST /api/artifacts/upload` boundary with
`{operationId, projectId, name, kind:'figure', base64}`. The response must carry the actual
owning project, artifact ID, byte count and SHA-256 matching the uploaded bytes.
The browser does not supply a target path or arbitrary upload endpoint.

Drawing insertion uses the public Docs insertion or Sheets image builder/command, preserving
Univer's live undo/redo. The drawing gets a fresh identity per insertion even when content
deduplicates to the same artifact. SHA-256 and artifact identity are retained in a versioned
`FORGE_IMAGE_ASSETS_V1` native snapshot resource. The SDK still owns supported drawing/plugin
resources; those are retained without reconstruction. Native vector shape SVG sources remain
plugin-owned and are not mistaken for uploaded bitmap images.

`snapshot()` validates drawing sources and includes only currently referenced image assets.
`rawSnapshot()` retains even an invalid/temporary source for dirty detection and recovery.
An invalid image cannot silently disappear to make save succeed. Manifest entries remain
available in the live service through undo/redo; unused ones are omitted from the saved resource.
Raw snapshots remain available on a save/network/revision failure, and no save receipt is issued here.
Native restore reloads URLs from durable project artifact storage; no blob/file URL is persisted.

`apply({kind:'sheet.setValues',sheetId,range,text})` now resolves the explicit sheet with public
`getSheetBySheetId`. An invalid/missing explicit ID fails; it never edits the active sheet instead.
Omitting sheetId retains the prior active-sheet behavior. No edit-queue/domain API is changed.

Disposal is idempotent, unsubscribes command events, cancels timers/HTTP uploads, clears image
caches and prevents an in-flight helper upload from inserting into a closed editor. The existing
theme and accent behavior is preserved.

## Verification

- `node --test tests/office-drawings.test.mjs` — **3/3 PASS**: plugin resources/asset identity,
  removed-image manifests and undo restoration, vector shapes, durable-source validation and
  recovery preservation, wrong project and explicit sheet routing.
- `node app/web/tests/drawings-smoke.mjs` — **PASS**, real mounted Univer + actual HTTP upload/
  artifact/download service + separate FORGE OS process. Both PNG/JPEG helper insertion and
  both SDK native file pickers, native image undo/redo, explicit non-active sheet editing,
  stale save/network/upload failures retaining local edits, cross-project server rejection,
  lost acknowledgment receipt replay, repeated disposal and disposal during upload.
  The original FORGE process exits; a different process/PID reads the same persisted state;
  a fresh browser page reopens both editors. The native canvases must paint the colored fixture,
  and downloaded bytes decode to the expected dimensions/pixel color and SHA-256.
- Final browser evidence: `C:/Users/siripon.sri/AppData/Local/Temp/forge-drawings-q3kgKS/evidence.json`;
  adjacent `sheet.png`, `doc.png`, `reopened-sheet.png`, `reopened-doc.png`.
- `npm.cmd run build` — **PASS**. Existing Radix `use client` and large bundle warnings remain.
- `npm.cmd test` — **111 pass, 2 fail, 5 skipped / 118**, run concurrently with browser/build.
  The two failures were outside owned paths: compute preflight fixture observation timeout and
  report corrupt-PDF fixture `EPERM` rather than `INVALID_OUTPUT`. Both passed on isolated rerun:
  `node --test --test-name-pattern='stop during preflight' tests/compute-adapters.test.mjs` and
  `node --test --test-name-pattern='corrupt PDF' tests/reports-lifecycle.test.mjs`.
  Do not describe that broad run as all-green; the lead should check the integrated tree.

## Remaining integration/qualification boundaries

- Lead must commit the coordinated dependencies/lock and wire any FORGE-specific toolbar button.
  Existing SDK native file menus work without that toolbar addition.
- Lead should run the normal Office GUI regression after merging Office.jsx/editqueue work.
  The focused harness mounts the actual editor but does not claim the parent React toolbar was edited.
- Previously embedded base64 or external bitmap sources need deliberate file re-upload; a save
  fails with recovery available instead of claiming durability for an external URL. PNG/JPEG
  is the supported upload subset; this is not an Office-format lossless conversion claim.
- Live undo is session-local. Restart restores the native drawing state/resources and durable
  history, not the in-memory undo stack.
- Uploaded artifacts are retained even if insertion is cancelled/undone or save later fails;
  deleting project artifacts is a separate retention decision. A cancelled request may already
  have committed server bytes; editor disposal never deletes durable project data.
- **Confirmed lead-owned integration gap:** complete storage restore's `remap` in
  `app/storage/service.mjs` (~266) treats serialized plugin/resource data as opaque strings
  apart from artifact URL replacement. It must parse this named manifest's `data` and remap
  its `artifactId`, `projectId` and `source` together. Current code also skips every object
  property named `source` as provenance; actual Docs `drawings.*.source` URL strings must be
  remapped, while provenance source objects may remain portable. Otherwise a restored document
  retains a foreign ID/URL and is correctly refused. Reported directly to the lead; no storage
  files edited. Do not claim cross-project storage restore until integrated and tested.
  Ordinary save/reopen/service restart is verified. Metadata-only artifact backup excludes bytes.
- No live credentials are needed for the implemented image path. **HOME_UAT_NOT_RUN** for owner
  content, home-machine fonts/input and broader file-size/content variations. Optional commercial
  conversion/collaboration and provider accounts were not activated or tested.

No push, main change, public service, compute purchase or prototype activation occurred.
