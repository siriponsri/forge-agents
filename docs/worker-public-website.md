# FORGE standalone public website worker

2026-11-24 · Branch `t3/standalone-public-website` · Base/product evidence revision
`01ee779ffd049ba875ad85bd36f2c8accd274ca0`. Actual inherited runtime model
`gpt-6.1-sol`, reasoning effort `xhigh`; no model switch and no nested delegates.

## Delivered boundary

Only NEW `apps/website/**` and this note. No root manifest/lockfile, app source,
central progress, launcher, legacy runtime, `bootstrap/payload`, portable manifest
or `adapters/ao` edit. The independent website package has its own lockfile,
React/Vite/TypeScript, bundled fonts, Lucide and Radix Tabs. No private localhost API,
runtime module import, credential, memory store or database dependency.

Thai-first, English section headings and independent light/dark themes. All six
page types are prerendered in both languages: product home, Docs, Install,
Downloads, Changelog and GitHub/source availability. The home has the actual
workbench screenshot, an open workflow story, interactive keyboard-operable
ownership layers, and a filterable factual capability inventory. The app's 15
VS Code themes are described without adding them to the public website.

Impeccable context/new-work/craft-floor guidance was applied. The supplied brief
was the direction; no duplicate user workshop or generated comp was introduced.
The no-nested-delegates assignment took precedence over skill suggestions.
Finish review/documentation were inline and explicitly labelled; independent lead
review remains pending. Local `apps/website/DESIGN.md`, design sidecar,
`docs/DIRECTION.md`, `docs/REVIEW.md` and asset provenance record the work.
The Impeccable detector returned `[]` for staged UI changes. The skill reported
pre-existing root setup drift; no root setup/doctor repair was performed.

Public references Orca, T3 Code, Paseo, Cursor, Linear, OpenCode and Dify were opened
in the shared browser on 2026-11-24. Execution is original: no copied screenshots,
logos, customer claims, metrics or testimonials. Radix supplies the accessible tab
primitive used by shadcn-style components; decorative Magic UI effects and a
second overlapping component framework were unnecessary for the confirmed brief.
Font/icon/primitive license notices ship under `public/licenses/`.

## Truth and release data

Anonymous public GitHub Releases API for remote `siriponsri/forge-agents` returned
HTTP 200 and `[]` at **2026-11-24T08:23:40.322Z**. That generated snapshot is
checked in at `apps/website/public/releases.json`. The site offers no nonexistent
Windows download and no macOS package. Its available action is the source setup
guide, with an explicit warning that the current development revision is not yet
public. A launcher-generated source ZIP is never called a signed binary release.

`npm run releases:refresh` explicitly updates anonymous public metadata; normal
builds make no request. Eligible future downloads must be uploaded Windows ZIP
assets with positive size, GitHub SHA-256 digest and exact repository-scoped HTTPS
release URL. Drafts, absent digests, external/private/localhost URLs and unqualified
macOS assets fail closed. The checked-in manifest is validated before a build.

The local implementation commit was not public: GitHub commit lookup returned
422; named current app/docs paths returned 404. Therefore no broken public blob
URLs are fabricated. Local Docs/Install/architecture/status pages work independently,
and source actions lead through an explicit source-availability page or repository.
When the lead publishes an authorized revision, update these qualifications and
the metadata snapshot together.

Used the verified newer 1440×1000 actual capture from engineering run
`forge-visual-refinement-rFK2fH/overview-1440-dark-modern.png`. The old root
`app/web/public/forge-workbench-preview.png` depicted a superseded Overview.
The copy is byte-identical SHA-256
`053c352b7c1a0235d8e9e866ed2b5b2a5f58dd4125312062faffa7f1da0bf705`.
Disposable engineering fixture content is visibly labelled. Clicking it opens
the actual full-resolution PNG. No private state directory was copied.

## Developer verification

Passed, inside `apps/website` with Node 24.19.0:

- `npm ci --include=dev --ignore-scripts`: clean standalone dependency installation;
  no root dependency installation or change. npm reported zero vulnerabilities.
- `npm run check`, `npm run build`: strict TypeScript and production static build;
  12 localized pages plus real 404 HTML. Radix's harmless bundled `use client`
  directive warnings do not prevent the build.
- `npm test`: two download-policy tests with valid metadata, missing hashes,
  invalid sizes/state, drafts, external/localhost/JavaScript URLs and macOS rejection.
- `npm run test:browser`: **PASSED**, **56 WCAG A/AA axe audits**, zero violations,
  zero page/console errors. Home and every architecture layer at **320/375/768/1440**
  in TH/EN and light/dark. All ten localized inner pages at 375/1440 in both themes.
  No document/element overflow. Every internal route and fragment resolves.
- Keyboard arrow tabs, capability filters, full-resolution screenshot, locale
  routes, persisted theme through reload/new page, mobile menu Escape/focus,
  skip-link main focus, reduced motion, forced colors, blocked localStorage and
  no-JavaScript install content. All runtime requests remain same-origin static
  assets: no third-party requests or private `/api/` calls.
- `node scripts/verify-static.mjs`: actual prerendered content, titles/descriptions,
  no fabricated canonical, noindex/robots defaults, correct CSP script and fixed
  Radix style hashes, no unsafe-inline/eval, Pages header length and shipped licenses.
- `node tests/build-config.mjs`: missing approved branch rejected; wrong branch
  rejected; matching branch fixture builds; reserved `.test` canonical/hreflang
  and 12-entry sitemap verified; then restored unset-origin/noindex local output.
- `npm audit --omit=dev`: zero vulnerabilities. `git diff --check`: clean.

Final browser report: developer-local temp `forge-public-website-iSwhBC/results.json`.
Portable sanitized summary and representative actual captures are checked in under
`apps/website/docs/evidence/` (1440 light EN, 768 light EN, 375/320 dark TH and 375 TH
Downloads). These are review evidence, not public served marketing assets.

Production `_headers` preserves a strict CSP with a hashed prepaint theme script
and two exact Radix style-attribute hashes. The exact PNG response detaches CSP
to allow the browser's native image-viewer styling; it stays image/png + nosniff.
This was exercised with a real full-resolution image navigation and return.

## Cloudflare preparation and pending qualification

The Thai no-code guide is `apps/website/docs/CLOUDFLARE_PAGES_TH.md` and the exact
local commands are in the package README. Root directory `apps/website`, output
`dist`, build `npm run build:pages`. `SITE_URL` and
`FORGE_APPROVED_PRODUCTION_BRANCH` intentionally have empty placeholders.
The Pages build checks an exact matching `CF_PAGES_BRANCH` and approved canonical.
The dashboard must separately use the owner-approved production branch, enable
automatic production deployment only when authorized, and disable preview branches.

No Cloudflare project/account mutation, actual deployment, public service,
domain purchase, paid feature activation, push, prototype activation or credential
migration occurred. `DEPLOYMENT_NOT_RUN`; actual production branch/domain/account
still require owner authorization and configuration. macOS native remains
`NOT_RUN`; `HOME_UAT_NOT_RUN`. Existing product implementation gaps and missing
live-provider qualification remain distinct and are described conservatively.

## Lead integration and central acceptance updates

Cherry-pick the scoped commit supplied in the handback. Root ownership remains
with lead; no core route or build is changed. Re-run the package commands above
from `apps/website`; optional local preview is `npm run preview` after build.

Add the following rows to the lead-owned backlog/acceptance matrix as part of
integration (not edited by this worker):

| Website scope | Worker status | Integration/owner remaining |
|---|---|---|
| Independent package and no private runtime dependence | Developer verified | Lead integration review |
| Product/architecture/capability truth | Implemented + inline visual review | Reconcile claims when product evidence changes |
| TH/EN, light/dark, responsive/a11y | Developer verified; 56 audits | Lead review and owner site acceptance |
| Docs/install/GitHub/changelog/Windows status | Developer verified | Publish authorized source revision before advertising public install |
| Release metadata and honest unavailable state | Developer verified | Refresh snapshot on actual release |
| Cloudflare static config, SEO, no-code Thai guide | Locally verified | Approved branch/domain and authorized public deployment NOT_RUN |

Full core product completeness is outside this worker's claim. The website does
not convert current core implementation gaps into Home UAT-only work.
