# Official hosted Colab MCP adapter — A09–A11

2026-11-24. Base `de2e451`, isolated branch `t3/colab-mcp-api-adapter`.
Actual inherited runtime: **gpt-6.1-sol, xhigh**, Codex in T3 Code. No model switch or child agents.

Assigned files only: new `app/compute/colab-mcp.mjs`, `tests/colab-mcp.test.mjs`, this handoff. No existing compute/common/index, server/domain/store/web, manifests/lockfiles, central progress, protected legacy or bootstrap files changed. No Google account/runtime calls, provisioning, purchase, credential migration, public service, prototype, push or PR.

## Integration seam (lead-owned)

```js
import { createColabMcpAdapter, validateColabMcpConfig } from '../compute/colab-mcp.mjs';
const colab = createColabMcpAdapter({ store, dataDir });
// Optional machine-vault integration, supplied by the host (never the browser):
// resolveBearer: async ({ vaultRef }) => hostVault.resolveFreshBearer(vaultRef)
await colab.reconcile(); // Read-only runtime observations, never execute_code.
// On shutdown await colab.shutdown() before closing the shared store.
```

Add `colab-mcp` as a separate compute kind and dispatch its configuration and new starts to this adapter. Route existing jobs by **job.computeAttempt.kind**, rather than today's project selection. Route Colab reconciliation separately: the baseline generic compute reconciler otherwise treats unrecognized remote kinds as Jupyter. Each start creates exactly one existing `jobs` record; do not add another reservation or process owner around it. Existing browser Colab remains a separate, explicitly interactive option.

Lead must add shared kind validation, HTTP routes, project/phase Settings and no-code notebook/job/file controls. Those paths are intentionally outside this worker. This isolated adapter is **not evidence of integrated GUI completion**.

All methods accept an object and return a promise:

| Method | Input | Result |
| --- | --- | --- |
| `configure` | `{projectId, config, targetId?, expectedRevision?, select?, phaseId?}` | Same-project compute connection; updates require exact revision; optional project default/phase selection. |
| `health` | `{projectId, targetId?, phaseId?}` | Required tool/schema qualification plus selected runtime read. `verified` means connection/runtime observed; **executionVerified:false** until a real attempt is observed. No test code, session or runtime is created. |
| `start` | `{projectId, notebookId, operationId, targetId?, phaseId?, mode?:'restart', previousJobId?}` | Immediately returns a durable `submitting` job; background dispatch performs session creation/execution. Poll status/logs. Replay returns the original job/source/config. |
| `status` / `logs` | `{projectId, jobId}` | Actual receipt/log observations. Logs return `{jobId,status,logs,observedAt,source}`. |
| `stop` | `{projectId, jobId}` | Closes only this attempt's owned session; returns unknown until closure can be observed. It never stops/deletes the runtime or the owner's notebook session. Also permits explicit cleanup of a terminal attempt whose session closure was unconfirmed. |
| `reconcile` | `{projectId?, jobId?}` | One job or active Colab attempts; read-only MCP/HTTP calls, no code/session recreation, no mutating retries. |
| `exportNotebook` | `{projectId, jobId}` | `{name,content,sha256,evidenceScope}`; genuine v4 source notebook with exact attempt metadata and SHA-256 of returned bytes. |
| `uploadArtifact` | `{projectId,jobId,operationId,relativePath,sha256,bytes}` | Host-only `Buffer`/`Uint8Array` bytes; PUT and read-back SHA verification. Durable transfer receipt. |
| `downloadArtifact` | `{projectId,jobId,operationId,relativePath,sha256}` | GET and expected SHA verification, retained `localPath`/byte count/hash/provenance in transfer receipt. |
| `reconcileTransfer` | `{projectId,operationId}` | Read/hash an ambiguous upload; never repeats PUT. |
| `shutdown` | none | Detach clients/timers; no protocol cancellation or resource deletion. Durable execution survives if the runtime does. |

Downloaded `localPath` is internal to `dataDir/compute/<jobId>/artifacts/`. The storage/artifact owner must register it and publish an authorized download; it is not an automatic public or project artifact URL. File bytes and bearer values must not go through model/tool transcripts. Upload routes should pass host bytes directly. Unknown upload replays return the same receipt; use `reconcileTransfer` to verify, rather than generating another upload operation automatically.

## Configuration and authentication

```js
{ kind: 'colab-mcp',
  runtimeName: 'runtimes/<explicit-existing-owner-runtime>',
  authEnv: 'FORGE_COLAB_BEARER',
  // OR authVaultRef: 'owner/colab', resolved by a host-injected resolveBearer.
  quotaProject: 'owner-selected-project', // optional X-Goog-User-Project
  environmentRevision: 'owner-runtime-image-reference', // optional declaration
  timeoutMs: 15000 }
```

Exactly one machine bearer reference is required. References alone enter domain/config/manifest state. The environment/vault is resolved for each HTTP request, permitting host-managed refresh/rotation. Access-token acquisition, consent and refresh-token retention belong to the existing host credential owner, not this module; no ADC files, browser credentials or gcloud stores are read/imported. Raw bearer, runtime proxy token and arbitrary upstream error bodies are not persisted. Known bearer/proxy tokens are redacted from retained logs. This is not an arbitrary-secret detector for notebook code/data.

Google's [MCP authentication guidance](https://docs.cloud.google.com/mcp/authenticate-mcp) supports bearer authentication; its [enablement guidance](https://docs.cloud.google.com/mcp/enable-disable-mcp-servers) describes project/API and billing prerequisites. The host must establish the appropriate owner account, scope and entitlement. This worker did not enable an API, billing or resource. Colab runtime reads document `colaboratory`/`colaboratory.readonly` scopes; mutations need the appropriate write scope. Do not treat generic cloud-platform scope, a Free subscription, accepted discovery, or an owner-supplied account label as execution entitlement or verified principal identity. [Runtime-read scopes](https://developers.google.com/colab/api/reference/rest/v1beta/runtimes/get), [write scope](https://developers.google.com/colab/api/reference/rest/v1beta/runtimes/create).

`quotaProject` is an explicit optional quota/billing attribution header, not a resource/project creation request. Google documents `serviceusage.services.use` as required to nominate that project. The runtime API resource name itself is `runtimes/{id}`, not `projects/{project}/runtimes/{id}`. FORGE project isolation comes from scoped connections/jobs/operations and exclusive use of an active runtime within this store. The API does not return the user's principal email; health states that limitation. [Google quota header](https://docs.cloud.google.com/docs/authentication/rest).

The only production MCP endpoint is `https://colaboratory.googleapis.com/mcp`. No persisted URL/command/arguments overrides. Constructor-only `fixtureEndpoint` accepts explicit loopback HTTP for engineering tests. Runtime proxy file URLs must be credential/query-free HTTPS beneath `*.googleusercontent.com`; undocumented proxy hosts fail closed with `COLAB_PROXY` until qualified. This is an adapter restriction, not a claim that Google guarantees that hostname forever.

## Execution, recovery and stop

Before network mutation the adapter commits operation fingerprint, immutable source/code/ipynb/hash/revision, config snapshot/hash and target/profile revisions, exact selected runtime, random dedicated session ID, UUID execution ID, attempt workspace, previous attempt linkage and deadline. Source notebook and a credential-free manifest are also written under `dataDir/compute/<jobId>/`. Reusing an operation with changed inputs is rejected. New source/config edits cannot silently change old attempts.

Actual discovery uses the SDK's paginated `tools/list`, detects duplicate names/cursors, checks required field schemas and validates representative documented calls without executing them. Required tools are `get_runtime`, `list_runtimes`, `list_sessions`, `create_session`, `delete_session`, `execute_code`. Each actual call is validated against its discovered schema. Runtime/session/result identities must match the persisted selection; only structured tool output is trusted for those identities. Tool text is not interpreted as success.

A new attempt creates a dedicated `forge-<UUID>` session after observing that name absent. It calls `execute_code` once, with **session + executionId + Python code**, never a runtime target or both target fields. A Python supervisor claims the attempt directory atomically, records source/project/session/execution identity, writes atomic running/terminal receipts and streams stdout/stderr to a runtime log. Python exceptions produce `failed`; absent/mismatched receipts produce `unknown`. The workspace is `/content/forge/<project-hash>/<job-UUID>`; user source runs there. This is namespace organization, not a sandbox against code with the runtime user's permissions.

Google's ID semantics are crucial: after a terminal result is delivered, reusing `executionId` may execute again. The adapter never retries an execution, including after deadline/unavailable/lost response. Reconcile uses only `get_runtime` and GET of the recorded receipt/log. The atomic claim also prevents a second source execution if an external client nevertheless resends the identical wrapper. A crash before code acceptance may therefore leave an unknown, never-executed attempt; automatic at-least-once submission is deliberately unavailable. [Official execution semantics](https://developers.google.com/colab/api/reference/mcp/tools_list/execute_code).

SDK 1.32.2 normally emits `notifications/cancelled` on a client timeout. Google documents that this interrupts whichever code the session currently runs. This adapter suppresses those transport notifications: a timeout/shutdown detaches observation. Explicit Stop uses `delete_session` for its dedicated session and confirms absence with `list_sessions`. Runtime and owner notebook sessions remain untouched. Closing a session loses kernel memory but leaves files/runtime running. [Session closure](https://developers.google.com/colab/api/reference/mcp/tools_list/delete_session).

Because `execute_code` can create a missing session, deleting before an in-flight request starts could allow that delayed request to recreate it. Stop therefore requires a runtime receipt before deleting a possibly dispatching execution; otherwise it remains unknown. A pending create response is bound to its exact durable random session reservation; after it returns, a pending stop prevents execution. A lost create response can be reconciled to that exact observed reservation during explicit Stop. No other listed session can be selected for closure. Kernel closure does not roll back outputs or cancel subprocesses that escaped the kernel; those effects are not claimed.

The selected project jobSeconds defaults to 120 and is bounded 1–86400. Python's Linux SIGALRM enforces this inside the supervisor; an attached client also requests Stop at the deadline. Blocking native code, altered signal handlers or child processes can defeat a Python deadline, so missing terminal evidence stays unknown. Read-only reconciliation does not rearm a mutating deadline timer. Reopening FORGE cannot guarantee the runtime survived; a lost runtime/files leaves unknown outcome and requires owner inspection. No keepalive or runtime recreation is attempted.

## Files and exact capability limits

The [documented file protocol](https://developers.google.com/colab/api/reference/mcp/tools_list/get_runtime) is implemented directly: `X-Colab-Runtime-Proxy-Token`, GET `/files/{absolute-path-without-leading-slash}`, PUT `/api/contents/{path}` with file/base64 or directory JSON. Each upload chunk is at most 8 MiB, with numbered chunks and final `-1` when chunking is needed. The default transfer cap is 128 MiB. GET logs request the last 200000 bytes; retained domain logs are bounded/redacted. A fresh `get_runtime` supplies proxy credentials for each request; a GET 404 gets one read-only credential refresh before being treated as missing/error. Mutating requests are never automatically replayed. Proxy tokens remain in memory.

Transfers are confined to the exact attempt workspace; parents are created one level per request beneath that root. Uploads require the workspace to exist (normally once the attempt has begun), so this is not a pre-dispatch dataset staging facility. SHA-256 is checked before upload and on read-back/download; successful receipts retain hash, size and source/execution provenance. A missing or wrong file never becomes a verified artifact. Successful source execution does not imply artifacts have been exported beyond ephemeral Colab storage.

Supported here: existing runtime attachment, fresh dedicated session, Python source/code-cell concatenation, status/log/failure, owned session closure, read-only recovery, immutable source notebook export and bounded binary file transfer. Local editor import/edit/persistence remains the existing notebook/domain owner. Hosted MCP has no documented notebook-cell CRUD tools; browser notebook editing remains the other Colab adapter. This executor does not render rich cell output, preserve per-cell execution counts, evaluate last-expression displays, process IPython magics or certify arbitrary notebook dependencies. Save plots/weights to files and use the transfer/storage boundary.

`mode:'resume'` and checkpoint refs are rejected with `RESUME_UNSUPPORTED`. Reattaching observations to an existing session is not restoration of application/model state. A new `restart` uses a new operation, session and execution identity; a supplied previous attempt must be terminal and from the same project/notebook. Arbitrary application checkpoint restoration is not advertised by the hosted tools and is not implemented here. The existing SSH/Jupyter checkpoint protocol remains a separate qualified path.

Runtime create/delete/start/stop, upgrade, rental, billing/API enablement and generic arbitrary tool calls are unavailable even if discovered. Supporting provisioning would require a separate explicit owner request and implementation/policy review. No Colab Enterprise or browser-bridge execution endpoint is substituted.

## Source pins and developer evidence

Primary references inspected **2026-11-24**:

- [Official hosted reference](https://developers.google.com/colab/api/reference/mcp), updated 2026-11-20: managed endpoint and tools. Service terms apply; no hosted server source commit or OSS license is invented.
- [create_session](https://developers.google.com/colab/api/reference/mcp/tools_list/create_session), [list_sessions](https://developers.google.com/colab/api/reference/mcp/tools_list/list_sessions), [delete_session](https://developers.google.com/colab/api/reference/mcp/tools_list/delete_session), [get_runtime](https://developers.google.com/colab/api/reference/mcp/tools_list/get_runtime), [list_runtimes](https://developers.google.com/colab/api/reference/mcp/tools_list/list_runtimes): inspected documented input/output field subset; tool references show 2026-11-13 updates where present. `list_runtimes` takes an empty request, not invented pagination parameters.
- [execute_code](https://developers.google.com/colab/api/reference/mcp/tools_list/execute_code), updated 2026-11-20: target union, execution ID, terminal result fields, errors and timeout semantics. Discovery rather than copied static schema is authoritative at connection time.
- Existing root lockfile pins **@modelcontextprotocol/sdk 1.32.2**, MIT, `https://registry.npmjs.org/@modelcontextprotocol/sdk/-/sdk-1.32.2.tgz`, integrity `sha512-SWsVtH/0vULSQStoZ6xxH2K09Li8fXYTMC64ZeogCdpZ3XSi1eCPOByV1OpuJxuI3OcmHhosDWYyii07tpPsLw==`. Installed package and SDK protocol/Streamable HTTP implementation inspected locally; no dependency or lock change.

Commands run from this isolated checkout (Windows, Node 24.19.0, Python 3.12.10):

```text
node --check app/compute/colab-mcp.mjs
node --test tests/colab-mcp.test.mjs tests/compute-adapters.test.mjs tests/compute-ssh-worker.test.mjs tests/providers-mcp.test.mjs
git diff --check
```

Result: **25 tests passed**, including **12 new Colab tests**. Real SDK client/server Streamable HTTP, actual Python supervisor/source execution, local HTTP file proxy and disposable SQLite store are exercised. Fixtures cover required discovery/schema/identity, project isolation, source/config replay, explicit restart vs refused resume, loss after terminal delivery, atomic claim against an external same-ID replay, owned-session stop, pending-create cancellation, ambiguous dispatch, invalid receipts, transient auth recovery, shutdown/reconnect without cancellation, raw binary hashes, chunking, expired-proxy read refresh, and read-only ambiguous-upload reconciliation. Existing compute and MCP regressions pass. The Python filesystem root alone is remapped to temporary Windows directories; Linux SIGALRM is not executed on Windows. No fixture result is labelled live Google evidence.

Dependencies were read through a worktree-local ignored `node_modules` junction to the already installed lead checkout dependencies. No install/lock refresh or parent source change was needed.

## Remaining work / live qualification

**Integration pending (lead scope):** shared compute dispatch/validation, HTTP authorization/routing, no-code forms/state labels, host credential consent/refresh UI and storage registration of downloaded artifact bytes. Rich browser notebook execution and generic model-checkpoint resume are explicit unsupported contracts above, not missing account credentials.

**LIVE_COLAB_NOT_RUN:** no account, enabled API/project, bearer scope/entitlement or owner-selected existing runtime was supplied/used. Authentication, actual discovered production schemas, proxy hostname, runtime image/dependencies, Linux deadline behavior, free-tier availability, real Google execution/file transfer and quota behavior require a separate bounded owner check. **HOME_UAT_NOT_RUN** independently.

After integration and owner setup: select the existing runtime and machine credential ref, run Health, start a reviewed short Python notebook that writes a small known file/hash, observe status/logs and verify its downloaded bytes. Reload FORGE during another bounded execution and reconcile the same job; invoke Stop and check only its dedicated session closes. Temporarily unavailable auth must report unknown without execution replay. Preserve needed artifacts using the selected storage owner before the ephemeral runtime ends. Do not create a runtime, change billing or activate a prototype as part of this check without a separate explicit request.
