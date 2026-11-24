# Theme worker handoff — 2026-11-24

Implementation model/options: `gpt-6.1-sol`, `xhigh`, Codex harness through T3 Code.
Branch: `t3/redesign-workbench-theme-picker`. No subagents, pushes or PRs.

## Delivered

The existing workbench CSS now uses shared surface, text, status and interaction
tokens throughout its sidebar, topbar, form, panel, canvas, Kanban, conversation,
modal, logs, artifact table, monitoring, report and office chrome. Generic native
element rules exclude descendants of `.univer-container` so the mounted editor
continues to own its controls. PDF paper is intentionally document white.

Dark Modern (`dark-modern`) is the unconditional fallback/default. All 15 built-in
choices are present: Dark Modern, Dark+, Light Modern, Light+, Monokai, Monokai
Dimmed, Solarized Dark, Solarized Light, Quiet Light, Abyss, Kimbie Dark, Red,
Tomorrow Night Blue, High Contrast Dark, High Contrast Light.

`ThemePicker.jsx` is a controlled default export accepting `{theme,onChange,t}`.
The optional translator uses `(thai,english)` and defaults to English in isolation.
`onChange(id)` emits the selected id. Search, dark/light groups, original-palette
miniatures, selected `aria-checked`, native modal focus containment, Escape,
outside dismissal, focus restoration and radio arrow/Home/End navigation are
implemented. Arrow keys preview/apply a theme while keeping the dialog open;
Enter, Space and click select and close it.

`themes.mjs` exports `THEMES`, `DEFAULT_THEME`, `VSCODE_REVISION`, and `getTheme(id)`.
Unknown/null theme ids resolve to Dark Modern. Each catalog record has
`{id,label,kind,highContrast,source,preview,tokens}`. The module is browser safe.
`themes.css` has `:root[data-theme="..."]` rules and a `:root` Dark Modern fallback.
`style.css` imports it, so no additional main import is required.

The actual built-in source and MIT license are pinned at Microsoft VS Code
[`b57d5c9e1b27c4ede570c76940b7aa5207595a54`](https://github.com/microsoft/vscode/tree/b57d5c9e1b27c4ede570c76940b7aa5207595a54).
The source/hash ledger and adaptation notes live in `app/vendor/vscode-themes/`.
No claims about marketplace themes or third-party compatibility are made.

## Lead integration

Import `ThemePicker` and catalog helpers, set root `data-theme` to the normalized
`getTheme(settings.theme).id`, and persist emitted ids in application settings.
Persistence and initial-paint initialization belong to the lead; this worker did
not edit App/main/Overview/backend/contracts/manifests/central progress.

Font tokens use Manrope first, IBM Plex Sans Thai second, then platform fallbacks.
The lead owns the bundled @fontsource dependencies/imports. This isolated worker's
verification used system font fallbacks because its base predates those imports.

SVG aliases: `--ink`, `--accent-ink`, `--accent-soft`, `--line`, `--paper`,
`--muted`. `--brand: #f97316` stays orange independently of the selected theme;
`--brand-ink` is the contrast-adjusted brand text color. Dark Modern controls use
its upstream blue (`#0078D4`). All lead-requested Overview classes are styled,
including the extra quick-action/local-note/section-head/live-indicator classes.
At widths <=960px, sidebar uses the existing `.nav-open` drawer class, aligned to
the 64px topbar. The lead's existing menu behavior continues to own its state.

Keep Univer live theme updates in its own API; no lifecycle/remount changes here.

## Developer evidence

- `npm.cmd ci --ignore-scripts --no-audit --no-fund`: passed, lockfile unchanged.
- `npm.cmd run build`: passed. Existing large Univer chunk and dependency
  `use client` warnings remain; no new CSS/build errors.
- `npm.cmd run test:browser`: passed on the real service with disposable data:
  Thai/English, project/team/chat/plan/task persistence, Python execution,
  Univer Sheets/Docs mounting, bounded edit/shared undo/redo, stale rejection,
  native snapshot reopening after restart, report persistence, backup, mobile,
  no uncaught browser errors. No owner product/prototype was created.
- `node app/vendor/vscode-themes/verify.mjs`: passed. All 32 retained upstream
  files match SHA256, 15 palette choices/fallbacks verified, body/muted/link text
  minimum contrast **4.503:1** across all principal surfaces; status and primary
  button default/hover text also pass 4.5:1. Original palette anchors verified.
- Same harness: all 15 public `onChange` ids, filtering/no-results, selected radio
  state, arrows/Home/End/Enter, Escape/outside close, focus restoration, Thai
  labels, reduced motion, editor CSS boundary, no root/dialog overflow and no
  truncated theme names at **320, 375, 414, 768, 1440px**. No browser errors.
- Theme-picker desktop/mobile/Thai screenshots inspected locally. Last capture:
  `C:/Users/siripon.sri/AppData/Local/Temp/forge-theme-verification-OnsnXU/`.
  Captures are disposable verification artifacts, not checked-in product assets.
- `git diff --check`: passed for authored files. Vendored source retains upstream
  whitespace byte-for-byte via local `.gitattributes` (`-text -whitespace`),
  including Quiet Light's three mixed-indentation lines.

Implementation gap: none within the assigned theme/styling scope. The lead still
needs the integrated Overview/font/persistence visual check after cherry-picking.
No live credentials are needed for this scope. HOME_UAT_NOT_RUN.
