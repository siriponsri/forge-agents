# Grouped navigation test helper update

2026-11-25. Isolated branch `t3/navigation-test-helpers`, base
`bef84fe697c45af2dc2f664ba9ed51571c047f90`.
Actual harness identity: **gpt-6.1-sol**, reasoning **xhigh**, inherited.
No model switch or nested agent was used.

## Delivered scope

Only the four assigned existing test files and this new report changed:

- `tests/product-completion-ui.test.mjs`: initial Missions click and desktop/Thai
  mobile route loops use the navigation helper.
- `tests/agent-workspace-ui.test.mjs`: normalize the Conversations click to the
  same helper, even though its group is initially open.
- `app/web/tests/smoke.mjs`: adapt the existing route helper.
- `app/web/tests/visual-refinement.mjs`: adapt the existing helper and scope the
  standalone drawer navigation visibility wait to `.sidebar nav`.

Each helper scopes the route button to `.sidebar nav`, opens the mobile drawer
when required, locates the real route with `includeHidden`, opens only its nearest
closed ancestor `details` through the summary, and performs a normal click.
`includeHidden` permits discovery; clicks still require normal visibility and
actionability. No force clicks, bulk disclosure opening, changed assertions,
timeouts, route lists, application code or Office guard changes.

## Verification

Windows, Node **v24.19.0**, npm **11.17.0**. Built this isolated worktree's actual
application source with `npm.cmd run build`; the app service serves this
worktree's generated `app/web/dist`, not the integration checkout's bundle.
The tested tree is the stated base plus exactly these helper changes. Subsequent
report creation does not change the tested runtime or helpers.

Existing dependencies were accessed using an ignored `node_modules` junction to
`C:/Users/siripon.sri/Desktop/my_project/forge-agents/node_modules`. No install,
dependency write, manifest or lockfile edit. The junction was removed after
verification; generated `app/web/dist` remains ignored.

Commands and results:

```powershell
npm.cmd run build
npm.cmd run check
node --check tests/product-completion-ui.test.mjs
node --check tests/agent-workspace-ui.test.mjs
node --check app/web/tests/smoke.mjs
node --check app/web/tests/visual-refinement.mjs
node --test --test-concurrency=1 tests/product-completion-ui.test.mjs tests/agent-workspace-ui.test.mjs tests/product-navigation-ui.test.mjs tests/product-native-accounting.test.mjs tests/product-memory-connection-ui.test.mjs app/web/tests/boundaries.test.mjs
node app/web/tests/smoke.mjs
node app/web/tests/visual-refinement.mjs
git diff --check
```

All commands **PASS**. The `node --test` command reports **7 passed, 0 failed,
0 skipped, 0 cancelled** (47.25s): graph UI, Mission journey, Memory/Budget UI,
native accounting, production navigation, and two Office boundary tests. Both
standalone smoke scripts also pass. The build retains existing upstream
`use client` and large-chunk warnings.

- Mission journey: real Owner forms, disposable SQLite/HTTP, reviewed local
  Node tests, local preview, QA, ZIP download/verification, desktop and Thai
  mobile routes. Provider execution observations are **injected**, not live;
  one fixture start and **zero provider turns**.
- Graph: real UI/SQLite with **injected run observations**, scoped artifact
  download, graph controls, retained draft, TH/EN and responsive layouts.
  Viewing causes no execution requests.
- Core smoke: real project/team/chat/planning persistence, real local Python,
  mounted Univer Docs/Sheets, human keyboard and bounded edits, shared undo/redo,
  real optimistic revision conflict, backup, report source persistence and
  service restart/reopen. No provider/model calls. This does not qualify native
  report generation or live LLM Office edits.
- Unchanged production navigation test: all **23 routes**, TH/EN, search and
  native disclosure keyboard behavior, mobile drawer, all 15 themes and real
  unsaved Office navigation guard for both search and grouped navigation.
  **60 contrast audits**, minimum **4.502795:1**, zero page errors.
- Visual refinement: **75 contrast audits**, minimum **4.5:1**, all 15 themes,
  widths 320/375/414/768/1440/1920, TH/EN, keyboard focus, forced colors, reduced
  motion and real loading/busy/error states; zero page errors. Response delay
  gates retain actual service responses; visual records are disposable fixtures.

## Read-only Budget P2 re-check

Neither `tests/product-native-accounting.test.mjs` nor
`tests/product-memory-connection-ui.test.mjs` was edited. Both pass against the
same isolated production build/backend. Native counter projections are explicit
**pinned protocol fixtures**, not captured or live provider measurements.

The accounting test verifies monotonic cumulative receipts (14 then 40),
historical snapshot handling, a regressed current source becoming unavailable,
cleared current `reportedUsage`, null current Budget totals, historical
`lastConfirmed` 40 and no extra accounting receipt. The UI test verifies real
Memory MCP SDK grant/copy/revoke plus the Budget correction: two 14 cells become
two `Unknown` cells and the reconcile guidance appears, the prior receipt is
retained, and the 375px page does not overflow. Source inspection agrees:
`app/protocol/controller.mjs`, `app/budgets/service.mjs` and
`app/web/src/BudgetStudio.jsx` preserve this current/history distinction.
No P2 failure found within these checks.

## Local evidence

These are machine-local temporary artifacts, not committed release media.
Prefix: `C:/Users/siripon.sri/AppData/Local/Temp/`.

| Check | Evidence directory |
| --- | --- |
| Mission journey | `forge-completion-ui-3w7NRJ/` (evidence JSON and 12 captures) |
| Graph | `forge-agent-workspace-Acmbr2/captures/` (evidence JSON and 3 captures) |
| Navigation | `forge-navigation-ui-IvElSH/` (evidence JSON and 15 captures) |
| Memory/Budget P2 | `forge-memory-connection-ui-Qj7cGN/` (memory and 375px counter captures, including unavailable state) |
| Core smoke | `forge-ui-worker-jrprFG/` (native editor/report source/mobile captures) |
| Visual refinement | `forge-visual-refinement-eoL5zh/` (evidence JSON and captures) |

## Remaining work and limits

No known implementation or test-maintenance gap remains in this assigned helper
scope. This is not a whole-product completion or independent design sign-off;
the full repository suite was not run. Other older helper files listed in
`docs/worker-navigation.md` remain lead-owned and unchanged: knowledge-compute,
controls, desktop, office-agent, report, serving and storage smoke scripts.
Lead still owns integration verification and final release media/docs.

Live providers/external accounts: **NOT_RUN**. Native computer-use targets and
cloud compute: **NOT_RUN**. Home installation: **HOME_UAT_NOT_RUN**. No account
access, provider/model turn, purchase, public listener, prototype activation or
push occurred. Protected legacy paths and all application/shared contracts,
manifests, lockfiles and central progress files are unchanged.
