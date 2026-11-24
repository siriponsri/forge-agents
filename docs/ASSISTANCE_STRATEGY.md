# Assistance Strategy and automatic model selection

Owner addition2026-11-24, augments FORGE complete-product requirements.

Confirmed: a larger model acts as **Asst.** for assistance/planning/review and a
smaller model acts as **Executor**. Add automatic model selection. The owner asks
to resolve uncertainty/conflicting requirements with them before dependent work.
This describes the product feature, not a change to the development model.

Owner choices confirmed in conversation:

1. Auto selection may consider **all models of connected providers**.
2. Invoke the larger Asst. **only for difficult work or when Executor is stuck**.

3. **Balance quality and cost**, starting with an Executor suited to the work.

All three preferences were explicitly answered by the owner. KOB was clarified
separately as an **API connection using the owner's API key**, not CLI/extension.

Status: REQUIREMENTS_CONFIRMED / READY_FOR_IMPLEMENTATION.

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

Next executable work: finalize Settings schema and selection rules,
implement role-specific T3 context/admission plus bounded Asst.–Executor loop,
add GUI controls/trace and fixture/live checks. Current ordinary adaptive selector
does not yet implement this two-role strategy and must not be presented as doing so.
