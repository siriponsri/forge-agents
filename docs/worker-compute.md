# Compute worker handoff — A09 / A10 / A11

2026-11-24. Base `998762d`, isolated branch `t3/forge-compute-adapters`.
Actual inherited runtime: **gpt-6.1-sol, xhigh**, Codex in T3 Code. No model switch or child delegation.
Owned paths: `app/compute/**`, `tests/compute*.test.mjs`, this document. No shared server/domain/store/web/manifest/lock/progress/legacy paths changed. No push, PR, cloud access, account import, purchase, or prototype execution.

## Integration contract

```js
import { createComputeService } from '../compute/index.mjs';
const compute = createComputeService({dataDir, store, localJobs: jobs});
await jobs.recover();       // existing local process owner
await compute.reconcile(); // read remote execution receipts; never redispatch
// Route normal notebook starts through compute.start, not jobs.start.
// On shutdown await compute.shutdown(), then existing jobs.shutdown().
```

All methods take an object and return promises. IDs must belong to `projectId`.

| Method | Input | Result |
|---|---|---|
| `configure` | `{projectId,config,targetId?,expectedRevision?,select?,phaseId?}` | Existing `connections` record of `kind:'compute'`. An update requires exact target revision. `select` updates project default or that project's existing phase override. |
| `health` | `{projectId,targetId?,phaseId?}` | Checked timestamp, actual auth/connection observation, `execution`, `verified`, error code or setup path. Never equates a configured target with tested execution. |
| `start` | `{projectId,notebookId,operationId,phaseId?,targetId?,mode?:'restart'|'resume',previousJobId?,checkpointArtifactId?}` | Existing local job or one durable `compute-notebook` job. A replay returns the same ID and immutable source/config. |
| `status` | `{projectId,jobId}` | Reconciled job with real receipt/status. Missing observations remain `unknown`. |
| `logs` | `{projectId,jobId}` | `{jobId,status,logs,observedAt,source}`; bounded, credential-redacted actual text. |
| `stop` | `{projectId,jobId}` | Stops only the recorded execution/kernel. Interrupt acknowledgement is `stopping`; transport loss is `unknown`; terminal receipt establishes `stopped`. |
| `reconcile` | `{projectId?,jobId?}` | One job, or active job and lifecycle observations. No new notebook execution or resource transition. |
| `lifecycle` | `{projectId,targetId,operationId,action:'start'|'stop'}` | Durable request/observation for that explicit existing Vast/Runpod resource. Replays never repeat transition. |
| `exportNotebook` | `{projectId,jobId}` | `{name,content,sha256,setup}`; actual v4 ipynb download data bound to immutable attempt source. |
| `importResult` | `{projectId,jobId,notebook:<parsed ipynb>}` | Colab owner-imported outputs with exact source/project/attempt validation and retained byte/hash reference. Evidence is expressly owner-imported, not remote attestation. |
| `linkArtifact` | `{projectId,jobId,artifactId}` | Adds an existing same-project verified artifact reference. It does not invent or transfer remote bytes. |
| `shutdown` | none | Detaches remote observation and clears deadline timers. Never stops an entire remote resource implicitly. Local shutdown remains `localJobs` responsibility. |

Selection order: project default → explicit existing phase override → notebook target → explicit requested target. The selected target must be a `kind:'compute'` connection from the same project. A nonlocal kind without a connection is an actionable setup error. Historical attempts retain the original config and source even after settings/notebook edits.

Lead-owned changes required:

1. Instantiate this service and wire the above routes and no-code forms/download/upload actions. This worker does not claim GUI/HTTP integration has passed.
2. Route notebook execution through `compute.start`. Local jobs are delegated to `localJobs.start({...input,resolvedCompute:{kind:'local'}})` and remain the **same job record**, with no second process owner.
3. The baseline `app/server/jobs.mjs` guard checks only notebook/project kind. Teach the internal local owner to respect the trusted `resolvedCompute` selection so a local phase override works under a remote project default. It also receives `notebookRevision,projectRevision,targetId,targetRevision` inside resolvedCompute; check revisions atomically before selecting source to refuse concurrent edits. Do not accept an unvalidated browser-supplied resolvedCompute directly.
4. Its workspace busy guard should also include `submitting/submitted/starting/unknown/interrupted/awaiting-owner`. Compute serializes submissions and checks those states, but a separate direct jobs endpoint could otherwise bypass the boundary.
5. Show Colab `evidenceScope`, unknown/stopping truth, source/config/environment revisions, resource identity and manual Jupyter cloud binding in the GUI. Do not label owner-uploaded results as automatically observed provider execution.
6. Generic connection mutation must preserve compute validation: use `compute.configure` for these targets. Existing shared state/export must never resolve `*Env` references into credential values.
7. `resultRef.path` is an internal dataDir reference, not automatically a project artifact download URL. Exported notebook bytes are returned directly by `exportNotebook`; lead can expose an authenticated download endpoint and register imported-result bytes through the established artifact/storage owner if desired.

## Configurations

Only documented fields are accepted; raw passwords, keys, arbitrary shell commands, query tokens, unrecognized fields and credential-bearing URLs are rejected. No dependencies added. Secrets are read from the **running machine environment** only. `authEnv`, `identityFileEnv` and `knownHostsFileEnv` are reference names, never credential values. No OS vault implementation is advertised by this worker.

```js
{kind:'local'}
{kind:'owner-ssh',host:'owner.example',port:22,user:'owner',
 knownHostsFileEnv:'FORGE_OWNER_KNOWN_HOSTS', // env value = machine-local known_hosts path
 identityFileEnv:'FORGE_OWNER_IDENTITY_FILE', // optional env value = private-key file path
 expectedMachineId:'<64 lowercase hex SHA256 of remote /etc/machine-id contents, trimmed>',
 workspace:'/workspace/my project',environmentRevision:'owner-image-revision',timeoutMs:15000}
{kind:'jupyter',baseUrl:'https://selected-jupyter.example',authEnv:'FORGE_JUPYTER_TOKEN',
 workspace:'project/work',kernelName:'python3',environmentRevision:'pinned-image-revision',timeoutMs:15000}
{kind:'vast',resourceId:'123',authEnv:'FORGE_VAST_API_KEY',executor:<owner-ssh or jupyter config>}
{kind:'runpod',resourceId:'existing-pod-id',authEnv:'FORGE_RUNPOD_API_KEY',executor:<owner-ssh or jupyter config>}
{kind:'colab-browser'}
```

SSH health can inspect a host before `expectedMachineId` is bound. Execution remains unavailable until it matches. Verify the presented identity and SSH known-host key against the owner's selected host through a trusted channel; no automatic trust-on-first-use. System `ssh` and remote POSIX/Linux `python3`, writable home/workspace and `/proc` birth-time inspection are required. Windows **client** is supported; a Windows remote SSH worker is not claimed.

SSH ignores implicit config (`-F none`), uses strict selected known_hosts, disables forwarding/local commands, sends all paths/code as JSON stdin and uses one constant Python bootstrap command. It never constructs a command from a workspace/notebook path. Its supervisor persists per-attempt request/source/process-birth/status/log files in `~/.forge/attempts/<UUID>`, uses an exclusive directory and cancellation tombstone, and signals only its owned process group after matching process birth. The remote supervisor continues across client disconnect. Missing/reused PID identity is unknown, never success or permission to signal an unrelated PID.

Jupyter supports the documented Python kernel/session/channels/contents contract, not arbitrary custom REST APIs. It authenticates HTTP using a token header and WebSocket using the standard token query **only in memory**; the URL/token is never stored/logged/exported. It creates a dedicated session/kernel, persists returned IDs before sending one `execute_request`, disables stdin, and writes a local Python receipt/log in the kernel workspace. Reconciliation reads Contents API files; it does not resend code or assume an idle kernel means success. A server whose kernel filesystem is not readable through its Contents root cannot satisfy this receipt contract. A lost response during session creation can leave an orphan session with no returned identity; the attempt remains unknown and must be inspected by the owner, rather than creating more sessions.

Jupyter deadlines use the recorded `deadlineAt` and an in-process interrupt timer; reconcile rearms it after application restart. Cancellation is acknowledged only through the receipt, so a stalled/disconnected/uninterruptible kernel stays stopping/unknown. SSH deadlines are enforced by the detached supervisor with SIGTERM then birth-checked SIGKILL. Local limits remain those of the existing job owner (baseline 120 seconds). Colab browser limits/stop stay owner-controlled. No universal survival or cancellation guarantee is claimed.

Provider API bases are fixed to their official origins and version paths; loopback HTTP overrides exist solely for labelled contract fixtures. Vast/Runpod inspection projects a narrow safe subset, never the raw resource response (which can contain environment/registry/Jupyter secrets). SSH executor host/port/user must match returned cloud resource SSH identity. A manually configured Jupyter proxy URL may not appear in provider data; health explicitly labels this binding **owner-configured, not provider-attested**. The selected resource must already be running before notebook dispatch. There is no automatic boot, resource search/rental, resize, upgrade, purchase, deletion or fallback.

`lifecycle start` can incur compute charges for an **already existing explicit ID** when the owner invokes it. This worker made no such live call. Resource stop can leave billed storage; it is separate from notebook stop and blocked while an active/uncertain notebook owns that target.

## Recovery, checkpoints and evidence

Remote reservation is written before any mutation, with operation fingerprint, immutable code/ipynb/source revision and hash, config snapshot/revision, environment observation/revision, attempt/previous-attempt IDs, artifact/checkpoint refs and remote execution IDs. Remote source and a credential-free manifest are also persisted in `dataDir/compute/<jobId>/`. Repeating an operation ID never reruns code; changed inputs return `OPERATION_REUSE`. Mutating transport errors remain `unknown`. Preflight failures before dispatch are `failed`. Missing receipt/timeout never establishes completion.

Resume is a **new attempt**, never retrying the original request or preserving an invisible kernel. Only SSH/Jupyter sources that explicitly declare `notebook.compute.resume={protocol:'forge-checkpoint-env-v1',sourceSha256:<exact executable-code hash>}` qualify. The notebook must actually read `FORGE_CHECKPOINT_PATH` and implement restoration. This is a declared application contract, not inferred learning/model support. The previous same-notebook attempt must be terminal and have the same source hash. Select a verified same-project `kind:'checkpoint'` artifact with a `locations` entry `{kind:'compute',targetId,path,sha256,verifiedAt}` on this exact target and matching artifact hash. FORGE passes the selected checkpoint path to the source; the producer/storage owner is responsible for actual checkpoint transfer/integrity qualification. It does not falsely claim a metadata reference transferred bytes. Local/interactive Colab resume is refused; use restart. A new source, missing qualification, missing checkpoint or different target is refused.

Colab owner-interactive path exports a genuine `.ipynb` with attempt/source metadata, directs the owner to upload/run it in their own browser and import the saved notebook with outputs, validates source and linkage and retains imported outputs/hash. Stop reports unknown until the owner handles Colab; FORGE never claims an official fixed browser execute/cancel endpoint. Free-tier hardware, eligibility and runtime lifetime are never guaranteed. Preserve completed artifacts outside the ephemeral runtime using the selected storage path.

## Primary references

Exact routes, immutable source pins and inspection scope are in `app/compute/PRIMARY_SOURCES.json`.

- [Runpod REST v2 read](https://docs.runpod.io/api-reference-v2/pods/get-a-pod) and [official generated operation at 6f1cb572](https://github.com/runpod/runpod-mcp/blob/6f1cb5729bd1d5dc835f7f80b18066d40f400978/src/specgen/generated/tools.gen.ts): `GET https://api.runpod.io/v2/pods/{id}` and **singular** `POST /v2/pods/{id}/action`, body `{action}`. Older v1/tutorial routes are not substituted.
- [Vast read](https://docs.vast.ai/api-reference/instances/show-instance) and [state control](https://docs.vast.ai/api-reference/instances/manage-instance): `GET/PUT https://console.vast.ai/api/v0/instances/{id}`, PUT `{state:'running'|'stopped'}`. General notebook execution uses SSH/Jupyter; Vast's constrained execute API is not misrepresented as a scheduler.
- [Jupyter REST](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html), [WebSocket](https://jupyter-server.readthedocs.io/en/latest/developers/websocket-protocols.html), [messaging](https://jupyter-client.readthedocs.io/en/stable/messaging.html): exact subset pinned and contract-tested; no broad compatibility certification.
- [Google browser bridge at b9ab3899](https://github.com/googlecolab/colab-mcp/blob/b9ab3899e0f1fa493390b1fd6d54aa2e464ecdf1/README.md): bootstrap/dynamic tools are distinct from exported notebooks.
- [Official hosted Colab MCP](https://developers.google.com/colab/api/reference/mcp) exists at `https://colaboratory.googleapis.com/mcp`. **This separate hosted route is not implemented here**. Its authenticated runtime/session/execution/reattachment/transfer lifecycle is an implementation gap, not a missing-credential test and not evidence that no Colab API exists. The implemented interactive browser route does not claim automatic bridge/MCP integration.

## Verification and gaps

Environment: Windows, Node `v24.19.0`, Python `3.12.10`, no owner/server/cloud credentials used.

`node --test tests/compute*.test.mjs`: **10 PASSED**, zero skips. Covers:

- Per-project defaults, phase selection, foreign project denial, revision conflict, unsafe config and secret-field rejection.
- Existing local owner, real Python stdout/failure/stop, exactly one job on concurrent operation replay, immutable historical source, resume refusal.
- Real HTTP + WebSocket traffic to a **labelled local Jupyter protocol fixture**, with actual Python execution of the adapter wrapper, logs/files, interruption, reconnect/no redispatch, session-create timeout, source-qualified checkpoint environment handoff and kernel deadline.
- Exact Vast/Runpod read/state route/body fixtures, identity mismatch, lifecycle replay/reconcile without repeated mutation, no provisioning, safe resource response and machine-secret redaction.
- Colab ipynb export, exact-source import, foreign-project/tampered-source rejection, imported output provenance and truthful unsupported automatic stop.
- Real child-process stdin transport fixture for SSH command/path isolation and timeout. Separate **labelled Python supervisor fixture** runs an actual detached harmless Python subprocess and verifies durable observation/replay, machine/owner mismatch, cancellation tombstone and simulated owned/reused-PID signalling logic. This does **not** establish a real SSH handshake, remote `/proc` or owner host access.

`node --check app/compute/{common,cloud,index,jupyter,ssh}.mjs` and Python syntax compilation passed. `git diff --check` passed (repeat after staging).

`pnpm test` could not start: pnpm is absent from this worker PATH. The equivalent `node --test tests/*.test.mjs app/web/tests/boundaries.test.mjs` ran: **33 passed, 9 failed at module loading, 1 optional skip**. All nine failures are baseline/integration suites requiring root packages absent in this isolated checkout (`@modelcontextprotocol/sdk`, `fflate`); focused compute has no such dependency. No root manifests/lockfiles were changed. Lead should run the integrated suite in its installed dependency environment. This is not an all-suite pass.

Live/home checks **NOT_RUN**: real owner SSH host-key/machine identity handshake, remote Linux supervisor kill/restart, actual Jupyter distribution/reconnect/filesystem mapping, Vast/Runpod authenticated API/execution/lifecycle, Colab signed-in upload/run/download, actual model checkpoint restoration, GUI/HTTP/home UAT. Do not replace these with fixture success.

Implementation boundaries requiring separate work: lead HTTP/no-code integration and local-owner guard change above; separate hosted Colab MCP and dynamic browser-bridge automation; remote artifact transfer/registration is the storage/artifact owner's contract. These are distinct from absent live credentials. This worker does not declare all FORGE A09–A11 product acceptance complete.
