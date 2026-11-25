# SuperUser adoption: scoped worker handoff

Date: 2026-11-25. Branch: `t3/add-superuser-playbooks`, base `940e0b5`.
Actual worker runtime: inherited `gpt-6.1-sol` / `xhigh`; no model switch.

## Implemented within assigned paths

- `app/playbooks/`: five compiled, original FORGE presets (software delivery,
  research with sources, independent split/merge, review/critique and bounded
  improvement). Loop/Graph/Dynamic are descriptive metadata pointing to existing
  owners, not another execution loop, scheduler or task store.
- Canonical `events`/`receipts` persist workflows, immutable five-part brief
  versions, exact command replays, Mission materialization references, versioned
  evidence-linked Owner observations and procedural lesson references.
- `WorkflowPresets.jsx` / `workflow-presets.css`: TH/EN brief/decision forms,
  reviewed Mission output definitions, explicit draft materialization, observed
  verification selection, findings and draft lessons. Project-keyed remounts drop
  private draft forms. Uses the existing `useStrategy` hook and actual App
  `run(async () => request(...))` callback contract, including null on failure.
  Source limits and unresolved decisions show actionable constraints.
- Lessons use the injected existing scoped `memory.remember` API as procedural,
  unverified, non-executable project drafts. They return the existing
  `Memory.proposeLesson → Adaptive candidate/evaluate/promote` path. This worker
  never calls candidate/promotion or rewrites a skill.

The lead's read-only `docs/requirements/SUPERUSER_ADOPTION.md`, root AGENTS,
Complete Local v3 core documents/current progress and existing Mission,
Goals/Assistance/Adaptive/Memory services supplied the implementation context.
The archive was not installed, executed or vendored. Original FORGE metadata and
code implement the accepted concepts. No archived model defaults, account caps,
palette corpus, hooks or agent settings were copied. No credentials, provider
turns, external messages, purchases, public services, prototype activation or push.

## Exact service/HTTP contract for lead integration

```js
import { createPlaybookService, dispatchPlaybookRequest,
  PLAYBOOK_HTTP_METHODS } from './app/playbooks/index.mjs';

const playbooks = createPlaybookService({
  store, missions, memory, adaptive,
  authorize: authority.goalAuthorize,
});
// Host validates private Owner session, CSRF, body size and restore admission.
const result = await dispatchPlaybookRequest(
  playbooks, method, input, authority.owner(session),
);
```

Only `presets`, `state`, `create`, `revise`, `materialize`, `review` and
`proposeLesson` belong to the HTTP allowlist. The dispatcher and each method
reject unexpected JSON fields. Every method requires an opaque trusted caller;
the authorizer receives `{action:'playbook',projectId,workflowId?,expectedRevision?}`
and must return `{kind:'human',role:'owner',subject}`. Existing
`authority.goalAuthorize` supports this. Forward the **same opaque caller** to
Mission and Memory. Never construct authority from body fields. Domain errors
use `statusCode`; Memory errors can use `status`.

| Method | Exact input fields |
| --- | --- |
| presets / state | `projectId` |
| create | `projectId, operationId, presetId, title, brief, decisions` |
| revise | `projectId, operationId, workflowId, expectedRevision, title, brief, decisions` |
| materialize | `projectId, operationId, workflowId, expectedRevision, definition` |
| review | `projectId, operationId, workflowId, expectedRevision, evidence, findings` |
| proposeLesson | `projectId, operationId, workflowId, expectedRevision, reviewId, title, procedure` |

`brief` has exactly five required bounded strings: `objective`, `inputsScope`,
`acceptance`, `interfacesDependencies`, `risksDecisions`. `decisions` is an explicit
array of `{id,question,answer}`, with blank answers representing unresolved work.
`definition` is the existing reviewed Mission definition; objective and explicit
brief decisions must match. All decisions must be resolved to materialize.

`evidence` is 1..12 `{runId,attemptId,artifactId,verificationId}` groups.
`findings` is 1..24 `{label,text,evidenceIndexes}`; labels are only `observation`,
`risk`, `blocker`, `question`. A finding is never a QA verdict. Reviews require
the current linked Mission definition, canonical Goal/task/attempt context,
completed run with observed provider/model selection, Mission-registered output,
versioned verifier observation, actual artifact bytes and the exact verified
source/test file hashes. PASSED and FAILED verifier observations can support
findings; neither confers Owner/QA acceptance through this API.

`state` returns `{presets,workflows,briefs,reviews,lessons,materializations,
capabilities}`. `reviews[].evidenceStatus` and `lessons[].evidenceStatus` are live
`current`/`stale` projections, not persisted acceptance claims. Exact operation
replay returns its historical result even if later state changes; read `state`
for current evidence status. Finished lessons retain hashes/references rather
than another procedure text copy; their temporary recovery request is removed.

Creation/revision returns the workflow. Materialization returns
`{workflow,missionId,missionDefinitionRevision,planId,taskIds}`. Review returns its
versioned review event. Lesson success returns
`{workflow,reviewId,memoryId,memoryRevision,lessonStatus:'draft',evidenceStatus,
adaptiveRoute}`. A forgotten/edited draft recovered after a lost response returns
`lessonStatus:'unavailable'` without recreating text. A stale reserved lesson that
never committed Memory becomes a durable no-effect outcome; its exact subsequent
replay returns `{status:'stale',lessonId,reason,action}`.

Mount `<WorkflowPresets {...{t,state,projectId,run,busy}} />` in the existing App
navigation and add `/api/playbooks/` to the client Owner-header/CSRF prefix.
Use the existing shared styles; the new stylesheet is scoped to this component.
No hash navigation is assumed: the UI directs the user to the existing Missions,
Providers/Assistance and Memory/Adaptive pages by their product names.

## Persistence, replay and restore boundaries

Materialization first reserves an exact reviewed definition in SQLite, calls
`missions.create` with a stable derived operation ID, then links the canonical
draft. It never approves, dispatches or creates a Goal. A lost response can be
reconciled after restart without another plan/task. If the Owner independently
approved the visible Mission in the meantime, replay links the original create
receipt without resetting that work or dispatching anything.

Lesson reservation similarly calls `memory.remember` with a stable operation ID.
A fresh write rechecks exact review evidence. An already committed draft can be
linked after a lost response using its original source snapshots; this creates no
new Memory even if later recovery changes Goal metadata. Forget/edit cannot
resurrect the original procedure. In-process duplicate continuations coalesce.
New operation IDs against a reserved workflow fail `RECONCILE_REQUIRED`.
`state` includes the reservation's original `request` for the explicit
**Recover exact request** button. No replay happens automatically on UI mount or
server startup.

Host-only lifecycle methods (never publish as HTTP/MCP methods):

1. On restore admission, `await playbooks.suspendForRestore()` before restoring
   the shared store; it fences new work and drains active continuations.
2. After the canonical restore, `await playbooks.afterRestore()` alongside the
   existing Mission/Memory/Goals safety hooks. Every workflow requires a fresh
   reviewed brief revision. Reserved effects become durable `unknown` outcomes;
   original replay cannot create a new effect. Inspect Mission/Memory records.
3. `playbooks.cancelRestore()` releases suspension after the host completes its
   restore barrier, including the abort path.
4. `await playbooks.close()` before closing the injected services/store.

No startup recovery method is needed: pending effects remain visible and require
explicit exact replay. Existing `goals.recover()` changes Goal revision, so an
exact historical review can truthfully become stale after restart; submit a new
review for a new lesson. Already committed lessons remain unverified drafts.

## Developer evidence

Windows, Node `24.19.0`, real SQLite and Chromium. Existing installed dependencies
were reused through an ignored local `node_modules` junction to the lead root;
no manifest/lockfile changed.

- `node --test tests/playbooks*.test.mjs tests/missions.test.mjs tests/memory-core.test.mjs`
  — **32/32 PASS** (13 new Playbooks/component tests + 19 existing tests).
  Tests include actual SQLite close/reopen, scope/authority, stale revisions,
  decision gates, exact/concurrent/lost-response replay, canonical draft linkage,
  zero dispatch on preset/materialization, actual node verification, file/test
  tamper, exact record revisions, no forged QA/Owner acceptance, draft-only
  Memory, forgotten Memory non-resurrection and restore fencing.
- `node --test tests/playbooks-ui.test.mjs` after the CSS/size-hint change —
  **2/2 PASS**. The actual component and scoped CSS run in a real browser against
  the disposable service adapter. Covers create/revise/materialize, TH/EN,
  a 390px viewport without horizontal overflow, project form separation and the
  actual App callback returning null on failure without manufacturing success.
- `node node_modules/vite/bin/vite.js build app/web --outDir dist` — **PASS**,
  29.93s. Existing dependency `use client` and chunk-size warnings remain.
  `pnpm` was absent, so the installed Vite CLI ran the exact build script.
  The worker App does not yet mount this new surface; component compilation and
  browser checks above exercise it directly. Lead must rerun the integrated build.
- `git diff --check` — **PASS** before staging; final staged whitespace check is
  required at commit.

Engineering execution observations are explicitly injected and labelled;
provider/model quality is **NOT_RUN**. Browser HTTP wiring is a labelled component
fixture, not proof of production session/CSRF enforcement.

## Lead-owned work remaining

Implementation within assigned worker paths is complete. Production service
construction, bounded HTTP route, Owner/CSRF/admission integration, App navigation,
restore/shutdown wiring, combined real application journey, final screenshots/GIFs,
README, central progress and release remain **INTEGRATION_NOT_RUN** here because
those paths belong to the lead. No live credentials are needed for this metadata
layer; live provider execution/catalog qualification and **HOME_UAT_NOT_RUN**
remain distinct from those integration tasks.
