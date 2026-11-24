# Localhost delivery and home-machine acceptance

Status: **Required delivery behavior and test plan**. The launcher, setup flow and checks described here must be implemented and verified; their presence in this document is not a passed test.

## 1. Owner experience

The delivered Windows workflow is: obtain the repository, open a clear launcher, complete guided first-run setup, and use FORGE in the browser. Routine use must not require terminal commands, editing environment files or writing code.

Provide `Start-FORGE.cmd` or an equally simple Windows entry point, plus an accessible Stop/Restart mechanism. A small first-run setup may handle required dependencies with clear progress and actionable installation steps where unattended installation is unavailable. Keep prerequisites minimal and document exact supported versions. Do not conceal missing dependencies behind a launcher that exits immediately.

First run should open a real onboarding/empty state: choose workspace, create a project, connect a provider and configure relevant tools through the GUI. Opening the shell, editing settings and reading existing work should not depend on every external account already being connected. Missing sign-in must identify the affected feature and provide the appropriate setup action.

Office and report setup must be part of that no-code experience. Univer editing/native persistence should work without an Office Exchange subscription. Discover or provision qualified WordCraft/PdfCraft executables, fonts and selected optional converters through guided controls; show per-engine readiness and a concrete remedy. Normal users must not install a Rust toolchain, type MCP roots or edit raw connection JSON. Report generation may wait for an engine's setup, but unrelated FORGE work remains available. Distinguish required report-engine implementation from optional format exchanges and their quotas.

## 2. Startup and recovery contract

- Resolve the application directory relative to the launcher; support a checkout whose path differs from the development machine and contains spaces.
- Bind to loopback by default and open the actual localhost URL only after application readiness succeeds. External exposure is a separate explicit setting.
- If FORGE is already running, open its existing instance. Detect unrelated port use without killing that process; choose an available supported port or present a useful remedy.
- Show startup progress and a readable failure summary with Open logs, Retry and Stop actions. Redact credentials from diagnostic exports.
- Make browser-close versus service-stop behavior understandable. Stop/Restart must address FORGE's processes and reconcile active tasks; preserve their evidence.
- Persist settings, projects, teams, conversations and execution history across application restart. Recover interrupted operations according to their actual contracts.
- Display application version/source revision and expose a health view for local service, storage and configured connections.

Machine-local data belongs in configured application-data/workspace locations, not tracked source files. Define backup, restore and schema migration behavior before shipping updates. A user-selected workspace is independent of the FORGE source checkout.

## 3. Verification before delivery to main

Complete the product implementation plan and record remaining external qualifications honestly. Do not postpone basic build, startup, interaction and persistence checks until the owner returns home.

Verify from a clean checkout or equivalent clean tracked-source copy using committed dependency lockfiles and documented prerequisites. This must detect reliance on untracked source, cached generated files, absolute development paths or an already initialized database. Include required assets and migrations in the repository. Installed dependencies and personal runtime data do not belong in source control.

Run relevant build/type/static checks and meaningful behavioral tests. Exercise the real interface: first run, project/team creation, plan/board consistency, settings persistence, task-thread association, error handling and restart. Use a harmless temporary engineering workspace where execution is necessary. Label fixture-based connector tests separately from authenticated service checks.

Qualify available local/native targets and provider routes without creating a prototype product. If Windows execution is unavailable in the development environment, state that specific verification gap; passing a non-Windows build does not prove Windows startup. Prepare the executable path and concrete home check rather than declaring it verified.

The release report must separate implementation status from each check's `PASSED`, `FAILED` or `NOT_RUN` result, with evidence and exact scope. Use `DEVELOPER_VERIFIED` only for the checks and environment actually exercised, following the acceptance matrix. **Ready for home UAT** means the implemented product is reviewable and the development checks passed to the stated extent. It does not mean every home account, GPU target or guest desktop was tested. Missing required implementation cannot be relabelled as deferred UAT.

## 4. Main delivery and transfer to the home machine

Use `main` as the delivery branch after integration and relevant checks. Keep concurrent writers in separate branches/worktrees; an orchestrator observes shared progress and integrates through a controlled worktree. Do not have several agents modify the same checkout. Follow the release prompt for the actual push step and preserve existing remote history.

Provide the delivered commit/revision, changed capabilities, checks and a short Thai quickstart. Credentials, tokens, personal databases, provider sessions and machine-specific paths must not enter the commit.

At home, clone the intended repository or update the existing clean checkout to the delivered `main`. If there are local edits or divergent commits, inspect and preserve them before updating; never instruct a blind hard reset. The developer should supply exact commands verified against the actual remote and branch, or an equivalent safe GUI procedure.

Launch FORGE, allow required setup/migrations, confirm the displayed revision, then choose local paths and sign in through the supported flows. Git transfers application source; account sessions and personal state need separate setup or an explicit supported migration. Do not assume the office account/path is valid at home.

## 5. Home flow checklist

Record results in the product's handoff/progress records with the application revision and target identity. A short checklist is sufficient:

| Flow | Expected observation |
|---|---|
| Start, stop, restart | Launcher opens the correct localhost instance; useful errors; no accidental second service |
| First-run setup | Workspace and account choices work through the GUI; missing services remain understandable |
| Project and team | Create/reopen projects, persistent bots, helpers and private/team conversations with correct scope |
| Visual planning | Overview, phases, canvas, board and task detail stay consistent after edits and reload |
| Harness/UI protocol | Real messages/tool state reach the correct task/bot; reload restores actual state; stop and interrupted streams do not duplicate work |
| Office workspace | Create and edit a sheet and document; agent edits are attributed; stale edits are handled; save, close, reopen and undo behave correctly |
| Reports | Choose real source data and template; generate DOCX/PDF, inspect Thai/English and layout, reopen/download registered artifacts; missing engines fail usefully |
| PDF operations | Exercise supported inspection/page operations; test optional LibreOffice conversion only when configured; do not infer universal format fidelity |
| Coding execution | An available provider performs a harmless bounded task in the selected workspace; thread and changes are linked correctly |
| Notebook/compute | Connection checks and a tiny non-research execution prove the selected path; cancel/reconnect show real state |
| Artifacts/serving | Register a test artifact, inspect provenance and exercise a compatible local serving check without creating a domain product |
| Storage | Select local/Drive/project-Git routing; check sync/retry/restore and distinguish save, commit and push |
| Native GUI | Observe an actual native-app action on each available target, then verify Stop/Take over; browser checks remain separate |
| Language/recovery | TH/EN works through primary screens; restart preserves state; restore and actionable errors behave as documented |

For reports, compare generated output with its source revision, template and recorded engine/font versions. Validate actual files, not just a download filename or success toast. Interrupted exports must leave the last completed artifact intact and avoid registering partial output as complete. Where native progress or cancellation is unavailable, the interface must say what FORGE has actually observed. A synthetic document with Thai/English text, a table and a figure is a suitable development fixture and does not create a prototype product.

For the model picker, record the actual provider route, selected model ID and a successful bounded request. Use [12_T3_MODEL_DIAGNOSTIC_TH.md](12_T3_MODEL_DIAGNOSTIC_TH.md) for the reported 6.2 visibility issue. An unavailable 6.2 model does not stop home testing with a working configured model, and a working FORGE picker does not prove that the separately installed development T3 was fixed.

Use only the selected accounts/resources and already authorized execution scope. Paid targets or unavailable guests can remain individually unqualified without hiding their status. The later owner test is a product acceptance activity, not authorization to create CA-EWS or run its research plan.
