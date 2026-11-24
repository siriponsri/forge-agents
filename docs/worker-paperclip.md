# Paperclip governance worker handoff

Date: 2026-11-24 (Asia/Bangkok). Base: `de2e451`.
Branch: `t3/paperclip-governance-integration`.
Executed model: **gpt-6.1-sol, xhigh** (inherited actual T3/Codex runtime).
Owned paths only: new `app/governance/**`, `tests/governance*.test.mjs`, this file.

## Delivery and authority

`app/governance/service.mjs` exports `createGovernanceService({store})`.
The existing `openStore()` SQLite transaction interface is the sole durable
authority. There is no new table, migration, dependency, daemon, process, timer,
provider runtime, task collection, account, credential or scheduler.

| Work | Implemented here | Integration remaining with lead |
|---|---|---|
| PC-02 | Bot reporting/responsibilities; existing task parent/plan-goal context; scoped validation; durable next action | HTTP/GUI forms, context in T3 prompt, generic CRUD/restore validation hook |
| PC-05 | Per-connection/tool Allowed/Ask/Off; exact operation request, human approve/deny, atomic one-shot consume, audit, optimistic revision fencing | Mount HTTP/GUI, inject MCP authorization, recheck immediately before remote dispatch |
| PC-03 | Read-only unified inbox projection of existing authoritative records | Mount inbox view; route actions to existing authority screens/services |
| PC-06 | Persist next action and validate actual task bot/run/attempt; reuse task/run owner | Existing T3 checkout/start owner remains responsible for actual execution |
| PC-04 | Pinned source assessment and concrete follow-on specification below | Observed usage/admission ledger is **IMPLEMENTATION_INCOMPLETE**, not a credentials blocker |

These methods are wire-ready modules, not claims that the product GUI is mounted.
No shared/main/domain/provider/web/manifest/central-progress file was changed.

## PC-05 exact API and HTTP/GUI seams

All mutators are async. Read methods and `validateAdmission()` are synchronous.
Errors use existing `{code,statusCode,details?}` conventions. Noninitial updates
require the reviewed revision. The local HTTP boundary must derive the human
actor from its trusted user action; an agent/provider tool must not gain access to
the human decision/configuration route by claiming an actor in its payload.
The actor object is attribution, not an authentication token.

Suggested lead-owned routes (none mounted by this worker):

| Route | Service method |
|---|---|
| GET `/api/governance/policy?projectId=...&connectionId=...` | `policy({projectId,connectionId})` |
| POST `/api/governance/policy` | `configurePolicy(input)` |
| POST `/api/governance/tool/request` | `requestTool(input)` |
| POST `/api/governance/tool/decide` | `decideTool(input)` |
| GET `/api/governance/organization?projectId=...` | `organization({projectId})` |
| POST `/api/governance/bot` | `setBotContext(input)` |
| GET `/api/governance/task?projectId=...&taskId=...` | `taskContext({projectId,taskId})` |
| POST `/api/governance/task` | `setTaskContext(input)` |
| GET `/api/governance/inbox?projectId=...` | `reviewInbox({projectId})` |

Policy input:

```js
await governance.configurePolicy({
  operationId: 'unique-settings-command', projectId, connectionId,
  expectedRevision: 0, // policy revision, initial unset policy is revision 0
  expectedConnectionRevision: connection.revision, // fence the displayed target
  mode: 'allowed', tools: { write_record: 'ask', delete_record: 'off' },
  actor: {kind: 'human', id: 'local-user'},
});
```

Absent policy is Off. Mode strings are lower-case `allowed|ask|off`.
Connection mode is a ceiling: a tool override narrows it, never widens it.
Connection Ask + tool Allowed remains Ask; connection Off always remains Off.
Use concrete tool names; wildcard `*` is rejected. A policy edit invalidates all
pending/approved operations on that connection, including edits to the same value.
The GUI should show both the connection setting and effective per-tool mode.
`policy()` also exposes `connectionRevision`, `bindingCurrent` and `effectiveMode`.
Pass that connection revision as `expectedConnectionRevision` when saving the
settings view. A changed endpoint/account reference/discovered catalog cannot
inherit Allowed: effective mode becomes Off until the user configures policy for
the new target. The saved mode remains visible so the reason is reviewable.

An exact request uses precisely the existing MCP call shape:

```js
const operation = {projectId, connectionId, name: 'write_record',
  arguments: {value: 'the reviewed concrete value'}, operationId: 'unique-effect'};
const approval = await governance.requestTool(operation);
const decided = await governance.decideTool({
  operationId: 'unique-human-decision-command', projectId,
  approvalId: approval.id, expectedRevision: approval.revision,
  decision: 'approved', // or 'denied'
  actor: {kind: 'human', id: 'local-user'}, note: 'Optional review note',
});
// Existing MCP call owner, retaining operation.operationId:
// await mcp.call(operation);
```

When a GUI explicitly offers **Run this exact operation**, it can request and
approve that displayed operation from the same explicit Run click, then call
MCP. A second confirmation is unnecessary. The request must be bound to the
actual displayed arguments; a generic Execute/approve-all flag is insufficient.
Check `decided.status === 'approved'` before continuing: stale decisions return
the durably invalidated record instead of rolling that invalidation back.

Inject `authorizeTool: governance.authorizeTool` into `createMcpService`.
The callback receives `{projectId,connectionId,name,arguments,operationId,signal}`
and returns boolean true only after an atomic SQLite admission commit. Ask
without approval returns false and retains a pending review. Allowed uses the
same one-shot consume path without redundant human confirmation. Off/disabled/
missing-discovery requests are recorded as denied and never admitted.

**Required final dispatch seam:** the current MCP owner awaits connect after the
authorization callback. The lead must call
`governance.validateAdmission(exactOperation)` after that await and immediately
before `client.callTool`, without another asynchronous gap. A false result must
leave a failed/non-dispatched call record. This read-only method validates an
already consumed admission; it is not permission to dispatch a second time.
The callback alone cannot revoke work during an asynchronous transport setup.
The MCP owner continues to own `submitting/completed/failed/unknown`, stop,
replay, and actual dispatch. Governance never resends an operation.

## Approval persistence and replay semantics

- `governance.policy`, `governance.tool-approval` and `governance.audit` live in
  `state.events`, using existing UUID entity identity and revisions.
- Tool request records use **`toolOperationId`**, never the raw MCP
  `events.operationId`. MCP's own lookup cannot mistake a governance approval
  for its effect record.
- Governance command receipts use `governance:command:<sha256(operationId)>`.
  They never reserve the raw MCP effect ID in `receipts` or `runs`. Repeating a
  command with identical input returns its prior result; changed input conflicts.
- Requests bind project, connection, tool name, canonical exact JSON arguments,
  raw operation ID, policy revision, connection revision, transport/config
  references and discovered tool definition. Undefined/NaN/non-JSON values are
  rejected; missing arguments mean `{}`. Object key order does not grant wider
  values or scope. IDs/tool names reject surrounding whitespace.
- State path is pending → approved/denied; approved or Allowed pending → consumed.
  Configuration/connection/schema/discovery changes make unconsumed grants stale.
  Denied/stale/consumed are terminal for that effect ID. A changed/reverted setting
  or disable/re-enable cannot revive an old grant because revisions are fenced.
  Refreshing discovery increments the connection revision and requires a fresh
  concrete operation/review. Consumed grants are never automatically renewed.
- `recover()` only invalidates stale pending/approved records, returns
  `{invalidated,redispatched:0}`, and never starts a turn/effect. MCP's recovery
  remains responsible for its own uncertain dispatch records. Call MCP recovery
  first, then governance recovery; stale discovery appropriately invalidates
  unconsumed requests. A normal unchanged-store reopen can retain approval.
- A crash after consume and before dispatch can leave no remote effect. This is
  deliberately conservative: review a **new explicit effect ID** after checking
  actual remote state, rather than redispatching the consumed ID. An uncertain
  response must be reconciled through the MCP owner, never auto-retried.
- The exact arguments are local private SQLite review data; they are not included
  in portable project bundles or the inbox projection. Policy bindings retain
  hashes of machine references, not resolved environment secret values.

## PC-02 task and organization seams

```js
await governance.setBotContext({operationId, projectId, botId,
  expectedRevision: bot.revision, managerBotId: managerIdOrNull,
  responsibilities: ['Review report provenance'], actor: {kind:'human',id:'local-user'}});
await governance.setTaskContext({operationId, projectId, taskId,
  expectedRevision: task.revision, parentTaskId: parentIdOrNull,
  goalId: planIdOrNull,
  nextAction: {kind:'run',summary:'Execute the reviewed bounded task'},
  actor: {kind:'human',id:'local-user'}});
```

Bot context is stored on the existing `bot.governance` as
`{managerBotId,responsibilities}`. Task context is stored on existing
`task.governance` as `{parentTaskId,goalId,nextAction,updatedBy}`. Both update the
normal bot/task revision so simultaneous domain edits conflict. Use null to clear
manager/parent/goal/nextAction; the setters require the whole context. No status,
assignment, plan approval, evidence, task or run is created/modified implicitly.

`goalId` references an existing **plan** in the project, since FORGE has no goal
collection. A task's goal must equal its own plan when assigned; parents must
share that goal. Cycles, missing and cross-project manager/bot/task/plan links are
rejected. A helper may only be assigned to its own existing task.

Agent progress can pass `{kind:'agent',botId,runId,attemptId}` as actor. The
existing task.botId and scoped run task/bot/attempt must all agree, the run must
be the latest mapped attempt, and another active/unknown run cannot compete.
This does not acquire a task, reassign a bot, approve a plan or start a turn.

Next action kinds: `run|review|inspect|resolve`; all require `summary` (up to 2000
characters). Optional `runId|artifactId|documentId` references are project-checked;
runs/artifacts with task attribution must match. Run actions use the task's T3
owner and accept no competing target reference. `taskContext()` returns actual
task/bot, ancestors, plan-goal, reporting chain, active runs, next action and
blockers. A runnable next action yields a `/api/runs/start` command template
requiring a fresh explicit operation ID; unapproved plans, incomplete dependencies,
existing active/unknown runs, completed tasks and retired bots block that template.
T3 rechecks execution admission itself; context projection is never a reservation.

`validateProjectContext(snapshot,{projectId})` is an exported **pure** helper for
lead-owned generic domain update and restore transactions. Run it on the candidate
snapshot before commit if changes to bot.taskId/task.botId/task.planId could break
governance links. It prevents another generic CRUD path from creating invalid
links. Worker setters and context projections enforce their own scope checks.

## Review inbox and backup seams

`reviewInbox({projectId})` returns `{projectId,stateRevision,items,readOnly:true}`.
Items carry `source/sourceId/status/title/authority` and relevant entity IDs.
Projection reads existing `runs[].pendingApprovals`, T3 permission response
receipts, `officeAgent.requests`, tasks in review and storage jobs in conflict.
Accepted-but-not-yet-refreshed native approvals are omitted; submitted/uncertain
responses point to reconciliation. Office items navigate to the actual mounted
editor/lease/review/durable-save flow. This service cannot decide those requests,
accept evidence-free completion, or bypass destination-head conflict checks.

**Existing portable bundles:** `recordsFor()` already exports bots/tasks and the
restore remapper already rewrites nested `*Id` fields. Actual backup/restore test
confirms managerBotId, parentTaskId, goalId and nextAction.taskId remap to the new
project. Policy/approval/audit events, connections and runs are excluded by the
existing portable contract. New projects need freshly configured connections and
policy; no approval authority is migrated. Agent updatedBy is provenance only:
restored run references must never be interpreted as current execution ownership.
For inspect actions referencing excluded runs, review/select a current target.

**Full local metadata snapshots:** existing local artifact backup includes the
whole store, including governance events. Lead restore must quiesce services and
call `recover({invalidateUnconsumed:true})` **before admitting work**, invalidating
restored pending/approved grants. Do not replay old effect IDs. Existing consumed
tombstones remain consumed in the restored snapshot. A full database rollback is
not evidence that a remote effect was undone. This worker supplies the invalidation
seam; it does not edit lead-owned restore orchestration.

## Pinned source/license and adoption assessment

Source inspected directly at Paperclip MIT revision
`7d26bdaa424551a172f1a4b7ae3c737a0745e8f9`, audited by the lead as master HEAD.
No Paperclip code, external agent instructions or runtime was copied/vendored.
The new modules are FORGE implementations of assessed product concepts. The
upstream [MIT license](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/LICENSE)
names copyright 2025 Paperclip AI. Any future literal source reuse must preserve
its full notice; no new Paperclip package is introduced here.

| Inspected primary source | Adopted strength / deliberate boundary |
|---|---|
| [Approvals service](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/server/src/services/approvals.ts), [resolution implementation](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/server/src/lib/approval-records.ts) | Durable scoped requests, atomic conditional resolution, actor/audit. FORGE adds exact MCP argument binding and one-shot consumption; upstream hiring/lifecycle/notification ownership is not reused. |
| [Agent record revisions](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/server/src/lib/agent-records.ts), [reporting chain](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/server/src/lib/agent-reporting-chain.ts), [issue hierarchy](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/server/src/services/issue-hierarchy.ts) | Reviewable reporting/context/revision relationships. FORGE retains its bots, tasks, plans, helper semantics and explicit cycle rejection; no company/issue database or hierarchy flattening is imported. |
| [Heartbeat protocol](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/docs/guides/agent-developer/heartbeat-protocol.md) | Parent/goal context, actual checkout ownership, durable next action and workflow versus run liveness separation. It is source research, not governing instructions. No heartbeat worker or continuation scheduler is introduced. |
| [Budget service](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/server/src/services/budgets.ts), [operator budget guide](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/docs/guides/board-operator/costs-and-budgets.md) | Observed spend and held reservation accounting, project/agent scope, unknown/unpriced usage policy and final admission recheck are useful. Paperclip's accounting, incident workers and cancellation dispatcher are not reused because FORGE/T3 own execution. |

## PC-04 executable follow-on, not fabricated zero cost

Next implementation task: define a lead-owned provider usage contract tied to
existing project/bot/run/attempt and trusted provider receipt identity. Persist
observed currency and integer minor units only when explicitly reported by that
source. Record missing billed cost as `null` with `pricingStatus:'unknown'`; token
counts, duration, subscription/login availability and local fixture runs cannot
be converted to dollars or silently treated as free.

Implement project/bot policy revisions with explicit unknown-usage handling, then
reserve admission inside the existing T3 start transaction and reconcile the same
reservation against observed receipts. A hard stop must use T3's existing Stop
path and retain unknown delivery outcomes. There must be no second provider turn
or scheduler. A follow-on should cover concurrent starts consuming one limit,
duplicate observed receipts, late/unknown usage, policy disable/version races,
restart with held admission, and currency mismatch. Until those contracts and
adapters exist, label monetary totals/admission **unavailable/unknown**, and
PC-04 **IMPLEMENTATION_INCOMPLETE**. Missing credentials alone do not explain it.

## Verification

Environment: Windows PowerShell, Node `v24.19.0`; dependency install used the
existing lockfile via `npm.cmd ci --ignore-scripts --no-audit --no-fund`.
No manifest/lockfile change. No browser server, cloud compute, production account,
prototype, push, main change or PR was started.

Target command:

```powershell
node --test tests/governance-policy.test.mjs tests/governance-context.test.mjs tests/governance-mcp.test.mjs
```

Evidence includes reopened actual SQLite state, competing one-shot consumers and
decisions, denial/stale/replay/disable/revision/restore semantics, exact arguments
and scope, org/task cycles, missing links, task ownership/attempt conflict,
read-only inbox, actual portable backup/restore and actual SDK stdio calls with
filesystem effects. A real fixture effect followed by response timeout stays
unknown and is not duplicated after restart. Fixtures are disposable engineering
checks, not external-provider qualification or an owner product.

Verified: **16/16 governance tests passed**, including two independent service
processes contending for the same SQLite grant. Related regression command also
included `tests/providers-mcp.test.mjs`, `tests/product-domain.test.mjs` and
`tests/storage-service.test.mjs`: **36/36 passed**. `git diff --check` passed.

External live-server qualification: **NOT_RUN** (not needed for these local
governance semantics). HTTP/GUI integration and PC-04 remain implementation work.
**HOME_UAT_NOT_RUN**.
