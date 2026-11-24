# Assistance Strategy and automatic model selection

Owner addition2026-11-24, augments FORGE complete-product requirements.

Confirmed: a larger model acts as **Asst.** for assistance/planning/review and a
smaller model acts as **Executor**. Add automatic model selection. The owner asks
to resolve uncertainty/conflicting requirements with them before dependent work.
This describes the product feature, not a change to the development model.

Pending owner choices (asked through asynchronous user-input UI):

1. Auto selection only within explicitly allowed Asst./Executor lists in Settings,
   or all models on connected providers.
2. Asst. plans/reviews every task, or assists only difficult/stalled execution.

Status: REQUIREMENTS_PARTIALLY_CONFIRMED / WAITING_OWNER_PREFERENCES.
Do not silently apply recommended UI defaults as an owner answer.

Implementation requirements independent of those answers:

- Preserve resident/helper bot identity and one authoritative task/run pipeline.
  Asst./Executor are model roles within that pipeline; T3 remains provider/thread
  execution owner. Persist exact provider instance/model/options per role/attempt.
- Validate selections against actual authenticated-route catalog/capabilities;
  no fabricated model IDs, size/quality claims, pricing or confidence percentages.
  Larger/smaller roles are explicit configurable classifications and constraints.
- Keep planning, bounded execution, inspection, review and escalation attributable.
  Show which model selected which role and the rule/evidence for auto selection.
- A model/route change creates an explicit new attempt after reconciliation.
  Unknown response, reconnect or model fallback must not repeat tool effects.
- Respect project scope, human plan approval, existing supervised permissions,
  adaptive limits, reported-cost policy and Stop/Take over semantics.
- Missing capability/catalog/authentication returns actionable setup; unresolved
  preference or conflicting constraints asks the owner before dispatch.

Next executable work after answers: finalize Settings schema and selection rules,
implement role-specific T3 context/admission plus bounded Asst.–Executor loop,
add GUI controls/trace and fixture/live checks. Current ordinary adaptive selector
does not yet implement this two-role strategy and must not be presented as doing so.
