---
name: FORGE public website
description: An expansive, product-led introduction to connected local work
colors:
  paper: "#f7f8fa"
  surface: "#ffffff"
  ink: "#20242a"
  muted: "#5f6570"
  line: "#d9dde2"
  soft: "#eceff2"
  accent: "#a83d0b"
  accent-soft: "#fbe5d5"
  brand-orange: "#fa7415"
  dark-paper: "#13161a"
  dark-surface: "#1a1e23"
  dark-ink: "#edf0f3"
  dark-muted: "#a4adb8"
  dark-line: "#343b43"
  dark-soft: "#222830"
  dark-accent: "#ffae7b"
typography:
  display:
    fontFamily: "Manrope, IBM Plex Sans Thai, sans-serif"
    fontSize: "clamp(48px, 6.1vw, 88px)"
    fontWeight: 600
    lineHeight: 1.11
    letterSpacing: "-0.04em"
  body:
    fontFamily: "IBM Plex Sans Thai, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
  title:
    fontFamily: "Manrope, IBM Plex Sans Thai, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.02em"
rounded:
  control: "8px"
  container: "14px"
  status: "5px"
spacing:
  tight: "8px"
  related: "16px"
  group: "28px"
  section: "112px"
components:
  button-primary:
    backgroundColor: "#252a30"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "12px 22px"
    height: "50px"
  navigation:
    textColor: "{colors.muted}"
    height: "88px"
  architecture-container:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.container}"
  capability-status:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.status}"
    padding: "3px 8px"
---

# Design System: FORGE public website

## Overview

**Creative North Star: "Connected work, clearly seen"**

The public website inherits FORGE's orange letterform and bundled typefaces,
then gives the product room: broad whitespace, an actual workbench capture and
open, readable workflow rows. This is a standalone Persuade/Read surface; its
light/dark choice is independent of the product's 15 named editor themes.

Thai is the default reading language, with English major headings. Visitors may
read in ordinary daylight or a darker workspace, so the two themes have explicit
semantic tokens rather than a filter applied to one palette.

**Key Characteristics:**
- Expansive typography paired with practical, readable supporting copy.
- Real product proof and explicit development qualifications.
- Open rows for content; bounded surfaces for the screenshot and architecture.
- One purposeful transition, not repeated section entrances.

## Colors

Cool neutrals carry the reading surface; the warm accent connects the site to FORGE.
Brand orange belongs to the mark. Darker accent ink in light mode makes small
links and status copy readable; light orange performs the same role in dark mode.
Green means local qualification, and purple means planned capability.

**The Semantic Pair Rule.** Every background, text, line and focus role has an
explicit dark counterpart. Change the whole role relationship, not isolated hexes.

## Typography

Display uses bundled Manrope, body uses bundled IBM Plex Sans Thai. Both support
the product's confirmed identity; no remote font request is needed. Headings
balance automatically and tracking never drops below the display token.

Section headings range from 32 to 46px, with 1.22 line height. Feature titles use
22–24px; inner-page headings use 44–68px. Main supporting copy uses 16–18px,
with a maximum 72-character measure. Small metadata is 10–13px and never carries
the essential setup or qualification instruction by itself.

**The Reading Language Rule.** Thai paragraphs keep generous line height and
normal tracking. English display compression never leaks into Thai body text.

## Layout

Content is at most 1232px wide. Desktop gutters are 48px, tablet 28px, phone 20px.
The header uses a wider 1376px maximum. Desktop sections separate at 112px;
tablet at 76px; phone at 58px. The hero pairs a larger left headline with a
right-hand explanation/action. Below 620px it becomes a single reading column.
Architecture detail follows its layer controls on phones; navigation becomes a
keyboard-dismissable menu. Documentation uses a requirements sidebar on larger
screens and ordinary top-to-bottom prose on phones.

## Elevation & Depth

Tonal fields and full borders define depth. Shipping surfaces have no ambient
shadow. The architecture's detail field is a tonal sibling of its control field.
Focus is a visible 3px outline, offset 5px; it is never simulated with elevation.

## Shapes

Controls use gently curved 8px corners; actual containers use 12–14px. Status
labels use compact 5px corners. The screenshot retains its original aspect and
opens at full resolution. Crisp connector geometry illustrates ownership only;
there is no decorative grid, glow or generated product picture.

## Components

Primary actions have a 50px minimum height and a simple arrow. Hover shifts the
background to the theme accent and lifts 2px; reduced-motion disables movement.
Navigation keeps ordinary links and a compact locale/theme group. Mobile menu
Escape restores focus to its opener. The skip link moves focus to main content.

Architecture uses Radix Tabs with arrow-key movement, selected styling and one
associated detail panel. The content transition clips from a visible state over
400ms with exponential ease-out; reduced motion removes it. Capability filters
are pressed buttons, status remains explicit text, and results announce their count.

Download availability is data, not a disabled imitation of a release button.
When metadata has no qualified package, the available action leads to setup.
No form, input primitive or account-sign-in flow exists on this site.

## Do's and Don'ts

- Do preserve real product screenshots and their developer-fixture captions.
- Do make setup and release limitations readable in both themes and languages.
- Do use open rows for explanatory content and full borders for actual containers.
- Do keep motion purposeful and remove it for reduced-motion visitors.
- Don't invent public releases, completed live checks, users or metrics.
- Don't apply the workbench's 15-theme controls to this independent website.
- Don't add external fonts, embeds or a dependency on the private local runtime.
