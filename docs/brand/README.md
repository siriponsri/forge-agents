# FORGE identity

The default FORGE identity is **colored and orange-led**. The original cut-ended
F keeps its silhouette, with a small yellow facet on the upper arm and a gray
facet on the middle arm. Custom geometric lettering stays readable against its
surface. No gradient, badge, enclosing shape or stock icon is used.

This supersedes the one-color default described in the earlier
[README/brand worker handoff](../worker-readme-brand.md). Black and white remain
optional technical fallbacks, not the user-facing default.

![Colored FORGE identity: orange F with yellow and gray facets, readable light/dark lettering, native 16–64 px PNGs, palette and optional single-ink fallbacks.](evidence/contact-sheet.png)

## Three-color brand palette

| Color | Exact sRGB | Role |
|---|---|---|
| Orange | `#f97316` | Existing primary FORGE color; dominant filled F. |
| Yellow | `#f2c94c` | Secondary upper-arm facet; occasional decorative role accent. |
| Gray | `#8b9199` | Secondary middle-arm facet; supporting geometry or decorative metadata separators. |

Yellow and gray never replace primary orange. The logo keeps all three colors
on light and dark surfaces. At every supplied native size, fully opaque orange
pixels outnumber yellow and gray pixels combined; see the measured
[small-size checks](evidence/validation.json).

Neutral ink is a separate reading role: `#20252b` on white/paper and `#f5f5f5` on
dark surfaces. In the horizontal lockup, all FORGE letters use neutral ink; in
the standalone wordmark, its F carries the brand colors and O/R/G/E use neutral
ink. These neutrals are not additional brand accents.

Use yellow for a small supporting shape beside a readable role label, never for
informational text, an approval state, a focus ring or a control by itself. Use
semantic theme text for metadata; brand gray is not universally approved as text.
Color never supplies the sole cue for role, status or action. Named workbench
themes retain their existing semantic colors; these brand values do not replace
warning, success, selection or foreground tokens.

## Assets

All exports have transparent backgrounds. SVGs use authored paths and groups,
with accessible titles/descriptions; no font, CSS, script, embedded image or
network resource is needed. PNG exports are four times the SVG canvas size.
Default and for-light files are byte-identical colored assets. The mark's three
colors are identical across light/dark variants; lettering changes neutral ink.

| Asset | Default / light | Dark surfaces |
|---|---|---|
| Mark, 64 × 64 SVG / 256 × 256 PNG | [Default SVG](exports/forge-mark-default.svg) · [PNG](exports/forge-mark-default.png) · [light alias](exports/forge-mark-for-light.svg) | [SVG](exports/forge-mark-for-dark.svg) · [PNG](exports/forge-mark-for-dark.png) |
| Wordmark, 258 × 64 SVG / 1032 × 256 PNG | [Default SVG](exports/forge-wordmark-default.svg) · [PNG](exports/forge-wordmark-default.png) · [light alias](exports/forge-wordmark-for-light.svg) | [SVG](exports/forge-wordmark-for-dark.svg) · [PNG](exports/forge-wordmark-for-dark.png) |
| Lockup, 314 × 64 SVG / 1256 × 256 PNG | [Default SVG](exports/forge-lockup-default.svg) · [PNG](exports/forge-lockup-default.png) · [light alias](exports/forge-lockup-for-light.svg) | [SVG](exports/forge-lockup-for-dark.svg) · [PNG](exports/forge-lockup-for-dark.png) |

Exact-size transparent mark PNGs:

| Context | 16 px | 24 px | 32 px | 48 px | 64 px |
|---|---|---|---|---|---|
| Default / light | [PNG](exports/forge-mark-default-16.png) | [PNG](exports/forge-mark-default-24.png) | [PNG](exports/forge-mark-default-32.png) | [PNG](exports/forge-mark-default-48.png) | [PNG](exports/forge-mark-default-64.png) |
| Dark | [PNG](exports/forge-mark-for-dark-16.png) | [PNG](exports/forge-mark-for-dark-24.png) | [PNG](exports/forge-mark-for-dark-32.png) | [PNG](exports/forge-mark-for-dark-48.png) | [PNG](exports/forge-mark-for-dark-64.png) |

Optional single-ink fallbacks, for limited print/technical environments only:

| Asset | Black | White |
|---|---|---|
| Mark | [SVG](exports/forge-mark-black.svg) · [PNG](exports/forge-mark-black.png) | [SVG](exports/forge-mark-white.svg) · [PNG](exports/forge-mark-white.png) |
| Wordmark | [SVG](exports/forge-wordmark-black.svg) · [PNG](exports/forge-wordmark-black.png) | [SVG](exports/forge-wordmark-white.svg) · [PNG](exports/forge-wordmark-white.png) |
| Lockup | [SVG](exports/forge-lockup-black.svg) · [PNG](exports/forge-lockup-black.png) | [SVG](exports/forge-lockup-white.svg) · [PNG](exports/forge-lockup-white.png) |

## Size, contrast and accessibility

- Preserve canvas proportions. Leave one stem width around the painted mark
  (12 units on its 64-unit grid); built-in padding contributes 8 units.
  Do not stretch, rotate, recolor individual facets or add effects.
- Use the mark at **16 px or larger**, the wordmark at **129 px or larger** and
  the lockup at **157 px or larger**. The latter two have 24 px cap height at
  these minimum widths. Smaller text should be ordinary text, not a raster logo.
  At 16 px the facets are tiny; recognition rests on the F silhouette, not on
  distinguishing individual colors. Prefer SVG or the exact-size PNG.
- Neutral lettering/body ink has four independently recomputed pairs above
  **7:1**: graphite on `#ffffff` / `#f5f5f5`, paper on `#1f1f1f` / `#0d1117`.
  This covers all letters in the lockup and O/R/G/E in the standalone wordmark.
  It does **not** describe the colored F or facets. Their twelve measured
  contrast values are decorative-logo observations with no text pass threshold.
  Other surfaces and every interactive use need their own contrast check.
- Give a linked logo the accessible name “FORGE”. When adjacent text already
  names FORGE, use `alt=""` on the image or `aria-hidden="true"` on decorative
  inline geometry. For a standalone inline SVG, retain title/description and
  namespace IDs per instance. A focusable logo link needs a theme-visible focus
  indicator; its colored artwork alone is not an indicator.
- The root README uses GitHub theme-specific fragments with colored assets.
  Its two existing `<picture>` blocks remain the horizontal diagrams. PNG links
  above remain available to readers without SVG/theme-fragment support.

## Tiny inline mark for integration

The same geometry works for a favicon or beside an accessible header name.
Use it with a 64 × 64 viewBox, at 16 px or larger. It contains three filled paths;
the later facets overlay the original orange silhouette without gaps.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">
  <path fill="#f97316" d="M8 8H56L44 20H20V28H48L36 40H20V56H8Z"/>
  <path fill="#f2c94c" d="M44 8H56L44 20H32Z"/>
  <path fill="#8b9199" d="M40 28H48L36 40H28Z"/>
</svg>
```

The lead owns app/site/favicon adoption and evidence for the assembled product.
This package changes only brand assets, tooling, this guide, worker notes and
the README logo reference. Existing media is unchanged and dated; it is not
evidence of new colored branding in the running app.

## Source, provenance and license

Authoritative editable source: [`tools/brand/build.mjs`](../../tools/brand/build.mjs).
The original filled F uses a 64-unit grid. Two authored facet polygons add the
secondary colors. The five hand-authored letters use a 48-unit cap-height grid;
they are not font outlines. The source records exact path coordinates, color
values and exports. No stock mark, icon library, AI bitmap, third-party logo
trace or external typeface was used. Existing FORGE workbench/media and diagrams
supplied context; their artwork/font outlines were not copied into this logo.

Created/refined for FORGE on 26 November 2026 by the design worker. Original
geometry, exports, source and documentation use the repository's
[Apache-2.0 license](../../LICENSE). This records authorship and file licensing,
not trademark clearance or exclusive rights to a letter.

Rasterization uses **resvg**, via `@resvg/resvg-js` **2.6.2** (MPL-2.0 tooling),
from an isolated prefix outside the repository. Its code is not redistributed
and it is not a product dependency. Contact-sheet labels use locally installed
Segoe UI, with no font file shipped; these labels are not logo artwork.

## Regenerate and verify

Use the existing isolated rasterizer/Markdown prefix read-only and an existing
Playwright installation. Do not change product dependencies or lockfiles:

```powershell
$brandModules = Join-Path $env:TEMP 'forge-brand-tools/node_modules'
# Set this to an existing prefix containing playwright 1.65.1.
$browserModules = '<existing-playwright-prefix>/node_modules'
# Regenerates twice and records repeat-build evidence.
python tools/brand/determinism.py --modules "$brandModules"
node tools/brand/readme-proof.mjs --modules "$brandModules" --browser-modules "$browserModules"
python tools/brand/verify.py --baseline 631ca22
git diff --check
```

Verification needs Python/Pillow; the README fixture uses markdown-it 14.1.0 and
Playwright 1.65.1 with installed Chromium. Logo exports are font-free and
offline after tool provisioning. Logo bytes are deterministic for the pinned
rasterizer; contact-sheet labels/captures can vary with local fonts/browser.

- [Export evidence](evidence/exports.json): source SHA-256, palette, geometry,
  resvg pin, dimensions, file hashes and separated contrast measurements.
- [Repeat-build evidence](evidence/determinism.json): two actual reruns on this
  machine and identical generated file hashes, including native small-size PNGs.
- [Independent validation](evidence/validation.json): XML/PNG/alpha/padding,
  effective fills, native palette pixel counts, contrast recomputation, links,
  fixture freshness and README/diagram/media/legacy preservation against the base.
- [Contact sheet SVG](evidence/contact-sheet.svg): editable proof, including
  embedded actual native small PNGs. Logo exports themselves embed no images.
- [README layout evidence](evidence/readme-layout.json): four local Markdown
  fixtures at 900/375 px light/dark, including image decode, one visible colored
  theme logo and whole-document overflow checks.

Actual first-viewport captures: [light desktop](evidence/readme-light-900.png),
[dark desktop](evidence/readme-dark-900.png), [light narrow](evidence/readme-light-375.png),
[dark narrow](evidence/readme-dark-375.png). These approximate a GitHub reading
surface; they do not test its actual sanitizer/hosted CSS. Visual review covered
these new captures, the contact sheet and native-size marks.

No app/native suite, provider/account call, credential migration, public
deployment, live GitHub publication or Home UAT was performed. This static asset
package does not qualify product implementation or imply Owner acceptance.
