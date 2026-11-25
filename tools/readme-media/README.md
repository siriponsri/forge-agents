# Reproduce prepared README media

This tool captures the built production FORGE App against fresh SQLite state,
actual loopback HTTP, browser session and CSRF. It never reads Owner projects,
uses accounts, invokes a model, opens public hosting, or runs a product pilot.
Only provider/agent/run/tool observations are injected, with visible qualification
on every related frame and matching manifest alt text/captions. Mission source
files are deterministic engineering inputs. Local tests, preview, QA/Owner GUI,
verified ZIP, mounted Univer edits/saves/reopens, native reports, central Owner
grant and CPU execution must succeed through real implementations.

## Requirements and commands

Use the repository lockfile installation (Node >=24.13, locked Playwright
1.65.1), its already installed Chromium, existing ffmpeg on PATH, and Python
with Pillow. No package installation or unpinned download happens in these tools.
An ignored `node_modules` junction to the root lockfile install is supported in
an isolated worktree. The tool does not create that junction or change lockfiles.

From the final integrated checkout, run these commands sequentially:

```powershell
npm.cmd run build
node tools/readme-media/capture.mjs
python tools/readme-media/render.py
python tools/readme-media/verify.py
git diff --check
```

The first command builds `app/web/dist`; capture requires unchanged production
source and reads `git rev-parse HEAD` at runtime. Documentation-only changes are
recorded separately. A new capture uses fresh state, a fresh private fixture vault,
a neutral disposable workspace, and a headless Chromium video. It blocks all
non-loopback browser requests. No browser cookies, CSRF values, raw state, secret
files, auth URLs or credentials are published. The runtime loopback port is random.

Native Windows report engines are discovered only in the existing
`%LOCALAPPDATA%/FORGE/report-engine-research` cache: WordCraft 0.18.1 and PdfCraft
0.22.0 portable packages. Set `FORGE_MEDIA_REPORT_ENGINES` to another already
qualified cache root with the same package layout. System Tahoma files are used
and hashed by the report service, never redistributed. Setup is through actual
local HTTP before opening Report Studio, keeping private executable paths out of
the recording. Missing engines produce an explicit `NOT_RUN` gap and no fake
report image. A discovered but failing engine fails capture.

## Outputs and review

- `docs/media/screenshots`: original 1440×1000 desktop and 390×900 mobile PNGs.
- `docs/media/sources/*-full.png`: original, full-resolution full-page PNGs.
- `docs/media/sources/walkthroughs.webm`: actual continuous Chromium recording.
- Four GIFs: selected contiguous intervals at 2x speed, 5 fps, 1008px width,
  128-color palette. A 0.6s trailing guard interval excludes adjacent navigation.
  No interpolation, invented frames or simulated success.
- `docs/media/manifest.json`: revision, tools/model/options, timing, source,
  qualification, numbered steps, alt/captions, output receipts and SHA-256/bytes.
- `docs/media/README.md`: generated gallery with qualification adjacent to each
  image/GIF, static alternatives and numbered instructions.
- `docs/media/verification.json`: complete decode, size, frame, hash, privacy-text
  and actual output/effect receipt checks. GIFs must each be <=8 MiB.

Captions are the only DOM annotation. No UI state or successful execution is
painted over the App. Full-page originals can place sticky chrome partway through
a long page; use viewport PNGs in the README for legibility. The first walkthrough
starts with the ready localhost App, not a filmed Windows launcher or clean install.
The unknown graph run remains unknown. CPU execution happens before introducing
that observation because the production writer fence correctly blocks uncertainty.

Inspect all viewport PNGs, mobile captures, each GIF's numbered captions and
representative early/middle/late frames. Confirm privacy on the *raster/video*,
including neutral workspace and output names; text scanners cannot prove raster
privacy. Verify static links and numbered steps. The raw video is a provenance
asset, not the lightweight first README view. Do not publish runtime diagnostics.

Every capture is **PREPARED_MEDIA_NOT_FINAL_RELEASE_VERIFICATION**. Refresh against
the final merged tree and rerun decode/privacy/editorial review before release.
The root README, final acceptance ledger, release checks and push remain lead-owned.
`HOME_UAT_NOT_RUN` and account/macOS/remote checks remain explicit. Native guarded
automation is not exercised by this media capture; separate bounded native
developer checks and limitations are documented in [the route guide](../../docs/guarded-route.md).
Media provenance does not qualify native automation or external accounts.

## Cleanup

The browser/context, local preview and application services are closed in `finally`.
The exact neutral workspace and state/vault/video fixture directory created by
capture are removed. On Windows these are neutral `C:\FORGE-MEDIA-*` directories,
so artifact paths do not expose a private user profile. The vault remains outside
the application data subtree. Cleanup receipts are written to the manifest only
after cleanup succeeds. A failed screenshot under `tools/readme-media/dist` is
ignored. Never check in runtime state or use an Owner workspace to refresh media.
