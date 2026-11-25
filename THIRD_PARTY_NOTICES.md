# Third-Party Notices

Original FORGE code is Apache-2.0 under the root LICENSE and NOTICE following
the owner's decision of25 November2026. The grant does not replace any license
or attribution below or in separately packaged dependencies and legacy payloads.

The optional AO Limited adapter interoperates with Agent Orchestrator by
Untrivial AI. The evaluated target is release `v0.13.0`, commit
`15e9ea971f1711ec8b50e157d6eb300db6cbe0d6`, licensed under Apache-2.0.

Agent Orchestrator source or binaries are not included in this repository.
Users must obtain and validate it separately under its own license.

Orca is evaluated as an external reference candidate and is not bundled. The
evaluated target is `stablyai/orca` release `v1.4.204`, commit
`4f7baefc4f5c49181d54046763e083a4628662d8`, licensed under MIT. No Orca
source, installer, binary, account data or runtime state is included here.
# FORGE v3 workbench additions

Playwright1.65.1 (Microsoft): Apache-2.0; runtime dependency for owned Chromium
targets. Browser acquisition uses the pinned package installer and retains the
downloaded browser's own notices. No owner browser profile is bundled.
LitServe0.2.19 and FastMCP2.14.7: Apache-2.0; Python MCP1.30.0: MIT.
Pinned isolated serving dependencies are in app/serving/requirements.txt; upstream
provenance and qualified platform evidence are in docs/worker-serving.md.

fflate0.8.3 (101arrowz/fflate), MIT: source archive generation, preserving Unix
launcher permission attributes. Downloaded installations verify their source-file
manifest before rebuilding packages without requiring a Git checkout.

Manrope and IBM Plex Sans Thai, @fontsource5.3.0: SIL Open Font License1.1;
unmodified bundled webfont subsets and copyright/license text are served at
`font-notices.txt`. See app/web/public/font-notices.txt. VS Code named theme palette
source is Microsoft/vscode MIT, source pin recorded in design.md and theme notices.

T3 Code: MIT, copyright2026 T3 Tools Inc. Source releasev0.1.11,
commit59651c1761f6c63e9b6056839067066968e6a406. Copied launcher/license and
modification record are in app/vendor/t3; matching release GUI/server remains an
unmodified acquired distribution. Keep its bundled notices.

The separate optional Guarded route builds a private derivative of that pinned
T3 source and OpenCode 2.4.1 at 6f0514052a3c859894ad01bb14cc14dda1e44b96 (MIT).
Its modification records, original MIT license files and reproducible patches
are in app/guarded-runtime/native and docs/worker-guarded-runtime.md. It does not
replace the ordinary acquired T3 distribution. Private installed bundles retain
T3/OpenCode/Node notices; Node and build-tool distributions retain their own
licenses. Machine binaries, credentials and toolchain caches are not in Git.

Univer core/presets1.6.1: Apache-2.0 (dream-num/univer). React/react-dom19.2.4,
AG-UI core1.0.5 and MCP TypeScript SDK1.32.2: MIT. Vite7.3.8: MIT.
Lucide React0.575.0: ISC, with applicable icon notices. Dependencies are pinned in
package-lock.json; their actual LICENSE/NOTICE files accompany installed packages.
No commercial Univer Exchange/collaboration/AI SDK modules are bundled.

WordCraft0.18.1/source079f478bd85df7bcc567e3bafa7d7219096f9c3c and
PdfCraft0.22.0/sourceac140f809d554981a5276d748e6193fcf4d4bdfa: MIT OR Apache-2.0.
FORGE acquires original official portable builds with pinned hashes and retains
their license/brand/asset notices; modified ArtCraft branding is not distributed.
Windows font files remain local and are not redistributed. Font identity/hash and
license description are recorded with qualified outputs. LibreOffice and optional
Office Exchange are not bundled or advertised as qualified conversions.

---

