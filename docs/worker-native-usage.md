# Native token usage bridge handoff

2026-11-25, Asia/Bangkok. Branch `t3/native-token-usage-bridge`, isolated worktree
`C:\Users\siripon.sri\.t3\worktrees\forge-agents\t3-f96a3c0b-1b44431bf0423e1c`.
Base HEAD `a401fe73e6f1251e60e8d6eafb5bed76b079040d`. Actual supplied harness
runtime: **gpt-6.1-sol / xhigh**, no model switch or nested delegation.

Only new `app/budgets/native-usage.mjs`, `tests/native-budget-usage.test.mjs`,
and this file changed. No shared source, contracts, migrations, manifests,
lockfiles, central progress, protected legacy files, accounts, provider turns,
public listeners, push, or prototype activation.

## Implemented behavior

The pure extractor validates the exact canonical FORGE project/bot/run/attempt/
provider/model binding, native project/thread/run, every native retry/attempt,
and its provider turns. It retains normalized identifiers and measured counters,
never the full projection, messages, credentials, reasoning content, or mutable
provider-session payloads. Historical native session identity uses
`attempt.nativeThreadId` and the turn's strong native references; borrowing a
reused thread's current session is rejected when historical attribution is absent.

The only counted source is `providerTurns[].turnTokenUsage`. Input already
includes cache reads/writes; output already includes reasoning. Cache/reasoning
subsets are retained as evidence and never added again. `tokenUsage.usedTokens`
is context occupancy, not processed/billable total. Thread `contextUsage.cost`
and aggregate `UsageBucket` data never enter Budget observations.

`mainAgent` reports measured input/output when present and a known subtotal
(`knownTokens`) with `complete_main_agent` or `lower_bound` basis. Missing data
stays null; explicit zero remains zero. Local-command counters are retained as
evidence but excluded from model counts. `otherUsage` remains separate because
the pinned contract lacks its model attribution.

Budget `usage:{totalTokens}` is emitted only for an exact cumulative snapshot
whose every attempt is terminal and whose every turn has explicit complete,
model-matched main-agent counters, terminal status, `hasSubagents:false`, no local
command, and explicit `otherUsage:{inputTokens:0,outputTokens:0}`. Otherwise
`usage:null` preserves unknown whole-run coverage, while measured main-agent
counters remain in the receipt. This is deliberately stricter than the pinned
Codex helper, which ordinarily omits otherUsage. A `completed` status does not
establish counter completeness or billing finality. Snapshot totals are
cumulative **as observed**, never a claim that no future native turn can occur.

**Every observation has `cost:null`, `final:false`, and an explicit billing
limitation.** The pinned sources contain no immutable, actual per-attempt billing
receipt with qualified monetary finality. Subscription prices, model prices,
thread aggregate cost, floating dollar values, or completed status cannot fill
that gap. Existing Budget unknown policy, reservations, restored holds, and Stop
tombstones remain authoritative. Real measured tokens do not release a hold.

Exact repeated/reordered snapshots reuse their original receipt and sequence.
New snapshots get increasing cumulative sequences. Reduced attempt/turn
coverage, counter/status regression, missing previously known counts, duplicate
row/native identities, overflow, malformed input, foreign identity, unknown
executed model and incomplete ordinal coverage fail closed. Previously unseen
stale regressions are refused; an exact historical snapshot replays at its
original sequence. There is no claimed upstream sequence in a raw full
projection. Receipt IDs bind both selected content hash and local sequence.

## Stable private exports and required lead hooks

```js
NATIVE_USAGE_SOURCE // 't3.native.turn-usage/1'
NATIVE_USAGE_REVISION // '59651c1761f6c63e9b6056839067066968e6a406'
selectNativeUsage(state, {runId, projection}) // pure, explicit unavailable reason
collectNativeUsage(state, {runId, projection}) // synchronous receipt collection
assertNativeUsageObservation(state, input) // pure required Budget commit guard
createNativeUsageBridge({store, budgets}) // collect(input), feed({runId}), drain()
```

Use only the host's actual full `orchestration.getThreadProjection` read. MCP
activity text, bounded timeline windows, thread-level usage or client-supplied
counter values are not authority. The revision constant pins the decoded source
contract; it is **not executable attestation**. The host must preserve its own
matching-runtime/private read-feed authority.

Inside the existing canonical observation transaction, after the real native
projection is applied:

```js
collectNativeUsage(s, {runId: id, projection: nativeProjection});
```

The convenience `bridge.collect(input)` creates a transaction and captures the
input before its await; it is for callers outside an existing store transaction.
Do not nest it inside one. The synchronous collector returns
`{status:'collected'|'replayed', receipt}`; rejected projections return
`{status:'unavailable',reason,...}` without creating a receipt. Cumulative/source
conflicts throw typed errors. These usage errors should be surfaced as accounting
unavailability, without discarding separately valid lifecycle observation or
claiming the provider itself failed. The collector does not alter lifecycle.

Receipts live in the existing `state.receipts`, type `budget.native-usage`, with
`sourceReceiptId`, `sequence`, `fingerprint`, and normalized `snapshot`.
`snapshot.identity` carries the full canonical binding and exact native
project/thread/run. `mergeBudgetSafety` already preserves this receipt type,
current Budget observations and their canonical run across metadata restore.
No schema/table/migration or independent accounting ledger was added.

In `budgets.observe` **inside its store transaction, before receipt replay or
ledger mutation**, the lead must add:

```js
if (source === NATIVE_USAGE_SOURCE) assertNativeUsageObservation(s, input);
```

This checks that the exact immutable receipt exists, the observation matches its
content/sequence, and the canonical source identity still matches after the
transaction's awaited queue. Keep the existing Budget binding validation. The
helper imports only budget contracts, so importing it in the service creates no
service/index cycle. Without this commit-time hook, the old Budget API cannot
protect a thread/providerRunId rebind while its transaction waits. The lead
explicitly accepted ownership of this shared hook during implementation.

Only **after the protocol run queue is released**, invoke
`bridge.feed({runId})`. It calls the existing `budgets.observe` and rechecks
canonical source identity after awaiting it. `bridge.drain()` explicitly feeds
pending durable receipts after restart; neither method reads the provider,
launches work, runs timers, reconnects, or retries an external effect.

Never await feed/drain while still holding the protocol queue: Budget observation
can call existing `t3.stop`, whose owner reconciles through that same queue.
Reentrant feeds return `in-flight` immediately; the active feed re-reads pending
receipts so a receipt collected by Stop reconciliation is delivered before it
finishes. Concurrent bridge instances rely on existing Budget receipt/Stop
deduplication. A crash after collection but before feeding is recovered from the
durable receipt; an already acknowledged receipt is skipped. No feed receipt or
Stop delivery state is independently manufactured here.

Do not expose collection, guard, feed, or drain as HTTP/model tool methods.
Budget's existing read/configure HTTP allowlist remains the only route surface.
Protocol/main/T3 wiring and any optional presentation of scoped main-agent
counters remain lead-owned shared changes, outside this worker's paths.

## Source verification

Primary checkout:
`C:\Users\siripon.sri\AppData\Local\Temp\forge-proactive-native-research\t3-source`.
Verified exact Git HEAD `59651c1761f6c63e9b6056839067066968e6a406`, clean status
before and after inspection; T3 0.1.11, MIT. This is a sparse checkout; helper
files outside its sparse working files were read directly with `git show
HEAD:<path>`, not inferred from missing files or another revision.

SHA-256 of exact Git blob content (LF) at that HEAD:

| Primary source path | SHA-256 |
| --- | --- |
| packages/contracts/src/providerRuntime.ts | cf73b6737e501ad1f602044f84ead7874c7b25cf5ad94d68e94863762a3322a7 |
| packages/contracts/src/orchestrationV2.ts | 5315592c553f33938eb9f26c0f4533d22de6148f76a05d6c7857eca35720f250 |
| packages/contracts/src/usage.ts | a788d9e4a943007444b3046bee3e36d8623b7b38f0ce2cc4c93fc0fabd35a646 |
| packages/contracts/src/modelSelection.ts | b9d4b443f527b8885828094d1ef342474b60af7888241637bf500f1aa0ee46ae |
| apps/server/src/provider/CodexTurnTokenUsage.ts | 2890761a1e1d55cdcc452c20dc76f2e6b36d2d6a4240b680a4a7d802979f9d34 |
| apps/server/src/provider/ClaudeTurnTokenUsage.ts | 220d6d1f6361b9dae9d3d63fae15efe230d30c5225b0c566348cdbc3344d8e29 |
| LICENSE | 935d8f2af0c703f9c39517ee57cc4930b19d02d533be930b63f0e82f93614b43 |

`TurnTokenUsage` declares the main-agent scope, complete/partial/unavailable
union, included cache/reasoning subsets, subagents and optional otherUsage.
`OrchestrationV2ProviderTurn` separates `tokenUsage` from `turnTokenUsage` and
binds `runAttemptId`; attempts bind exact runId and native destination. The
Codex helper accumulates native deltas, emits unavailable without observed
counters, and marks interrupted counts partial. The Claude helper separately
computes process-ledger growth minus main-agent usage as unassigned otherUsage.
UsageBucket is aggregate and can be providerReported/modelPriced/unpriced;
none of those are immutable per-attempt invoice authority. This bridge was
independently written against these contracts; no upstream code was copied.

## Developer evidence and remaining qualification

Node `v24.19.0`, Windows PowerShell, actual `node:sqlite` WAL store. Final scoped
service/ledger run: **38 PASS** (17 new bridge tests + 21 existing Budget ledger
tests), including actual close/reopen and restore, cross-process Budget capacity,
multiple native turns/retries, zero/absent/partial/subagent/otherUsage, exact
scope rejection, caches/reasoning, overflow, duplicates/reorder/stale/regression,
sourceReceipt tampering, commit-time and post-await rebind, Stop reentry,
receipt collection during Stop, concurrent feeds, and preserved unknown holds.
The test's guarded-store seam emulates the required lead commit-time hook around
the real Budget service; it is clearly labeled and does not claim shared wiring.

The worktree has no installed dependencies. Tests used an inline Node import
resolver falling back to the already installed root dependency tree, without
modifying files or lockfiles. Reproduce the dependency resolver if needed:

```powershell
$loader = 'import {registerHooks} from "node:module";registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code!=="ERR_MODULE_NOT_FOUND"||s.startsWith(".")||s.startsWith("/"))throw e;return next(s,{...c,parentURL:"file:///C:/Users/siripon.sri/Desktop/my_project/forge-agents/package.json"});}}});'
$env:NODE_OPTIONS = '--import=data:text/javascript,' + [uri]::EscapeDataString($loader)
node --test tests/native-budget-usage.test.mjs tests/budgets-ledger.test.mjs
```

With normal checkout dependencies installed, the test command needs no resolver.
`node --check app/budgets/native-usage.mjs` and `git diff --check` pass. An optional
existing Budget UI regression was attempted but could not bundle React/lucide in
this dependency-free worktree (esbuild package resolution); **no UI pass is
claimed**. No UI source was changed.

Fixtures are explicitly labeled **pinned contract samples**, not live provider
execution. Live counter/billing/Stop qualification: **NOT_RUN**. Home UAT:
**HOME_UAT_NOT_RUN**. Missing per-attempt billing receipts and shared host wiring
are implementation/contract gaps, separate from any missing credentials.
