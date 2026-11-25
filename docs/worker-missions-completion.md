# Mission + Delivery Pack implementation handoff

2026-11-25. Worker branch `t3/forge-missions-delivery-pack`, prepared base
`4e8ebd3`. Actual execution model **gpt-6.1-sol**, reasoning **xhigh**, inherited
from the delegated T3 run. No model switching, child agents, shell checkouts,
provider sign-in, credential migration, purchases, deployment or push.

## Delivered within assigned files

- `app/missions/`: strict object APIs, opaque private Owner/QA authorization,
  Mission brief/decision/version records in canonical SQLite events and receipts.
  Creates canonical unapproved Plan/Tasks; explicit Owner approval creates an
  existing manual Goals record. Resume/advance/pause/cancel/reconcile/QA/review
  call the existing Goals/T3 owner. No second planner, database or provider loop.
- `app/web/src/Missions.jsx` default component with
  `{t,state,projectId,run,busy}`; scoped CSS. TH/EN form, answer revisions,
  canonical plan review, actual run selection, file registration, command review,
  test results, preview, independent QA, Owner review and ZIP links. Project switch
  clears private selection/draft/review state. Lost-response recovery retains the
  exact operation input rather than allocating a new attempt.
- Actual output bytes, SHA-256, canonical task/plan signatures, selected source
  checksums, observed local Git HEAD/dirty qualification when available, exact
  run/attempt/provider/model/options and versioned verification records.
- Local verifier runs only the fixed Node executable with explicit reviewed
  JavaScript test filenames (`node --test --test-concurrency=1 -- <files>`), no
  shell/package scripts/install or model process. Environment omits provider
  secrets and Node options. 30-second/256-KiB-output limits; Windows uses the
  **existing `app/jobs/runner.py` WindowsTree JobObject driver** through the narrow
  Mission Python supervisor. The same driver provides POSIX owned-group cleanup.
  Deliberate POSIX group escape and hostile code isolation are not qualified.
- Static preview serves immutable registered-file byte snapshots on ephemeral
  `127.0.0.1`, exact Host, unguessable path, 10-minute expiry, explicit Stop.
  CSP sandbox blocks forms and network connections; only selected registered
  outputs can be served. No server-side application commands/package scripts.
- Portable ZIP contains selected output/test/source files, manifest, checksums,
  provenance, actual test outcomes, QA and Owner records, explicit unverified work.
  Deterministic ZIP timestamps allow byte-identical upload replay. Archive and
  manifest/file checksums are revalidated on download; bounded ZIP expansion and
  undeclared/unsafe entries fail validation. Download supplies already verified
  **Buffer bytes**, avoiding a path reopen between verification and response.
- Restore hooks quiesce owned local work/previews, mark dispatched-but-unresolved
  tests unknown and require a new Owner mission revision after metadata restore.
  They do not replay tests, provider dispatches, approvals or imports.

## Lead mounting seams (shared files intentionally untouched)

```js
import {createMissionService,dispatchMissionRequest} from '../missions/index.mjs';
const missions = createMissionService({
  store, goals, t3, artifacts, authorize: authority.goalAuthorize,
});
```

Add to app services and close **before Goals/T3/store shutdown**. Call
`await missions.recover()` before serving requests. Restore sequence must include
`await missions.suspendForRestore()`, existing restore/recovery, then
`await missions.afterRestore()`, and `missions.cancelRestore()` in `finally`.
Suspend Goals as well using the existing restore lifecycle. No restore work may
begin until Mission suspension has awaited its outstanding local operations.

POST `/api/missions/<method>` calls
`dispatchMissionRequest(missions, method, input, authority.owner(ownerSession))`.
Add `missions` to **both** `api.mjs` Owner-CSRF regex and main's humanSession
regex, including `state`. Do not expose `recover`, `close`, restore methods or
caller identity in JSON. Mount default `Missions` in App using existing props.

GET `/api/missions/:packId/download?projectId=...` uses a valid existing
`browserSession` + `authority.owner(session)` (GET download anchors cannot supply
the POST-only CSRF header). Call `missions.download({projectId,packId},caller)`,
set attachment filename/content type/length and `res.end(result.bytes)`.
Retain the host/origin protections and reject absent/expired Owner sessions.
Do not serialize the path or Buffer into a JSON download response.

If the host installs CSP, allow sandboxed iframe `frame-src http://127.0.0.1:*`
for this local preview. No public binding/port exposure is needed. Python must be
available for the local verifier; missing Python returns an actual failed
verification, never a synthetic pass. To use configured Python, inject
`local:createLocalMissionTools({python:<trusted machine executable>})` from
`app/missions/local.mjs`; never take the executable/environment from a model or
request body.

## Exact request contract

`MISSION_HTTP_METHODS` exports the mount allowlist. Unknown fields fail closed.
All mutation requests have `{projectId,operationId,missionId,expectedRevision}`,
except `create` omits mission identity/revision. Returns are direct entity records
(or an existing Goal for execution/QA/review), not `{entity:...}` wrappers.

| Method | Additional fields / behavior |
| --- | --- |
| `state` | `{projectId}` only. Authenticated read; missions/outputs/packs/commandReviews/previews/capabilities. Never dispatches. |
| `create`, `revise` | `definition` below. Draft plan/tasks persist without starting work. Revisions require prior Goal quiescent and cancelled/completed/exhausted. |
| `approve` | No extras. Resolves durable pending approval using the same canonical Goal-create operation. Unanswered decisions reject. |
| `execute` | `action`: resume/advance/reconcile/pause/cancel; `expectedGoalRevision`; optional `taskId`/`conversationId` for advance. |
| `registerOutput` | `outputKey`, `runId`: exact completed existing Goals/T3 attempt with observed selection; actual files must exist. |
| `verify` | `outputKey`, `runId`, `reviewDigest` from state.commandReviews after Owner checks source/test checksums and exact argv. Durable claim prevents duplicate process launch. |
| `qa` | `taskId`, `expectedGoalRevision`; rechecks bytes/latest tests/current source, then existing independent Goals QA. |
| `review` | `expectedGoalRevision`; rechecks all outputs/tests, then existing final Owner review. |
| `pack` | No extras; requires completed Goal/QA/Owner; immutable pack record with artifactId/archive+manifest hashes. |
| `download` | `{projectId,packId}` only; authenticated read returning verified bytes. |
| `preview` | `outputKey`: registered HTML entry; only registered outputs served. |
| `stopPreview` | `previewId`: exact owned preview. |

Definition:

```json
{
  "title": "Software mission",
  "objective": "Concrete intended outcome",
  "constraints": "Scope/budget exclusions",
  "inputs": "Source material",
  "outputs": [{
    "key": "page", "name": "HTML page", "path": "index.html",
    "acceptance": "Measurable outcome checked by these tests",
    "testFiles": ["tests/page.test.mjs"], "sourcePaths": ["src/page.js"],
    "botId": null, "dependsOn": []
  }],
  "decisions": [{"id":"language","question":"Which language?","answer":"English"}]
}
```

1..12 outputs, unique simple keys/paths. Each output needs explicit JS test files.
Dependencies reference earlier output keys. No private/configuration/runtime
folders or path escapes. Only unclear/conflicting decisions need adding; selected
answers persist with the revision. Definition edits create new canonical plan and
task records while preserving prior revisions/runs/evidence.

## Developer verification

`node --test tests/missions.test.mjs tests/missions-ui.test.mjs tests/goals.test.mjs`
passed **39/39** on Windows Node **v24.19.0** against the worker base. The lead has
subsequently added a shared late-verifier Goals reconciliation fix and test;
integration rerun remains the lead's responsibility.

Evidence is explicitly **disposable engineering fixtures with injected T3
execution observations**, not a live model or new prototype:

- Actual SQLite restart and portable file bytes/checksums; concurrent/replayed
  packaging; exact provider/attempt attribution; tests/QA/final review.
- Actual HTTP static preview content/CSP and Stop; actual Node test process under
  Windows JobObject; timeout with a spawned descendant and confirmed tree cleanup.
- Message-only completion, forged reviewers/extra fields, path escape,
  cross-project bot, stale revision, unanswered decisions, source/output and ZIP
  tamper, duplicate verification claims and restore approval invalidation.
- Playwright interacted with the shipped React component against the actual
  disposable services through a labelled host-route fixture: form→decision→plan
  approval, no execution from viewing/approval, Thai project switch clears prior
  draft; no horizontal overflow at 320/375/768. English1280/Thai375 rendered
  screenshots inspected in the disposable local capture directory. These are
  component qualification captures, not public README media or the integrated App.
- Standalone Missions JSX browser bundle passed with existing esbuild; Impeccable
  detector returned `[]`. No installed dependencies or manifest/lockfile changes;
  an ignored node_modules junction reused the lead's existing dependency tree.

## Qualification and remaining work

- **Lead integration pending**: shared main/App/CSRF/restore/download mounting and
  actual built-app end-to-end browser journey. Worker paths do not mount themselves.
- Missions guards early completed-run reconciliation until local evidence exists.
  The lead reported fixing the shared Goals one-shot evaluation defect so direct
  Goals reconciliation can supersede failed verification when late trusted
  receipts arrive, retaining history and never redispatching/reopening accepted QA.
- Test coverage proves selected files and observed process outcomes, not semantic
  software correctness. Arbitrary dependency/install/server-runtime commands and
  full-project source inclusion are deliberately unqualified. Preview is static.
  Pack extraction/import never grants execution/permission/restore authority.
- Default Goals policy blocks unknown usage accounting for continuation. Owner
  policy choices remain in existing Goals; Mission does not turn unknown cost into
  zero. Provider/model options are copied from actual durable selection records.
- **LIVE_PROVIDER_NOT_RUN / MODEL_QUALITY_NOT_RUN / HOME_UAT_NOT_RUN**. The full
  product remains **IMPLEMENTATION_INCOMPLETE** until the lead's integrated gates
  pass. Missing live credentials/home UAT do not replace that implementation gate.

No shared root/server/domain/migration/manifest/progress or protected legacy paths
were edited. Lead owns integration, final release authorization and push.
