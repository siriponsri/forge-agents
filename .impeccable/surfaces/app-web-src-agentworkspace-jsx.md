---
version: 1
slug: app-web-src-agentworkspace-jsx
primary_target: app/web/src/AgentWorkspace.jsx
related_targets: [app/web/src/agent-graph.mjs, app/web/src/agent-workspace.css, app/web/src/work.jsx]
---

# Conversation visualization

Mode: Operate. A bounded, code-led extension of the existing Chat Group surface.
Owner asked for Chat Group transforming into a beautiful Node–Edge workspace,
showing which agents were called and what they are doing. Owner confirmed live
inspection and existing guarded Start/Stop/Approve controls. Existing themes bind.

## Direction contract

THESIS: Make actual room → agent → run → tool/output relationships inspectable.
No illustrative workers, fictional progress, decorative dashboard or new planner.

OWN-WORLD: Existing Manrope/IBM Plex Thai, named semantic themes, Lucide and
graphite canvas. Fine curved connectors, readable node buttons and status words.

STORY: Switch Chat to Workspace; inspect an observed agent, run, tool or artifact;
open its existing run controls and return to the same conversation draft.

FIRST VIEWPORT: Room heading and Chat/Workspace switch above a bounded horizontal
canvas; room left, agents/runs center, tools/results right; selected detail below.
Fit/zoom and a readable list alternative remain available on narrow screens.

FORM: seed: none (pinned). Owner: "Transform จาก Chat Group เป็น Node Edge"
and "ใช้ Start/Stop/Approve ผ่านปุ่มเดิมที่มีสิทธิ์ตรวจอยู่แล้ว".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

This extension inherits design.md; no visual identity or system rewrite and no
shipping raster are required. Evidence is recorded in the competitive review.

## Finish evidence

Build and12 scoped projection/production-UI/domain/boundary checks PASS. Captures
1600 dark/768 light/375 dark inspected, real uploaded file/hash/download, injected
run/tool/parent observations (zero provider turns). Independent review returned
FIX; re-check verified three fixes and found active dash override. Lead removed
the override and tested active execution/delegation styles. No independent SHIP
after that last CSS correction. Incumbent design.md/tokens preserved; no generated
comp or shipping raster. Product implementation/live/home qualification remains
incomplete outside this first slice. Pre-existing Impeccable setup drift unchanged.
