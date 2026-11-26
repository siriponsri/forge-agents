# Session roles and orchestration — Owner addition, 26 November 2026

The Owner resumed the complete-product goal and approved isolated subagents.
The supplied T3 screenshot is a reference for clear session organization. The
existing complete-product requirements, README-PRO and LOGO-MIN remain active.

## Required behavior

- The user can assign a role to an agent session, including Orchestrator,
  Planner, Reviewer, Executor and Strategist. Roles are retained with the exact
  session/bot and visible in its UI and run provenance.
- A main Orchestrator can send a prompt to an explicitly approved child
  session, using the existing canonical T3/conversation dispatch and budget
  owner. The relation and originating run/attempt must be explicit and current.
- Role assignments describe responsibility. They do not grant tool privileges,
  approve plans, reveal private conversations or bypass Stop, revisions,
  project isolation or human authority.
- Dispatch has a durable operation identity. Replay, lost acknowledgement,
  restart and concurrent requests cannot send the prompt twice. Role/membership
  changes during setup invalidate dispatch before the native effect.
- Assistance supports a user-selected Strategist pattern in addition to the
  existing Asst and Executor roles, with real selected routes and bounded
  planning/return handoffs. Existing patterns remain compatible.
- TH/EN controls and meaningful integration tests cover assignment, scoped
  prompt routing, replay, permission denial, Stop and recovery.

## Active ownership

The lead owns shared contracts, store/migrations, main/T3/conversation hooks,
integration and final qualification. Isolated workers own the new session-role
service/UI, Assistance Strategist implementation and README/brand assets.
Native observations supplied by test fixtures must remain labelled. The new
roles are not complete until production hooks and the mounted UI are verified.
