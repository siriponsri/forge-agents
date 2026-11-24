# Provider / MCP GUI worker handoff — 2026-11-24

Implementation subtask: **IMPLEMENTED as integration-ready components**.
Developer browser contract checks: **PASSED**. Mounted product Settings/HTTP
integration: **NOT_RUN in this worker base**, lead work below. External provider,
OAuth-account and home qualification: **NOT_RUN**. No whole-product acceptance
claim is made.

Branch: `t3/provider-mcp-setup-gui`, base `b8a3fe6` (includes governance `38481fa`,
Colab `082d889`, MCP OAuth `b8a3fe6`). Actual inherited execution model:
**gpt-6.1-sol / xhigh**. No model switch or worker delegation.

Only these new paths are owned:

- `app/web/src/ProviderSetup.jsx`
- `app/web/src/McpConnections.jsx`
- `app/web/tests/providers-smoke.mjs`
- this note

No shared component, main route, contract, migration, manifest, lockfile,
central progress or legacy boundary was edited. No push/main/PR, production
account, credential read/migration, cloud provisioning or prototype work.

## Mounting contract

Both files export a **default React component**, `ProviderSetup` and
`McpConnections` respectively. Render each with:

```jsx
<ProviderSetup {...{t, state, projectId, run, busy}} />
<McpConnections {...{t, state, projectId, run, busy}} />
```

`t(th,en)` selects Thai/English. `state` is the existing authoritative snapshot,
including `projects`, project-scoped `connections` and `events`. Each derives its
project from `state.projects`, so no additional `project` prop is required.
`run(fn)` awaits the function and refreshes state; it returns null on failure,
as in the current App. Status reads do not use it to manufacture state changes.
Project and selected connection changes remount local drafts and transient setup
data; late responses cannot populate another connection's forms.

Reuse: existing `Field`, `Badge`, `Empty`, `Json`, `request`, `operationId`,
`scoped`, `safeLocalUrl`, and project theme/control classes. Hallmark's component
guidance was applied to the rendered surface; the user's path ownership and
existing VS Code tokens take precedence over extra demo/token files. Native
labels/selects/forms/details preserve keyboard behavior. No new CSS dependency,
font, palette, faux chrome or client persistence is introduced.

`McpConnections` imports three small input/link helpers from `ProviderSetup`;
cherry-pick both together. Normal simple MCP schemas render typed fields;
complex schemas have an explicitly advanced JSON editor plus an exact preview.

## Exact HTTP requests

The server must inject trusted **human actor** / **local OAuth session** itself.
No actor, session, approval boolean or credential value is collected from users.
POST bodies below are objects, with fresh operation IDs for distinct explicit
commands. Status/catalog reads never allocate operation IDs.

| Endpoint | Body / response contract |
|---|---|
| GET `/api/providers/routes` | Array of route descriptors, or `{routes:[...]}` |
| POST `/api/providers/configure` | `{operationId,projectId,routeId,name,executable?,envRefs?,args?}`; `args` only for `custom-acp`; API routes add `{apiKeyEnv,baseURL,apiFamily,models:[upstreamIds]}` |
| POST `/api/providers/check`, `/catalog`, `/refresh` | `{projectId,connectionId}` |
| POST `/api/providers/select` | `{operationId,projectId,connectionId,expectedRevision:project.revision,selection:{instanceId,model,options:[{id,value}]}}` |
| POST `/api/providers/setup` | `{projectId,connectionId,action,operationId?,methodId?,flowId?,interactionId?,decision?,callbackUrl?,installOperationId?}`; exactly worker-providers actions; no operationId on `*-status` |
| POST `/api/t3/start` | Existing `{projectId}` -> `{url}` or `{appUrl}`; used only by explicit native-setup preparation |
| POST `/api/mcp/configure` | `{operationId,projectId,name,route:'http',url,authEnv?}` or `{operationId,projectId,name,route:'stdio',command,args,envRefs}` |
| POST `/api/mcp/enable` | `{projectId,connectionId,enabled}` |
| POST `/api/mcp/discover` | `{projectId,connectionId}` |
| POST `/api/mcp/call` | Exact `{operationId,projectId,connectionId,name,arguments}` |
| POST `/api/mcp/stop` | `{projectId,connectionId,callId}` |
| GET `/api/governance/policy?projectId=...&connectionId=...` | Policy with `revision`, `connectionRevision`, `bindingCurrent`, `effectiveMode` |
| POST `/api/governance/policy` | `{operationId,projectId,connectionId,expectedRevision:policy.revision,expectedConnectionRevision:policy.connectionRevision,mode,tools}`; server injects actor |
| POST `/api/governance/tool/request` | Exact eventual MCP call object above; response uses `toolOperationId` |
| POST `/api/governance/tool/decide` | `{operationId:newDecisionId,projectId,approvalId,expectedRevision:approval.revision,decision:'approved'}`; server injects actor |
| GET `/api/mcp/oauth/status?projectId=...&connectionId=...` | Safe status only, no credentials/authorization URL |
| POST `/api/mcp/oauth/begin` | `{operationId,projectId,connectionId,clientInformationEnv?}`; server injects session |
| POST `/api/mcp/oauth/disconnect` | `{operationId,projectId,connectionId}`; server injects session |

There is deliberately no `auth` field in MCP configure, whose current service
rejects extra fields. OAuth begins on a saved HTTP connection without `authEnv`.
Server owns the fixed callback `/api/mcp/oauth/callback`; this GUI never constructs
an OAuth callback URL or accepts OAuth codes. The provider-native callback field
is a separate, transient T3 setup flow exposed only when that interaction accepts it.

Provider routes remain dynamic: no route/model inventory is hard-coded in these
components. A future `kob` descriptor with `mode:'opencode-api'` uses the same API
form. This worker base still advertises KOB as unsupported; it is not relabelled
as working. Models and typed options come from the actual returned catalog for
the selected provider instance; failed refresh retains the previous list and
blocks selection. Dependency/auth, catalog visibility, configured selection and
actual model execution remain distinct. No direct model call is made by setup.

Browser/device setup URLs and codes live only in the current component. Native
terminal/credential interactions explicitly direct users to FORGE T3 Settings:
prepare its localhost surface, then click the displayed link. This does not claim
that a terminal form is implemented in this component. Environment names are the
only secret-reference source advertised by these provider/MCP setup forms;
there is no DPAPI-secret-entry widget or browser localStorage credential store.

## Tool execution / uncertainty

Policy defaults to Off. Connection policy is a ceiling; a tool override only
narrows it. Saved mode and current effective mode are distinct. Connection revision
changes require Reload and an explicit policy Save; target/catalog/auth binding
changes cannot silently inherit an old Allowed grant. Discovery does not enable
tools, and server read-only annotations do not grant execution authority.

The explicit **Run this exact operation** click captures the previewed tool and
JSON arguments once. Ask requests that object, approves only its returned pending
record, checks decided status, then calls with the **same original operationId**.
The governance record calls that identity `toolOperationId`; the dispatch body
retains the service's `operationId` spelling. The decision command has its own ID.
Allowed calls through existing server admission without a second GUI decision.
Double clicks are guarded before the first await. No generic confirmation or
approve-all surface is added. Stale/denied/error branches never call MCP.

Stop is reachable during a waiting call and sends once per call ID, including
response loss. A cancellation is not proof of remote rollback. Unknown call events
survive reload and keep execution blocked for that connection. Unconfirmed call
responses are shown without replay; existing server-side reconciliation remains
the authority. This GUI adds no reconciliation-by-retry or new execution owner.

OAuth begin returns a transient reviewed authorization link. It is opened only
through a separate explicit link click, with no-referrer/noopener, never an
automatic window or redirect. Polling is GET-only, single-flight, at most 30 reads,
8-second per-read deadlines and a 60-second wall-clock budget; unmount aborts
status observation. Explicit status check is available afterwards. Reconnect,
callback/status changes and disconnect never replay a tool. Connected means local
credentials stored, not remote tool qualification or execution permission.

## Developer verification

Windows PowerShell, Node **24.19.0**, pinned dependencies already installed in the
integration checkout. A local ignored `node_modules` junction was used; clean
clones use the unchanged lockfile's normal install. No package file was edited.

```powershell
node app/web/tests/providers-smoke.mjs
node --test tests/providers.test.mjs tests/providers-mcp.test.mjs tests/governance-policy.test.mjs tests/governance-mcp.test.mjs
node --check app/web/tests/providers-smoke.mjs
git diff --check
```

Both JSX entries also compiled with `vite.build`, `write:false`, explicit component
inputs, and existing React/Lucide dependencies externalized. This exercises the
new entries even though App has not imported them in this worker base.

**21/21 focused existing service regressions passed**. Browser contract harness
passed with actual SQLite, provider configuration/check/catalog/selection modules,
governance and an actual SDK stdio MCP server recording filesystem effects.
Only T3 management/catalog and OAuth HTTP responses are fixture seams. The harness
banner and emitted evidence explicitly label this distinction; it is not the
mounted production server or external-provider qualification.

Verified browser paths: dynamic future route descriptors; exact option string and
boolean types; failed catalog retention; device code/consent/transient callback;
truthful native fallback; one install cancellation; typed actual SDK tool schemas;
default Off; Ask one-shot exact operation and same request/call ID; Allowed without
redundant decision; concurrent policy invalidation with no dispatch; stop during a
waiting call; unknown persisted through reload with no replay; disable/re-enable
and discovery invalidation; two-project isolation; OAuth reviewed link/no popup,
safe status observation/disconnect; no localStorage; TH/EN; keyboard focus; viewport
widths **320/375/414/768/1440** with no document overflow. Transient codes/callbacks/
OAuth URLs are absent from actual persisted SQLite state.

The script prints its temp fixture/evidence path on every run. Generated fixture
state/effects are disposable engineering evidence, never owner credentials or a
new product. No remote endpoint is contacted: browser requests outside the
loopback harness origin are aborted.

## Remaining lead integration and live checks

Implementation work outside worker scope (not missing-account excuses):

1. Mount both components in Settings, replacing any overlapping raw provider/MCP
   configuration forms; expose the exact service HTTP routes above.
2. Use trusted human/session injection and OAuth callback/no-store/CSRF boundaries.
   Never take actor/session claims from posted bodies.
3. Wire OAuth `transportOptions`, invalidate cached clients and rediscover after
   auth changes. Inject governance authorizeTool and final synchronous
   `validateAdmission` immediately before remote tool dispatch as worker-paperclip
   describes. These existing service edits remain lead-owned.
4. Run `providers-smoke` equivalent flows through **the mounted actual Settings
   screen**, plus persisted reload and actual server callback flow. The contract
   harness does not establish those mounts. Qualify the eventual KOB route from its
   worker's final descriptor/compiler; the test's future descriptor is labelled.
5. Unknown remote effects need authoritative inspection/reconciliation outside
   this tester; no current reconcile endpoint was specified for this GUI to call.

Separate unavailable live checks: native installed provider/ACP account sign-in,
real account model/catalog request eligibility, external MCP HTTP OAuth account,
remote tool effects/cancellation, clean-home machine and **HOME_UAT_NOT_RUN**.
Use supported fresh account setup at home; do not migrate development credentials.
