# Thai A+B copy recovery — 2026-11-26

Base: `6590cf62f26efa0407122c80d94e5d547777205f`.
Worker branch: `t3/resume-thai-ui-copy`.

## Implemented scope

Recovered the interrupted ThaiB uncommitted copy from
`t3-a1fee7d8-8259eacc25793ded` by reading it only. The assigned recovered files
had no intervening source changes between that checkout's `0e16336` base and
this worker's required base. The old checkout was never modified. ThaiA's old
checkout had no uncommitted work to recover.

Reviewed and completed Thai copy in all 25 assigned existing JSX modules:

- BudgetStudio, Compute, Desktop, FrontendTools, GuardedSetup, McpConnections,
  Office, Plugins, ProviderSetup, Reports, ResearchCohort, ResearchLab,
  SecretManager, Serving, Storage, ThemePicker and operations.
- Assistance, Adaptive, Strategies, SessionRoles, SessionOrchestrator, Memory,
  WorkflowPresets and Goals.

Applied the lead's `th-copy-guide.md`: everyday Thai, consistent names for
projects, AI assistants, work folders, sessions, memory and evidence; buttons
name the action and result. Technical product names and necessary identifiers
remain recognizable. English translations remain unchanged. Three previously
English-only Thai labels now have Thai copy: hosted Colab MCP, Drive folder ID,
and the Strategist-to-Executor pattern.

Reviewed the recovered copy for meaning, including corrections to retain:

- Explicit permissions, human approval, uncertain outcomes and no automatic replay.
- Spending uncertainty, storage charges after stopping compute, and the absence
  of real Vast rentals in the sample-data discovery path (without a blanket
  promise that all usage is free).
- Verified artifact uploads, registered-file backup scope, separate approved
  cohort work folders, independent checks and SHA256 validation.
- The LitServe installation trigger: first local model start, not opening FORGE.
- The Office editor version and the lack of Thai menus in that version.

No behavior, routes, API names, IDs, state enums, validation, numeric values in
code, or interpolation expressions were changed. Shared role/status values and
raw service diagnostics remain unchanged rather than inventing new mappings.

## Verification

Windows, Node `24.19.0`. Used an ignored `node_modules` junction to the root
checkout's installed dependencies; no dependency installation or lockfile edits.
Vite development caches and production output were directed to temporary
directories. The two existing tests without cache configuration were run through
a temporary Node `registerHooks` loader that only supplied `cacheDir` to Vite's
`createServer`; their repository source and HTTP assertions were not weakened.

Passed focused commands:

- `node --test --test-concurrency=1 tests/budgets-ui.test.mjs tests/guarded-install-ui.test.mjs tests/secrets-ui.test.mjs tests/jobs-ui.test.mjs`
  (with the temporary cache loader for jobs): 4 passed, no skips. Actual local
  Python in the Compute fixture; TH/EN, request bodies, unknown outcomes,
  permission controls, project changes and narrow layouts.
- `node --test tests/playbooks-ui.test.mjs`: 2 passed, no skips. Production
  component rendering plus actual brief/revision/Mission browser workflow.
- `node --test --test-concurrency=1 tests/goals-ui.test.mjs tests/product-session-roles-ui.test.mjs tests/product-session-orchestrator-ui.test.mjs`:
  11 passed, no skips. Actual production components/domain services with injected
  native effects; retained command identity, approval, stop, project isolation,
  Thai/English, keyboard controls and responsive rendering.
- `node app/web/tests/providers-smoke.mjs` (temporary cache loader): passed.
  Actual SQLite/provider/governance/SDK stdio services, deterministic provider
  and OAuth seams, exact approvals, cancellation and uncertain outcomes.
- `node tests/assistance-strategist-ui.mjs` (temporary cache loader): passed.
  Real SQLite/Assistance services and production JSX with injected native effects;
  all 15 themes and 320/375/414/768/1440 widths.
- `node tests/strategies-ui.mjs`: passed. Real SQLite/Git/roles/budget services
  with injected T3; all six setup modes, actual candidate selection, no automatic
  merge, uncertain response retention, stop and responsive controls.
- Production Vite build of both `app/web/index.html` and `welcome.html`: passed,
  using the same root/entries/chunk threshold as the checked-in configuration
  with `configFile:false`, temporary output/cache and no server. Initial run
  reported existing upstream `use client` and chunk-size warnings; final build
  was repeated after the last copy changes.
- `git diff --check`: passed.

A temporary AST audit compared `git show HEAD:<file>` with each changed source,
using esbuild JSX lowering and Rollup `parseAst`. It compared every node/key/value
except source offsets and string literal values, separately checked changed
strings, and allowed only the three Thai-label translations noted above for
originally English literals. All **35 JSX/test files** passed: **974 changed
string literals**, zero executable-structure differences. Numbers, template
expressions, identifiers, request construction and validation remain identical.
The audit is available during this session at
`%TEMP%/forge-thai-copy-ast.mjs` with its string list in
`%TEMP%/forge-thai-copy-changes.json`.

The originally assigned five copy-test files were updated. Lead explicitly
extended ownership to the five additional ThaiA selector tests listed above
(Goals, SessionRoles, SessionOrchestrator, Assistance Strategist, Strategies).
All test changes update expected text only.

## Integration and remaining scope

Root owns App.jsx, api.mjs, server/main.mjs, the studio and central documents.
None were edited. Root was sent the excluded OAuth callback success copy from
the old ThaiB `app/server/main.mjs` line 219:

> เชื่อมบัญชีแล้ว ปิดหน้านี้ กลับไปที่ FORGE แล้วกด ดูรายการเครื่องมือ ก่อนใช้งาน

Root also owns the ongoing ordinary HTTP POST CSRF integration. These focused
checks qualify this worker's base and changed UI; they are not a claim about
root's later assembled HTTP changes. No CSRF gate or fixture authorization was
weakened here.

Remaining page scope is explicit: App/studio and unassigned modules, externally
supplied preset copy, raw server messages/status enums, model catalog values and
embedded editor menus were not rewritten by this worker. This copy task adds no
new translation behavior for backend data. Complete-product implementation gaps
remain governed by the root acceptance record.

No live cloud rental, external account/OAuth qualification, native provider run,
or home UAT was performed. `LIVE_PROVIDER_NOT_RUN / HOME_UAT_NOT_RUN` remain
separate from the passed developer fixtures. No prototype activation, credentials
migration, public hosting, protected legacy change, manifest change or push.
