# A08 MCP OAuth worker handoff — 2026-11-24

Implementation subtask: **IMPLEMENTED**, local developer checks **PASSED**.
Integrated HTTP callback/Settings GUI mounting remains lead-owned work in existing
modules. Remote account/server qualification: **NOT_RUN**. **HOME_UAT_NOT_RUN**.
This worker does not claim overall A08 or full-product acceptance.

Actual inherited runtime: **codex / gpt-6.1-sol / xhigh**, as supplied by the T3
runtime and assignment, no model switch or delegated worker. Windows, Node
**v24.19.0**. Branch `t3/mcp-oauth-setup`, base **9081f76**. Only new scoped
provider modules, OAuth tests and this note were written. No dependencies,
manifests, migrations, existing providers, web, server, store, central progress,
legacy runtime/payloads or protected manifests were changed. No main/push/PR,
external browser launch, owner credential migration or prototype activation.

## Integration contract

```js
import { createMcpOAuthService } from './providers/mcp-oauth.mjs';
const oauth = createMcpOAuthService({
  dataDir, store, callbackOrigin, // exact HTTP loopback application origin
  vault, // optional { async get(name), async set(name, string) }
});

await oauth.begin({ projectId, connectionId, operationId, sessionId,
  clientInformationEnv, // optional machine environment variable NAME
});
await oauth.status({ projectId, connectionId });
await oauth.callback({ callbackUrl, sessionId, projectId, connectionId });
// projectId/connectionId optional for callback: state binds them server-side.
await oauth.disconnect({ projectId, connectionId, operationId, sessionId });
await oauth.close();

// Both synchronous; connection is the actual project-scoped domain connection.
oauth.authProviderFor(connection); // SDK OAuthClientProvider | undefined
new StreamableHTTPClientTransport(new URL(connection.url), {
  ...oauth.transportOptions(connection), // {authProvider, fetch} or {}
});
```

The host must use the **entire transportOptions result**; the supplied fetch also
guards SDK discovery, registration, refresh and token requests. Do not combine a
resource `Authorization` header or an `authEnv` reference with OAuth.

The callback path is exactly **`/api/mcp/oauth/callback`** under callbackOrigin.
`127.0.0.1`, `localhost` and `[::1]` are supported as loopback application hosts,
but they are distinct origins; the actual callback must match the selected origin,
port and path. `sessionId` must come from the authenticated local application's
session, bound by the HTTP host at both begin and callback/disconnect. It is never
taken as authority from a browser boolean. The host still owns its normal
authentication, origin/CSRF checks, session cookie handling and project access.
Do not log callback queries or send them into domain commands/events. Serve
callback/setup results with no-store and avoid external resources/referrers on the
callback page.

`begin` returns `{status, auth, live:'NOT_RUN', authorizationUrl?, expiresAt?, error?}`.
Only explicit begin returns the short-lived URL; operation replay returns safe
status plus `alreadySubmitted:true`, without the URL. Browser opening is the GUI's
responsibility after explicit Connect. This service never opens a browser.
`status`, callback and disconnect return safe status in the same shape without
an authorization URL. `auth` contains only `{kind, status, reference?}`. Errors
have fixed safe code/message pairs and statusCode; never display raw SDK errors.

Actual portable connection configuration is `config.auth = {kind:'oauth', status,
reference?}`. Status values are `connecting`, `awaiting-authorization`, `connected`,
`required` and `disconnected`; status responses may also be `disabled` or
`not-configured`. `connected` means machine credentials are stored, not that remote
tools have been qualified. A pending state lost on restart/expiry is reported as
`required`, even if the old snapshot still says awaiting. GUI should query status.

Include `config.auth` in the existing MCP connection signature. Close cached MCP
clients on explicit auth configuration/disconnect transitions, then require
capability rediscovery. OAuth marks `discoveryStale` on transitions. Keep the
existing supervised tool policy, operation reservations, call receipts and
uncertain-outcome reconciliation. **Callback, refresh, reconnect and status must
never automatically retry a previously submitted tool effect.** This service owns
no MCP client, tool, provider turn or scheduler.

## Protocol and credential behavior

Uses installed **@modelcontextprotocol/sdk 1.32.2 (MIT)** interfaces and helpers:
`OAuthClientProvider`, `discoverOAuthProtectedResourceMetadata`,
`discoverAuthorizationServerMetadata`, `extractWWWAuthenticateParams`, `auth`,
`exchangeAuthorization`, `refreshAuthorization`, official token/client schemas and
`checkResourceAllowed`. SDK-generated PKCE uses S256. No hand-written OAuth token
exchange/registration imitation and no additional dependency.

An effect-free GET obtains the protected endpoint's WWW-Authenticate metadata URL
and requested scopes. RFC9728 discovery and authorization-server discovery use
the SDK. The resulting protected resource must match the configured MCP resource;
issuer must match the selected authorization server. S256/code support is
required. Authorization and token requests include the selected resource, and
SDK issuer stamps are retained with both registrations and tokens. DCR is used
where advertised. If DCR is absent, an optional `clientInformationEnv` points to
machine JSON `{issuer, client_id, client_secret?}`; the value is validated and
stored only in the OS vault, never in a snapshot. Missing registration capability
produces an actionable `OAUTH_REGISTRATION_REQUIRED`, not fake connected status.
An environment reference is advanced setup, not a claim of no-code registration
at an arbitrary server that requires its administrator to preregister clients.

State is 256 random bits, single-use, memory-only, 10-minute lifetime; it binds the
installation, project, connection, exact resource, redirect and application session.
The verifier is memory-only and cleared on consumption, expiry, superseding
begin/disconnect or close. Callback consumes state before asynchronous work and
rechecks ownership after acquiring the connection lock. Callback code exchange
uses the SDK's **single exchange** helper because its higher-level auth helper can
retry `invalid_grant`; replaying a consumed authorization code is inappropriate.

Access/refresh tokens, client ID/secrets and discovered metadata persist only in
the vault record, stamped with installation/project/connection/resource/redirect
binding. Default: Windows DPAPI CurrentUser through existing
`app/storage/auth.mjs`, separate **`%LOCALAPPDATA%/FORGE/secrets/mcp`** directory,
outside `dataDir`. Copied portable snapshots are not a credential migration.
Missing credentials on a second machine require Connect there. Other platforms
must inject an OS credential vault; there is no portable plaintext fallback.

Expiry is persisted with tokens; proactive refresh is single-flight per connection
and uses the SDK refresh helper with resource binding. SDK transport can also
refresh after an authenticated 401. Rejected refresh clears local tokens and
requires Settings reconnect. Registration/interactive redirect cannot be initiated
by a normal transport call. Disable is checked before every credential operation,
network request and response commit. Disconnect revokes old provider handles and
overwrites only its own bound encrypted record with a credential-free tombstone;
it does **not** claim remote token revocation. Refresh/disconnect writes are
serialized so an in-flight refresh cannot restore forgotten credentials.

HTTP URLs are limited to the explicitly selected local MCP loopback origin;
remote endpoints require HTTPS. Embedded credentials, fragments, query-bearing
metadata/token URLs and redirects are rejected. Authorization URL query fields are
transient OAuth transport fields. Callback checks exact origin/path, allowed
fields, duplicates, state/session and optional issuer. JSON/error responses are
bounded at **1 MiB**, with a 15-second network deadline. Successful MCP SSE remains
streaming. Fixed errors do not echo server bodies, tokens, URLs or native output.

## Developer evidence

Executed from this isolated worktree:

```text
node --check app/providers/mcp-oauth.mjs
node --check app/providers/mcp-oauth-policy.mjs
node --test tests/mcp-oauth.test.mjs tests/providers-mcp.test.mjs
git diff --check
```

**22 passed, 0 failed, 0 skipped**: 19 new OAuth cases plus 3 existing MCP
regressions. Disposable loopback HTTP OAuth endpoints and actual SDK protected MCP
server/client exercise discovery, registration, S256 verifier acceptance and
rejection, actual initialize/list/call, exact callback/session binding, state
expiry/replay, concurrent/superseded callback once-only exchange, safe setup
operation replay, issuer/resource isolation, cross-project reference theft,
disable, disconnect, in-flight response rejection, close cancellation, malformed
metadata, unsafe URL, redirect and response-size rejection, pre-registered
environment setup, rejected refresh/redaction, and reconnect without duplicate
tool effects. Successful stored credentials never relabel the live check PASSED.

Real native Windows DPAPI **PASSED** with newly generated disposable fixture
credentials: encrypted file contains no access-token/client-secret plaintext,
SQLite contains no credential plaintext, and encrypted refresh credentials survive
SQLite/service restart and perform an actual HTTP refresh. The vault directory
and SQLite fixture are removed by test cleanup. No owner credential was read.

The worktree used a local ignored node_modules junction to the existing installed
dependencies for verification; this is not a tracked prerequisite. A clean clone
uses the unchanged lockfile's normal dependency installation.

## Remaining scope and qualification

Lead must mount the exact callback, preserve authenticated session binding, add
Settings Connect/status/disconnect, and spread transportOptions into the existing
MCP HTTP transport. Those existing-file edits are intentionally absent here under
the worker ownership contract. Integrated GUI/browser validation is therefore
**NOT_RUN in this worker**; it is an integration task, not a missing-account excuse.

Remote OAuth accounts, named external MCP services and home machine UAT are
**NOT_RUN**. Select the intended server at home, Connect in the GUI, authorize its
requested scopes, rediscover actual tools, run one supervised bounded operation,
restart and confirm reconnect without repeat effects. If a server has no account
or no owner-accessible registration, record that specific live check unrun.

Conservative compatibility/security boundaries: PRM plus metadata and S256 must
be present; legacy guessed authorize/token endpoints, URL-based public client
metadata hosting, non-Bearer grants, DPoP and remote revocation are not implemented.
Multiple advertised authorization servers currently select the first. Private or
reserved non-loopback destinations are rejected, including DNS answers, and local
OAuth endpoints must share the selected local MCP origin. A separate intranet or
different-port local authorization server needs an explicit future trust policy.
The DNS check uses standard lookup then built-in fetch; it **does not pin DNS**
between validation and connection, so it is not a hardened network sandbox against
DNS rebinding. FORGE remains a local application, not a public OAuth relay.

## Primary references inspected

- [MCP 2025-11-25 authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP security best practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)
- [RFC9728 protected resource metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [RFC7636 PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC8707 resource indicators](https://datatracker.ietf.org/doc/html/rfc8707)
- Installed SDK source/type declarations:
  `node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.{js,d.ts}`,
  `client/streamableHttp.js`, `shared/auth.js`, `shared/auth-utils.js`,
  `server/streamableHttp.d.ts`, and package version/license metadata.
