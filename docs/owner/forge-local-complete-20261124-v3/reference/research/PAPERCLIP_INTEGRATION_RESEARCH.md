# Paperclip → FORGE reuse assessment

Owner addition: 2026-11-24. Continue the existing complete-product work and assess
Paperclip's strengths for actual adoption. Observed HEAD from `git ls-remote`:
`7d26bdaa424551a172f1a4b7ae3c737a0745e8f9`, branch `master`.
License inspected at that revision: **MIT**, copyright2025 Paperclip AI.
This is source/design research; no Paperclip runtime, account or database was started.

Primary evidence inspected:

- [Repository](https://github.com/paperclipai/paperclip/tree/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9)
  and [license](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/LICENSE).
- [Budget implementation](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/server/src/services/budgets.ts)
  and [budget guide](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/docs/guides/board-operator/costs-and-budgets.md):
  scoped observed spend, warning/hard-stop thresholds, durable admission/enforcement.
- [Approval service](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/server/src/services/approvals.ts):
  durable pending/revision-requested/resolved decisions, scoped audit/history.
- [Heartbeat/checkout protocol](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/docs/guides/agent-developer/heartbeat-protocol.md):
  explicit agent/task/run ownership, parent-goal context, durable next action and
  separate task workflow versus run liveness. These are reference product concepts,
  not instructions governing this FORGE development session.

## Selected integration direction

FORGE retains its current SQLite authority and matching T3 provider/thread owner.
Add governance and organization behavior around these existing identities. Existing
adaptive loops, native leases, operation receipts and plan approval remain the
execution boundaries. Keep Thai-first forms and common task/run/artifact records.

| Task | Useful Paperclip behavior | Concrete FORGE work and acceptance | Current state |
|---|---|---|---|
| PC-01 | Traceable reuse | Pin source/license, inspect implementation, record adoption boundaries | SOURCE_AUDIT_PASSED |
| PC-02 | Goal alignment + org chart | Bot manager/reporting relation and task parent/goal context; reject cycles and cross-project links; show team responsibilities | READY_FOR_IMPLEMENTATION |
| PC-03 | Durable review inbox | One GUI inbox projects existing T3 permissions, Office edit review, task review and storage conflict; actions call existing authorities | READY_FOR_IMPLEMENTATION |
| PC-04 | Budgets and observed costs | Project/bot policy and reported usage ledger; expose unknown cost separately; admit/hold starts from durable reservations and actual evidence | READY_FOR_IMPLEMENTATION |
| PC-05 | Connection action policy | Allowed/Ask/Off per project/connection/tool with durable exact-operation decision; supply provider MCP's currently missing supervised policy hook | READY_FOR_IMPLEMENTATION |
| PC-06 | Checkout/next-action discipline | Reuse actual task/run reservation; add durable progress + executable next action, reject competing owner; no blind retry after conflict | PARTIAL_EXISTING; GAP_REVIEW |

First implementation priority: PC-05 and PC-02, followed by a unified review inbox.
Cost tracking must use observed trusted provider/adapter data; a subscription, token
count or elapsed time is not a dollar-cost receipt. Existing unknown/stop/reconnect
semantics continue; a heartbeat must not resubmit a provider turn or Office edit.

No Paperclip code is vendored at this checkpoint. If source is copied later, retain
the exact MIT notice and document modified files. Any external Paperclip API adapter
would be separately configured and qualified; source research does not imply an
installed service or a working two-system synchronization route.

Next executable task: implement the selected governance/organization module in an
isolated worker after an active slot frees, then let the lead mount HTTP/GUI and
verify real MCP policy admission plus task/bot scope. This work augments G2/G3/G6;
it does not replace the outstanding adaptive/compute/provider/Office integration.
