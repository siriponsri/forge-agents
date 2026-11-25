# Website publication fixes — integration handoff

25 November 2026, Asia/Bangkok. Branch `t3/website-publication-fixes`, prepared
base `418791275f4a682cacf3c2b36a54d97ac0510be0`. Actual inherited T3/Codex runtime:
**gpt-6.1-sol / xhigh**. No model switch, provider verification turn or nested agent.

## Exact implementation commits

Apply in order, followed by the documentation-only handoff commit reported in
the final handback:

1. `8d1ad3646ed594e4c2c47c4a067c0f5c8f069891` — public baseline/current-development
   distinction, capability and date refresh, vertical keyboard behavior,
   primary publication observations, standalone assertions and website captures.
2. `bf9a754ffb5ef19389a31a7da373ba38cfe416e4` — latest lead-confirmed local Research
   status, matching changelog/assertion/filter updates and refreshed final evidence.

Only `apps/website/**` and this note were written. Root/shared/server, root README,
progress, manifests/lockfiles and protected portable/runtime/adapter paths were
unchanged. The website package/lockfile are also unchanged. The assigned isolated
worktree was already prepared; no shell worktree or checkout was created.

## Publication truth

Fresh **anonymous primary GitHub API** observations at
**2026-11-25T03:52:31.178Z**:

| Observation | Actual result |
|---|---|
| Public main | HTTP 200, `4e8ebd394c14b08d642a5f5e47a2305efb26fd25` |
| Pinned baseline | HTTP 200, `01ee779ffd049ba875ad85bd36f2c8accd274ca0` |
| Baseline `app/web/src/Office.jsx` | HTTP 200, blob `69083e63594b5c16285b52811990e1c8b5e9d7d6` |
| Prepared integration `418791275f4a682cacf3c2b36a54d97ac0510be0` | HTTP 422; no public commit |
| Public Releases | HTTP 200, `[]` |

Endpoints/results are preserved in
`apps/website/docs/evidence/publication-20261125.json`.
The separate build snapshot `public/releases.json` was refreshed at
**2026-11-25T03:53:40.177Z**: HTTP 200, `no_public_releases`, zero downloads.
No future publication is asserted. Normal builds make no GitHub request.

The false blanket unpublished warning was replaced with distinct public-baseline
and unpublished-current-development sections in TH/EN. Baseline tree and Office
links are pinned to actual verified public source. Install copy and scoped package/
Cloudflare preparation docs use the same distinction. Downloads remain unavailable.

The original public product PNG and provenance sidecar are unchanged. The caption
and alt text explicitly identify the **24 November baseline, before newer
integrations**. SHA-256 remains:
`053c352b7c1a0235d8e9e866ed2b5b2a5f58dd4125312062faffa7f1da0bf705`.
No new core-product screenshot/GIF or replacement media was created. The root
English README and final media gate remain lead-owned and pending.

## Development status and interaction

Missions/Delivery Pack, isolated Parallel Workspace, Chat ↔ Node–Edge Visualization,
Proactive recipes/Inbox and budget policies are described as mounted/developer
verified, with **labelled injected provider/native observations**, not live models.
T3 remains the sole execution owner; FORGE owns canonical plans/scope/approvals.
The local open-source core and optional future remote/team services remain distinct.

The lead's subsequent Research update was incorporated after the first commit:
local CPU/file trials, recheck, comparison and export are mounted/developer
verified. The supporting production Owner/session/CSRF/App/restore evidence and
33 backend checks, 12 captures and 2 injected-native-wire checks were supplied by
the lead; this website worker did not rerun or sum those backend checks.

Remaining **implementation/qualification gaps**, explicitly retained in the copy:

- Guarded all-action automatic execution: **NOT_QUALIFIED**; recipes/Inbox are not
  advertised as qualified native automatic execution.
- Native billing receipt ingestion: incomplete; unknown usage is not zero.
- Research agent/native execution bridging and component/action/limits
  qualification: pending. No model trials, benchmark scores or quality improvement.

Architecture controls now declare vertical orientation. Actual keyboard tests
assert Up/Down selection, Home/End, wrapping, Left/Right staying on the vertical
selection, active focus and the corresponding labelled panel, across all 16
TH/EN × light/dark × 320/375/768/1440 home variants.

## Standalone verification

Windows, Node **v24.19.0**, unchanged pinned dependencies:

- `npm.cmd ci --include=dev --ignore-scripts`: PASS, 45 installed packages,
  zero reported vulnerabilities; standalone package only.
- `npm.cmd run build`: PASS, includes strict `tsc --noEmit`; 12 prerendered
  localized routes and real 404. Existing Radix `use client` warnings only.
- `npm.cmd test`: **2/2 PASS**, download policy fails closed on absent/unsafe data.
- `npm.cmd run test:browser`: final post-Research-update run **PASS**,
  **56 axe WCAG A/AA audits**, zero violations, zero page/console errors,
  zero overflow; every runtime request stays same-origin with no private API.
  Home/all layers at 320/375/768/1440, all ten localized inner pages at 375/1440,
  both themes, real keyboard/filters/theme persistence/menu/skip-link/full-resolution
  PNG, reduced motion/forced colors/storage failure/no-JavaScript content and
  all internal routes/fragments.
- `node scripts/verify-static.mjs`: PASS, 12 pages, exact publication/Research
  qualifications, original screenshot hash, CSP script/Radix hashes, no unsafe
  inline/eval, header limits, 5 licenses, no fabricated canonical.
- `node tests/build-config.mjs`: PASS after latest copy. Missing/wrong approved
  branch rejected; matching fixture builds; reserved `.test` canonical/hreflang/
  sitemap verified; final local output restored to **unset origin/noindex/empty
  sitemap**. This is not a Cloudflare deployment test.
- `npm.cmd audit --omit=dev`: zero vulnerabilities. Publication script syntax and
  `git diff --check`: PASS. No dependency expansion or doctor/setup repair.
- Impeccable source scan: **0 anti-pattern failures**, regex-only coverage;
  55 advisory notes concern incumbent type/radius values. Actual rendering and
  axe checks supplement that limited scan; no detector-only visual claim.

Final raw local run: temp directory `forge-public-website-aKAAu9`.
Portable sanitized report/checksums and six actual website review captures are at
`apps/website/docs/evidence/publication-20261125/`. They show source/changelog and
visible keyboard focus across desktop/mobile TH/EN light/dark; they are website
review evidence, not public proof of newer core-product features. Inline review
preserved the incumbent identity and corrected a misleading changelog image
reference. Independent lead review remains separate.

The shared-preview attempts returned `ERR_CONNECTION_REFUSED` because review
started before a successful local static server was available. The repository's
real Playwright Chromium/server harness completed the capture and checks above;
failed preview tabs were closed. No preview failure is represented as a pass.

## Lead next action and remaining external checks

Cherry-pick the ordered scoped commits plus this handoff, review the date/source
qualifications against the final delivered revision, and rerun package build/
static/browser checks if integration changes this surface. Source availability
must only change after an actual authorized publication; refresh release metadata
only from actual GitHub data. No root progress/acceptance ledger was edited here.

No push, deployment, account configuration, credential migration, compute purchase,
public listener, prototype activation or live provider/model run occurred.
**DEPLOYMENT_NOT_RUN / LIVE_PROVIDER_NOT_RUN / HOME_UAT_NOT_RUN / macOS native
NOT_RUN**. These external/home checks are separate from the implementation gaps
above. The scoped website fixes are implemented and developer verified; this is
not a declaration that the complete FORGE product or release is qualified.
