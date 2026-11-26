# Selectable Assistance Strategist — worker handoff

Base: `4c944bd` (`fix/research-attestation-check-work`), isolated orchestration-managed
branch `t3/add-strategist-assistance`. Work is limited to `app/assistance/**`,
`app/web/src/Assistance.jsx`, new `tests/assistance-strategist*.mjs` and this note.
No shared contracts, migrations, manifests, locks, central progress, legacy
payloads, credentials, native installation or root runtime files were changed.
No push, paid calls, live provider turns, prototype or nested agents were used.

## Implemented behavior

Owner-configured classification `roles` now accepts `strategist` in addition to
`executor` and `asst`; all subsets and explicit exclusion remain supported. The
same exact route/catalog/options validators, completeness/freshness/authentication
requirements, provenance and quality/cost utility rule apply. Neither model names
nor purported capabilities establish eligibility. Size ranks remain explicit
owner ordinals: only the existing Asst requires a greater rank than Executor.
Strategist has **no size or superiority rule**. Every selected role must use a
distinct `(connectionId, model)` pair. A policy can permit one model for several
roles, but one decision cannot assign that exact pair to two roles.

`select({projectId, taskId, operationId, constraints})` accepts these additional
constraints:

```js
{
  rolePattern: 'executor-asst', // default, including old persisted decisions
  minStrategistQuality: 0      // explicit ordinal in 0..100
}
```

Patterns are `executor-only`, `executor-asst`, `strategist-executor`, and
`strategist-executor-asst`. Existing constraint fields remain supported. The
immutable decision records the chosen pattern, all connected candidates,
rejections and classified evidence. `decision.selection` contains only selected
roles; callers must treat `.asst` and `.strategist` as optional. Executor is always
present in an executable decision. An impossible pattern returns `ask_owner`;
missing auth/catalog/capability returns `needs_setup`, with no fallback.

Loops for Strategist patterns start `ready` with `pendingRole:'strategist'`.
`advance` reserves and claims that attempt through the existing T3 owner. A
completed, reconciled Strategist reaches `awaiting_return`; the existing
`transition({action:'return', feedback, provenance, ...})` records a reviewed
bounded handoff and sets Executor pending. `reason.runId` names the exact
Strategist run. A failed/interrupted/cancelled Strategist reaches `awaiting_owner`
and cannot hand off or automatically retry. Only completed Executor work can
receive the existing human review. No domain task is automatically marked done.

Asst remains an explicitly difficult/stuck Executor escalation, only when the
pattern selected it. Strategy does not consume an Asst escalation, but every
Strategist dispatch and handoff consumes the existing attempts/steps/deadline and
reported-cost policies. Default maximum four attempts fits
Strategist → Executor → Asst → Executor. Stop, unknown submissions, reconciliation,
receipt replay, once-only native effects and SQLite restart behavior use the
existing service/store. No second runtime, store, provider turn owner or tool
permission was introduced. A role is model-work specialization; the root's new
session responsibility roles are a separate concept.

## Exact integration hooks

**No new root hook or endpoint is needed on the supplied base.** Root already
imports `validateAssistanceContext` and `assistancePrompt` from
`app/assistance/context.mjs`, invokes validation in the durable reservation and
again at final dispatch, preserves `run.assistanceContext`, and selects the exact
role route/options. Those functions now accept/describe Strategist. Keep
`assistanceContextVersion:1`: the existing envelope is unchanged and `role` can
now be `'strategist'` when the current decision/reservation permits it.

Existing HTTP operations remain:

```text
/api/assistance/{state,configure,select,create-loop,advance,reconcile,transition,stop}
```

`createLoop` derives its initial role from the immutable selected pattern, never
from a caller-supplied role. Handoff still uses `/transition` with `action:'return'`.
All revisions, project/task/bot/conversation scopes, approved plan, provider
selection and governance boundaries retain their existing meaning. The
canonical T3 prompt explicitly says Strategist proposes strategic options,
risks, acceptance checks and a handoff without approving/expanding the plan,
claiming superiority, granting tools or acting for another role.

If root adds session-role prompt data, preserve the separate current
`run.assistanceContext.role` and its exact model snapshot. Do not replace it with
the session responsibility string or let the session string override selection.
Source search found no product consumer outside this scope that assumes an
always-present `decision.selection.asst`; old tests read it only for the legacy
default pattern.

## UI and design evidence

Thai-default/English Assistance now offers all role classification combinations,
the four task role patterns, conditional minimum-quality fields, current saved
pattern and selected route/model/options/provenance, an explicit Strategist-first
creation action, reviewed handoff action, and failed-advisory recovery copy.
Asst escalation controls are absent when the selected pattern has no Asst. The
existing legacy loop title/action names remain compatible with prior smoke tests.

Impeccable context and its craft/Operate guidance were applied once. This is a
narrow extension of the existing surface, with no context repair or system-file
edits. Direction: preserve semantic VS Code palette tokens and existing field,
panel and button hierarchy; introduce role pattern before constraints, show only
selected role controls, and make reviewed handoff the sole continuation from a
completed Strategist. Existing policy editing stays in its incumbent location.
No new identity, palette, font, illustration or decorative motion was added.
Design review was conducted in-thread under the explicit no-nested-agents scope;
no independent reviewer verdict is claimed. Detector returned `[]`.

UI qualification uses production JSX/CSS with real SQLite/service commands and
injected native effects. All 15 theme palettes retained visible controls and no
main overflow at desktop; target widths 320/375/414/768/1440 were checked. Thai
default, English, labelled controls, keyboard focus, unconfigured refusal,
Strategist handoff, optional Asst absence, Executor-only operation/Stop and failed
Strategist recovery passed with zero browser exceptions. The new harness is
development-only and installs no product endpoints. Full-page captures were opened
and inspected; policy, selected route and handoff states matched current tokens
and source. It does not qualify full-app navigation, live model execution or
every color contrast in all palettes.

Local untracked evidence (regenerate with the commands below):

```text
C:\Users\siripon.sri\AppData\Local\Temp\forge-strategist-ui-cqcswx\evidence.json
C:\Users\siripon.sri\AppData\Local\Temp\forge-strategist-ui-cqcswx\desktop-strategist-handoff.png
C:\Users\siripon.sri\AppData\Local\Temp\forge-strategist-ui-cqcswx\mobile-th-strategist-handoff.png
C:\Users\siripon.sri\AppData\Local\Temp\forge-strategist-ui-cqcswx\failed-strategist.png
C:\Users\siripon.sri\AppData\Local\Temp\forge-strategy-gui-ggyseL\evidence.json
```

## Verification

Windows Node `v24.19.0`; dependencies reused through an ignored worktree-local
`node_modules` junction to the installed project dependencies. No install or lock
change. `pnpm` is absent on this shell, so the existing npm build script was used.

```text
node --test tests/assistance-selection.test.mjs tests/assistance-workflow.test.mjs tests/assistance-strategist.test.mjs tests/adaptive-selection.test.mjs tests/adaptive-loop.test.mjs tests/adaptive-context.test.mjs tests/context-integration.test.mjs app/web/tests/boundaries.test.mjs
node app/web/tests/strategy-smoke.mjs
node tests/assistance-strategist-ui.mjs
npm.cmd run build
git diff --check
```

The scoped suite passes 64 checks, including 13 new Strategist tests. Real SQLite
tests cover classification/pattern conflicts, constrained feasible triples,
Strategist→Executor and optional Asst flow, human review, failed strategy,
replay/reopen, unknown Stop, attempt/step/reported-cost limits, current
catalog/account/plan/task/policy changes and legacy persisted decisions. Two
tests use the actual `createT3Service` with **injected native transport** to verify
exact supervised model selection/prompt and final refusal when Stop, plan
revocation or catalog change occurs during asynchronous preparation.

Both GUI smoke commands pass. Build passes, with existing dependency `use client`
and large-chunk notices. No native Research suite was run, per root's active
heavy-job coordination request.

## Remaining implementation and live limits

No known implementation gap remains in this assigned Strategist slice. Root
integration/cherry-pick and its session-role changes remain root-owned. Pattern
selection is explicit before loop creation; changing a current pattern requires
Stop/reconcile and a fresh decision/new loop. The existing five-minute decision/
catalog freshness rule still applies. No automatic strategic-quality evaluator,
role-turn driver, price estimator or inferred model hierarchy is claimed.

Separate external qualification: `LIVE_ASSISTANCE_NOT_RUN`, empirical quality
improvement `NOT_ESTABLISHED`, `HOME_UAT_NOT_RUN`. These are not substitutes for
missing implementation. No live accounts, credentials or paid model calls were
needed for the developer checks above.
