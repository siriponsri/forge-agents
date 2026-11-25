# Grouped workspace navigation — implementation handoff

2026-11-25. Branch `t3/grouped-workspace-navigation`, actual base `45a7e1b`.
Actual runtime: **gpt-6.1-sol**, reasoning **xhigh**. No model switch or nested
delegation. Independent design review remains the lead's next step.

## Delivered and exact scope

- NEW `app/web/src/WorkspaceNavigation.jsx`: Overview stays directly available;
  native disclosure groups show Your work (open initially), Create & explore,
  Team & automation, and Resources & settings. The initial route choices fall
  from 23 to 5, with four clearly named group summaries.
- NEW `app/web/src/workspace-navigation.css`: existing named semantic palettes,
  typography and drawer; normal sentence-case summaries, wrapping route labels,
  full selected-route border/tint, native keyboard focus, touch-sized summaries.
- `app/web/src/App.jsx`: one import and replacement of the original nav render.
  The nav array, route names, state/effects, project picker, footer, route header
  and `navigate` unsaved Office guard are unchanged. Both grouped and search
  buttons call the exact same guarded callback. No route executes work by itself.
- Search accepts Thai or English route names in either language, regardless of
  case. Ordinary route buttons retain their existing accessible names. No-result
  status gives recovery guidance; Clear/Escape restores the groups and search
  focus. Search is transient component state, with no new persistence.
- Active route changes reopen their exact group, including Overview quick actions
  and clearing a search. Native disclosures can otherwise be toggled normally.
  Unassigned future App items remain reachable directly rather than disappearing.
- NEW `tests/product-navigation-ui.test.mjs`: production build, actual loopback
  service/session/CSRF and disposable SQLite, no component/API response stubs.
- `tools/readme-media/capture.mjs`: ONLY `nav(name)` gains three lines to find the
  existing button with `includeHidden`, locate its ancestor native `details`, and
  click the summary if closed before the original click. No media, state, caption,
  receipt or success logic changed. Final media refresh remains lead-owned.

No other source, manifest, lockfile, progress, README, credentials, legacy portable
or backend paths changed. Existing installed `node_modules` was junctioned to the
verified target `C:/Users/siripon.sri/Desktop/my_project/forge-agents/node_modules`;
no install or dependency change. Production navigation source is stable for the
lead's media refresh.

## Design workflow and evidence

Read AGENTS, PRODUCT.md, design.md, current v3 start/prompt/precedence and incumbent
Overview surface guidance. Applied installed Impeccable 4.10.0, ran context once
for App, read Operate/distill guidance and craft-floor immediately before UI
writes. This is the supplied focused Operate brief; no new interview/world,
generated comp, or claim was introduced. The actual built incumbent was inspected
before edits in a disposable incognito preview. Narrow path ownership keeps the
surface strategy in this handoff rather than editing shared design metadata.
No doctor, setup repair or repeated context run. Mechanical detect ran once: `[]`.
An in-thread visual inspection is **not** an independent reviewer verdict.

Final verification:

```powershell
npm.cmd run build
node --test tests/product-navigation-ui.test.mjs app/web/tests/boundaries.test.mjs
node --check tools/readme-media/capture.mjs
git diff --check
```

All passed: 3 tests, 0 failures. Build retains upstream `use client`/large Univer
chunk warnings. The complete root suite was not claimed: older navigation helpers
need the explicit adaptation below before they can click disclosed tools.

Final evidence: `C:/Users/siripon.sri/AppData/Local/Temp/forge-navigation-ui-1wU307/`.
`evidence.json` contains all 23 route names, 15 actual PNG paths and 60 rendered
navigation contrast audits (15 themes × default/summary hover/active hover/no
results), minimum text contrast **4.5028:1**, no failures, no uncaught page errors.

Verified all 23 routes through groups in TH and EN, all 23 through English search,
Thai search in English UI, Tab/Enter result activation, summary Enter/Space/focus,
active-group expansion from Overview and after search clear, no-result recovery,
compact Clear control without covering the input, and mobile drawer closure.
Both languages at 320/375/768/1440 passed document/sidebar bounds checks. Real
Office rename while Univer is mounted proves search and grouped navigation both
open the existing unsaved guard; Return retains the editor and Discard changes
route without saving the draft name. No provider run was created.

Inspect `empty-th-1440-dark-modern.png`, `default-project-en-1440-dark-modern.png`,
`summary-keyboard-focus.png`, `search-no-results.png`, `navigation-light-modern.png`,
`navigation-high-contrast-dark.png`, `drawer-{en,th}-{320,375,768,1440}.png`, and
`unsaved-office-navigation-guard.png`. These are genuine empty/default and local
engineering records, not media replacements or live-provider evidence. Archive
them if durable release evidence is needed; no screenshot asset ships in this change.

## Exact older test-helper changes for lead integration

Do not force-click hidden buttons or open every group. Use this pattern for each
route helper/direct route click; scoped `.sidebar nav` avoids collisions with
Workflow presets' own saved-brief navigation:

```js
async function nav(name) {
  const navigation = page.locator('.sidebar nav');
  if (!await navigation.isVisible())
    await page.getByRole('button', {name:'Menu', exact:true}).click();
  const route = navigation.getByRole('button', {name, exact:true, includeHidden:true});
  const group = route.locator('xpath=ancestor::details[1]');
  if (await group.count() && !await group.evaluate(element => element.open))
    await group.locator('summary').click();
  await route.click();
}
```

Assigned media helper was adapted; other tests were intentionally untouched.
Required older helper/direct-click updates:

- `app/web/tests/smoke.mjs:30`: replace nav helper with the pattern above.
- `app/web/tests/visual-refinement.mjs:22`: same helper change; at line 168 scope
  the standalone navigation visibility wait to `.sidebar nav` too.
- `app/web/tests/knowledge-compute-smoke.mjs:12`: replace nav helper.
- `app/web/tests/controls-smoke.mjs:24,33`: Settings / Strategies & skills via helper.
- `app/web/tests/desktop-smoke.mjs:20`: Desktop & browser via helper.
- `app/web/tests/office-agent-smoke.mjs:27,67`: Docs & sheets via helper, also after reload.
- `app/web/tests/report-smoke.mjs:23,25`: Artifacts / Report Studio via helper.
- `app/web/tests/serving-smoke.mjs:18,21`: Artifacts / Models & serving via helper.
- `app/web/tests/storage-smoke.mjs:15,17`: Artifacts / Storage & recovery via helper.
- `tests/product-completion-ui.test.mjs:56`: use helper in the desktop route loop;
  line 63 mobile loop uses `await nav(label)` instead of its Menu/direct-click pair.
  Line 28 Missions is initially visible and can be normalized to the same helper.

`tests/agent-workspace-ui.test.mjs:41` Conversations remains in the initially open
primary group, so its initial click needs no mandatory change. Component-only
test harnesses do not consume App navigation and need no adjustment.

## Limits and next step

No known implementation gap remains in the assigned navigation scope. Lead must
integrate this commit, adapt the listed test helpers in lead-owned paths, run the
independent design review and final stable-source media refresh. Do not treat this
worker as a whole-product completion or independent design sign-off.

Live providers/external accounts: **NOT_RUN** (no calls required for navigation).
Home installation: **HOME_UAT_NOT_RUN**. No push, deploy, purchase, account/model
operation, public service or prototype activation occurred.
