# FORGE public website

Independent React/Vite/TypeScript static site. Its package and lockfile are local
to this directory. It imports no core app modules and calls no FORGE runtime API.

From `apps/website`:

```text
npm ci --include=dev
npm run dev
```

Open the loopback address printed by Vite, then `/th/` or `/en/`. Build and inspect
the production output with `npm run build` followed by `npm run preview`. Production
HTML is prerendered for every localized route; documentation remains readable
without JavaScript. JavaScript adds theme, architecture tabs, filters and mobile
navigation. The localized language preference is the URL and survives shared links.

```text
npm run check
npm test
npm run build
npm run test:browser
node scripts/verify-static.mjs
node tests/build-config.mjs
```

Browser tests use an installed Playwright Chromium, or the executable given by
`FORGE_TEST_BROWSER`. If needed, run `npx playwright install chromium` locally.
Tests start their own loopback static server, apply the shipped CSP, write screenshots
and a JSON report to a temporary folder, and close their browser/server. No account
or external service is used by those tests. The app screenshot itself is a genuine
developer capture, with fixture data labelled in the page and in `docs/ASSETS.md`.
The build-config check performs an approved-branch fixture build with a reserved
`.test` origin, verifies metadata, then restores ordinary unindexed local output.
It does not set an actual production branch or deploy anything.

`npm run releases:refresh` explicitly captures anonymous public GitHub Release
metadata into `public/releases.json`. Ordinary builds are deterministic and use that
checked-in snapshot. There is no token fallback and no local download endpoint.
Drafts, missing digests, unrecognized assets and out-of-repository URLs fail closed.
No automatic release download appears for macOS, whose native qualification is
NOT_RUN. Refresh and review this snapshot as part of each website release.

Set `SITE_URL` in the build environment to an approved HTTPS origin to generate
canonical, Open Graph, alternate-language and sitemap URLs. With it unset, the
site emits no canonical/domain, an empty sitemap, and noindex/disallow directives.
Never put a private runtime address or secret in this setting. See
`docs/CLOUDFLARE_PAGES_TH.md` for the no-code deployment preparation guide.

The Pages build command is `npm run build:pages`. It requires
`FORGE_APPROVED_PRODUCTION_BRANCH`, matching `CF_PAGES_BRANCH`, and `SITE_URL`.
This is a build check; the Cloudflare dashboard must separately be configured to
use that owner-approved branch and disable preview deployments. No service or
production branch was configured by this implementation. No deployment was made.

Routes: `/th/`, `/en/`, and localized `/docs/`, `/install/`, `/download/`,
`/changelog/`, `/github/`. `_redirects` maps short entry routes to Thai. A real
`404.html` prevents the Pages implicit SPA fallback from swallowing unknown paths.
`_headers` contains a restrictive CSP, security headers and immutable hashed-asset
caching. The only inline script is the prepaint theme initializer; its exact SHA-256
is generated into CSP. Two exact hashed Radix SSR style attributes are permitted.
The PNG response detaches CSP so the browser's own full-resolution image viewer
can apply its native styles; HTML keeps the restrictive policy and PNG is served
as `image/png` with nosniff. Static content uses no analytics, remote fonts or embeds.

Publication was rechecked anonymously on **25 November 2026**: the pinned
24 November baseline `01ee779` and its Office source are public, main is `4e8ebd3`,
and Releases is empty. Newer development integrations remain unpublished. The
unchanged workbench PNG depicts the baseline; it does not prove the new features.
See `docs/ASSETS.md` and `docs/evidence/publication-20261125.json` for exact hashes
and primary API observations. `node scripts/check-publication.mjs` performs a new
anonymous check of those recorded revisions without changing build data.

The capability inventory and changelog separately describe developer verification
with labelled injected provider/native observations, native automatic-execution
qualification and billing implementation gaps, and pending Research agent/native
execution bridging and qualification. The local CPU/file Research flow is mounted
and developer verified.
They claim no live model quality improvement, benchmark score or Home UAT result.
Update claims, evidence and source availability together only after the lead
actually publishes an authorized revision.
