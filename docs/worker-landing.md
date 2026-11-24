# FORGE landing page worker

2026-11-24 · Branch `t3/forge-landing-page` · Model `gpt-6.1-sol`, reasoning effort `xhigh` (inherited T3 Codex harness). No subagents, external deployment or push.

## Delivered scope

- `app/web/src/Landing.jsx`: default `Landing()` React component, internal Thai/English switch, hero download actions, actual screenshot slot, original workflow diagram, editor/report sections, localhost/source explanation, platform packages, install steps and truthful alpha readiness.
- `app/web/src/landing.css`: graphite/cobalt palette with orange FORGE mark, Manrope/IBM Plex Sans Thai stacks, responsive layout, keyboard focus and reduced-motion styles. Every selector is rooted at `.landing`; token values live inside that root. It does not import or alter the application stylesheet.
- `app/web/welcome.html`: independent Thai-first HTML entry pointing to `/src/landing-main.jsx`, with an entry-specific background/reset and JavaScript fallback. It does not load `main.jsx` or `App`.
- This handoff note. Shared app contracts, launcher/package generation, manifests, lockfiles, legacy payloads and central progress were not edited.

The design uses Hallmark guidance with the authorized custom graphite/cobalt/orange direction and reference-inspired centered product hero. Its token block stays inside the assigned stylesheet, and its decision record stays here; no out-of-scope root token or Hallmark memory files were created. Self-review: philosophy 4, hierarchy 4, execution 4, specificity 4, restraint 4, variety 4. These are design assessments, not independent product acceptance.

## Public reference observations

Read the public pages on 2026-11-24. The observations concern their content hierarchy; HTML/text retrieval cannot establish their exact rendered spacing or motion.

- [Orca](https://orca.dev/): direct platform download and source actions, a large product demonstration, and feature groupings that describe actions in the development loop. FORGE adopts the short route from product statement to downloads and actual product imagery.
- [T3 Code](https://t3.codes/): concise multi-line headline, prominent download/source pair, language control and a large product image close to the introductory copy. FORGE uses its own typography, content and brand, with TH/EN controls visible in the header.
- [Paseo](https://paseo.sh/): product-centered introduction, clear download destination, and a progression from workspace capabilities to practical setup. FORGE presents a plan → team → work → review sequence and platform-specific install guidance.

No reference logos, branding, copy, screenshots, testimonials, user counts or performance claims were copied. All icons use the existing Lucide dependency; the FORGE mark and report-source illustration are original SVG. There is no fake browser/IDE/terminal chrome or simulated product screenshot.

## Metadata behavior

`GET /api/downloads` supplies `{version, commit, status: 'alpha', platforms: [...]}`. No static download fallback links are rendered. Metadata must include the agreed platform ID/filename, positive integer byte size, SHA-256, qualification and string requirements. Only same-origin URLs with the exact `/downloads/FORGE-Windows.zip` or `/downloads/FORGE-macOS.zip` path are accepted. A malformed entry fails the metadata request rather than emitting an unverified download link. A platform omitted from otherwise valid metadata stays disabled while the other remains downloadable.

The UI distinguishes loading, metadata failure/retry, missing package, developer-verified package and platform test not run. A 12-second request timeout and abort-on-unmount prevent a permanent initial loading state. A hero note points users to the package-status section if the API is unavailable. Filename, size in MiB, requirements, version, commit and selectable SHA-256 are visible in the package section. Download anchors use the supplied valid local URL and filename.

Language is saved independently as `forge.landing.language`; workbench language/settings are not changed. The default is Thai, and blocked browser storage does not prevent rendering. The root document's language and title follow the active landing language.

## Verification performed

Used the existing owner checkout's installed esbuild/React/Lucide/Playwright/font packages via explicit module paths, without copying or changing its manifests. Built an isolated temporary browser bundle and served it on an ephemeral `127.0.0.1` port. API responses were clearly bounded engineering fixtures; no provider/credential or product-workspace operations were invoked. Temporary tests and screenshots were kept outside the repository, and the test server/browser were closed after each run.

Passed:

- JSX/CSS/font compilation into an isolated bundle.
- Default Thai, English switching, document language/title and persisted language selection.
- Widths 320, 375, 414, 768, 1024, 1440 and 1920 in both languages: document width matches viewport, interactive elements remain within the viewport and text nodes in visible buttons/navigation do not wrap.
- Metadata availability, loading, HTTP 503 and recovery through Retry, rejection of a remote executable URL, and a missing macOS entry while Windows remains available.
- Real local download hrefs from metadata, SHA-256 disclosure, missing-image recovery and reduced-motion spinner behavior.
- Keyboard skip-link focus and a functioning TH/EN switch when localStorage is blocked.
- WCAG text contrast checks for primary/hover buttons and the main body, muted, secondary-action and qualification colors (all at least 4.5:1).
- No uncaught browser errors. Desktop/mobile screenshots inspected for hierarchy, wrapping and section rhythm.
- `git diff --check`.

Isolated test evidence is in the system temporary directory `forge-landing-test-wgwNiF/results.json` at the time of this note; this is developer-local evidence, not a portable release artifact. Default/hover primary-button contrast measured 5.13:1 / 4.70:1; muted body text measured at least 6.64:1 against its surfaces. The lead must run integrated build/routing/download/screenshot checks against the real service after cherry-pick. The fixed real-image slot was tested in its honest missing-image state because the lead-owned screenshot was not yet present in this worktree.

## Exact lead integration needs

1. Write `app/web/src/landing-main.jsx` to import React/createRoot, bundled Manrope and IBM Plex Sans Thai styles, and `Landing`; mount into `#root`. `Landing.jsx` already imports `landing.css`. Use font weights 400/500/600/700/800 as appropriate for Manrope and 400/500/600 for IBM Plex Sans Thai. No Google Fonts or remote assets are needed.
2. Include `welcome.html` in Vite's production HTML inputs, serve it at `/welcome`, and preserve the working application at `/app` and existing `/` behavior as lead routing dictates.
3. Supply the implemented `/api/downloads` and actual ZIP routes. The component expects the exact agreed contract and does not fabricate release version, commit, size, hash, availability or platform qualification.
4. Add an actual redesigned FORGE application capture as `app/web/public/forge-workbench-preview.png`. The image uses intrinsic dimensions 1600×1000 and a fixed 16:10 container with `object-fit: contain`; other image sizes still render without distortion. The alt text describes the project/workspace in the graphite theme. Avoid secrets and disclose any fixture content appropriately in the capture/handoff.
5. Verify both metadata-backed hero buttons and platform buttons using the real archives, TH/EN, no global styling leakage, screenshot load, and `/welcome` → `/app` navigation in the integrated build.

## Product qualification, not landing blockers

Read actual v3 `progress/CURRENT_STATUS.md` and `HOME_UAT_RESULTS.md`: overall `IMPLEMENTATION_INCOMPLETE` and `HOME_UAT_NOT_RUN`. The landing repeats those statuses explicitly; it does not imply the full v3 target is implemented. Individual editor/report descriptions refer to implemented surfaces and disclose engine/font readiness rather than universal format parity.

Lead reports a clean Windows ZIP installation/build/start/restart/stop check and preserved macOS launcher executable mode. Those are lead evidence, not tests performed by this worker. macOS live-machine qualification remains `NOT_RUN`; its package description explicitly says native report engines are unqualified. No signed installer, `.exe` or `.dmg` is advertised. Missing live service credentials/home UAT and remaining implementation gaps stay separate. No prototype was activated.
