# Static development launcher downloads — worker handoff

This worker adds a publication generator, verifier and focused packaging tests. It
does not publish a website or qualify product execution. Only the new paths
`tools/launcher-downloads/**`, `tests/launcher-downloads.test.mjs` and this document
are owned here. Shared server, website, package/lockfiles, progress and legacy
portable files are unchanged.

## API and commands

Run with the project's pinned dependencies already available to Node. Generation
uses Git and Node.js 24.13+; it does not install dependencies or launch the product.

```js
import {
  generateLauncherDownloads,
  verifyLauncherDownloads,
  publicationFiles,
} from './tools/launcher-downloads/generate.mjs';

const manifest = await generateLauncherDownloads({
  sourceRoot: '/absolute/path/to/forge-git-root',
  outputDirectory: '/absolute/path/to/new-publication-directory',
});
await verifyLauncherDownloads({
  sourceRoot: '/absolute/path/to/forge-git-root',
  outputDirectory: '/absolute/path/to/new-publication-directory',
});
```

PowerShell CLI (use actual absolute paths; output must not exist):

```powershell
node tools/launcher-downloads/generate.mjs --source-root "$PWD" --output-directory "C:\publication-staging\forge-new-revision"
node tools/launcher-downloads/generate.mjs --verify --source-root "$PWD" --output-directory "C:\publication-staging\forge-new-revision"
node --test tests/launcher-downloads.test.mjs
```

Both APIs require explicit `sourceRoot` and `outputDirectory`. The source must be
the root of a Git repository/worktree, not a subdirectory or extracted installation.
Generation pins `HEAD`; worktree changes and untracked files are excluded. A change
of `HEAD` during packaging fails the operation. Verification uses the full commit
recorded in the manifest, so a later `HEAD` does not invalidate an older publication.
That commit must remain readable in the supplied repository.

Generation always starts with a fresh temporary cache and invokes the existing
`createDownloadService` from `app/server/downloads.mjs`. It is the sole ZIP writer.
`canonical-build.mjs` runs this service in a child process with `TZ=UTC`, because
fflate writes DOS timestamps using local calendar fields. Caller environment,
committed files and the shared download service are not modified. The resulting
bytes are deterministic for the same source commit and generator/dependency version,
including across caller time zones and differing file modification times.

The bundle is built and verified in a sibling temporary directory, then exposed by
one directory rename. **Existing output directories are refused**, preserving their
contents. Generate into a fresh revision directory; the integration owner controls
the later website mount/switch. The caller must exclusively own the destination
during generation. Temporary ZIP caches and staging directories are removed on
success or failure. No website paths are special-cased or written by this worker.

## Fixed publication files and manifest v1

The output directory contains exactly:

- `FORGE-Windows.zip`
- `FORGE-macOS.zip`
- `manifest.json`
- `SHA256SUMS`

`publicationFiles` exports this frozen filename list. Every platform record has a
fixed basename `path`, fixed `filename` and fixed root-relative public `url` under
`/downloads/`. The generator never derives filesystem paths from manifest input.
`SHA256SUMS` has two LF-terminated lines, Windows then macOS, formatted as
`<lowercase sha256><two spaces><filename>`.

The JSON schema is represented below; placeholders describe values, not literal
output. The `platforms` array has exactly two records, Windows then macOS.

```json
{
  "schemaVersion": 1,
  "product": "FORGE",
  "version": "<committed package.json version>",
  "commit": "<full 40-character source SHA>",
  "status": "alpha",
  "packageKind": "unsigned-development-source-launchers",
  "signed": false,
  "requirements": [
    "Node.js 24.13+",
    "Internet on first launch for npm ci and pinned dependencies",
    "Extract the entire FORGE folder before using Start/Stop/Restart"
  ],
  "limitations": [
    "Unsigned development source launcher packages; no bundled Node.js or native runtime",
    "Packaging checks do not qualify Windows/macOS execution or complete the product release",
    "Native report-engine acquisition is currently qualified only on Windows x64; macOS qualification pending"
  ],
  "qualification": {
    "archiveValidation": "PASSED",
    "platformRuntime": "NOT_RUN",
    "nativeMacos": "NOT_RUN",
    "liveProduct": "NOT_RUN",
    "homeUat": "NOT_RUN",
    "productReleaseComplete": false
  },
  "platforms": [
    {
      "id": "windows",
      "label": "Windows",
      "filename": "FORGE-Windows.zip",
      "path": "FORGE-Windows.zip",
      "url": "/downloads/FORGE-Windows.zip",
      "contentType": "application/zip",
      "sha256": "<64-character lowercase SHA256 of ZIP bytes>",
      "bytes": 123,
      "sourceFiles": 123,
      "embeddedQualification": "developer-verified-local-core",
      "qualification": {
        "archiveValidation": "PASSED",
        "platformRuntime": "NOT_RUN",
        "nativeMacos": "NOT_RUN",
        "liveProduct": "NOT_RUN",
        "homeUat": "NOT_RUN",
        "productReleaseComplete": false
      }
    }
  ]
}
```

The second platform record uses `id: "macos"`, `label: "macOS"`,
`filename/path: "FORGE-macOS.zip"`, `url: "/downloads/FORGE-macOS.zip"` and
`embeddedQualification: "NOT_RUN"`. Its other fields have the same meaning.
`sourceFiles` is the count of committed files, excluding generated
`FORGE/release-info.json` and `FORGE/README_FIRST.txt`. `embeddedQualification`
copies the canonical archive's existing source metadata for provenance; it is
**not evidence of platform execution by this generator**. Each top-level and
per-platform qualification object states only the generator's actual scope.

The verifier checks exact fixed output files, ZIP bytes/lengths/SHA256SUMS,
qualification, version/commit, ZIP CRC/size/path safety, source manifest hashes
and complete inventory. It independently compares every source file with its
Git blob object from the recorded commit. macOS Start/Stop/Restart `.command`
entries must have executable `0755` mode. Committed links, case-colliding paths,
Windows-unsafe filenames, credential-state filenames and bundled native/runtime
files are rejected. This is a source/path integrity boundary, not an arbitrary
secret scanner; review committed source before authorizing public distribution.

## Verification performed

- `node --test tests/launcher-downloads.test.mjs`: **9/9 passed** on Windows,
  Node.js v24.19.0. Tests use a real disposable Git repository, actual project
  launcher/lock/license files, archive extraction and independent source checks.
  Covered explicit paths, committed-only output, deterministic cross-time-zone
  bytes, preserving existing output, tampering, invalid permissions, cleanup after
  incomplete canonical archives and rejection of committed machine data/missing
  launchers. No dependency installation, native
  build, full application build, browser session or runtime launch was performed.
- Actual temporary packaging and verification against source commit
  `170274df3fe8508721de5633826d47a2a9d0038c`: **PASSED**, 368 committed source files
  per archive. Windows ZIP: 1,254,249 bytes, SHA256
  `c023ea65cb607de957b2bf3b4227ab0438c97372159365b5f414a59e05d8f65c`.
  macOS ZIP: 1,254,237 bytes, SHA256
  `f4db038b69e5af0aac733165e63be4b3457ef54bc804c289277b4d3d2681be04`.
  Both temporary archives were removed. They are not final packages for the
  parent's later strategy/native fixes, and no publication output is committed.

## Remaining integration and qualification

The integration owner must commit pending product fixes, integrate this worker,
then generate a new bundle from the intended final source commit. Mount those
actual bytes at `/downloads/FORGE-Windows.zip` and `/downloads/FORGE-macOS.zip` on
the static public landing. Expose `manifest.json`/`SHA256SUMS` there as appropriate
and wire landing metadata to the generated version, source SHA, sizes, hashes,
requirements and explicit unsigned development status. A source-repository link
alone is not a launcher download. For a hosting subpath, the owner must account
for the fixed `/downloads/` public URL contract when mounting/routing.

Verify the final mounted files and website download links after the final source
regeneration. This worker did not deploy, push, alter accounts, edit native caches
or touch protected legacy payloads. The packages contain real Start/Stop/Restart
`.cmd` and `.command` launchers plus application source, lockfile and licenses;
they require Node.js 24.13+ and first-launch network access for npm dependencies.
They are unsigned source launchers, not signed installers or bundled runtimes.

**NOT_RUN:** real-product/external-server execution under work-machine restrictions,
native macOS execution, signed installer qualification and home UAT. Those remain
separate from archive validation. No claim of a completed product release or final
newer-source packages is made here.
