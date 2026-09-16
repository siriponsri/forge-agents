# Architecture

FORGE is the control plane. It owns OWNER intake, discovery, task graphs,
planning, dynamic staffing, routing, Independent QA, deployment gates,
evidence and irreversible decisions.

Execution uses the native backend by default. When the AO Limited feature gate
and a worker route both opt in, the adapter may delegate only worker/session,
isolated-workspace and process-lifecycle mechanics to a provider-scoped AO
daemon. AO does not become a planner or approval authority.

`FORGE Planner -> route(native | AO Limited worker) -> result receipt -> FORGE Independent QA -> deployment gate`
