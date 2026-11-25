# Run-scoped loopback Memory MCP transport — 2026-11-25

Implementation worker: `t3/run-scoped-memory-mcp`, parent `45a7e1b33b6d9554179a496235587df9ad07d900`; runtime `gpt-6.1-sol`, reasoning `xhigh`. Changed only the three new assigned files: `app/server/memory-mcp.mjs`, `tests/product-memory-mcp.test.mjs`, this handoff. No shared contracts, manifests, locks, existing Memory/authority code, legacy files, credentials, provider calls or pushes changed.

## Exact host API

```js
import {
  createRunMemoryMcpGateway, MEMORY_MCP_OWNER_SCHEMAS, mergeMemoryMcpSafety,
} from './memory-mcp.mjs';

const memoryMcp = createRunMemoryMcpGateway({
  store, memory,
  endpoint: new URL('/mcp/memory', applicationUrl).href,
  authorizeOwner: authority.goalAuthorize,
  callerForRun: (canonicalRun, options) => authority.forRun(canonicalRun, options),
  // Optional clock: synchronous integer epoch milliseconds, defaults Date.now.
});
```

Synchronous factory, no listener or provider activity. `authorizeOwner(request, opaqueCaller)` must synchronously return `{kind:'human',role:'owner'}` from the host's authenticated opaque handle. Plain body identity is rejected by the real authority. `callerForRun(canonicalRun,{allowWrite,active})` must return the root authority's private **run** handle, never an Owner handle. `active(canonicalState)` is private, synchronous and literal-true only. The existing Memory service invokes it again **inside the real mutation transaction**.

Strict Owner bodies are exported as `MEMORY_MCP_OWNER_SCHEMAS` and enforced internally:

| Method | Exact body |
|---|---|
| `await memoryMcp.issue(input, ownerHandle)` | `{projectId,runId,operationId,expectedRevision,access?:'read'\|'read-write'}` |
| `memoryMcp.state(input, ownerHandle)` | `{projectId,runId}` |
| `await memoryMcp.revoke(input, ownerHandle)` | `{projectId,runId,sessionId,operationId,expectedRevision}` |

`expectedRevision` is the current **run.revision**, not the global state revision or session revision. Issue/revoke append canonical audit metadata without changing the run's revision. Access defaults to `read`. Unknown fields, actor/owner claims, missing fields, invalid types/access and stale revisions fail closed. Errors have `code`, `status` and `statusCode`.

First issue response:

```js
{
  replayed: false,
  session: {
    sessionId, projectId, runId, attemptId, access,
    issuedAt, expiresAt, revokedAt: null, status: 'ACTIVE',
  },
  transportStatus: 'HTTP_MCP_AVAILABLE',
  nativeAttachmentStatus: 'NATIVE_ATTACHMENT_NOT_CONFIGURED',
  configuration: {
    type: 'http', url: endpoint,
    headers: { Authorization: 'Bearer <transient-256-bit-session-value>' },
  },
}
```

Return this credential only to the authenticated Owner for explicit copy/use. Mark the response `Cache-Control: no-store`. Keep it out of browser persistence, canonical state, telemetry/logs, generic error logging, provider-management configurations and `system.env`. The gateway has no automatic configuration, invocation, second turn, task or job behavior.

Any exact issue replay returns `{replayed:true,session,credentialStatus:'NOT_REISSUED',newOwnerActionRequired:true}` **without configuration**, including delivery uncertainty, expiry and process restart. A new deliberate Owner action requires a new operation ID; it must not be generated automatically by retry code. Concurrent identical issue actions mint exactly one grant. Reuse with changed fields or another service's operation fails.

State returns metadata-only sessions and `transportStatus:'HTTP_MCP_AVAILABLE'`, `nativeAttachmentStatus:'NATIVE_ATTACHMENT_NOT_CONFIGURED'`, `nativeAttachmentQualification:'NOT_RUN'`, `ttlMs:300000`. Session statuses: `ACTIVE`, `INACTIVE`, `EXPIRED`, `REVOKED`, `INVALIDATED`. Revoke returns `{replayed,sessionId,revoked:true}`. State never returns raw credentials or token hashes.

## Root mounting and lifecycle obligations

1. Mount `await memoryMcp.handler(req,res)` **before any JSON/body parser**, under the same root request admission/drain mechanism as Office. It returns `false` for other raw paths and `true` for matched paths. Mount only on the existing loopback listener. No gateway-owned listener exists.
2. Root mounts only Owner `POST /api/memory-mcp/{issue,state,revoke}` after existing loopback Host/Origin checks, authenticated browser session and CSRF. Pass `authority.owner(authenticatedSession)` separately from input. Do not expose these methods to any MCP tools or generic provider RPC resolver. Suppress generic logging of issue responses/authorization headers.
3. Close admission and synchronously call `memoryMcp.invalidateForRestore()` **before** beginning restore/quiescence. It clears all private grants immediately. During the existing canonical restore transaction call `mergeMemoryMcpSafety(restoredState,previousState)` alongside the other Memory safety merges. This mutates/returns restoredState, unions consumed operation receipts and session audit metadata, preserves revocations, and rejects identity conflicts. It restores no bearer. Then finish existing derived Memory restore and reopen admission. A new explicit Owner issue action is needed after restore.
4. On shutdown stop new admission, `await memoryMcp.close()` **before closing Memory/store**. Close synchronously invalidates all grants, destroys outstanding raw requests, closes transports and awaits pending service/Owner operations. Root lifecycle admission still owns request draining. A queued Memory mutation sees invalidation inside its canonical transaction.

Session bearer: fresh independent `randomBytes(32)` value, five-minute lifetime, only process memory. Canonical `memory-mcp.session` events contain IDs, binding/token hashes, access, times and revocation metadata; `memory-mcp.issue`/`.revoke` receipts contain operation fingerprints and IDs. Restart creates an empty private grant map; old tokens cannot be reconstructed from canonical metadata.

Native binding must already exist: run status `starting`, `running` or `waiting`; no Stop or restore-review flag; exact attempt, `threadId`, `providerRunId`, `t3ProjectId`, provider instance, selection/options, account generation/route, project workspace, bot/task/session scope. Binding changes invalidate the old grant. Issue checks the current project selection (or existing explicit assistance selection) and exact enabled same-project provider connection. The gateway does not claim catalog membership establishes authentication or model quality.

Rejects proactive/research contexts and corresponding canonical operation/workspace claims even when context fields are stripped. Rejects Guarded `run.guardedContext`, `run.guardedReceipt`, other guarded markers and `forge-guarded` route identities. Their exact all-action qualification manifests exclude Memory; this transport cannot bypass that restriction. Ordinary OpenCode routes are not categorically denied.

## Protocol and authority

Uses installed official MCP SDK **1.32.2** `StreamableHTTPServerTransport` in stateless JSON response mode and existing `createMemoryMcpServer`. Every request gets a fresh SDK server/transport. A trusted service wrapper uses only the session's opaque run handle; tools/list is filtered without editing the existing Memory server.

Read grants list/call only `memory.recall` and `memory.list`. Read-write grants list/call all five existing methods: remember/recall/update/list/forget. Backend authorization separately rejects foreign projects, task/agent/session scopes, Owner scopes/operations, sharing, verification and sensitive grants. No Owner, setup, export, service configuration or authority tools are exposed. Memory remains untrusted DATA.

Raw handler checks exact path, loopback peer, exact Host and optional same-origin Origin. Bearer hashes are compared using `timingSafeEqual` before body consumption or SDK allocation. Raw body limited to **64 KiB**, including chunked input, with a ten-second body deadline. JSON-RPC batch/primitive input is denied, current lease is checked again after the body and on tool entry/exit, and the global concurrent request cap is **32**. GET/DELETE are intentionally 405; this endpoint supports stateless POST, no long-lived SSE/session resumption. Scope fields are validated by the existing Memory service rather than trusted from tool schemas.

## Verification and remaining gaps

Developer command:

```text
node --check app/server/memory-mcp.mjs
node --test tests/product-memory-mcp.test.mjs tests/product-run-memory-authority.test.mjs tests/memory-mcp.test.mjs
git diff --check
```

Result: **22 passed, 0 failed, 0 skipped**. Disposable real SQLite canonical/index stores, real `createMemoryService`, real `createLocalAuthority`, official SDK HTTP client/server, actual scoped remember/recall/update/list/forget. Scope/read-only/forged identity denial; five-minute expiry; canonical revoke and independent sessions; native/account/model drift; Stop/expiry/revoke/restore during queued mutation; durable Memory operation replay; issue replay/concurrency/lost-response/restart; restore receipt union; metadata without bearer; raw path/Host/Origin/auth-before-body; fixed/chunked body caps; batch denial; post-body revalidation; concurrency release and shutdown invalidation covered. Fixture labels are explicitly synthetic and make **zero provider/inference calls**. Ignored `node_modules` junction uses existing installed dependencies from the main checkout; manifests/lockfiles were untouched.

**Lead integration still required:** root server construction/raw mount/Owner session+CSRF routes, response logging exclusion, restore merge/lifecycle calls and Memory UI connection section. Worker cannot edit those shared paths. The module is ready for that integration.

**Native attachment implementation gap:** pinned T3 launch has no custom-MCP attachment option. This transport supports an explicitly configured SDK/native MCP client under current run authority. It does **not** establish automatic per-thread T3 attachment. Guarded fixed-three-tool manifest excludes Memory; actual Guarded/T3 Memory attachment qualification is **NOT_RUN**. No fake automatic attachment status.

Live provider/model authentication, paid inference, semantic quality, native attachment, browser/home UAT are **NOT_RUN**. Transport qualification is complete independently of those checks; root integrated UI/CSRF qualification remains lead-owned.
