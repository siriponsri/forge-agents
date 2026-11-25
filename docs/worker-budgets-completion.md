# PC-04 native budgets completion handoff

Date: 2026-11-25, Asia/Bangkok. Integration base: `35803d4`.
Branch: `t3/budget-ledger-policies`.
Actual supplied runtime: **gpt-6.1-sol**, **reasoningEffort: xhigh**, inherited
Codex provider. No model switch, worker delegation, provider/account access,
purchase, prototype, public listener, push or deployment.

Owned paths only: new `app/budgets/**`, `app/web/src/BudgetStudio.jsx`,
`app/web/src/budgets.css`, `tests/budgets*.test.mjs`, this handoff.
No shared contracts, migration, manifest/lockfile, central progress or protected
legacy file was changed. Dependencies installed from the existing lockfile using
`npm.cmd ci --ignore-scripts --no-audit --no-fund` in this isolated worktree.

## Delivered implementation and remaining integration

Implemented a FORGE-native supplemental budget ledger in existing SQLite
`state.events` and command receipts in `state.receipts`. It has no new table,
database, runtime, heartbeat, cancellation dispatcher, turn owner or scheduler.

| Implemented here | Lead-owned integration still required |
| --- | --- |
| Atomic synchronous project/bot reservation and final dispatch fence | Call them in **both** `app/server/t3.mjs` task starts and `app/providers/conversations.mjs` conversation starts, including bot/team turns |
| Trusted immutable cumulative observation ingestion, exact money, unknown accounting | Ingest actual native provider receipts with stable identity, cumulative sequence, currency and **explicit native accounting finality** |
| Owner read/configuration service with revision fencing, exact HTTP method whitelist | Mount routes using the actual browser session authority; add `budgets` to the shared `api.mjs` CSRF route expression |
| Usable TH/EN BudgetStudio, reports, policy forms, usage/held/unknown/receipt/Stop views | Import and mount it in the real App; integrated browser qualification |
| Stop-once tombstones using existing `t3.stop(runId:string)` | Inject actual T3 owner, reconcile following native lifecycle changes |
| Metadata restore ledger/run/receipt preservation and stale admission fencing | Call `mergeBudgetSafety(restored,current)` inside the full metadata restore transaction; preserve the lead's other restore/quiescence safeguards |

These integration items are **IMPLEMENTATION_INCOMPLETE**, not missing live
credentials. This scoped module and its component are implemented and developer
verified against the tests below; this handoff does not claim the merged product
already exposes them or that its live native feed produces billable receipts.

## Exact exported API

Import from `app/budgets/index.mjs`:

```js
createBudgetService({store, t3, authorize})
reserveBudget(state, {run, input, now = Date.now()})
validateBudgetAdmission(state, {run, input, now = Date.now()})
exposure(state, policy, now = Date.now(), exceptRunId = null)
dispatchBudgetRequest(service, method, input, caller)
BUDGET_HTTP_METHODS // frozen ['state', 'configure']
legacyCostToMoney(reportedCost)
legacyObservation(run, {source, sourceReceiptId, sequence, final, occurredAt})
mergeBudgetSafety(restored, current)
assertBudgetLedger(state)
```

`reserveBudget` and `validateBudgetAdmission` are synchronous: no IO, callbacks,
promise, source lookup or external effect. Reservation mutates **only the
supplied candidate state**, for use inside the existing authoritative T3 store
transaction. `input` is accepted for the lead call shape and deliberately grants
no price, scope, policy or reservation override. The canonical run and saved
Owner policies are authority. Both helpers throw existing-style
`{code,statusCode,details?}` errors. `validateBudgetAdmission` returns `true` on
success and is read only; it is not permission to send another turn/effect.

Inside each first-admission transaction, create/push the canonical run, then:

```js
reserveBudget(s, {run: r, input});
```

Transaction rollback then removes both run and reservation on a budget refusal.
After asynchronous provider/context/transport setup and **immediately before
each actual dispatch**, with no further asynchronous gap:

```js
const current = store.read();
const r = current.runs.find(r => r.id === exactRunId);
validateBudgetAdmission(current, {run: r, input});
// Existing owner now performs its sole dispatch.
```

Keep the existing run operation-ID/replay, task/plan/provider and capability
checks. Do not call reserve in another service transaction before acquiring the
T3 run; that would leave a concurrency gap. Team/subordinate conversation starts
must each reserve their own canonical attempt. No new turn is started here.

Run identity is `{projectId,botId|null,id,attemptId,providerInstanceId,model}`.
`providerInstanceId` falls back to `run.selection.instanceId`. Model comes from
`run.model`, `run.selection.model`, then `run.profile.provider.model`. The full
binding is checked against the canonical run on observation, final admission,
release and Stop. Changed/foreign attempts never inherit another run's hold.

## Owner methods and HTTP

All service methods are async. The service accepts the existing
`authorize: authority.goalAuthorize` callback. It calls
`authorize({action,projectId}, opaqueCaller, candidateState?)`; authorization must
return `{kind:'human',subject,role:'owner'}` or null. Subject is audit attribution.
Payload `actor`, `approved`, booleans and JSON resembling a caller confer no
authority. Missing authorization fails closed. Configure rechecks authority in
the transaction. Read requires Owner authority too.

```js
const budgets = createBudgetService({store,t3,authorize:authority.goalAuthorize});
await budgets.state({projectId, botId /* optional report filter */}, caller);
await budgets.configure({
  operationId, projectId, botId: null, // null = project; bot ID = narrower scope
  expectedRevision: 0, // saved policyRevision; initially 0
  enabled: true,
  unknown: 'block', // explicit 'allow' or 'block', never inferred
  period: 'month', // UTC calendar month, or 'lifetime'
  limit: {minorUnits:10000,scale:2,currency:'USD'},
  reserve: {minorUnits:500,scale:2,currency:'USD'},
}, caller);
```

Suggested routes, matching the shipped component:

- POST `/api/budgets/state` → `dispatchBudgetRequest(budgets,'state',body,caller)`
- POST `/api/budgets/configure` → same dispatcher with `'configure'`

Both require the real browser session/CSRF boundary (the component reuses
`useStrategy` / `request`). A GET read wrapper is optional, but this component
currently reads using POST. Never mount arbitrary `service[method]`; the exported
dispatcher rejects inherited properties and all internal hooks. Do not offer
native observation or no-dispatch proof as model tools or Owner JSON forms.

Commands use `budget:command:<sha256(operationId)>`, never raw native effect IDs.
Repeating identical input returns its saved result; changed reuse conflicts.
Policy history uses immutable `budget.policy` snapshots and `policyRevision`.
Any project/bot policy edit, including disable or an equal-value edit, fences a
previous admission. Editing a policy never clears costs, receipts, counts or
held reservations. Currency differences cannot authorize a conversion.

## Accounting and admission semantics

Money is exactly `{minorUnits,scale,currency}`: nonnegative safe integer amount,
scale 0–9, uppercase three-letter currency. Comparisons and sums use integer
base-ten arithmetic, including differing exact scales. No exchange-rate lookup,
rounding or token/time/subscription pricing exists. Unsafe aggregate totals fail
closed (`BUDGET_OVERFLOW`); enforcement treats overflow as a stop condition.

`reserve` is the Owner's capacity hold per start, **not an estimated bill or a
guarantee that the provider cannot exceed it**. Exposure for each applicable
policy is known cumulative spending plus remaining held capacity; within the
same window the remainder is max(reserve − known cost, 0), avoiding double
counting a partial bill and its hold. Project and bot policies both apply,
independently; the same charge is not duplicated within either scope.

Absent/disabled policy allows normal supervised operation while unpriced runs
remain visibly unknown. With unknown `block`, an initial run can acquire its
hold; another unpriced active/terminal attempt blocks future work. Explicit
unpriced observations also trigger Stop of current owned work under that
policy. Unknown `allow` keeps reporting uncertainty while allowing work subject
to known spend/holds. Currency mismatch always blocks. A nonzero candidate hold
may fill capacity exactly; no candidate may exceed it. Known spend at the limit
is a hard stop even if reserve is zero.

Monthly spend belongs to the **attempt's admission month in UTC**, not arrival
time of its last cumulative receipt. Late receipts update that original window.
Unresolved holds carry into later windows; there is no calendar-triggered release.
Final cost after the window belongs to that original attempt. Reports label
period, known subtotal, remaining hold and unknown attempts separately.

Untracked legacy/unintegrated canonical runs remain unknown in the report and
enabled unknown-block admission. Their floats cannot silently enter billed
totals. A trusted retrospective `observe` may create an `accountingOnly:true`
reservation for such a run without re-admission. This never grants dispatch,
even if `reserveBudget` is later called against it. Thus historical accounting
can be ingested even when the current policy would refuse a new start.

## Internal native observation contract

```js
await budgets.observe({
  projectId, botId: run.botId ?? null, runId: run.id,
  attemptId: run.attemptId, providerInstanceId, model,
  source: 'stable-authoritative-native-stream',
  sourceReceiptId: 'immutable-native-receipt-ID',
  sequence: 3, // nonnegative monotonic cumulative snapshot sequence per attempt
  cost: {minorUnits:123,scale:2,currency:'USD'}, // or null
  usage: {totalTokens:456}, // or null; reported only
  final: false, // explicit native ACCOUNTING finality, not run completion
  occurredAt: nativeTimestampMs, // optional attribution, not budget window choice
});
```

Only a trusted host adapter may call this method. It must provide a stable
native receipt identity and actual cumulative semantics. Never derive money or
finality from LLM text, transport closure, token counts, local subscription,
task acceptance or a terminal run label. If the native contract has no stable
receipt/sequence/finality, keep accounting unknown; do not synthesize claims.

One authoritative cumulative source is allowed per exact attempt. A receipt ID
is immutable within its provider instance, across all runs/projects: changed
reuse conflicts. Same-receipt concurrency returns the same event. Same-sequence
different IDs conflict. Lower sequences are retained as stale evidence and do
not change totals. A newer cumulative snapshot replaces its high-water mark;
it never adds another delta. Decreasing billed cost/tokens or changing a known
currency is rejected, not converted. The adapter must surface such source errors
for reconciliation. A later null-cost snapshot preserves the prior known
subtotal and marks current pricing unknown. Token observations stay separate.

`observe` reconciles the project's held reservations and may Stop other current
owned attempts affected by the same project/bot threshold. No run is started.
Source receipts are immutable `budget.observation` events, with `stale`,
`fingerprint`, observed pricing status and host receipt time.

### Existing legacy fields

`legacyObservation(run, trustedNativeMetadata)` is a conversion seam, not an
ingestion source. `reportedCost.amount` is converted only if source is explicit,
basis is absent or `reported`, currency is valid, and the lexical decimal is
exactly representable at scale ≤9 in a safe integer. Numeric `0.1` becomes
`{minorUnits:1,scale:1,currency:'USD'}`; `0.1+0.2` is not rounded into 0.30.
Unrepresentable, estimated, subscription, missing or invalid cost becomes null.
Token counts require nonnegative safe integer `reportedUsage.totalTokens` and
an explicit reported source. They do not generate monetary cost.

The caller must still supply **trusted** native source, immutable receipt ID,
cumulative sequence and explicit finality. No finality default is inferred from
`run.status`. Do not periodically manufacture receipt IDs for the same floats.

## Reconciliation, Stop and restore

```js
await budgets.reconcile({projectId, runId /* both optional */});
// returns {stopped, released, redispatched:0}
await budgets.confirmNotDispatched({projectId,runId,attemptId,sourceReceiptId});
```

Reconcile is internal and timer-free. Call after a canonical native lifecycle
change and during controlled startup recovery. Do not blindly subscribe every
store change back into reconcile: transactions publish store changes too.
A held reservation releases only when the exact canonical run is terminal AND
its latest native receipt explicitly reports final known cost. Final null cost,
missing finality, lost response and canonical unknown status retain holds.

`confirmNotDispatched` is the host dispatch owner's explicit durable proof that
the call never reached dispatch (for example its `!launchRequested` catch path).
It requires a matching terminal attempt, no native thread/provider-run mapping
and no observation. Those state checks alone do **not** prove absence; the
trusted caller/proof is required. It never fabricates billed zero. Never use it
after an uncertain dispatch or from an HTTP/client-supplied receipt string.

Stop claims are persisted as `budget.stop` before any external call. The service
rechecks canonical binding and current threshold immediately before invoking
the actual existing **`t3.stop(exactRunId)`** string API. It never sends an object
to that API. A returned Stop request is not proof of cancellation: holds still
need canonical lifecycle plus source accounting. Lost/unavailable Stop delivery
remains unknown; startup, late receipts and repeated reconcile never resend it.
A crash after claim but before delivery is deliberately uncertain. Missing T3
injection cannot be described as functioning live enforcement.

Lead's full metadata restore transaction, after existing quiescence checks:

```js
mergeBudgetSafety(restored, s);
assertBudgetLedger(restored);
Object.assign(s, restored);
```

This retains current acknowledged budget events, command receipts, Stop
tombstones and exact current runs across an older snapshot. It freezes all
restored reservations as non-dispatchable; held ones remain unknown. Historical
restored data is not execution authority. A duplicate old receipt cannot thaw
them. Fresh explicit native final-known accounting plus a terminal canonical
run can settle a held reservation after restore. A second restore requires fresh
evidence again. Keep other lead-owned task/controller/project/credential restore
boundaries; this helper owns only budget safety and preserves referenced runs.
Portable project bundles exclude these machine accounting events by the
existing domain export contract; this worker does not migrate policy authority.

## Component

```jsx
<BudgetStudio t={t} state={state} projectId={projectId} run={run} busy={busy}/>
```

Default export from `app/web/src/BudgetStudio.jsx`; imports scoped `budgets.css`.
Uses existing UI primitives, theme tokens, `useStrategy`, opaque Owner routes
and uncertain-command handling. Reports and receipt details perform no effects.
Forms use exact decimal strings, explicit currency/scale, project/bot scope,
period, unknown handling, limit/reservation and loaded `policyRevision`.
Background refresh preserves the draft's original revision. Load current policy
explicitly discards stale edits. Project changes remount and clear private draft
and receipt state. The screen neither starts a turn nor exposes billing mutation
hooks. There is no estimated/free-zero metric for missing billed cost.

Impeccable was used to inherit the existing Operate surface and semantic theme.
The supplied implementation brief resolved purpose/states; no extra design
interview, shared design artifacts or subagents were introduced. Setup drift was
reported by the skill, not repaired. Detector returned `[]`. Screenshots of the
actual rendered component in Dark Modern were visually inspected.

## Pinned primary sources/license

Read before implementing concepts at Paperclip MIT revision
`7d26bdaa424551a172f1a4b7ae3c737a0745e8f9`:

- [Budget service](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/server/src/services/budgets.ts)
- [Costs and budgets guide](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/docs/guides/board-operator/costs-and-budgets.md)
- [MIT license](https://github.com/paperclipai/paperclip/blob/7d26bdaa424551a172f1a4b7ae3c737a0745e8f9/LICENSE)

Adopted concepts: observed versus held exposure, scoped policies, unpriced
handling and read-only final admission fences. Implemented independently using
FORGE canonical events/store and T3 Stop ownership. No upstream source code or
Paperclip runtime/package was copied or imported; its billing/cancellation/
continuation infrastructure and workers are not introduced here. Future literal
reuse must preserve the upstream MIT notice.

## Developer verification and qualification

Windows PowerShell, Node `v24.19.0`, real Node SQLite/WAL transactions,
headless Playwright Chromium, bundled actual React component.

```powershell
node --test tests/budgets-ledger.test.mjs tests/budgets-ui.test.mjs
```

**22/22 passed** after final implementation changes. Covers cross-process SQLite
capacity contention; duplicate/altered/late/regressing receipts; provider/model/
attempt/project/bot scope; unknown and late billing; partial known subtotals;
policy change/disable/stale revisions; project+bot policies; exact scales and
currency mismatch; monthly carry; known threshold/Stop once/changed foreign
attempt; restart; older and repeated metadata restore; legacy retrospective
ingestion; invalid monetary/delta/finality input; exact legacy conversion.

The real component test routes requests to the actual service/SQLite, performs
form edits/submits and external revision conflict, verifies unknown report and
actual receipts, switches TH/EN and projects, and checks no page overflow at
320/375/768 px. Host mounting and CSRF integration are explicitly fixture seams;
the test does not pass the unmounted product's HTTP boundary by implication.

Final related regression run:
`node --test tests/budgets-ledger.test.mjs tests/budgets-ui.test.mjs tests/governance-policy.test.mjs tests/proactive-workflows.test.mjs`
was **81/81 passed**. `node --check` on all budget modules and
`git diff --check` passed. The browser test compiles the full JSX with esbuild.
No shared App build/mount is claimed by this worker.

Optional reproduction of developer screenshots (outside versioned files):

```powershell
$env:FORGE_BUDGET_CAPTURE_DIR = Join-Path $env:TEMP 'forge-budget-review'
node --test tests/budgets-ui.test.mjs
```

These are disposable engineering fixtures, not live model costs or a new Owner
product. Native billing feed/actual paid cost/actual T3 Stop qualification:
**LIVE_PROVIDER_NOT_RUN**. Integrated App/HTTP/native-admission qualification is
lead implementation work, not deferred because of credentials.
**HOME_UAT_NOT_RUN**.
