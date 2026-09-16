# Execution substrate boundaries

FORGE owns intent, requirements, planning, task graph, staffing, routing, Independent QA, release gates and evidence. An execution substrate receives a bounded task and returns artifacts plus receipts. It must not introduce another planning authority.

## Current classification

| Substrate | Classification | Boundary |
|---|---|---|
| Native FORGE | Default | Always available; rollback target for optional adapters. |
| AO v0.13.0 | `ADOPT_AO_LIMITED` | Opt-in worker execution only; one loopback daemon/data/run/port boundary per provider. |
| Orca v1.4.204 | Reference-only | No adapter; Windows runtime and provider-account boundary are not qualified. |

## Required adapter properties

Any optional execution adapter must be disabled by default, worker-only, locally bounded, receipt-producing, reversible before dispatch, and unable to mutate FORGE planning or deployment state. Authentication management, account switching, remote/mobile control and public listeners are denied unless the OWNER separately approves an architecture and security change.

Fallback to native execution is allowed only before an external dispatch is created. After dispatch, the adapter must reconcile the external lifecycle and evidence rather than silently duplicate work.

## FORGE-to-substrate mapping

| FORGE concept | Substrate representation |
|---|---|
| Project execution | Isolated runtime namespace, never a planner |
| Task | Bounded work item with preserved FORGE task ID |
| Attempt | Dispatch/session ID linked to one task attempt |
| Worker | Terminal, session or coding-harness process |
| Evidence | Structured receipt normalized back into FORGE schema |
| Cleanup | Explicit stop/release result with process and workspace proof |

See [AO Limited integration](AO_LIMITED_INTEGRATION.md) and the [Orca evaluation](ORCA_EVALUATION.md).
