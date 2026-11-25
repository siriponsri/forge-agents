# Supervised frontend product facade and Office selection control

Worker branch `t3/supervised-frontend-route`, base `a408ac2`. Actual inherited
runtime **gpt-6.1-sol / xhigh**. No nested agents, paid/model calls, credential
migration, native-cache changes, protected legacy edits or push.

Only NEW owned files: `app/server/frontend-route.mjs`,
`app/web/src/FrontendTools.jsx`, `tests/product-frontend-route*.test.mjs`, this note.
Shared mounting/integration belongs to the lead; these files do not edit the
application composition root, T3 owner, Workspace, Office, Univer wrapper,
protocol, Guarded bridge, installer, manifests, lockfiles or central progress.

## Executable service and hookup

```js
const frontend = createFrontendRoute({
  store, authorizeOwner: authority.goalAuthorize, policy: guardedPolicy,
  getGuarded: () => guarded, getT3: () => t3,
});
await frontend.recover(); // Before accepting HTTP/native requests; no fake Owner.
```

Mount authenticated Owner/CSRF POST routes on the existing application server:

| Path | Method arguments |
| --- | --- |
| `/api/frontend-tools/intent` | `frontend.createIntent({projectId,taskId,documentId,documentRevision,operationId}, owner)` |
| `/api/frontend-tools/start` | `frontend.start({projectId,intentId,operationId}, owner)` |
| `/api/frontend-tools/result` | `frontend.result({projectId,runId,attemptId,pendingId,operationId,result}, owner)` |
| `/api/frontend-tools/stop` | `frontend.stop({projectId,runId,attemptId}, owner)` |
| `/api/frontend-tools/pending?...` | GET `frontend.pending({projectId,runId,attemptId}, owner)` |

Intent returns an explicit saved Doc revision and **host-generated run
operationId**. Pass that returned operationId into start. Start reserves a durable
start receipt before calling the SAME `getT3().startRun(hostInput)` exactly once.
It never creates a task, plan, second store, provider turn or providerRunId. A
lost/unknown start is never redispatched by replay, recovery or restore.

For the native SDK endpoint and optional pending/result HTTP implementation:

```js
const frontendHttp = frontend.createHttpHandler({
  endpoint: appUrl + '/mcp/frontend-tools',
  authenticateOwner(req,res) { return authority.owner(humanSession(req,res)); },
});
// Early server routing, BEFORE generic body reading:
if (await frontendHttp.handler(req,res)) return;
```

Authenticate with real existing session/CSRF before bytes/JSON. If main owns
pending/result routes instead, mount this handler for the native endpoint only;
avoid two handlers competing for the same route. Add `frontend-tools` to the
existing browser API helper's CSRF-protected prefix list. No browser traffic goes
to the private native gateway port.

### Same T3 and shared bridge lifecycle

Pure synchronous callbacks run inside the lead's existing canonical writer:

- `validateContext(s,input,{run?})` **unconditionally**, including ordinary input:
  a stripped frontendContext is detected by the canonical intent operation ID.
  Before returning an existing run, use
  `validateContext(s,input,{run:prior,replay:true})` and compare exact context.
  `replay:true` checks historical equality only and MUST NOT authorize dispatch.
- Persist the host-derived `frontendContext` into the canonical run. Retain the
  original run.profile. Retain `frontendContext` in all operation replay checks.
- `requestForInput(s,input)` (alias `guardedRequest`) returns null for ordinary
  input; explicit frontend input returns purpose `supervised-frontend-v1`, only
  scope capability `frontend_selection_read`, absolute intent `deadlineAt`, and
  enforceable time-only limits. Bridge must clamp profile expiry to deadlineAt.
- After shared native bridge reservation, `reserve(s,{run,input})` binds the
  once-only intent to the allocated run/attempt. The existing T3 allocation owns
  task.runIds/revision and canonical thread/root IDs. It must have advanced the
  task revision once, matching its existing Guarded reservation behavior.
- `validate(s,{run,input,...})` at admission/send/native lifecycle repeats current
  canonical checks. Task stamping honors existing guardedTaskSnapshot /
  guardedReservedTaskSnapshot owned by actual T3 projection. It does not accept
  arbitrary task-revision drift. Context checks reject controller mixing,
  expired/revoked Owner, changed task/plan/bot/document/workspace/settings/policy,
  changed checked provider route and changed selection.
- Pass `createFrontendGateway: args => frontend.createFrontendGateway(args)` to
  W2's shared bridge. Exact args:
  `{profile,assertCurrent,authorizePhase,withFence}`. The gateway delegates to
  existing `openFrontendNativeGateway`; W2 owns its withFence/current-before-and-
  after-binding addition. `broker.bindNativeTurn` is synchronous. Never await an
  actual SDK tool call or Owner wait while holding the canonical writer.

`current(runId)` observes shared `privateSnapshot(runId)` with actual profile,
phase, phases, attestation, providerThread/providerTurn and live state.
`nativeBinding({sessionId,callId,messageId},profile)` requires actual observed
providerThread/providerTurn, rootNode, attempt and exact native refs/strength;
`authorizeNativeBinding(binding,state)` repeats these checks inside the broker.
It never invents an orchestration providerRunId or upgrades weak native refs.
Tool call identity originates at authenticated native **Tool.Context.id**, never
guessed event IDs, message body role or the transport request ID.

W2 frontend attestation is purpose-specific: actual sessionID/pid/binary/profile/
manifest/context/generations/runtimeDirectory and the sole native tool name
`forge_frontend_selection_read`, evidence prefix `frontend-session-v1:`. It does
not borrow Guarded's 17-negative probe or become Proactive authority. Native
credentials/bootstrap/SDK bearer remain private; Owner/domain state contains no
bearer. Default Proactive/Research keeps its independent three-tool purpose.

Before **every** existing Stop/Take over/terminal cleanup, revoke private grants
using the facade Stop method or host-only `closeRun(runId,reason)` before native
Stop. `closeRun` never manufactures a human Owner. Every native gateway receives
a scope-restricted broker view; closing one transport revokes only that attempt,
and cannot close the product broker or disable future frontend runs.
Canonical Stop also blocks current binding checks. Before metadata restore call
`await frontend.invalidateForRestore()` (revocation is synchronous before its
first await), then inside the existing restore transaction call
`mergeFrontendRouteSafety(restored,previous)`. This includes existing broker
result safety, once-only intents/start receipts and consumed canonical runs.
Close the facade before closing SQLite. `recover()` does not reconstruct human
approvals, dispatch, session capabilities, model loops or tool continuations.

## Office component props and behavior

Named `FrontendRunControl` mounts beside existing Run controls. Props:
`{t,projectId,state,record,dirty,busy,requestOwner,onStarted}`. Choices are existing
tasks with an approved canonical plan and the saved Doc revision. It submits
intent/start, retaining operation IDs on a lost response. No new task/planner.

Default `FrontendTools` mounts inside Office Editor. Props:
`{t,projectId,run,getEditor,requestOwner,onResult,busy}`. It shows only the current
frontend-scoped run, polls read-only pending state and answers only on a user
click. `requestOwner` defaults to the existing app request helper once its CSRF
prefix is wired. It returns real typed error results for unavailable/dirty/stale/
missing selection and supports Decline. An interrupted reply retains the exact
operation ID AND captured typed result for retry; a changed selection is not
silently reread into the same operation ID. Reload reconciles persisted status;
it never executes historical calls. Accepted means provider delivery unconfirmed.

`getEditor()` must read CURRENT refs and return:

```js
{
  univer, unit,                    // real current mount, expose from wrapper
  record: base.current,            // last acknowledged durable record
  currentRevision: latestDoc.revision,
  ready,
  dirty: dirtyRef.current,
  saving: saving.current,
  pendingEdit: !!pending.current,
  baseline: baseline.current,      // existing normalized raw-snapshot JSON
  rawSnapshot: editor.current.rawSnapshot,
}
```

The lead needs the minimal `univer, unit` additions to `mountEditor`'s existing
return value, with nulling/disposal through the existing owner. Do not duplicate
or remount an editor just to read selection. `readSavedDocSelection` uses actual
installed `@univerjs/docs` **1.6.1** exported `DocSelectionManagerService`, through
the actual mount injector and its `getSelectionInfo/getTextRanges` APIs. The
installed `FDocument` facade has `setSelection`, but no getSelection method.
Reader checks the explicit mounted unit ID, last saved raw-snapshot baseline,
current revision and saved body; only one nonempty main-body selection of at
most **8192 UTF-16 code units** is returned. Rectangles, multiple ranges,
header/footer segments, insertion cursors and out-of-body ranges are refused.
No DOM/window selection, guessed offsets, arbitrary JS, script, path, edit,
saved-edit evidence, document mutation or command receipt is fabricated.

Source copy defaults to Thai with explicit English via existing `t`. Components
reuse `panel`, `inline-form`, `Field`, `history-row`, `toolbar`, help/error/button
styles and semantic existing theme tokens. No visual-world/theme drift repair.
Impeccable context was already loaded by root; worker read incumbent context and
craft floor before UI edits. No nested finish reviewer per assignment.

## Developer evidence and limits

Focused service and API fixtures use actual canonical SQLite, real opaque local
Owner authority, MCP SDK/HTTP and real installed Univer. T3 allocation/native
observation is explicitly INJECTED CONTRACT FIXTURE in the worker service tests;
it is not a live native/credential/account qualification. Existing full native
CLI evidence belongs to `docs/worker-frontend-tools.md`, not these fixtures.

Developer checks:

| Command | Scope |
| --- | --- |
| `node --test tests/product-frontend-route.test.mjs tests/product-frontend-route-univer.test.mjs tests/product-frontend-route-browser.test.mjs tests/frontend-tools.test.mjs` | Focused route, actual mounted Univer/React retry fixture, actual SDK and inherited broker regression |
| `node --check app/server/frontend-route.mjs` | Service syntax |
| `git diff --check` | Scoped patch whitespace |

The browser fixture uses real Univer Docs Core Preset 1.6.1 and its documented
`FDocument.setSelection` API, waits for the actual selection service to observe
the range, clicks the rendered Send selection/Retry controls, and verifies a
changed selection cannot change the original captured result on retry. It uses
an injected Owner request callback, not a live account or native provider. It
checks panel width at desktop and 390px and writes disposable screenshots under
the OS temp directory; those were visually inspected. It does not qualify the
whole mounted FORGE product or all application routes/themes. The two initially
failed browser attempts were virtual JSX fixture setup issues; no product bypass
was used to obtain the final passing selection.

Final focused result: **36 passed, 0 failed, 0 skipped**, 7.25 seconds. This
includes **21 new** service/Univer/rendered-component checks and **15 inherited**
broker regression checks. Service syntax and scoped whitespace checks passed.
No full npm
suite was run; the lead's inherited baseline remains separately owned. Whole
product A22 still requires main/T3/Workspace/Office mounting plus W2's shared
purpose-specific native bridge and a lead-owned actual native/GUI integration
check. These are implementation integration requirements, separate from missing
external accounts. External account/model-quality checks **NOT_RUN**;
**HOME_UAT_NOT_RUN**.
