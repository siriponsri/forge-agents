# Asset and source provenance

No generated imagery, competitor assets, testimonials, adoption counts or benchmark
claims are used. Public references supplied by the owner were opened in the shared
browser on 2026-11-24: Orca, T3 Code, Paseo, Cursor, Linear, OpenCode and Dify. Their
clear product actions, interface-led proof and workflow storytelling informed the
quality bar. No code, copy, logos or screenshots were copied from those sites.

`public/forge-workbench.png` is an unchanged copy of the verified actual FORGE
1440×1000 Dark Modern workbench capture named `overview-1440-dark-modern.png`, made
by `app/web/tests/visual-refinement.mjs`. The parent checkout's older
`app/web/public/forge-workbench-preview.png` showed a superseded Overview, so the
newer verified capture was selected instead. Its disposable engineering data is
labelled in the screenshot and the surrounding caption. The source evidence
reported PASSED for real GUI creation, scoped task records and theme verification;
it did not claim live agent runs. No mutable state, database or secret was copied.

- Origin at capture: developer-local temp directory `forge-visual-refinement-rFK2fH`.
- Source SHA-256: `053c352b7c1a0235d8e9e866ed2b5b2a5f58dd4125312062faffa7f1da0bf705`.
- Product source inspected: local commit `01ee779ffd049ba875ad85bd36f2c8accd274ca0`.
- Current workbench code/tokens were compared with the screenshot before copying.
- GitHub commit API for that local commit returned HTTP 422 and named app/docs
  paths were absent in the public tree. The public site therefore creates no
  broken public source-file links, and explicitly explains publication status.
- Screenshot content belongs to FORGE and follows the repository license. No
  upstream product screenshot is included.

`public/favicon.svg` and the React `Mark` are original code-native FORGE letterform
geometry, matching the orange brand identity without an external logo asset.

Bundled fonts: Manrope and IBM Plex Sans Thai from the pinned `@fontsource`
packages (SIL Open Font License 1.1). Their licenses and required notices are
copied into `public/licenses/` and ship with the fonts. Lucide icons use the
ISC license; Radix primitives use MIT. See `public/licenses/` for full notices.
Radix Tabs supply the accessible interaction also used by shadcn-style tab
components; a second component framework and ornamental Magic UI effects were
not necessary for this restrained, compatible implementation.
