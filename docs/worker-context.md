# DH-04 context worker handoff

Scope: DH-04 P0 and the DH-02/MEM-05 context seam. Development observed as
`gpt-6.1-sol`, `xhigh`, Windows, Node `24.19.0`, 2026-11-24. Branch
`t3/context-budget-compaction`. No push, main change, PR, external provider turn,
credentials, public service, cloud job or prototype activation.

## Implemented and ownership

- `app/context/index.mjs`: `createContextService`, canonical context events and
  receipts, route policies, composition, deterministic compaction, resolution,
  memory integration, usage, scoped spill, recovery, HTTP method allowlist.
- `contracts.mjs`, `accounting.mjs`, `spill.mjs`: bounded validation, redaction,
  provenance, measurement, confined hash-verified UTF-8 output storage.
- `pre-dispatch.mjs`: trusted native T3 pre-dispatch closure.
- `app/web/src/ContextBudget.jsx`: default component with props
  `{t,state,projectId,run,busy}`. Uses existing UI classes, TH/EN, real APIs.
- `tests/context*.test.mjs`: service, real HTTP/SQLite/Chromium panel and actual
  Memory Manager integration tests.

No changes to shared backend/T3/AG-UI/App/styles, manifests, lockfile, migrations,
central progress, legacy runtime, portable payload or adapters/ao. The store schema
remains version 1. Operational truth stays in `state.events` and `state.receipts`;
there is no context database or alternate execution owner.

## Exact integration contract

```js
import {createContextService, dispatchContextRequest} from '../context/index.mjs';
import {createT3ContextSeam} from '../context/pre-dispatch.mjs';

const context = await createContextService({
  store, dataDir,
  authorize,          // REQUIRED trusted host function; no permissive default
  capabilities,      // REQUIRED to compose/compact/admit a prefix
  tokenizer,         // optional; absence yields explicitly labeled estimate
  providerUsage,     // optional; absence yields unknown, never fabricated usage
  contentResolver,   // optional trusted canonical facts, see below
  memoryContext: (input, caller) => memory.context(input, caller),
  memoryResolveRefs: (input, caller) => memory.resolveRefs(input, caller),
});
const prepareContext = createT3ContextSeam({
  service: context,
  callerContextForRun, // trusted host resolver; return no body-supplied grants
  memoryForRun,       // optional trusted resolver of a Memory context request
});
// Inside the existing native startRun, AFTER plan/adaptive/run admission and
// BEFORE setting launchRequested or issuing t3_thread_launch:
const prepared = await prepareContext({run, project: p, baseMessage: message});
// Use prepared.message in the EXISTING launch. Persist prepared.contextId and
// prepared.receipt on the EXISTING run/attempt; this is not launch authorization.
```

`createContextService` is asynchronous. It awaits internal `recover()` before
returning. Recovery deletes only generated orphan/revoked files from
`dataDir/context-spill`; it neither starts nor recovers external processes. One
FORGE application/store owns this directory; do not run concurrent independent
service owners against the same data directory. No `close()` is needed: there are
no held resources beyond the caller-owned store.

The service receives `authorize({action,scope,callerContext,state})`, which must
return exactly `true`. It supports async authorizers. Actions are
`context.policy|compose|compact|resolve|spill|retrieve|revoke|usage|status|preDispatch`.
`scope` is exactly `{projectId,kind,id}`, kind one of
`project|owner|team|agent|session|task`. A missing caller or callback fails closed.
The host must authenticate/bind the caller independently of JSON body claims.
Every operation/replay is checked. Nested evidence scopes are checked separately;
handle retrieval/revocation requires the identical scope as the stored handle.
Routes/policies are project scoped. Policy editing can govern a run and therefore
must require an Owner/settings grant, while normal run callers may have reads.

The lead's authenticated HTTP boundary must mount POST `/api/context/{method}`
through `dispatchContextRequest(context, method, body, boundCaller)` and enforce
its existing HttpOnly session/CSRF policy for Owner actions. The component uses
the shared `request()` helper and never creates an alternative session. The
panel fixture provides a disposable `/api/session` token for compatibility with
the newer shared helper. Its fixed caller/token exist only in the test server.

`preDispatch` and `recover` are internal only and are deliberately excluded from
`CONTEXT_HTTP_METHODS`. A public caller cannot provide the native `baseMessage` or
spoof capability negotiation through the dispatcher. Do not bypass this allowlist
with arbitrary service-property dispatch.

Injected content/token/usage/memory resolvers must be read-only with respect to
the canonical store: they can be called inside the store transaction and must
not start a nested store transaction, launch a model or execute tools.

## Method inputs and results

All public methods are async `(input, callerContext)`. Every input contains
`projectId`. Omitted scope means `{projectId,kind:'project',id:projectId}`.
Mutations additionally require a unique `operationId` (max 200 UTF-8 bytes).
Reusing it with different inputs fails; identical replay rechecks access and
current reference deletion. Receipts contain event IDs/fingerprints, no copied
context/memory text. Reads need no `operationId`.

| Method | Additional input | Result |
|---|---|---|
| `policy` read | `route:{providerId,modelId}` | Latest immutable policy, or null |
| `policy` write | `operationId,route,budget,source,expectedVersion` | New policy event; `expectedVersion:0` for first policy |
| `compose` | `operationId,route,taskId?,scope?,items?,memory?` | Resolved context version, admission accounting and receipt |
| `compact` | `operationId,contextId,scope?` | Child version, originals retained, current policy and capabilities rechecked |
| `resolve` | `contextId,scope?,evidence?,offset?,limit?` | Current authorized resolution; `evidence:true` returns up to 16 originals per page by default, max 32 |
| `spill` | `operationId,scope?,text,source` | Durable opaque handle, SHA-256, byte length and scope |
| `retrieve` | `scope?,handle,offset?,limit?` | Hash-verified untrusted text page; UTF-8 byte offset, `nextOffset`, `pageBytes`, `totalBytes`, measured latency |
| `revoke` | `operationId,scope?,handle` | Canonical tombstone event and `deleted:true`; bytes unlinked after commit |
| `usage` read | `scope?,contextId?` | Authorized accounting/observations; no usage is invented |
| `usage` observe | `operationId,contextId,scope?` | New event from injected trusted `providerUsage`, or explicit unknown |
| `status` | none | Scoped policies/version metadata/spill metadata/usage/limits; no cached memory text |

`source` is `{kind,reference,observedAt}` with a valid timestamp, nonempty bounded
strings. A GUI-created capacity override is `kind:'configured'` and keeps the
configuration observation time. This does not claim provider discovery or live
validation.

`budget` is `{contextWindow,outputReserve,safetyReserve,maxInputTokens?}`: integer
window 256..100,000,000; nonnegative reserves; input cap must fit the remaining
window. Omitted cap equals window minus both reserves. There is no built-in model
capacity/catalog assumption. Exact provider and model IDs select the policy;
switching route requires that route's policy. Unknown route fails with
`CONTEXT_POLICY_REQUIRED`.

`items` is at most 128 records `{id,kind,text,sourceRefs?,scope?,trust?}`. It is DATA
by default even if an HTTP body claims `trust:'canonical'`. A trusted
`contentResolver({input,state,callerContext}) -> items[]` may supply canonical
facts with `trust:'canonical'`. For `compose` it supplies the entire item set;
for `preDispatch` it supplies additional canonical/project facts. It must resolve
current Owner requirements, decisions, acceptance/errors from authoritative
records, not blindly promote body items or memory. It must not auto-ingest hidden
reasoning, credentials or unauthorized private text.

`preDispatch({projectId,taskId,runId,operationId,route,baseMessage,memory?},caller)`
validates the existing run/task, approved canonical plan and current exact project
route. It derives task state, plan acceptance, permission constraint, existing
run error, linked artifact IDs/revisions/hashes, whole native FORGE `baseMessage`,
and optional trusted `contentResolver` facts. Those critical facts survive whole.
The seam uses `operationId:'context:'+run.id` to make reconciliation idempotent.
Changed canonical facts, policy or route reject replay; a revised run must be
reconciled through the existing execution lifecycle. This API creates no run,
changes no task status, launches no model and grants no approval.

Context results include `id/contextId,version,route,policyId,scope,taskId,runId,
message,accounting,pressure,budget,omitted,evidenceRefs,memoryRefs,memoryAvailable,
capabilities,metrics,receipt,authority`. Read-only resolution measures the current
prefix again after memory deletion. Event accounting records the originally
composed prefix; provider usage remains a separate immutable observation.

## Trust, accounting and memory

Trusted `capabilities({route,callerContext})` must return
`{contextOwner:'native'|'forge',acceptsForgePrefix:true,compactForgePrefix:boolean,
source}`. Missing negotiation fails. The service never accesses or resets native
T3/Codex/Claude/DeepSeek/OpenCode history; `nativeHistoryAccess:false` and native
token counts remain unknown. Compaction applies exclusively to the FORGE prefix
the adapter explicitly permits. Selection/capabilities do not authorize tools.

`tokenizer({text,route,requestHash})` returns null (unknown) or
`{status:'actual'|'estimate'|'upper-bound'|'unknown',tokens,route,source}`. Route must
match exactly. The host must use `actual` only for a trusted tokenizer for that
exact model; `upper-bound` requires a justified bound. No tokenizer means a UTF-8
bytes/3 **estimate**, with no asserted upper bound. Unknown measurements cannot
admit a prefix. Estimates can admit a prefix and are explicitly not a hard
provider-context guarantee. Even exact prefix tokens cannot bound hidden native
history/envelopes. The fixture codepoint model is test-only, not a production
tokenizer or model evaluation.

`providerUsage({contextId,route,requestHash,callerContext})` returns null or
`{route,requestHash,inputTokens,outputTokens,source,cost?}`. The hash associates
the usage observation with that exact FORGE prefix; the hidden native request
envelope remains unobserved. Cost, when actually reported, must include
`{value,currency,source}`. Provider totals remain separate from prefix tokenizer
counts, overlapping cached/reasoning buckets are never added, and model names do
not generate pricing. No hidden chain of thought is collected. Measured UTF-8
bytes and monotonic elapsed latency are recorded; model quality/resource cost
remain unknown unless independently observed.

Memory input follows the memory worker exactly:
`{scope,query?,limit?:1..100,maxCharacters?:256..64000,includeStale?,memoryType?,backend?}`.
The context service supplies its own `projectId`. Bind both
`memoryContext -> memory.context` and `memoryResolveRefs -> memory.resolveRefs`.
The latter receives `{projectId,scope,refs:[{id,revision,sha256}]}` (max 100).
Only exact current revision+raw UTF-8 content hash matches are used. Missing,
forgotten, changed or expired references disappear without a cached fallback.

Memory text never enters context events, receipts, compacted summaries or spill
storage. Only refs and the bounded retrieval request are stored. Current memory
is re-authorized/re-resolved for preview, resolve, compaction, retry and dispatch.
Verification, conflicts and stale flags remain claims in escaped untrusted DATA.
Memory cannot become a canonical critical instruction, permission or approval.
This first implementation accepts records in the exact requested memory scope;
cross-scope shared records must be requested/resolved in their original scope
under an explicit trusted grant. Native harness memory is not ingested or copied.

## Deterministic compaction and spill semantics

Critical kinds are `owner-requirement,acceptance,decision,critical-error,task-state,
artifact-ref,approval-constraint`. They are kept whole, including when untrusted
data happens to use that label (the label itself confers no authority). An
over-budget critical set fails `CONTEXT_CRITICAL_OVERFLOW`, preserving the
approval requirement rather than dropping/truncating it.

Optional records are considered in a stable newest-first order. Large optional
text gets an explicit partial head/tail data preview; a record is included only
when the current measured prefix fits. Optional omissions are explicit. The
complete redacted originals/source refs remain in the immutable version evidence,
separate from the active projection. No LLM summarizer, extra runtime or paid
call is involved. Independent compactions of one version have identical message
and prefix hash; event IDs/timestamps/latencies are naturally new.

Authorized `tool-output` items larger than 8192 bytes spill before active
composition. General `spill()` supports permitted UTF-8 text only. Data is
redacted before hashing/writing. It is stored under
`dataDir/context-spill/ctx_<48 random hex>.bin`; no client filenames/paths enter
filesystem operations. Canonical events retain scope, source, SHA-256 and size.
Reads verify confined real paths, no links/hardlinks, file identity/size and the
full byte hash before returning a bounded UTF-8 page. A page never splits a code
point; offsets are bytes, not characters. Retrieval DATA is never executable.

Limits: 2,000,000 bytes per context item; 4,000,000 admitted context text bytes;
8,000,000 bytes per spill; 64,000,000 live spill bytes/project; 32,768 bytes/page;
at most 256 Unicode-safe pages per selected page size; 10,000 versions/project.
Injected limits may only tighten those maxima. Very small requested page sizes
are rejected if the complete output would exceed the conservative page bound.
Evidence pagination returns item records; individual item bytes remain bounded
by admission limits. Tool spills are separate capabilities, avoiding cross-scope
deduplication/deletion side effects.

Revocation commits before deleting bytes. Replay/restart completes deletion and
cleans uncommitted files left by a crashed transaction. Ordinary failed composition
removes newly staged spill files immediately. Revoked or changed original
spill evidence rejects resolve/compact rather than silently using its old active
preview. Directory junction redirection is rejected. This protects the application
boundary; it is not a claim to sandbox an attacker who controls the host or SQLite
authority. Existing backups are not automatically rewritten by deletion; hosts
must apply their deletion ledger on restore and manage backup retention.

Redaction covers common named credential assignments, Bearer tokens, API/GitHub
keys, URL passwords and PEM private keys. Nested named credential fields are
redacted too. It is defense in depth, not a universal classifier for private
data; the trusted admission/authorization boundary must decide what text may be
stored at all. Hidden-reasoning item kinds are rejected, and no native reasoning
channel is read.

## Source reuse and qualification

Inspected exact upstream pin
[`4b399c39a6d1479cd84ca591b4d7c88e24d38a96`](https://github.com/deepseek-ai/deepseek-harness/tree/4b399c39a6d1479cd84ca591b4d7c88e24d38a96).
Root and all five inspected package manifests declare MIT and `0.2.3-alpha.2`.
Root [`LICENSE`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/LICENSE)
and [`SAFETY.md`](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/SAFETY.md)
were read. No upstream code or package was copied/installed. This is an original
native incremental implementation using API/architecture patterns.

| Decision | Inspected source paths at that pin | Native target, qualification and risk |
|---|---|---|
| ADOPT existing FORGE | `app/server/store.mjs` in worker base `65b78e9` | Reuse existing SQLite transaction/events/receipts API directly; real persistence/restart tests. No migration or shadow authority. |
| ADAPT pattern | `packages/compaction/compaction/{package.json,src/index.ts}` and `compaction-basic/{package.json,src/index.ts}` | Separate policy/measurement/compaction seam, routed capacity, output reserves and cited original evidence. Native deterministic critical preservation replaces model summarization; no Cordis runtime dependency. |
| ADAPT pattern | `packages/compaction/compaction-tool-result-pruner/{package.json,src/index.ts}` | Model-free Unicode head/tail optional previews, independent original evidence. No native tool-call pairing rewrite. Verified Thai/English and retrieval hashes. |
| ADAPT pattern | `packages/llm/token-meter/{package.json,src/index.ts,src/types.ts}` | Source-labeled estimate/exact/unknown measurement and separate provider usage. Deliberately no assumption of additive cache/reasoning buckets. Exact route/source/request association tests. |
| REFERENCE | `packages/context/session-reference/{package.json,src/index.ts}` | Escaped untrusted snapshot DATA, explicit budgets, references and optional spill. Upstream documents broad candidate listing/read exposure; FORGE requires exact injected scope authorization instead. Scope/tamper/delete/restart tests. |
| DEFER | Upstream framework plugins, automatic LLM summarization and native DSH runtime | No second runtime/orchestrator. Upstream Node range `^24.22.3 || >=26.13.1` exceeds local 24.19.0; optional runtime qualification is separate and does not block native P0. Upstream calls itself unaudited developer preview. |

## Actual verification and remaining integration

Installed existing locked development dependencies with
`npm.cmd ci --ignore-scripts --no-audit --no-fund`; no manifest/lockfile changes.
The plain `npm` PowerShell wrapper was blocked by execution policy; `npm.cmd`
worked without changing host policy.

- `node --test tests/context*.test.mjs tests/adaptive-context.test.mjs tests/governance-context.test.mjs`
  with `FORGE_MEMORY_TEST_MODULE` pointing to the actual memory worker module:
  **29/29 PASS**, no skipped test cases. This includes 21 context tests, two
  existing adaptive context regressions and six governance context regressions.
- Real local Chromium + HTTP + SQLite panel: budget save, compose, compact,
  evidence resolution, usage view, spill page, deletion, reload and TH/EN passed.
  The panel is compiled directly in the test; App mounting remains a lead edit.
- Actual Memory Manager (separate worker checkout) context/resolveRefs, FTS
  retrieval, conflict flags, native pre-dispatch composition, forget and service
  restart passed. The test uses `app/memory/index.mjs` automatically after merge;
  otherwise it explicitly skips unless `FORGE_MEMORY_TEST_MODULE` is set.
- Real spill directory junction redirection and same-size byte tampering rejected.
  File-symlink creation itself lacked Windows privilege; that sub-fixture was not
  exercised and emits an explicit diagnostic. It is not a passed symlink test.
- `npm.cmd run build`: PASS; existing vendor directive/chunk-size warnings remain.
- `node --check app/context/*.mjs` individually and `git diff --check`: PASS.

**Shared-path implementation still required by lead:** mount ContextBudget in
App/Settings, wire the authenticated CSRF-protected HTTP allowlist, provide
canonical scope grants/capabilities/content resolver, call the trusted seam from
the existing T3 dispatcher and persist its receipt on the run/attempt/AG-UI
projection as appropriate. Supply real tokenizer/provider usage adapters when
available; until then the UI truthfully reports estimates/unknown observations.
Preserve native admission/approval/workspace checks independently of context.

**Live NOT_RUN:** actual provider tokenizer/usage observations and model quality,
live cross-harness/native context behavior, DSH runtime compatibility. No credentials
or provider calls were required for local verification. **HOME_UAT_NOT_RUN**.
These are qualification gaps, separate from the explicit shared integration work.
