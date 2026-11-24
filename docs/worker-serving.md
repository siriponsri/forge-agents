# Serving worker handoff — FORGE v3 G4 / A12–A13

Scope: `app/serving/**`, `tests/serving*.test.mjs`, this note. No changes to shared
contracts, backend/domain, frontend, root dependencies/lockfiles or protected legacy
paths. Working model: **gpt-6.1-sol, xhigh** (reported by this T3 runtime); no model
switch, delegate, push, PR or main merge. Lead owns HTTP/GUI integration and central
progress. All model inputs used below are disposable engineering fixtures.

## Public service API and concrete inputs

```js
import { createServingService } from '../serving/service.mjs';
const serving = createServingService({ dataDir, store, connections, artifacts });
```

The shared store is authoritative: synchronous `read()`, serialized asynchronous
`transaction(fn)`. Factory recovery is awaited by each method. Errors thrown before
submission have `code,message,statusCode`; jobs with runtime failures return a
durable failed/unknown job. `connections` and `artifacts` arguments are accepted for
integration compatibility; this adapter uses its own bounded SDK client and writes
common artifacts, avoiding the generic MCP caller's separate execution receipt.

Configure changes **only** `project.profile.serving`, requires current project
revision, verifies both artifact bytes, and returns
`{projectId,revision,config,bindingEvidence:{kind:'declared-binding',loadedModelVerified:false}}`.
Use the returned revision for the next project mutation. Idempotency returns the
original result; changing arguments with a reused operation ID fails with 409.

```js
await serving.configure({
  operationId: crypto.randomUUID(), projectId, expectedRevision: project.revision,
  adapter: 'litserve', mode: 'local', port: 0, timeoutMs: 15000,
  binding: {
    model: { artifactId: model.id, revision: model.revision },
    preprocessor: { artifactId: preprocessor.id, revision: preprocessor.revision },
  },
});
const deployment = await serving.start({
  operationId: crypto.randomUUID(), projectId,
  installDependencies: true, // guided isolated setup if needed; never global pip
  // pythonExecutable: optional machine-selected CPython executable
});
const health = await serving.health(projectId);
const rest = await serving.predict({
  operationId: crypto.randomUUID(), projectId, deploymentId: deployment.id,
  transport: 'rest', payload: { inputs: [5, 6] },
});
const mcp = await serving.predict({
  operationId: crypto.randomUUID(), projectId, deploymentId: deployment.id,
  transport: 'mcp', payload: { request: { inputs: [5, 6] } },
});
await serving.stop(deployment.id);
await serving.shutdown();
```

`deploymentId` accepts the deployment job ID or the distinct deployment identity;
omitting it selects the current active deployment in that explicit project. There
is no source-repository project default. `start` waits for actual readiness or a
bounded startup failure while durable state/logs remain available for SSE/polling.
Lead should mount long-running Start without a shorter HTTP timeout, and keep Stop
available while Start is pending. Setup can take up to five minutes; server startup
has a separate 60-second limit. `stop` accepts common job IDs, including a pending
local start or an active prediction.

For an existing LitServe endpoint configure the same explicit binding with
`mode:'existing', endpoint:'http://127.0.0.1:8000', mcpTool:'<discovered name>'`.
The URL is a base URL; the adapter checks `/health`, posts `/predict` and uses SDK
Streamable HTTP `/mcp/`. `health(projectId)` discovers paginated tools and schemas;
the UI must select a returned tool name. Predict MCP payloads are **raw tool
arguments from that schema**. LitServe 0.2.19's qualified local schema requires
`request`; its REST body has no such wrapper. Arbitrary remote results, including
self-asserted `forgeEvidence`, never establish that selected weights were loaded.

## Local model/preprocessor format

Model artifact JSON:

```json
{"format":"forge.linear.v1","weights":[2,-1],"bias":0.5,"engineeringFixture":true}
```

Preprocessor artifact JSON:

```json
{"format":"forge.standardize.v1","mean":[1,2],"scale":[2,4]}
```

This original loader computes `sum(w[i] * (input[i]-mean[i])/scale[i]) + bias`.
The above labelled fixture returns **3.5** for `[5,6]` through both real REST and
MCP. No training, dataset or domain product was created. For actual user weights
omit `engineeringFixture` or set false; the API does not claim measured quality.
Vectors must be matching, finite, nonempty and at most 10000 features; scale cannot
be zero. Local JSON files are limited to 4 MiB each. No pickle, uploaded Python,
arbitrary executable loader or automatic framework/model downloads are allowed by
this loader. Unsupported weights return `MODEL_FORMAT_UNSUPPORTED` with the route
to an existing inference implementation. Existing LitServe supports other formats
only when that endpoint already implements their inference logic.

## Health and common job/event/artifact shapes

Successful health shape (REST readiness and MCP readiness are separate):

```js
{
  status: 'ready', endpoint, checkedAt, latencyMs,
  rest: { httpStatus: 200, result: /* actual /health response */ },
  mcp: { status: 'ready', tools: [{ name, description, inputSchema }],
    selectedTool: 'forge_predict', selectedToolAvailable: true },
  binding: { model: { artifactId, revision, sha256, bytes, path, source },
    preprocessor: { artifactId, revision, sha256, bytes, path, source } },
  deploymentId,
  bindingEvidence: { kind: 'owned-loader-observation', loadedModelVerified: true,
    deploymentId, instanceId, binding, loader: 'forge.linear.v1',
    engineeringFixture: true, workerPid, observedAt },
  dependencies: { ready: true, executable, python: '3.12.10', packages: { /* observed */ } },
}
```

For existing endpoints, `bindingEvidence` always remains declared/unverified and
`dependencies` is omitted. A REST failure yields
`{status:'error',error:{code,message,httpStatus?,response?},checkedAt,dependencies?}`.
A healthy REST endpoint with unavailable MCP retains REST `status:'ready'` while
`mcp.status:'error'` carries its actual error. UI must show these independently.
Health persists `serving.health` events; it never fabricates GPU, loss or accuracy.

Common jobs have `id,projectId,revision,createdAt,updatedAt` plus:

- Both kinds: `kind:'serving.deployment'|'serving.inference',operationId,runId,
  attemptId,deploymentId,status,profileRevision,config,binding,owned,logs,
  artifactIds,metrics,error?,startedAt?,finishedAt?`.
- Deployment: `endpoint,pid?,readiness,environment?,features?,engineeringFixture?,
  observedBinding?,health?`. Lifecycle: preparing → starting → running;
  failure/stop/recovery produce failed/stopped/unknown. An existing endpoint's
  running record means attached and reachable, with `owned:false`.
- Inference: `request:{transport,payload},result,endpoint,bindingEvidence,
  metrics:{latencyMs,observedAt}`. REST result is the actual decoded response;
  MCP result preserves SDK content/structuredContent/isError without pretending
  binary attachments or streaming conversion. Latency includes verification,
  connection and discovery; it is client workflow elapsed time, not model GPU time.

Each job has a common `runs` record with captured profile, binding and status.
Events include `serving.configured/reserved/status/health/recovered`. Completed
inference responses (including returned MCP tool errors) create immutable JSON
`inference-result` artifacts under the chosen project's `.forge/serving/results/`,
with SHA256, byte count, job/run/deployment IDs, binding and profile revision.
HTTP errors retain actual status/body on the failed job. No synthetic counters or
scores are populated. Common artifact download verifies these bytes again.

## Effects, ownership and recovery

Every inference/start reserves operation ID and fingerprint transactionally before
dispatch. Same-operation retries, including concurrent retries and retries after
restart, return the recorded job without another effect. Reused IDs with different
arguments fail. Tampered bytes, changed artifact revisions or changed serving
selection fail before dispatch. Inputs are bounded to 256 KiB, REST responses to
2 MiB; large outputs should use the project's artifact transfer facility.

Timeout/disconnect/cancel after dispatch means **unknown** unless a definite
response was received. MCP tool `isError` and explicit HTTP errors are failed.
Stop of a prediction cancels the client wait; it does not claim remote execution
was cancelled. No automatic retry, MCP Task cancellation or checkpoint resume is
invented. Generic LitServe has no remote request-status handle: inspect its logs
before issuing a new operation ID. Uncertain inference results are preserved.

Stop of an existing endpoint or recovered PID returns `NO_OWNED_PROCESS`. Only a
live service-owned process handle grants termination authority. Windows uses a
kill-on-close Job Object for the runner and all its workers, plus a handle waiting
on the live Node owner. A hard owner crash therefore closes the whole child job.
POSIX uses a dedicated process group and raw owner-lifetime pipe; POSIX live
qualification remains pending. Owned local staging/copies live under dataDir.

On factory recovery, prior active serving jobs/runs become unknown. For a new
attempt supply `start({operationId,projectId,reconcileJobId:oldJob.id})`. A local
record can become interrupted only after an actual loopback TCP connection refusal
shows its recorded endpoint is offline; a reachable/uncertain unowned resource
blocks a new local deployment. An existing endpoint is probed and its prior record
detached (never falsely stopped) before a new attachment. Recovery does not grant
authority to kill a recorded PID. Artifacts/history survive all these changes.

## Dependencies and upstream qualification

No root dependency changes. Existing **@modelcontextprotocol/sdk 1.32.2 (MIT)** is
used directly. Public primary sources inspected on 2026-11-24:

- [LitServe MCP guide](https://lightning.ai/docs/litserve/features/mcp) and
  [v0.2.19 source](https://github.com/Lightning-AI/LitServe/tree/7675990d5d2f782f2be6d36a489dcf42db03e342)
  (release tag points at that commit); [license](https://github.com/Lightning-AI/LitServe/blob/7675990d5d2f782f2be6d36a489dcf42db03e342/LICENSE), Apache-2.0.
- [LitServe 0.2.19 package](https://pypi.org/project/litserve/0.2.19/),
  [FastMCP 2.14.7 package](https://pypi.org/project/fastmcp/2.14.7/) (Apache-2.0),
  [Python MCP 1.30.0 package](https://pypi.org/project/mcp/1.30.0/) (MIT).
  Current package-index latest FastMCP/MCP were 4.2.5/2.3.0; these are intentionally
  **not** installed because LitServe's qualified MCP adapter uses v1 SDK helpers.
- [Official MCP SDK inventory](https://modelcontextprotocol.io/docs/sdk).
  Installed TypeScript SDK package/source declarations were inspected as shipped;
  no claim that a nonexistent GitHub v1.32.2 tag was inspected.

All tested Python package versions, including transitive dependencies, are pinned
in `app/serving/requirements.txt`. Critical versions: LitServe 0.2.19, FastMCP
2.14.7, MCP 1.30.0, FastAPI 0.165.0, Uvicorn 0.54.0, Pydantic 2.14.4. Setup discovers
CPython 3.10–3.12 and installs a venv under
`%LOCALAPPDATA%/FORGE/cache/serving/litserve-0.2.19` on Windows, outside source.
Only Windows x64 CPython 3.12.10 / Node 24.19.0 was live-qualified. No global pip,
owner credentials, environment token copying or public bind is involved. Runtime
environment is allowlisted and Python uses isolated `-I` execution. Local launch
binds **127.0.0.1** and selects/checks an available port; a later bind collision is
a recorded startup failure rather than taking over another listener.

## Verification, limits and next executable task

Developer checks:

- `node --test tests/serving*.test.mjs`: actual local HTTP and official SDK MCP,
  verified weight/preprocessor checksums, stale revision/cross-project rejection,
  concurrent idempotency, timeout/cancel unknown effects, restart recovery,
  occupied port, unsupported loader, and real Windows LitServe REST/MCP parity,
  loaded-byte evidence, stop/restart, startup cancellation and hard-owner-crash
  cleanup/reconciliation. The live test skips only if native dependencies are
  absent; `FORGE_SERVING_REQUIRE_LIVE=1` makes absence fail instead.
- `FORGE_SERVING_TEST_SETUP=1 node --test tests/serving-setup.test.mjs`:
  **passed**, fresh disposable machine-cache venv installation through the actual
  guided setup implementation, pinned versions and reuse; default suite skips this
  network/download check. Isolated setup took about 66 seconds on this machine.
- Managed venv `python -I -m pip check`: **passed**.
- `npm.cmd test`: **31 tests, 28 passed, 0 failed, 3 skipped** (two report-native
  opt-in checks and the separately passed guided-setup download check). Final
  standalone real LitServe lifecycle check also passed in about 21 seconds.
- `node --check` on all four serving JavaScript modules, Python AST parse, and
  `git diff --check`: **passed**.

Implementation boundaries: HTTP endpoints and no-code GUI are lead work and were
not edited here. Authenticated/OAuth LitServe transport and arbitrary local model
framework loaders are **not implemented by this adapter**; this is not a missing
credential excuse. Connect an already implemented compatible unauthenticated
private/loopback endpoint for other model formats. No deployment provider,
cloud purchase, trained-model quality evaluation, GPU collector, rich MCP file
conversion or token streaming is claimed. Native CPython installation itself is
an actionable setup prerequisite, not an automatic global installer.

External owner models/endpoints, authenticated targets and HOME_UAT_NOT_RUN remain
separate from this fixture qualification. Next executable lead task: mount the six
methods, expose jobs/events/artifact downloads in the existing shared views, then
exercise GUI upload → select revisions → configure local → Start/Setup → Health →
REST and discovered-schema MCP Predict → result artifact → Stop → Restart using
the exact labelled JSON fixtures above. Keep real owner model validation pending.
