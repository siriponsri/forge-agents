# Strategy GUI worker

Scope: new `app/web/src/Adaptive.jsx`, `Assistance.jsx`,
`app/web/tests/strategy-smoke.mjs` and this note only. Base `9e1f6b9`.
Development model: `gpt-6.1-sol`, xhigh. No provider execution authorized.

## Design lock before implementation

Product-app register; reuse the existing FORGE workbench and its VS Code / Primer
style of explicit settings and execution history. The existing root `DESIGN.md`
is authoritative. Reuse `Field`, `Heading`, `Badge`, `Empty`, `Json`; existing
`panel`, `form-grid`, `toolbar`, `actions`, `help`, `code` classes and semantic
`--paper`, `--ink`, `--muted`, `--line`, `--input`, `--accent`, `--focus` tokens.
Typography, radii, focus, reduced-motion and responsive stacking come from the
existing stylesheet. No independent palette, stylesheet or design-system change.
Use native labelled inputs, fieldsets and buttons; announce loading/errors/results.
Manual selection precedes explicit loop creation and each execution action.

## HTTP seam

Default component props: `{t,state,projectId,run,busy}`. Lead mounts/routes them.
All endpoints use POST. Reads: `/api/adaptive/status` `{projectId}` and
`/api/assistance/state` `{projectId}`. Catalog: `/api/providers/catalog`
`{projectId,connectionId}` returning the existing `{catalog,identity,stale,error}`.
Mutations use `/api/{adaptive,assistance}/<action>` and exact service object
arguments plus `projectId,operationId`. `create-loop` maps to `createLoop`.
Adaptive actions: select/candidate/evaluate/promote/rollback/create-loop/advance/
stop/reconcile/resume. Assistance: configure/select/create-loop/advance/transition/
reconcile/stop. Expected revisions and expectedPolicyId use the draft/record that
populated the form, never a silently refreshed revision.

## Implemented surfaces

Owner answers in the assignment supersede the pending status in
`ASSISTANCE_STRATEGY.md`: all models on enabled connected providers; explicit
quality/cost balance; Executor first; larger Asst only for difficult/stuck work.

`Assistance.jsx` implements model rows from exact observed catalogs, explicit
exclusion/role classifications, blank unknown size/quality ranks, unknown cost
rank, optional sourced monetary cost, per-row and policy provenance, typed
catalog option values (including booleans), weights and unknown-cost preference.
Saved options that disappear from a catalog are called out and removable. No
model IDs/options, empirical quality, parameter counts or prices are synthesized.
Unobserved saved classifications remain visible and retained in the policy.

Manual task selection persists decisions and displays selected routes, options,
ordinals, utility, candidates, constraints, issues and provenance. `ask_owner`
and `needs_setup` block loop creation. Limits include attempts/escalations/steps/
elapsed time and the service's optional reported-cost policy. Explicit loop
commands cover dispatch, reconcile, stop, saved-difficulty/stuck escalation,
reviewed return and human review. Role attempts retain exact context, stable
operation IDs, run IDs, observed executed model/cost (unknown when absent), T3
thread/provider run IDs and actual loopback thread URL when supplied. No URL is
guessed. Asst advice never approves the domain task.

`Adaptive.jsx` implements manual skill/candidate selection; bounded stage actions;
stop, reconcile and explicit original-reservation replay/resume; immutable skill
candidates with source evidence pickers; paired evaluation check builders; passed
evaluation promotion; lineage-checked rollback. Evidence is selected from existing
project run/artifact/verifier records. Artifact hashes come from stored artifacts;
browser input cannot create a verifier receipt or execute a generic check script.
The real service rechecks scope, skill context/version, revision, receipts and
actual bytes. No generic skill-update endpoint is used.

Both components preserve server revision gates. Policy forms retain their
original expectedPolicyId; candidate/evaluation drafts retain their original
skill revision. Background refresh never silently authorizes an old draft with
a newer revision. Successful command results update local state inside the
callback passed to `run`; a null result after the parent's error catch is never
treated as success. Unknown HTTP outcomes retain the exact command and operation
ID in per-project sessionStorage across page reload, require manual inspection/
acknowledgement, and never automatically replay or dispatch. Service-level unknown
loops require reconcile; Stop remains available. There is no automatic role driver
or difficulty detector in this UI.

Helpers exported by `Assistance.jsx` are shared by `Adaptive.jsx`; integrate both
files together. Mount with the selected project scope, preferably `key={projectId}`.
No shared App, route, stylesheet, manifest, migration, backend, progress or legacy
file was changed. New controls reuse the existing theme and accessible form primitives.

## Developer verification

Run `node app/web/tests/strategy-smoke.mjs`. Optional `--serve` opens a disposable
loopback manual harness (Ctrl+C closes it), without changing production routes.
Existing installed dependencies were reused through an ignored `node_modules`
junction; no install, dependency, manifest or lockfile edit was needed.

Qualification: **GUI_WIRE_CONTRACT_REAL_SERVICES_INJECTED_T3**, PASSED.
The harness mounts the actual components, uses actual disposable SQLite stores,
actual adaptive/assistance services and the existing provider catalog validator.
The catalog and T3 lifecycle are explicitly injected engineering fixtures, as
labelled in the page and test output. HTTP bindings in the harness are test-only;
they do not establish the production authenticated HTTP boundary or T3 admission.

The browser pass covered all 20 POST paths, including catalog reads; unconfigured
ordinals; ask_owner/needs_setup dispatch blocking; exact boolean options; weights/
provenance; null cost surviving read/edit/save; stale-policy 409 retaining entered
draft text; Executor→Asst→Executor reviewed handoff and stop; unchanged project
model and task status; accepted command with unavailable response retaining its
operation ID across reload without dispatch; adaptive plan/dispatch/stop/resume/
revise/reconcile/inspect/human-review; paired actual artifact-byte evaluation,
promotion and rollback; loading/read-error screenshots; both components at
320/375/414/768px without main-content overflow; Thai switching, keyboard focus,
one H1, labelled inputs and zero browser exceptions.

JSX transpilation and test syntax checks pass. This isolated checkout's shared
App has no component mounts or API routes, so a full integrated application flow
is not claimed. The test harness compiles and renders both components through
Vite. Shared T3 preview was also opened and snapshotted; its frame capture was
intermittent, while Playwright captured all automated evidence reliably. Preview
tab and temporary manual harness were closed after inspection.

Local evidence directory from the latest completed browser pass:
`C:\Users\siripon.sri\AppData\Local\Temp\forge-strategy-gui-H6vn2P`.
It contains `evidence.json`, desktop/mobile screenshots, loading, read-error,
uncertain-outcome and stale-policy screenshots. This is disposable engineering
evidence, outside the tracked product. This pass includes the final catalog-option
warning and editable monetary-cost fields.

Design reconciliation: product-app / existing FORGE VS Code tokens; implemented
forms and trace; native keyboard/label/heading checks passed. SEO is N/A for this
local product surface. Automated axe audit was not run (no existing axe dependency);
full accessibility qualification remains partial, rather than claiming zero axe
violations. No new styling system or visual assets were introduced.

## Lead integration and separate qualifications

**Implementation integration remains lead-owned:** mount navigation/components,
bind the exact POST methods above under the real loopback/session/CSRF boundaries,
and complete the actual T3 selected-route/context and reciprocal loop admission
contracts from `worker-assistance.md` / `worker-adaptive.md`. Provider Check/Refresh
and credential setup use the existing provider surface; this UI only reads its
catalog and explains that next action. Validate the mounted app after integration.
The generic skill-edit bypass must remain closed at the shared backend boundary.

These are integration gaps, not missing live credentials. Separate qualifications:
**LIVE_PROVIDER_NOT_RUN**, empirical quality improvement **NOT_ESTABLISHED**,
**HOME_UAT_NOT_RUN**. No credential access/migration, external provider turn,
cloud compute, public service, prototype, push, main update or PR was performed.
