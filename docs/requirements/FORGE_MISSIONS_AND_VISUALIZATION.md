# Mission, Visualization, Parallel and Proactive requirements

Owner-confirmed 2026-11-25. This extends Complete Local v3 and its addenda;
it does not replace A00–A30, activate a prototype, change the repository license,
authorize a push/deployment or treat source availability as release readiness.

## Confirmed decisions

- Implement all three: **Mission + Delivery Pack**, **Parallel Workspace**, and
  **Proactive Workflows**. They are accepted scope, not competing alternatives.
- Add **Visualization Workspace**: transform the same Chat Group into a Node–Edge
  view of the agents actually called and what they are doing. Make it beautiful
  within the established FORGE themes, typography and no-code operating context.
- Graph is live inspection/details with the existing guarded Start/Stop/Approve
  actions. Dragging an edge does not create a new delegation or permission path.
- Primary acceptance journey: **software idea → plan → code → preview + tests**.
  Use bounded engineering fixtures; do not start a separate product prototype.
- Local core open source; team/remote services may be optional future offerings.
  Exact license/commercial terms and publication remain separate work.
- Owner approves a proactive recipe, scope and budget first; subsequent triggers
  may run automatically inside that envelope. Anything beyond it goes to Inbox.
  New work through Telegram still needs originating-channel Owner approval.

## Mission and delivery

Capture expected outputs, constraints, inputs and measurable acceptance. Ask only
for unclear or conflicting decisions and persist the selected answer/revision.
Generate/edit the existing canonical plan/tasks/Goals; show the plan before work.
Bind each output to its task, source revision, actual attempt, provider selection,
verification and Owner review. Delivery Pack includes preview or supported files,
test results, checksums, provenance and explicitly unverified remaining work.
An agent's completion message alone cannot satisfy acceptance.

## Visualization

One room identity and canonical state, two views: Chat and Workspace. Preserve
the draft and conversation while switching. Project/room switches must not
display a previous room's graph selection or private data.

Show room, called agent, actual run/attempt, observed tools and linked artifacts.
Differentiate room membership/binding, execution, explicit delegation and artifact
lineage. Never infer delegation from text, bot role or an agent claiming success.
Map native nested workers only when their actual parent/thread/run identity is
available; a tool named delegate_task is not sufficient evidence of a child run.

Persisted unknown/interrupted/disconnected states remain visible. Tool argument
completion is distinct from a confirmed result. Artifact registration, verified
bytes, tests passed and Owner acceptance are separate states. Animation indicates
an observed active connection, never a simulated worker or inferred progress.

Node inspection exposes related run/attempt/tool/artifact evidence and existing
guarded commands. Ordinary viewing, reconnecting the display or switching views
must not dispatch work, grant permission, retry an external effect or mutate tasks.
Include keyboard selection, readable linear alternative, Fit/zoom, bounded graph
size with omission disclosure, TH/EN, named themes and reduced-motion support.

Initial implementation bounds: eight prioritized room-bound FORGE runs, three
tools/two artifacts per run on the canvas, full selected-run details. Native T3
child-worker attribution, history/time travel, drag positioning and large-graph
virtualization remain follow-on tasks. Do not claim these from the first slice.

## Parallel workspaces

Use actual separate worktrees/branches or explicitly qualified execution targets.
Preserve canonical task/bot/run identity and one authority for admission. Dependency
tasks stay ordered; shared desktops remain single-controller. A Git worktree is
file separation, not an OS security sandbox. Capacity and provider limits must be
configured/observed, not inferred from the model name or machine CPU count.

Integrate results through a review queue with source heads, checks and evidence.
Detect conflicting edits and stale bases before merging. Stop only the owned
attempt/process; unknown outcomes do not authorize redispatch. Verify two real
independent engineering tasks and their combined result before advertising this.

## Proactive envelope

Version recipe + trigger + timezone + identity + scope + action capabilities +
budget + expiry together. Recheck the accepted envelope immediately before a
trigger starts work. Revocation/edit/connection changes invalidate incompatible
grants; scopes cannot expand because a model asks. Dedupe events and keep durable
scheduled/claimed/dispatched/delivered identities. Out-of-envelope work and
uncertain outcomes go to Inbox; never automatically retry a possible effect.

Display actual reported usage, estimates and unknown accounting separately.
Unknown cost is not zero and cannot silently satisfy a monetary cap. Bounded
read/propose routines and outward effects retain their existing permission rules.
The approved recipe is not permission for unrelated mobile work or arbitrary MCP.

## Delivery order and evidence

1. Complete existing v3 credential/recovery/acceptance gaps (CR-00).
2. Build the read-only Visualization projection alongside that work, then
   Mission/Delivery acceptance around the software journey.
3. Qualify isolated parallel execution and integration queue.
4. Implement proactive recipe envelopes/scheduling/Inbox and test lifecycle races.

This ordering schedules all accepted features; it does not remove later items
from scope. Each slice records implementation separately from developer/live/home
qualification. Research comparison and source pins:
`docs/research/FORGE_COMPETITIVE_REVIEW_20261125.md`.
