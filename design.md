# FORGE product design system

Owner correction2026-11-24: redesign the workbench to be beautiful and distinctive;
earlier rigid negative UI defaults may be relaxed. Use **named VS Code themes**,
with **Dark Modern** as the initial graphite theme. Theme choice is a real GUI
preference, persisted locally and by the application, not a static screenshot.

## Product and surfaces

A precise, calm engineering workbench for Thai no-code users. A consistent
side rail, functional top bar, task-led Overview and focused working surfaces.
Keep real project/team/plan/notebook/office/report behavior. No invented metrics,
reviews, customers, completed jobs or connectivity. Status is backed by records.

The landing page uses a strong typographic hero, real FORGE screenshot, workflow
story and explicit Windows/macOS alpha downloads. Public references provided by
the owner: orca.dev, t3.codes, paseo.sh. They inform structure and product-led
presentation; their copy, brand, testimonials, statistics and screenshots are not
FORGE content. The site is built for local review; publication is separate.

## Typography and tokens

Bundled Manrope600/700 display; IBM Plex Sans Thai400/500/600 body and Thai
fallback, local font assets from @fontsource5.3.0. Upright headers, useful hierarchy,
short readable paragraphs. Code keeps a monospace role. No remote font runtime.

Use semantic theme tokens throughout app surfaces: background, sidebar, paper,
ink/foreground, muted, accent/accent ink, line, input, success/warning/error and
focus. Use actual palettes from MIT microsoft/vscode builtin themes, pinned source
b57d5c9e1b27c4ede570c76940b7aa5207595a54 with attribution. The same layout and
behavior applies across themes; all forms/modals/task states must remain readable.
Univer uses its supported live theme APIs without remounting or discarding edits.

## Interaction and layout

Desktop uses a clear side rail (232px, 218px below 1200px), a 64px top bar and
roomy content. The app content stays within 1560px; Overview within 1180px.
The main heading uses Manrope at 26px on Overview, reducing to 22px on phones.
Task focus uses 30px desktop text, with explicit 26/25/23px responsive steps.
The body remains 13px with 12px action labels and 11px supporting records.
Overview uses one tonal task focus surface, an open definition-list summary, and
Recent work beside a compact tool list. Task status, owner, and counts reflect
canonical records. Ongoing work leads, then blockers, reviews, ready and backlog
tasks; the most recently recorded task wins within a status. Opening the focus
uses the existing plan route; it does not execute or imply a live run.
Use the semantic sidebar tone for the focus surface, full status outlines and
ordinary row separators. Avoid decorative graphs and repeated summary cards here.
Keep the current project description visible and label developer fixtures honestly.

Desktop uses tonal separation; ordinary panels and primary buttons have no
ambient shadow. Dialogs and the mobile drawer retain their functional elevation.
Interactive rows have hover feedback; focus rings use the existing semantic token.
Busy submit buttons retain their accessible name, announce busy state and disable
repeat submission. Field hints preserve existing description associations.

Narrow screens use a drawer and
stacked fields; check320/375/414/768 widths for overflow. Theme chooser supports
keyboard and search, visual palette previews, current selection and Escape.
Use restrained transitions and reduced-motion. Preserve visible focus and useful
loading/error/conflict states. No new approval gate for routine authorized UI work.

## Scope and ownership

Lead: App/theme persistence/fonts, launcher/download API/packaging, integration
and shared contracts. Scoped app refinement: Overview, ui primitives and style.css.
Named palette sources and ThemePicker retain their existing owner.
Landing worker: Landing/landing.css/welcome.html only. Preserve existing code paths
and routes; no production components or legacy payloads are deleted.
