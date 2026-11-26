# Ambitious public landing — worker handoff

Required starting HEAD: `378466061e575ffd3b429f73aaf623f51b5396fb`.
All writes are confined to `apps/website/src/**`, `apps/website/docs/**` and this
new handoff. No source/public deployment or push. No nested delegation, install,
account operation, application backend/UI edit or protected legacy modification.

## Delivered design

Owner orange `#f97316` leads, yellow `#f2c94c` and gray `#8b9199` stay secondary.
The original colored mark and genuine screenshot remain unchanged. Bundled
Manrope/IBM Plex Sans Thai and light/dark semantic reading colors are retained.
Hallmark was applied with the explicit no-interview and in-place redesign scope.

Home keeps its route/component and source boundaries. Additions are a stronger
asymmetric hero, formation index, original horizontal strategy explorer with
six actual concept-specific allocations, four-step explanatory sequence and
a separate genuine-workbench evidence composition. Existing workflow rows,
Radix architecture, capability filter, source/install/license/release routes,
TH/EN URL behavior and release fail-closed policy remain in place.

Playback is opt-in, finite and pausable. A transform-only time indicator explains
the progression; manual choices, offscreen/hidden document and reduced-motion
changes stop playback. Reduced motion uses a manual Next step instead. Keyboard
mode selection supports Left/Right/Home/End with wrap and retained focus. Mobile
uses readable HTML nodes rather than shrinking a desktop SVG. There are no fake
terminals/browser frames, generated product shots, customers, metrics or quality
claims. Pure local interactions have no network loading/error states to invent.

Public qualification remains exact: the 26 November anonymous snapshot records
main `d928e9c` and zero public releases. The six-mode explorer is labelled
illustrative, active development on an unpublished branch, not a live run or
proof of public checkpoint capability. It does not qualify native/provider runs.
Native Windows/macOS/report-engine limitations and HOME_UAT_NOT_RUN remain on
the original routes and capability ledger. No download has been fabricated.

See [design rationale and primary references](../apps/website/docs/LANDING_AMBITION.md).
Official Orca/T3/AO pages were opened and then visually inspected through the
repository-installed Playwright fallback after the T3 preview screenshot tool
failed twice. No external code, copy or artwork was adopted. Reference captures
are temporary; final evidence contains FORGE renders only.

## Files and integration

- `src/App.tsx`: additive Home composition plus StrategyStory import; other
  page functions, data, architecture and capabilities remain unchanged.
- `src/StrategyStory.tsx`: isolated illustrative local interaction.
- `src/tokens.css` and `src/landing.css`: scoped marketing extension and one
  offscreen skip-link clipping safety fix; base `style.css` is untouched.
- `src/main.tsx`: additive imports after all original imports, including CSS.
- `docs/LANDING_AMBITION.md` and `docs/evidence/landing-20261126/**`: rationale,
  repeatable verification/capture scripts, final actual renders and report.

The repository ignores `**/*token*`; the new `src/tokens.css` must be explicitly
tracked with `git add -f`, not silently omitted at integration. No ignore rule,
manifest or lockfile was changed. Existing installed website modules were reused
through an ignored `apps/website/node_modules` junction to the main checkout,
read-only; the junction is not committed. Ordinary clean-clone installation
still uses the website's existing manifest/lockfile instructions.

## Developer verification

From `apps/website`, using the installed packages, one Chromium at a time:

```text
npm run check
npm test
npm run build
node scripts/verify-static.mjs
node docs/evidence/landing-20261126/verify.mjs
node docs/evidence/landing-20261126/inspect.mjs
git diff --check
```

The lead explicitly granted a small build/browser slot after native cleanup.
Final machine-readable browser results and screenshot hashes are recorded in
`apps/website/docs/evidence/landing-20261126/verification.json`.
The matrix covers TH/EN × light/dark ×320/375/414/768/1440, all six modes,
20 WCAG AA axe audits, keyboard/focus, manual/timed/reduced-motion behavior,
all ten localized inner pages, local links/fragments and licenses, no-JS reading,
the actual served CSP, no page/console errors and no external runtime/API/font
requests. Additional capture checks include a 1280px laptop hero, real theme
toggle/persistence, locale navigation and full-resolution product image.

Visual inspection corrected an initial four-line desktop headline, inherited
duplicate hero spacing, a 320px direct-text label spill that box overflow checks
missed, and an offscreen skip-link compositor artifact. Full mode names survive
in accessible labels and the selected explanation. Final screenshots replace
the initial captures; old published evidence folders are not rewritten.

Original screenshot SHA-256 remains
`053c352b7c1a0235d8e9e866ed2b5b2a5f58dd4125312062faffa7f1da0bf705`.
The static verifier confirms12 localized pages, noindex/unset canonical, five
licenses and hashed CSP without unsafe-inline/eval. Vite reports only existing
Radix `use client` directive warnings. Release-policy tests pass2/2.

## Coverage and remaining qualification

No implementation gap is identified in this delegated landing scope. The
baseline screenshot predates later integrations; fresh final product media,
actual six-mode execution acceptance, native/provider qualification and any
publication remain lead-owned work. This landing is not evidence for those
features or an independently approved product release. No live credentials were
needed for the static website; no native/provider test or Home UAT ran here.
`HOME_UAT_NOT_RUN`. No assertion that the design is objectively superior to a
reference product is made. The ambitious target is a design direction.
