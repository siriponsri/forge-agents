# Session roles and bounded parent–child prompts

Worker branch: `t3/session-role-prompt-service`. Required local base:
`4c944bd8f0b317590e5fa2cd2ab5be26a7e7606e`.
Runtime inherited from T3 Code: Codex `gpt-6.1-sol`, xhigh. Node `v24.19.0`,
Windows. No model switch, provider-account request, paid turn, push, legacy edit,
manifest/lockfile edit, nested agent or central progress edit in this worker.

## Implemented boundaries

`app/server/session-roles.mjs` stores assignments, explicit Owner-approved
membership and prompt commands in canonical `events` and `receipts`. There is
no additional database, turn owner or run collection. Roles are per canonical
conversation + bot. All sends, observations and Stops use the injected existing
conversation owner. All operation IDs share the existing collision namespace.

Membership binds a project, exact active parent run/attempt, immutable dispatched
orchestrator role, child conversation/bot/role and existing owned T3 binding.
Editing a role does not alter dispatched run snapshots or grant an old attempt
new authority. Role or binding changes invalidate pending sends and memberships.
Task plans, privileged tools, Budget and workspace admission retain their owners.

Prompt receipt reservation precedes the sole send attempt. Replay and recovery
only inspect canonical runs; they never send again. A crash between marking
dispatching and owner reservation remains uncertain. Stop is durable; the final
dispatch hook rejects a stopped command. When an accepted send has unknown native
identity, reconciliation delivers its previously requested Stop after observing
the exact identity. The existing conversation owner owns native Stop idempotency.

`app/server/session-roles-mcp.mjs` exposes only `session_children` and
`session_prompt` through the real MCP SDK. Host-created run handles, expiring
transient bearer capabilities, exact loopback host/origin checks, bounded bodies
and concurrency protect the gateway. Stop, role changes, restart and restore
invalidate leases. Bearers are never written to canonical state. Unknown or
refused child delivery is an MCP `isError:true` with durable command identity;
the gateway never turns a failed child into tool success.

## Exact lead-owned integration hooks

Construct `createSessionRoleService({store, conversations, authorize, qualifyRun})`.
The synchronous `authorize(request, opaqueCaller)` resolves PRIVATE host handles
to `{kind:'owner'}` or
`{kind:'run',runId,attemptId,projectId,conversationId}`. Request contains
`action:'session-role.*', projectId, conversationId, parentRunId, state`.
No JSON actor/role/identity label is authority. Promise/null/unknown results deny.
Recheck expiry and the run handle's active callback on every resolution.

Mount `dispatchSessionRoleRequest(service,method,input,caller)` at
`/api/session-roles/{state,assign,bind,revoke,children,prompt,reconcile,stop}`.
All browser routes must use the existing human session and CSRF owner gate.
Add `session-roles` to `api.mjs` Owner-header matching. Run callers enter through
the private MCP handle, never through a caller field in an HTTP request body.

Conversation AND task owner reservation must call:

```js
const sessionRoleContext = sessionRoles.validateDispatch(state, input);
const sessionRole = sessionRoles.captureRole(state, input);
// Persist immutable sessionRoleContext and sessionRole on the canonical run.
```

After **all** asynchronous setup/context/native binding work, immediately before
the actual native dispatch, synchronously call both
`sessionRoles.validateDispatch(currentState, reservedRun)` and
`sessionRoles.validateRole(currentState, reservedRun)`; no await before dispatch.
Always capture/check role even for a parent without a child-prompt context.
`sessionRoleInstruction(run)` returns advisory role-specific prompt text from
that immutable snapshot. Append it in the existing owner prompt builder.
Final Budget/governance/workspace/native checks remain mandatory.

Public request bodies (all with `projectId`):

| Method | Additional fields |
| --- | --- |
| state | none |
| assign | operationId, conversationId, botId, role, expectedRevision (0 initially) |
| bind | operationId, parentRunId, childConversationId, childBotId |
| revoke | operationId, membershipId, expectedRevision |
| children | parentRunId |
| prompt | operationId, parentRunId, membershipId, text (1–48,000) |
| reconcile / stop | commandId (no operationId) |

`state` returns roles, current assignments, memberships with computed
`usable/unavailableReason`, and commands with canonical child-run observations.
The new `SessionRoles` component accepts existing `{t,state,projectId,run,busy}`;
Thai is the fallback. Mount it under Team or Strategies. It uses the existing
`run(() => request(...))` behavior, retains stale draft revisions and exact
uncertain operation inputs, and clears drafts when project scope changes.
Parent task selection/start is owned by the lead's native orchestrator surface.

Host-only `sessionRoles.bindInTransaction(state,input,opaqueOwner)` runs the EXACT
public `bind` validation and receipt logic synchronously inside the existing
canonical writer. Public async `bind` delegates to it. The lead may retain the
same opaque human Owner from an intent that reviewed exact child session/bot/
role/binding, then invoke this hook after committing the ACTUAL attested native
parent `running` observation, before its first model tool call. Use one stable
operation ID per intent+child. No callback awaits and no second writer is opened.
Replay returns current canonical membership, so revocation cannot be revived.
Do not expose this hook in HTTP/MCP method lists or treat an intent JSON actor
as its retained Owner. Owner expiry/current role/attempt/native proof all recheck.

Construct `createSessionRoleMcpGateway({store,service,callerForRun,qualifyRun,
endpoint,clock,ttlMs})` only after loopback URL is known. Route its `handler`
at the exact endpoint through existing request admission/draining. Host-only
`issueForRun(canonicalRun, optionalExactBinding)` returns transient
`{configuration:{type:'http',url,headers:{Authorization:'Bearer …'}},expiresAt,
nativeAttachmentStatus:'NATIVE_ATTACHMENT_NOT_CONFIGURED',revoke()}`.
Deliver configuration only to the exact native adapter; never expose the
host-only issue hook as JSON authority or persist its bearer. A new issue revokes
the previous live lease for that run; cache a still-valid native attachment.

Ordinary T3 parent bindings require established attempt/thread/providerRun/
t3Project/providerInstance identity. Qualified private adapters use actual
provider-thread/turn/native refs and must not fabricate ordinary IDs.
Both factories accept the SAME trusted synchronous `qualifyRun(state,run)`:

```js
{
  purpose: 'supervised-orchestrator-v1',
  manifestDigest, profileDigest, attestationDigest, // actual 64-hex digests
  binding: {
    projectId, runId, attemptId, threadId, providerThreadId, providerTurnId,
    nativeSessionId, nativeTurnId, identityKind: 'private-adapter'
  }
}
```

The root callback must prove the actual private attestation, purpose, exact
two-tool manifest and live native adapter. This module additionally compares
profile/manifest digests and the canonical guarded projection, attempt/root node,
provider-thread/turn refs and native refs. Other guarded purposes and
Proactive/Research/Frontend contexts deny. Every private SDK tool call requires
`params._meta['forge/session-native-v1']` with EXACT keys
`{sessionId,turnId,callId,messageId}`. Session/turn must match the private binding;
call/message IDs must be actual bounded nonempty native context values. The
native hook must overwrite metadata from actual Tool.Context, never model input.
Qualification/role/attempt/lease are rechecked before and after awaited calls.

Call gateway `invalidateForRestore()` before restore quiescence; inside the
existing restore writer call `mergeSessionRoleSafety(restored,previous)`.
It preserves consumed identities and revokes all restored memberships. After
conversation owner recovery call `sessionRoles.recover()`. Recovery never sends.
Close gateway before/draining app shutdown and close the role service before its
conversation owner/store. No new listener is created by either factory.

## Verification and genuine limitations

Scoped checks: **17 PASS** (11 SQLite/Budget/domain lifecycle, 5 actual SDK over
loopback, 1 real React/Playwright UI). The owner lifecycle for successful sends
is explicitly INJECTED in tests; it uses real canonical runs and Budget reserve/
final fences. Private observation/attestation is explicitly injected in worker
tests. A separate REAL existing conversation-owner test proves active same-
workspace parent refusal without a provider call.

```powershell
node --experimental-loader ./tests/product-session-roles-loader.mjs --test tests/product-session-roles.test.mjs tests/product-session-roles-mcp.test.mjs tests/product-session-roles-ui.test.mjs
node --check app/server/session-roles.mjs
node --check app/server/session-roles-mcp.mjs
git diff --check
```

The test loader reads dependencies from the existing root checkout when the
isolated worktree has no node_modules. No installs/symlinks/lockfile edits.
UI checks drive TH/EN, stale drafts, child approval, lost response/same-ID replay,
Stop/reconcile, and project isolation. Actual inherited fonts/themes are loaded.
No overflow at 320/375/414/768. Captures inspected: EN1280 Dark Modern, TH375
Dark Modern, TH768 Light Modern, under `%TEMP%/forge-session-role-captures/` when
`FORGE_SESSION_ROLES_CAPTURE_DIR` is set. No shipping raster or new design system.
Impeccable context + incumbent PRODUCT/DESIGN/surface/CSS were read; mechanical
detector returned `[]`. No setup repair. Finish inspection was performed in this
worker because the task explicitly forbids nested agents; no independent review
is claimed. Native attachment worker/lead integration is separate.

**Implementation integration still required in the lead tree:** HTTP/CSRF,
opaque authority resolver, both owner reservation/final fences, prompt text,
native attachment/qualification, restore/shutdown and UI navigation. Generic
active same-workspace parent remains blocked by existing admission. Lead must
only consider a precisely qualified two-tool orchestrator with zero filesystem
authority for an exact-parent exception; all unrelated writers/jobs/claims must
remain blocked. This worker implements no workspace exception.

**Live checks:** native compiled attachment, real provider accounts and integrated
root launch are NOT_RUN in this worker. They are implementation qualification
work for the lead/native worker, not waived as missing credentials. Provider
account qualification and HOME_UAT_NOT_RUN remain separate. This worker does not
claim the integrated product or native attachment is complete.
