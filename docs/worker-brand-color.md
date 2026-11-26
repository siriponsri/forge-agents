# Colored FORGE identity — worker handoff

Required local base: `631ca22946adf925827d12cbcce84a8268f72efa`.
Branch: `t3/forge-colored-brand-assets`; orchestrator-managed worktree.
Assigned writes only: README logo embed references, `docs/brand/**`,
`tools/brand/**`, this new handoff. No app/site/server/native, manifest/lockfile,
central progress, existing diagram/media or protected legacy edits. No nested
agent, credential operation, paid call, public service or push.

## Owner correction and resulting identity

Owner requested color, keeping the primary orange while adding **yellow and
gray as secondary accents**, including the logo and supporting elements.
The colored identity is now the default. The earlier monochrome-default handoff
in `docs/worker-readme-brand.md` is historical and superseded by this note and
the [current guide](brand/README.md).

Exact three-color brand palette:

| Color | sRGB | Role |
|---|---|---|
| Orange | `#f97316` | Existing primary FORGE brand; dominant F silhouette. |
| Yellow | `#f2c94c` | Secondary upper-arm facet / restrained decorative role accent. |
| Gray | `#8b9199` | Secondary middle-arm facet / supporting metadata geometry. |

Neutral reading ink remains separate: `#20252b` light / `#f5f5f5` dark.
Use semantic theme text for roles/metadata; yellow is never informational text,
and gray is not universally suitable for small text. Keep a text/shape cue for
status, role, focus and action. Preserve existing named-theme semantic tokens.

Tiny inline mark for favicon/header adoption (the enclosing link supplies the
accessible name; standalone SVGs should use the titled export):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">
  <path fill="#f97316" d="M8 8H56L44 20H20V28H48L36 40H20V56H8Z"/>
  <path fill="#f2c94c" d="M44 8H56L44 20H32Z"/>
  <path fill="#8b9199" d="M40 28H48L36 40H28Z"/>
</svg>
```

The existing cut-ended silhouette/custom lettering is preserved. The lockup
uses the colored mark with neutral FORGE lettering; the standalone wordmark
colors its F and keeps O/R/G/E neutral. No gradient, badge or enclosing shape.

## Delivered assets and evidence

- Fifteen transparent SVG/PNG pairs: mark, wordmark, lockup × colored default,
  colored for-light alias, colored for-dark, optional black and white fallbacks.
  Default and for-light bytes match. Monochrome is explicitly technical-only.
- Fifteen native mark PNGs: default/light/dark × 16/24/32/48/64 px. The mark's
  palette is identical in both themes; wordmark/lockup reading ink changes.
- Font-free authored vector source, resvg 2.6.2 rasterization, source SHA-256,
  exact geometry/palette/dimensions and actual export hashes in
  [export evidence](brand/evidence/exports.json).
- [Contact sheet](brand/evidence/contact-sheet.png), including actual embedded
  native small PNGs. Reviewed the new result at 100%, then all four actual new
  [README captures](brand/evidence/readme-layout.json), not the old evidence.
- Two fresh complete regenerations produced identical hashes for 48 generated
  files (47 assets/proofs plus export metadata), recorded in
  [repeat-build evidence](brand/evidence/determinism.json).
- [Independent validation](brand/evidence/validation.json): effective SVG fills,
  no fonts/scripts/network resources in exports, PNG dimensions/alpha/padding,
  native size/palette pixel counts, independent contrast recomputation, links,
  source/capture freshness and preservation against the assigned base.

The guide includes download links, minimum sizes, clear space, accessible use,
exact palette/geometry, supporting-role rules and Apache-2.0 provenance. No
stock/traced logo, external font outline or AI bitmap was used. This records
original authorship; it is not trademark clearance.

## Executed scoped checks

Existing tool modules were used read-only: resvg and markdown-it under the temp
`forge-brand-tools` prefix; Playwright from the existing main checkout's
`node_modules`. No dependency install, product manifest or lockfile change.

```powershell
node --check tools/brand/build.mjs
node --check tools/brand/readme-proof.mjs
python tools/brand/determinism.py --modules "$env:TEMP/forge-brand-tools/node_modules"
node tools/brand/readme-proof.mjs --modules "$env:TEMP/forge-brand-tools/node_modules" --browser-modules 'C:/Users/siripon.sri/Desktop/my_project/forge-agents/node_modules'
python tools/brand/verify.py --baseline 631ca22
git diff --check
```

README fixtures: 900/375 px light/dark; all images decoded, exactly one colored
theme logo visible, no whole-document overflow, page errors or HTTP(S) requests.
These are offline Markdown layout fixtures, not GitHub sanitizer/hosted-CSS tests.

Neutral lettering/body pairs independently measure **15.431:1** on white,
**14.154:1** on paper, **15.119:1** on Dark Modern and **17.358:1** on GitHub dark.
These cover all lockup letters and standalone wordmark O/R/G/E. The colored F
and facets are logo geometry: their twelve measured pairs have **no text pass
threshold**. For example, yellow on white is only 1.587:1; orange on white is
2.803:1. No claim that the logo accent colors meet 7:1 or universal UI contrast.

Native 16 px mark: opaque palette pixels orange 57 / yellow 6 / gray 3. All
five native sizes retain each color and orange exceeds both secondary colors
combined. Tiny facets support the F; they do not convey information. The F's
silhouette, cap-height letter counters and parallel cuts survive the inspected
minimum sizes. Narrow README wraps without overflow; dated screenshot detail
still requires its existing full-size links.

Read AGENTS/v3 applicable requirements, existing DESIGN/brand/tooling/README;
applied Impeccable context, colorize and craft-floor guidance. As requested,
direction/final visual review stayed in this sub-agent with no nested agent.
The mechanical detector was run once after the static asset/tooling edits;
it returned `[]`, not treated as product UI qualification.
Pre-existing Impeccable setup drift was left untouched.

## Preservation and integration limits

The only README edit is the light logo reference from `for-light` to explicit
colored `default`; dark references already point to now-colored `for-dark`.
All other README text is unchanged: published checkpoint `d928e9c`, source-only
qualification, pending role-session/Strategist work, actual/injected media
disclosures, both diagram picture blocks and Apache qualification. Existing
diagram/media files and protected legacy paths are unchanged.

No implementation gap found in this scoped static package. The lead owns
app/site/header/favicon and secondary-role element adoption, new assembled
screenshots, independent review and product status reconciliation. Historical
app screenshots were not recolored. If the lead changes README text afterward,
regenerate its fixture evidence and reconcile validation's preservation baseline
explicitly; do not reuse this package's preservation PASS for changed copy.

No expensive application/native tests, live account/provider calls, native
runtime setup qualification, public GitHub publication or Home UAT ran here.
Missing live credentials/home acceptance are separate from implementation gaps.
`HOME_UAT_NOT_RUN`. This identity is ready for lead review/integration, not
claimed Owner-accepted or complete-product qualified. Model inherited from
the parent: `gpt-6.1-sol`, xhigh; no provider/model switch was performed.
