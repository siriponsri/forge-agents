# Parallel Workspace worker handoff

Date: 2026-11-25, Asia/Bangkok. Worker branch: `t3/parallel-workspaces`.
Development model: **gpt-6.1-sol**, inherited **xhigh** reasoning effort, as
reported by the current T3/Codex runtime and the lead assignment. No model or
provider was switched. No live model call was made by the engineering fixtures.

## Delivered within assigned paths

- `app/workspaces/`: durable isolated Git workspaces, strict context validator,
  trusted checkout resolver, capacity admission, lifecycle and integration queue.
- `app/web/src/ParallelWorkspace.jsx` and `parallel-workspace.css`: Thai/English
  no-code controls using existing themes, canonical tasks, actual run/attempt
  identities, check output, conflicts, Owner review and local merge receipts.
- `tests/workspaces*.test.mjs`: actual disposable repositories, worktrees,
  branches, commits, Node test processes and persisted/reopened SQLite state.
  **Only T3 execution is injected**, explicitly labelled `INJECTED_T3_NOT_LIVE`.

No shared domain, migration, admission, T3, manifest, lockfile or progress file
was changed. Protected portable payload/runtime/adapters were not touched.
There is no second planner, provider client, model executor or task database.

## Lead integration: required implementation work

The worker deliberately does **not** advertise `workspaceContextVersion` on T3.
The GUI disables Start until the fully wired T3 service exposes version 1.
These shared changes belong to the lead, and are implementation work rather than
missing live credentials:

1. Import exports from `app/workspaces/index.mjs`. Construct
   `createWorkspaceService({store,dataDir,t3,authorize:authority.authorize})`;
   call `recover()` once at startup after T3 recovery and `close()` on shutdown.
2. In T3's authoritative reservation, call `validateWorkspaceContext(s,input)`;
   retain the returned exact context on the canonical run. Compare its digest
   on operation replay, together with all existing context comparisons.
3. Call central admission with **full input** (`projectId`, `taskId`,
   `operationId`, `workspaceContext`, and `runId` on dispatch). The isolated
   branch calls `assertIsolatedWorkspaceAvailable`; ordinary dispatch retains
   every existing strategy/goal/compute/desktop admission guard. Ordinary work
   also fences active `workspace.workspace` records in `admitting`, `running`,
   `unknown` and `stopping`, including the gap before a canonical run exists.
4. Before dispatch, repeat context/admission checks and await
   `resolveWorkspaceForRun({store,input,dataDir})`. Its trusted result is
   `{workspace,branch,baseSha,sourceHeadSha,workspaceId,context}`. Register and
   select the T3 project using **this actual worktree path**, never the original
   project folder. Use this path in the base message and append
   `workspacePrompt(resolved)`. Repeat checks after awaited setup/context work.
   Existing run cancellation, provider selection, capability, plan, bot and
   revision checks remain authoritative. Only then expose version 1.
5. Mount the component with `{t,state,projectId,run,busy}`, navigation and private
   HTTP routes below. Add `workspaces` to the shared browser `ownerHeaders`
   mutation path matcher so the existing CSRF token is sent.
6. Run integrated T3/HTTP/GUI checks. Keep active shared desktops single-controller.
   Workspace file isolation grants no new desktop, network or provider permission.
7. Before metadata restore, call `assertWorkspaceRestoreAvailable(s)` in the
   shared busy guard, including the pre-run admission gap. Inside the existing
   `artifacts.restore` transaction call `mergeWorkspaceSafety(restored,s)` before
   assigning the restored snapshot. It preserves acknowledged workspace effect
   events/receipts and exact owned run identities, like the existing memory
   tombstone and relay authority preservation. Historic-only workspaces become
   non-dispatchable; an old backup cannot erase accepted run identities.

`validateWorkspaceContext` expects T3's existing task admission increment:
before reservation the task revision equals the frozen workspace task revision;
after reservation it is `run.approvalSnapshot.taskRevision + 1`. Definition,
plan, bot, profile and original root must still match. Paths in client context
are forbidden. Resolution verifies the path, real ancestor identities, Git
common directory, registered worktree, owned branch, clean base and ancestry.

Mixed goal/adaptive/assistance/relay/proactive contexts and conversation dispatch
are rejected with `WORKSPACE_CONTROLLER_CONFLICT` until a real composable
authority contract exists. Existing controllers are never silently disabled.
Canonical dependencies remain ordered. Goal admission still validates its own
canonical task ownership even on a proposed isolated route.

## Private HTTP contract

Authenticate the existing local Owner browser session for **all** routes. For
mutations require its existing CSRF token as well. Pass the opaque
`authority.owner(session)` handle; JSON actor labels grant no authority. GUI read
first bootstraps `/api/session`; state reads never dispatch or recover effects.

`dispatchWorkspaceRequest(service,action,input,caller,{httpMethod})` enforces this
exact allowlist and exact top-level keys. No model-facing MCP endpoint exists.

| Verb/path | Input |
| --- | --- |
| GET `/api/workspaces/state?projectId=...` | `projectId` only |
| POST `/api/workspaces/configure` | common + `maxConcurrent`, `providerLimit`, `checks` |
| POST `/api/workspaces/create` | `projectId`, `operationId`, `taskId`, `expectedTaskRevision` |
| POST `/api/workspaces/start` | common + `workspaceId` |
| POST `/api/workspaces/reconcile` | common + `workspaceId` |
| POST `/api/workspaces/stop` | common + `workspaceId` |
| POST `/api/workspaces/check` | common + `workspaceId` |
| POST `/api/workspaces/review` | common + `workspaceId`, exact `head` |
| POST `/api/workspaces/enqueue` | common + `workspaceId`, exact `head` |
| POST `/api/workspaces/prepareIntegration` | common + `integrationId`, exact `targetHead` |
| POST `/api/workspaces/checkIntegration` | common + `integrationId` |
| POST `/api/workspaces/approveIntegration` | common + `integrationId`, exact `targetHead`, exact candidate `head` |
| POST `/api/workspaces/integrate` | common + `integrationId`, exact `targetHead`, exact candidate `head` |
| POST `/api/workspaces/reconcileIntegration` | common + `integrationId` |

Common fields are `projectId`, `operationId`, `expectedRevision`. All unsupported
actions, verbs and fields fail closed, including arbitrary service method names.
Configure revision starts at 0 and advances monotonically. A policy explicitly
sets both capacity ceilings; neither is inferred from CPU/model/provider names.
The GUI's initial suggested ceiling is 1 and requires an explicit Save. Unknown
attempts occupy capacity. `checks` requires `diff`, with optional `node-test`.
Node checks run project code with the existing machine permissions, require at
least one actual test and do not imply a hermetic or security sandbox.

## Durable records and recovery

Uses existing `events`, `runs`, tasks, plans and `receipts`, with no schema change.
`workspace.workspace` freezes source/base/head, source repo/common-dir identity,
task/plan/bot revisions, signatures, profile digest, required checks and branch.
`workspace.operation` durably reserves exact request fingerprints before effects.
Retries with the same operation return its existing result or unknown reservation;
changed input fails. A workspace permits one exact canonical run operation only.

Recovery marks pending admissions/operations unknown and performs no dispatch,
creation, merge, cancellation or retry. Explicit reconciliation observes existing
Git/T3 state. Stop persists intent first and can invalidate an awaited admission;
only the exact owned canonical run/attempt can be stopped. Missing/foreign run
identities are never guessed. Unknown external outcomes retain their reservations.

Machine worktrees live under `dataDir/parallel-workspaces/<UUID>/checkout`, outside
the output repository. Existing directories/branches are never reused or forced.
Linked ancestors and mismatched repository/path/branch registrations fail closed.
The implementation has **no deletion, reset, clean, force checkout or push path**.

## Integration semantics

Each queue item freezes exact candidate base/head, passing check evidence and
Owner review. Preparation accepts the exact latest integrated head (initially
the original source snapshot) and creates a separate owned integration branch.
The original source head moving makes the proposal stale. Candidate changes,
dirty files, shifted targets or failed checks stop progress before acceptance.

The queue merges with `--no-ff --no-commit`, retaining actual conflict files/index
in its integration checkout on conflict. The Owner can resolve and stage those
files explicitly, then request combined checks again. Required checks execute
against the combined working tree. The stage/tree, heads and evidence digest are
bound to a separate Owner approval. Integration creates only a local merge commit
on the owned integration branch and verifies both exact parents and approved tree.
The user's original branch/index/working files remain unchanged; publication or
promotion of the result is a separate Owner/lead action. No automatic push.
Lost commit acknowledgements can be reconciled by matching actual parents/tree
to durable approval, without creating another commit.

## Developer evidence

Windows, Node **v24.19.0**, Git **2.54.0.windows.1**.

- Real-Git principal suite: **16/16 passed**, no skipped tests, 196.6 seconds.
  Includes pending-admission Stop, staged original index preservation, linked
  paths, monotonic policy revisions, global provider ceilings, missing context,
  stale canonical definitions and lost merge acknowledgement recovery.
- Additional metadata restore/SQLite/restart regression: **1/1 passed**. The
  retained accepted attempt cannot be dispatched again after an older snapshot.
- Focused final conflict-resolution check: **1/1 passed**, repeated coverage
  confirming the retained conflict clears after explicit staged resolution and
  fresh combined verification. This is not an additional unique test case.
- Scoped component JSX/CSS **browser bundle passed**, `esbuild` with
  `bundle:true, write:false`; no generated files written or dependency changes.
- `node --check` passed for every workspace module.
- The prepared worktree has no installed dependencies. Tests use a read-only
  Node ESM resolution hook falling back to the lead checkout's existing installed
  dependencies. This leaves source/lockfiles unchanged. With local dependencies
  installed, the ordinary command is `node --test tests/workspaces.test.mjs`.
- Verification initially caught Node inheriting `NODE_TEST_CONTEXT` and skipping
  nested tests. The runner now removes that variable, requests TAP, and requires
  a positive test count. A deliberately failing real Node test is blocked.

One observed successful actual fixture (not a live model run):

- Base: `0bf89f664e33a064c69bc0037871ae172c3ea7f7`
- Independent alpha change: `0437f79c86e2de683bdcef38ae96aa7c55a99452`
- Independent beta change: `88447662a08417a15476c45e37c358c8a21fdfb5`
- Checked combined merge: `1a9f06de56e97b2ba4f6ac4012d8ae3df2df0854`
- Both actual task tests were present and passed in the combined checkout.
- Original branch, HEAD, staged index, tracked dirty bytes and untracked draft
  were checked for preservation. Disposable fixture paths are printed by tests.

## Qualification and limits

- **LEAD_T3_HTTP_GUI_WIRING_REQUIRED** in this worker branch; do not advertise
  integrated isolated execution until the lead completes and tests those hooks.
- **LIVE_PARALLEL_MODEL_RUN_NOT_RUN**: T3 lifecycle fixtures are not evidence of
  simultaneous live provider turns, entitlement or available capacity.
- **HOME_UAT_NOT_RUN**. No credentials were migrated, compute purchased,
  CA-EWS/prototype activated, public service exposed, or branch pushed.
- Current check choices are Git diff and real Node tests. Other languages/test
  runners need an additional bounded trusted verifier contract rather than
  accepting arbitrary HTTP commands. Worktrees are file isolation, not an OS
  sandbox. Conflicts need explicit resolution in the retained checkout.
