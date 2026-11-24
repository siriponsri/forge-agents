# Local jobs lifecycle + Compute screen handoff

2026-11-24. Isolated branch `t3/compute-jobs-lifecycle-ui`, base `38cadb4`.
Actual runtime **gpt-6.1-sol, xhigh**, Codex in T3 Code; no nested delegation.
Only assigned `app/server/jobs.mjs`, new `app/jobs/runner.py`,
`app/web/src/Compute.jsx`, `tests/jobs*.test.mjs` and this handoff changed.
No main/domain/admission/compute/manifest/lock/progress/legacy/bootstrap changes,
push, PR, credentials migration, public service, cloud call or prototype.

## Lead integration hooks

```js
const jobs = createJobService({
  store, dataDir,
  admit: (state, input) => { /* shared synchronous writer/capability admission */ },
});
const localJobs = {
  start: ({resolvedCompute, ...input}) => jobs.start(input, {resolvedCompute}),
  stop: id => jobs.stop(id),
};
const compute = createComputeService({store, dataDir, localJobs});
await jobs.recover();
await compute.reconcile();
// On shutdown: await compute.shutdown(); await jobs.shutdown(); await store.close();
```

`admit(state,input)` executes synchronously **inside** the same reservation
transaction, after scope/revision/writer checks and before insertion. Throw a
domain error or return false to deny. Returning a Promise is a contract error.
It is skipped for an immutable replay. No uncommitted `admission.mjs` import.
The hook should not mutate external systems; a failed transaction must have no
outside effects. Shared cross-owner policy remains the lead's authority.

**All browser notebook starts must route exclusively through `compute.start`.**
The existing compute service passes a trusted selection inside its private
localJobs call. The host facade above moves it into the second argument.
`jobs.start(input,{resolvedCompute})` requires `kind:'local'`, exact
`projectRevision`, `notebookRevision`, and (when selected) same-project
`targetId/targetRevision` whose connection kind is compute and config kind is
local. A local phase/explicit target can override a remote project default.
`input.resolvedCompute` is rejected with `COMPUTE_SCOPE`; never copy an HTTP body
into this private slot. Direct legacy internal local calls without a connection
selection still work, but must not be exposed as a selection bypass over HTTP.

`jobs.stop(id)` remains compatible; `{projectId,jobId}` is also accepted for a
project-scoped host caller. Stop returns after owned cleanup and final state
persistence. Completed jobs remain completed if Stop races completion. Starts
and shutdown share launch gates; Stop before source launch prevents execution.
No local checkpoint resume is claimed. Explicit fresh restarts accept a terminal
previous attempt from the same project/notebook. Unknown/interrupted jobs require
owner inspection and explicit shared recovery disposition, not blind replay.

The writer guard covers canonical task/chat runs and notebook/compute-notebook
jobs in queued/submitting/submitted/starting/running/stopping/unknown/interrupted/
awaiting-owner states. Serving deployments and report jobs do not independently
block notebooks. Lead admission may impose additional intentional constraints.

## Process ownership and persistence

The standard-library Python supervisor is independent of LitServe and every
serving dependency. Windows creates an outer private non-inherited
`KILL_ON_JOB_CLOSE` JobObject containing the supervisor, then creates the worker
**suspended**, assigns an inner owned JobObject and resumes it. The outer guard
closes the process-creation/assignment crash gap. Inner cleanup terminates all
descendants and queries active-process count until zero before writing its
terminal receipt. Ordinary source completion cleans lingering descendants too.
Stop, timeout and shutdown close the private control pipe. Unexpected Node death
is observed by pipe EOF and an opened Windows owner-process handle. Supervisor
crash closes its kernel job handle. Unsupported JobObject assignment fails closed
before source executes; Windows systems that deny nested jobs need qualification.

POSIX uses an owned fresh process group with stdin EOF, SIGKILL and a main-child
wait. This excludes descendants that deliberately create other groups/sessions.
**POSIX/macOS execution qualification NOT_RUN on this Windows machine.** Windows
fixtures establish neither POSIX behavior nor remote SSH behavior. These controls
manage normal process lifecycle; they are not a hostile-code security sandbox.
There is no `taskkill`, PID enumeration, or signalling of stored/reused PIDs.

All child listeners attach before the first persistence await. Final observation
waits for `close`, pending log reads/writes and a job-ID-matching tree-cleanup
receipt. An early spawn error becomes actionable failure. Missing supervisor
receipt becomes interrupted, never invented completion. Persisted active jobs on
reopen become interrupted; source is never redispatched, and a persisted PID is
cleared without being signalled. A hard kill can prevent the last receipt even
when kernel-owned children are gone. Reconciliation cannot infer success from
that absence. Shutdown drains pending starts, owned supervisors and writes before
returning; persistence errors are surfaced.

The existing job table retains code/sourceRevision/profileRevision/workspace/
operationId/status/logs/pid/start/end/exit fields, with immutable source hash,
localFingerprint, computeAttempt target revisions, limit/deadline, previous
attempt and cleanup evidence added. Output is real stdout/stderr, with a bounded
200000-byte tail in domain state. Full supervisor log and receipt live under
`dataDir/jobs/<id>/`; source writes ordinary files in the project workspace.
They are not automatically declared verified common artifacts. Link/register
actual output bytes through the artifact owner. Environment inheritance is
limited to machine runtime/path/temp entries, not all account environment secrets.

## Compute UI and HTTP contracts

Mount default export `Compute` with **`{t,state,projectId,run,busy}`**; no App or
stylesheet change was made. It inherits existing Field/Heading/Badge/form/theme
contracts and resets local selection on project change. `run` is the established
App wrapper that displays errors and refreshes canonical state. `t(th,en)` is the
existing translation function. Saved form revisions are retained; stale drafts
cannot silently overwrite changes, including Health observations. Reload saved
target is an explicit action. Unsaved settings block Start until saved/reloaded.

Exact POST `/api/compute/` suffixes:
`configure`, `health`, `start`, `status`, `logs`, `stop`, `reconcile`, `lifecycle`,
`export-notebook`, `import-result`, `link-artifact`.
Dispatch `colab-mcp` to the official adapter, including existing jobs by their
recorded attempt kind rather than current profile selection.

Forms implement the exact configs from `worker-compute.md` and
`worker-colab-mcp.md`: local, strict owner SSH, existing Jupyter, existing Vast/
Runpod with an SSH/Jupyter executor, owner-interactive Colab and official hosted
Colab MCP. No arbitrary commands, paid-resource creation, model/account login or
plaintext secret entry. GUI guides machine `*Env` reference names only. Existing
OS-vault consent/refresh UI remains the lead's separate credential-owner work.
Target selection supports project default or an existing phase override; execution
also accepts the explicit selected target. Notebook editing stays lead-owned.

Controls expose actual attempts/status/logs/Stop, immutable source/config/environment
revisions, explicit fresh restart and source-qualified SSH/Jupyter checkpoint
resume (server validates qualification). Unknown/interrupted/owner-imported states
carry truthful copy. Hosted Colab cannot resume; interactive Colab import is a
saved ipynb with outputs, never labelled automatically attested execution.
Export uses returned notebook bytes and a transient browser download URL only.
Resource Start/Stop is separate, explicit and warns about existing-resource charges;
no lifecycle request was made against a real service.

Colab file routes are POST `/api/compute/colab/`:

| Suffix | Browser body beyond projectId/jobId/operationId |
| --- | --- |
| `upload-artifact` | `artifactId, relativePath` |
| `download-artifact` | `relativePath, sha256` |
| `reconcile-transfer` | `operationId` (project-scoped; no jobId required) |

The lead must resolve upload artifactId to verified same-project bytes and inject
those bytes into the adapter privately. Browser bodies never contain a localPath,
Buffer or byte payload. Publish a verified downloaded internal localPath through
the common artifact owner. Ambiguous transfer/start operations retain their ID
for a safe replay/reconcile; UI does not automatically regenerate an operation
after a transport error.

## Developer verification and remaining integration

Windows, Node 24.19.0, Python 3.12.10, installed pinned dependencies via
`npm.cmd ci --ignore-scripts`; no manifest/lock modification.

```text
node --test tests/jobs-lifecycle.test.mjs tests/jobs-ui.test.mjs tests/compute-ssh-worker.test.mjs tests/colab-mcp.test.mjs
npm.cmd run build
node --check app/server/jobs.mjs
python -c "import ast,pathlib; ast.parse(pathlib.Path('app/jobs/runner.py').read_text(encoding='utf-8'))"
git diff --check
```

**22/22 targeted tests PASSED**, zero skipped: 8 new real local lifecycle tests,
1 new Chromium/HTTP/SQLite UI test, existing 12 Colab fixtures and 1 SSH supervisor
fixture. Local tests cover actual Python stdout/stderr/files/failure, concurrent
operation replay with exactly one effect, immutable source, local override and
revision conflicts, admission, early spawn error, setup-stop and completion-stop
races, Stop/timeout/shutdown and normal-completion descendant cleanup, Node-owner
SIGKILL with delayed-effect canary, reopen/no redispatch and stale PID avoidance.
All process kills target a just-spawned fixture ChildProcess, never unrelated
machine processes or stored PIDs.

The GUI fixture mounts the actual new module through Vite, uses the real store/
compute/local Python services over HTTP for Start/Stop and configuration, checks
all target-kind forms and stale-save failure, TH/EN and widths
320/375/414/768/1440, and asserts reference-only Colab transfer request bodies.
Colab transfer responses in this **GUI** fixture are labelled simulated receipts;
adapter byte/hash tests remain the dedicated Colab tests. Desktop/mobile captures
were visually inspected against DESIGN.md and incumbent tokens; no new theme or
shipping raster. Optional capture: set FORGE_JOBS_EVIDENCE_DIR before the UI test.
Production app build PASSED (existing upstream chunk-size/use-client warnings).
App does not import Compute until lead wiring; actual JSX compilation/mount is
established by the browser fixture. Impeccable detector returned no findings;
the worker performed the scoped finish review without nested delegation.

**Known integration test adjustment:** original
`node --test tests/compute-adapters.test.mjs` is **8 passed / 1 failed** because
its local setup passes `localJobs` directly and therefore sends resolvedCompute
inside input. Update that lead-owned setup to the private facade above. Its
eight nonlocal cases pass. `tests/jobs-lifecycle.test.mjs` independently verifies
the real compute/local private facade, including remote-default/local override.
This is not an all-suite pass, nor a reason to weaken the browser trust boundary.

**Lead work, not credential gaps:** production HTTP/App wiring and shared admission,
existing compute-test facade adjustment, common artifact publication of downloaded
bytes, OS-vault UI, and explicit disposition/reconciliation UX for a genuinely
interrupted local attempt. The scoped owner never fabricates a terminal state
just to unblock a fresh writer.

**Live checks NOT_RUN:** owner SSH handshake, actual Jupyter distribution,
Vast/Runpod/Google resource identity/entitlement/execution/lifecycle/file transfer,
real checkpoint restoration and POSIX/macOS process ownership. No credentials or
compute purchases were used. **HOME_UAT_NOT_RUN** independently. Fixture passes
do not certify those services, Free GPU access, arbitrary notebook dependencies,
hostile-code containment or cloud survival/cancellation guarantees.
