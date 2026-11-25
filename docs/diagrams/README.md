# FORGE editorial diagrams

The README diagrams follow the Owner-selected [Diagram Design gallery](https://cathrynlavery.github.io/diagram-design/): paper, ink, tangerine, Instrument Serif titles, Geist names, Geist Mono tags, clean orthogonal connectors, and no gradients or shadows. These are documentation overviews, not runtime or release qualification evidence.

| Diagram | Minimal light | Minimal dark | Full editorial | Static exports |
|---|---|---|---|---|
| Five-stage workflow | [HTML](software-delivery.html) | [HTML](software-delivery-dark.html) | [HTML](software-delivery-full.html) | [SVG](software-delivery.svg), [PNG](software-delivery.png) |
| Eight-component architecture | [HTML](architecture.html) | [HTML](architecture-dark.html) | [HTML](architecture-full.html) | [SVG](architecture.svg), [PNG](architecture.png) |

Download an HTML file and open it locally. Every variant is self-contained, has embedded font bytes and inline SVG, and works without JavaScript or network access. On narrow screens the focusable figure region scrolls locally; print releases that width constraint. The full editorial variants add two unequal explanatory panels and a colophon. Their diagram-only exports intentionally match minimal light apart from namespaced accessibility IDs.

The README uses theme-specific **outlined SVGs** with **2080px PNG fallbacks** and explicit full-size links. The SVGs contain paths instead of font-dependent text, inline presentation attributes, accessible title/description, and no CSS or external resources. GitHub need not execute anything, retain embedded font CSS, or fetch a font. Editable text remains in HTML and the generation source. A 375px README thumbnail cannot make all five stages readable at once: open full size for zoom, use the alt text, or open the local HTML scroller.

## Source and regeneration

- [Generation script](../../tools/readme-media/diagrams.mjs): authoritative semantic model, deterministic geometry, palettes and all six HTML variants. Source model snapshot: [model.json](source/model.json).
- Mermaid semantic companions: [workflow](../media/software-delivery.mmd), [architecture](../media/architecture.mmd). Mermaid is not used to render the editorial layout.
- HTML-first export: original HTML renders in Chromium, its SVG is captured at device scale 2 for PNG, and its measured text is converted to paths with the exact acquired font files for portable SVG. Text advance widths are compared before outlining. This is a deliberate adaptation of the skill's export procedure to avoid remote font imports and preserve GitHub rendering.
- Canvas preset: `fit`, 1040 × 492 workflow and 1040 × 676 architecture; mixed audience, simplified workflow / balanced architecture. Names use the presentation ramp (16px), prose 12px, title 40px, technical tags 8px. The wider type is deliberate for GitHub's roughly 900px image width. Outer structural margins are 40px.

Normal generation is offline and changes only assigned documentation assets:

```powershell
node tools/readme-media/diagrams.mjs
```

For export and browser evidence, provision an isolated tool prefix. This does not change the root manifest or lockfile. The browser was already present on the development host; install a compatible Chromium explicitly on a new host if absent.

```powershell
npm.cmd install --prefix "$env:TEMP/forge-editorial-diagrams" --ignore-scripts --no-audit --no-fund --package-lock=false opentype.js@1.3.4 playwright@1.65.1
node tools/readme-media/diagrams.mjs --render --modules "$env:TEMP/forge-editorial-diagrams/node_modules"
python docs/diagrams/source/verify.py '<installed diagram-design skill directory>'
git diff --check
```

No acquisition is needed to regenerate: font files are checked in. [fetch-assets.py](source/fetch-assets.py) records the one-time public downloads; its Google Fonts CSS endpoint is mutable, so a future acquisition must be reviewed against the pinned byte hashes in [acquisition.json](source/acquisition.json). Do not silently replace these fonts.

## Verification and its limits

[render-checks.json](evidence/render-checks.json) contains actual Playwright 1.65.1 / Chromium 159.0.8154.6 results, computed font families/weights/sizes and load state, node-label containment, image source selection, PNG fallback decoding, print rules, local scrolling and generated SHA-256 hashes.

- Six HTML variants captured at 1040px, 900px and 375px. At 375px a second capture shows the scroller's far end, including the final stage / artifact node. All source label boxes fit with padding; no whole-document horizontal overflow; every scroller reaches its end. Captures are named `evidence/<slug>-<width>[-end].png`.
- The two exact README picture blocks are exercised in local fixtures at 900px and 375px for light and dark. [Light 900](evidence/readme-light-900.png), [dark 900](evidence/readme-dark-900.png), [light 375](evidence/readme-light-375.png), [dark 375](evidence/readme-dark-375.png). These fixtures reproduce the image embedding, not GitHub's complete sanitizer or surrounding page.
- Zero HTTP(S) asset requests and zero page errors during standalone variant rendering. Used font faces resolve through embedded bytes; the unused italic face may remain `unloaded` because there is no italic text.
- Source geometry checks reject diagonal connector segments, transit through non-endpoint boxes, stacked strokes, unbridged crossings, and shared attach points less than 12px apart. There is one explicit 8px bridge, with a paper knockout, where the scoped-context path crosses the FORGE-to-compute path. All other off-axis corners use radius 8. There are no arrow labels to mask or collide with nodes.
- Visual inspection covered the 900px light/dark picture fixtures, both full editorial layouts and narrow scroller captures. Automated containment and routing complement that inspection; they do not establish product functionality.

The installed skill's unmodified `self_check.py` **rejects all five embedded font `url(data:font/ttf;...)` declarations** in each HTML file. It permits a remote Google Fonts stylesheet, but that would contradict this task's offline requirement. [verify.py](source/verify.py) records the original failures, validates each embedded TTF's exact acquired SHA-256, removes only those audited font-face rules in temporary copies, and runs the unchanged skill gate over the remaining document. All six remaining gates pass; all six SVGs parse and have no CSS, scripts, external images or live text. [skill-checks.json](evidence/skill-checks.json) preserves that exception explicitly. Neither the installed gate nor the global profile was modified. The installed package has no geometry verifier, so source routing checks and actual browser label measurements are used instead.

No live GitHub publication, remote account, compute, application runtime, native automation or Home UAT test was run for this documentation task.

## Fidelity ledger

Compared with README at `b238a5d`:

- Workflow: 8 nodes → **5 stages**. Asst advice moves inside Build; registered files, local tests, preview, QA and Owner acceptance move inside Verify. Plan approval remains explicit. Unknown outcome reconciliation remains a note rather than a sixth stage. Preview is registered static content; delivery is a selected-files ZIP with limitations.
- Architecture: 13 nodes → **8 components**. GUI moves inside Owner; AG-UI observations and Chat/Workspace become one observed-views component; Docs/Sheets and report generation become Office / Reports; Context and Memory become one scoped-reference component. QA / Owner acceptance is retained in the workflow instead of repeated in architecture. Compute/targets, artifacts and the distinction between FORGE authority and T3 turn ownership remain explicit. FORGE coordinates compute; the drawing does not give T3 a second domain authority. Selected edges explain relationships, not every API call or control return path.

## Credits and source pins

Adapted editorial system and template structure: **Diagram Design**, copyright © 2025 Cathryn Lavery, MIT. Primary visual reference: [gallery](https://cathrynlavery.github.io/diagram-design/) and [architecture sample](https://cathrynlavery.github.io/diagram-design/example-architecture.html). The sample's actual computed body was paper `#f5f5f5`, ink `#2d3142`, Geist; H1 was Instrument Serif at 32px. The supplied skill's current tangerine token is `#eb6c36` (dark `#f08a59`). No installed profile was changed.

The installed package used was **2.6.48**; [skill-provenance.json](source/skill-provenance.json) records the hashes of its templates and applicable references. The repository was observed at [`b228c5d77794a84150fca41b22940bb316b1398d`](https://github.com/cathrynlavery/diagram-design/tree/b228c5d77794a84150fca41b22940bb316b1398d), used to pin the [included MIT license](credits/diagram-design-LICENSE.txt). That upstream HEAD pin does not claim the installed package is identical to HEAD. FORGE content and coordinates are original to this task.

Fonts are unmodified public Google Fonts distributions with URL, size and SHA-256 in [acquisition.json](source/acquisition.json): Geist 400/600, Geist Mono 400, Instrument Serif regular/italic 400. Their included SIL Open Font License 1.1 notices are [Geist](credits/geist-OFL.txt), [Geist Mono](credits/geistmono-OFL.txt), and [Instrument Serif](credits/instrumentserif-OFL.txt), obtained from google/fonts revision [`83c62e30d87daa70216dab6b984d00d20d96d585`](https://github.com/google/fonts/tree/83c62e30d87daa70216dab6b984d00d20d96d585). Typeface authorship and reserved-name terms remain in those notices.

Trailing spaces in the three OFL notice copies are removed for repository whitespace checks; acquisition records preserve their original upstream byte hashes separately. License wording is unchanged.
