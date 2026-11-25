# Proactive Workflows worker handoff

Implemented 2026-11-25 in isolated branch `t3/proactive-workflows`, baseline
`4e8ebd3`. Actual inherited model: **gpt-6.1-sol**, reasoning **xhigh** (T3/Codex
runtime declaration). No subagents, checkout creation, push, prototype, public
listener, compute purchase or credential migration.

## Implementation coverage

New owned paths only: `app/proactive/**`, `app/web/src/ProactiveWorkflows.jsx`,
`app/web/src/proactive-workflows.css`, `tests/proactive*.test.mjs`, this note.
Shared contracts, main/T3/admission, domain/migrations, manifests/lockfiles,
central progress and protected legacy paths are unchanged.

- Recipes use existing approved plans, canonical tasks/bots and T3 execution.
  No second task database or provider runtime. Mutable coordination, immutable
  recipe versions, claims, transitions, Inbox and delivery records use the
  existing SQLite snapshot's `events`; command dedupe uses `receipts`.
- Owner approves the exact immutable recipe/trigger/timezone/identity/scope/
  capability/budget/expiry version, then enables it. Private opaque callers are
  authenticated by injected callbacks. Body `actor`/`approved` flags are rejected.
- Schedule: daily local `HH:mm`, selected weekdays, valid IANA timezone, bounded
  lateness. DST missing times skip; repeated wall times have one local identity.
  Missed schedules enter Inbox; no catch-up effects. Runtime tick is internal.
- Authenticated event/webhook seam checks source, subject, type, project, age
  and durable event ID/fingerprint. No listener, secrets or public endpoint.
  Duplicate/changed event identities do not redispatch.
- Durable scheduled → claimed → dispatching → dispatched/unknown → delivered
  identities survive actual SQLite reopen. Returned run IDs are never authority.
  Terminal delivery is a receipt of observed status/artifact links, not verified
  bytes, task completion, QA or Owner acceptance.
- Recheck before submission and in authoritative T3 admission. Changes to plan,
  tasks/governance, bots, project profile or enabled connections invalidate grants.
  Revoke, pause, close and restart invalidate grants; a new version requires fresh
  approval. Task consumption and run usage remain across versions.
- Each task permits one possible automatic submission per recipe, across edits.
  A failed/unknown run is not an automatic retry permission. Existing Goals-owned
  work remains with Goals. Assistance/Adaptive/workspace ownership blocks an
  independent proactive start. Mobile-linked tasks cannot use this path to bypass
  originating-channel Owner approval; relay admission must remain unconditional.
- Max starts, per-run deadline and expiry bound activity. Unknown reported token
  or monetary usage cannot satisfy a cap. Reported totals, unknowns, estimates,
  subscription accounting and currencies remain separate. Caps inspect reported
  prior usage before the next start; they are not a hard provider price ceiling.
- Stop targets only the exact operation/task/bot/context-owned canonical run.
  Unknown Stop is retained and never automatically resent. A delayed start
  response does not hold the independent scheduler/watchdog lock. Unknown effects
  retain their claim and require reconciliation; Inbox resolution cannot release
  an active/unknown claim or authorize replay.
- TH/EN no-code component exposes configure/revise, review exact version,
  approve/enable/pause/revoke, accounting, run/delivery history, reconcile and
  Inbox resolution. Project-keyed component state isolates drafts/selections.
  Controls use allowlisted object argument APIs and the existing strategy hook.

## Native runtime enforcement: mandatory qualification, not a prompt claim

The pinned T3 native shell/filesystem tools are **not proven** to pass through
FORGE's normalized MCP action guard. Prompt instructions, scoped capabilities,
approval-required mode and plugin selection alone do not prove native path/action
enforcement. This is a product integration/qualification gap, not missing live
credentials. **Do not advertise bounded native automatic execution until proven.**

The module refuses **all automatic starts** without current private runtime
qualification, including read/propose when native tools remain unrestricted.
Mutable recipes specifically require `mediated-actions`. Unqualified triggers
enter Inbox as `NATIVE_ENFORCEMENT_UNQUALIFIED` before calling `startRun`.

`t3.proactiveEnforcementVersion = 1` declares the seam only. The trusted synchronous
callback `t3.qualifyProactive(state, request)` must return `null` until the selected
runtime route has evidence that every relevant native action is guarded or blocked
and all normalized actions are guarded. No model/HTTP `supported` boolean counts.
The evidence must be backed by actual runtime configuration/qualification, expire,
and be invalidated when the route/tool policy changes. The callback must not make
network calls or return a Promise inside the store transaction.

Exports from `app/proactive/enforcement.mjs` and `index.mjs`:

```js
const request = proactiveEnforcementRequest(state, startInput, clock);
// { projectId, taskId, envelopeDigest, identitySnapshot, scope }
const proof = t3.qualifyProactive(state, request); // private runtime evidence
validateProactiveEnforcement(state, startInput, proof, clock);
```

Exact proof contract (no additional fields):

```js
{
  version: 1,
  projectId, taskId, envelopeDigest, identitySnapshot,
  scopeDigest, // digest(request.scope), exported from proactive/contracts.mjs
  mode: 'read-propose-only', // or 'mediated-actions' for mutable capabilities
  nativeActions: 'blocked', // or 'guarded'; never 'unverified'
  normalizedActions: 'guarded',
  evidenceId, // actual versioned route/config qualification evidence
  expiresAt // epoch milliseconds, strictly future
}
```

`read-propose-only` permits only `read`/`propose` capabilities and still requires
path scope on read actions. `mediated-actions` requires actual mediation/blocking
of every relevant native and normalized action, with existing supervised mutable
and outward-effect approvals retained. A mutable capability does not grant
arbitrary MCP access, mobile approval, a new account, purchase or another runtime.

`validateProactiveAction(state, {projectId,runId,capability,path?}, clock)` is a
supplemental narrowing guard for trusted normalized actions. Capabilities are
`read`, `propose`, `workspace.write`, `external.write`. Reads and workspace writes
require a normalized path. It checks exact run/context/grant/deadline, capability,
lexical workspace/recipe scope and actual symlink/junction ancestors. It must run
   alongside ordinary tool policy; it is not an OS sandbox or a generic shell/MCP
argument interpreter. Hosts must fail closed on unnormalized/unmapped tools and
multi-path actions must validate every affected path. The underlying filesystem
adapter still owns race-safe access. Calling this guard for MCP alone cannot
qualify native execution.

## Exact lead integration

1. Create `createProactiveService({store,t3,authorize,authenticateEvent,clock})`
   against the single canonical FORGE store and T3 service. Call `start()` before
   exposing commands or triggers; it runs recovery first, then starts the internal
   timer. `tick()` is the deterministic internal/test seam. Do not start a second
   scheduler process; the existing store serializes one process's transaction queue
   and independent live SQLite connections can fail with `database is locked`.
2. Authoritative T3 reservation **and final pre-provider dispatch** must invoke
   `validateProactiveContext(state,input,clock)` **unconditionally**, including
   when context is absent. Preserve every existing Goals, Assistance, Adaptive,
   relay and workspace admission check. Independently obtain and validate current
   enforcement evidence with the functions above at these boundaries and before
   every effectful/normalized action. The scheduler also rechecks current route
   qualification for held runs and requests Stop if it is lost. A stored
   proof or capability version alone cannot prove runtime enforcement.
3. Advertise `proactiveContextVersion:1` only after actual wiring. Persist returned
   context verbatim on the canonical run and append `proactivePrompt(context)` to
   the actual provider prompt. Include that actual context in governance/tool
   preparation and normalized action checks; never replace other contexts.
4. Exact `startRun` input is `{projectId,taskId,conversationId:null,operationId,
   proactiveContext}`. Context is `{version:1,recipeId,versionId,envelopeDigest,
   grantId,occurrenceId,taskId,taskSignature,triggerKey,instructions,scope,budget,
   expiresAt,deadlineAt,enforcement:proof}`. T3 remains the sole provider owner.
5. Private `authorize(request,caller)` returns `{kind:'human',role:'owner',subject}`
   from a real authenticated human session. `caller` is injected outside JSON.
   Mutating methods, including resolve/reconcile, require Owner authentication.
6. Private `authenticateEvent(request,caller)` must verify the existing transport's
   signed raw request/session and bind `{projectId,source,subject,eventType}`.
   Internal `ingestEvent({projectId,recipeId,eventId,occurredAt},caller)` accepts no
   raw action, task, approval or capability override. Do not expose it through the
   generic GUI HTTP dispatch allowlist. A webhook transport is an internal adapter,
   not permission to add a public listener or broaden Telegram mobile approval.
7. Route only `PROACTIVE_HTTP_METHODS` through
   `dispatchProactiveRequest(service,method,objectArgs,privateCaller)`. List:
   `state/create/revise/approve/enable/pause/revoke/reconcile/resolve`.
   State accepts `{projectId}`. Mutations accept
   `{projectId,operationId,recipeId,expectedRevision}` plus method-specific fields:
   create/revise = definition below; reconcile = `occurrenceId`; resolve =
   `inboxId,note`. Create does not need recipeId/expectedRevision.
8. Mount `ProactiveWorkflows` with `{t,state,projectId,run,busy}`; it imports its CSS.
   Shared `api.mjs` Owner-CSRF route regexp needs `proactive` added beside Goals.
9. Shutdown order: await `proactive.close()` before closing T3/store. It invalidates
   grants immediately, waits owned pending submissions and stops/reconciles only
   exact owned runs. Restart never resumes an old grant automatically.

Recipe definition object:

```js
{
  name, instructions, planId, taskIds,
  trigger: {
    kind: 'schedule', timezone: 'Asia/Bangkok', localTime: '09:00',
    weekdays: [1,2,3,4,5], maxLatenessMs: 60000
  }, // OR {kind:'event',timezone,source,subject,eventType,maxAgeMs}
  identity: {connectionIds: []},
  scope: {paths: ['.'], capabilities: ['read','propose']},
  budget: {maxRuns: 1, maxRunMs: 300000, maxTokens: null,
           maxCost: null, currency: null},
  expiresAt // future epoch milliseconds; at most 366 days
}
```

Limits: 32 canonical tasks; 64 maximum starts; per-run 1 second to 1 hour;
32 relative scope paths; event age 1 second to 1 day; schedule lateness 1 minute
to 1 day. No task creation, automatic retries or background plan expansion.

## Developer verification and remaining qualification

Environment Node **v24.19.0**. The prepared worktree had no dependencies;
an ignored local `node_modules` junction reuses the existing owner repository's
installed dependencies read-only. No install or manifest/lockfile mutation.

- `node --test tests/proactive*.test.mjs`: **53 passed** on final enforcement seam.
  Real SQLite writes/reopen; deterministic clocks/IANA timezone/DST; duplicate
  event/schedule and competing services; stale grants; late/revoked/pending starts;
  exact Stop/unknown outcomes; deadline watchdog while response pending; caps,
  unknown/estimated/subscription accounting; native enforcement refusal; mobile
  and other-controller admission; real junction/path checks; TH/EN JSX bundling
  and static rendering with no dispatch during render.
- Primary fixture uses a qualified, labelled **INJECTED_T3_OWNER** with no native
  provider tools, validates the actual canonical admission/action guard, and
  writes harmless local evidence bytes. That is real local-effect verification
  through an injected owner, **not** a model/provider/mobile execution claim.
- Existing Goals/Assistance/relay/Adaptive context regression suite plus proactive:
  **133 tests passed** including the final native-enforcement seam.
- `npm.cmd run build`: **PASS** (Vite, existing upstream directive/chunk warnings).
  Plain `npm` initially hit PowerShell execution policy; `.cmd` works without
  changing policy. The component is also independently bundled/rendered by its
  own test because parent App wiring is lead-owned.
- `git diff --check`: run before commit; final commit/hash reported separately.

Required integration work above is **IMPLEMENTATION_INCOMPLETE until lead wiring
and integrated checks land**. Automatic native provider qualification is also
**NOT_QUALIFIED**, not a credential blocker. Live provider/MCP transport event
qualification and mobile E2E are **NOT_RUN**. Browser visual/UI interaction UAT is
**NOT_RUN** in this worker. Home acceptance is **HOME_UAT_NOT_RUN**.

Home check after lead integration: open the local app, select approved canonical
tasks, review a recipe, approve the exact version and enable. An unqualified native
runtime must produce Inbox with zero provider starts. On an actually qualified
route, verify one accepted trigger/run/delivery and Stop, then restart and confirm
fresh approval is required. Send NEW Telegram work and confirm its originating
channel Owner approval remains required regardless of any proactive recipe.
