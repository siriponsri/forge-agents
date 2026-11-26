# Session UI integration verification

Branch: `t3/session-ui-integration-tests`. Initial immutable source HEAD:
`661a3f71386b2646fc6b9c31afac1b83febe2822`. Inherited Codex
`gpt-6.1-sol`, xhigh; Node `v24.19.0`, Windows. No nested delegates.
Owned additions only: this report and
`tests/product-session-orchestrator-ui.test.mjs`.

## Result and corrected source

**9 PASS, 0 FAIL** (eight behavioral subtests plus their parent); final focused
run duration 23.56 seconds. `node --check` and `git diff --check` also PASS.

The original HEAD had a real 320px Chat navigation overflow. The lead was told
immediately and supplied authorized correction
`0596d66125d0370bafc748eb798d7a04985a6ac1`. It was cherry-picked as
`43e1462c7497f57553dfb69f01cd5dabf9530751`, which is the corrected source under
the final tests. The only conflict was an import block in the lead-owned
`tests/product-session-route.test.mjs`; both incoming imports were retained.
No application fix was authored by this worker. The correction also contains
lead-owned backend/admission changes; this UI verdict does not qualify those.

Original reproduction: open the actual mounted `Chat`, keyboard-activate
**บทบาทและเซสชัน**, open the Orchestrator disclosure, set viewport to 320px.
`documentElement.scrollWidth` was **349**. The selected view button extended from
233.28 to 349.20px; the conversation panel ended at 289px with inner scrollWidth
332px. `agent-workspace.css` lacked view-switch wrapping. The correction wraps
the buttons and their text. The final suite preserves document-width AND
individual control/fieldset/panel bounds and internal-clipping assertions.
It does not conceal overflow with fixture CSS or remove the regression check.

## What is exercised

- Mount production `work.jsx` **Chat**, enter its real **Roles and sessions**
  view with Enter, then mount production **SessionRoles**, **SessionOrchestrator**
  and **Run** through that integration. No replacement component or screenshot
  imitation. Production `style.css`, themes, component CSS and bundled
  Manrope/IBM Plex Thai fonts are loaded by esbuild.
- Thai initial rendering, standalone SessionRoles' actual Thai fallback, English,
  Dark Modern and a Light Modern check. TH/EN long mixed-script names at
  **320/375/768/1440**; scoped element/document overflow checks. Native Run controls
  also fit at 320px. No uncaught browser exception or external resource request.
- Task choices exclude unapproved plans, running tasks, bots without preassigned
  Orchestrator roles and foreign-project tasks. Only bound session-role children
  appear. Changing the parent clears child approval selection. Role save updates
  real role state and the main Orchestrator's child label.
- Lost **intent-create** and **start** responses, separately: responses are dropped
  AFTER the real service commits. Reload restores sessionStorage recovery and
  blocks new edits. Replay keeps the exact original create body, and the exact
  returned intent/start operation IDs. Create and start IDs are intentionally
  different in the service. Each case reserves **one** canonical run and calls
  the injected native start once.
- Revoke a retained, unstarted approval through the UI with the original IDs;
  subsequent direct replay of the real service remains cancelled with zero starts.
- Definitive create 403 leaves selections editable; in-flight create disables
  task/parent/child/retry controls. Two synchronous real form submit events
  exercise the ref lock before React rerenders, with one start reservation.
  This is synthesized rapid double submission, not a physical-device gesture.
- Project changes clear role/prompt/task/child drafts. Pending operations stay
  project-scoped. A late create response after switching projects cannot start
  work or alter the other project's UI; returning recovers the original create.
- SessionRoles' real stale-revision rejection, acknowledgement and current-role
  recovery; real link approval, lost prompt response/same-input replay with only
  one conversation-owner send, Stop, reconcile and membership revocation. Empty
  project/no-project guidance. Uncertain prompt controls fit at 320px.
- Parent records with `sessionContext` render the existing seven Run controls.
  Reconcile/recovery/Stop buttons reach the expected existing endpoint paths and
  preserve the single parent reservation.

## Evidence limits

SQLite, domain state, role service, intent service, receipts and their opaque
fixture Owner handle are real. Browser HTTP/session admission is **Playwright
route injection**, not the actual listening HTTP/CSRF owner gate. The real API
helper's CSRF header is asserted against an explicitly injected browser session.
There is no listener. Native task and conversation owners/identities/observations
and Run-control responses are explicitly **INJECTED**. Provider/model values are
engineering fixtures. Screenshots identify this visibly. No native dispatch,
installed runtime, actual model execution, provider account or native Stop is
claimed. This is component/integration developer evidence, not an installed
runtime or full production-shell acceptance result.

The actual app `app/web/public/forge-mark.svg` and website
`apps/website/public/favicon.svg` are loaded and decoded in the browser at
64/32/16px. Both retain exact orange **#f97316**, yellow **#f2c94c** and gray
**#8b9199** fills. Inspected captured marks preserve the orange F and secondary
facets. Child labels use semantic reading ink; the yellow branch icon and gray
child borders are decorative. Scoped rendered semantic labels/help/child/action
text checks measure at least **4.53:1** across Dark/Light Modern. Logo/facet colors
and disabled controls are excluded from the text contrast threshold. This is
not an all-theme or complete accessibility audit.

## Exact captures

Original failure evidence remains separate, under:

`C:/Users/siripon.sri/AppData/Local/Temp/forge-session-ui-integration-t2jUsc/`

The directly inspected original is `chat-sessions-th-320-dark.png`; that folder
also retains the original TH/EN four-width matrix and `scope.json` naming the
uncorrected HEAD. It is not reused as passing evidence.

Final PASS evidence and `scope.json` are under:

`C:/Users/siripon.sri/AppData/Local/Temp/forge-session-ui-integration-li5XBs/`

Final PNGs:

- `chat-sessions-th-320-dark.png`, `chat-sessions-th-375-dark.png`,
  `chat-sessions-th-768-dark.png`, `chat-sessions-th-1440-dark.png`
- `chat-sessions-en-320-dark.png`, `chat-sessions-en-375-dark.png`,
  `chat-sessions-en-768-dark.png`, `chat-sessions-en-1440-dark.png`,
  `chat-sessions-en-375-light.png`
- `colored-app-mark-and-website-favicon.png`
- `recovered-intent-with-run-controls.png`, `recovered-start-with-run-controls.png`,
  `recovered-intent-320-run-controls.png`, `recovered-start-320-run-controls.png`
- `revoked-retained-approval.png`, `orchestrator-loading.png`,
  `empty-foreign-project.png`, `real-role-conflict.png`
- `session-roles-uncertain-en-320.png`, `session-roles-stopped-revoked-en-320.png`

Rendered review was performed in-thread, without a nested reviewer. Original
320px failure, corrected TH320/EN1440, final light375, colored marks,
uncertain-role320, native-control320 and loading captures were directly inspected.
The test is not a pixel-golden comparison. No shipping raster or design-system
change is introduced. Temp captures need archiving if durable release evidence
is required.

## Reproduce and boundaries

```powershell
node --experimental-loader ./tests/product-session-roles-loader.mjs --test tests/product-session-orchestrator-ui.test.mjs
node --check tests/product-session-orchestrator-ui.test.mjs
git diff --check
```

Optional `FORGE_SESSION_UI_CAPTURE_DIR` selects a capture directory;
`FORGE_TEST_BROWSER` selects an already installed Chromium executable.
Dependencies are resolved read-only from the existing main checkout, normally
`C:/Users/siripon.sri/Desktop/my_project/forge-agents/node_modules`; the existing
role-test loader also resolves transitive service dependencies there. No install,
junction, manifest/lockfile write or dependency download was performed.

Read AGENTS, current v3 start/prompt, PRODUCT/design, worker-session-roles,
worker-brand-color, worker-impeccable and the incumbent conversation surface brief;
applied existing Impeccable Operate/harden guidance. Context/doctor/setup were not
rerun or repaired. No UI source edits, full application build, whole browser
suite, legacy/payload/manifest/central-progress edit, push, account access, paid
turn or native job. The lead's preceding production build is not represented as
a build of the final corrected UI by this worker.

**Scoped implementation gaps:** none remaining in the tested flows after the
authorized CSS correction. Actual integrated HTTP/native attachment/runtime
qualification remains separate implementation-verification work for the lead.
Real-provider/account checks and **HOME_UAT_NOT_RUN** remain separate live/home
acceptance limits, not explanations for the original UI defect.
