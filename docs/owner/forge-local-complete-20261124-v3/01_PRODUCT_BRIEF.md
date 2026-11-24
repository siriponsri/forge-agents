# FORGE — Complete Local Product Brief

Revision: **v3, 2026-11-24, Asia/Bangkok**. Owner: คุณท๊อป.

## 1. Latest owner outcome and completion boundary

Develop **FORGE as a complete no-code local AI engineering workbench**, using the previously agreed concepts, requirements and upstream references. A user must be able to start it easily, open a localhost interface and operate it through the GUI. The owner develops in T3 Code at `C:\Users\siripon.sri\Desktop\my_project\forge-agents`, intends to deliver through `main`, then pull the repository on the home computer and test system flows.

**Do not create a prototype product in this implementation round.** CA-EWS and its medical application, dataset acquisition, benchmark training and study evaluation are deferred. Its earlier plan remains requirements provenance. Generic engineering fixtures and temporary test workspaces may verify FORGE without creating a new owner product or making scientific claims.

The previous first-slice handoff is superseded as the overall endpoint. A runnable first slice is an intermediate dependency. Continue through the full product scope below. Missing credentials may defer a specific live integration check; they do not justify omitting its required implementation or leaving core screens as placeholders.

Use explicit release wording: complete implementation scope, developer-verified behaviors, unresolved implementation gaps, external qualification pending, and **HOME_UAT_NOT_RUN** until the owner tests at home. Do not claim that all providers and hardware have been exercised merely because the GUI starts.

**v3 additions:** integrate AG-UI at the agent-to-application boundary, embed Univer Sheets/Docs for office work, and use WordCraft/PdfCraft through qualified local report adapters. These are required capabilities in the complete FORGE scope. The owner reports T3 not displaying 6.2; model discovery diagnosis must not block development with an already usable model.

## 2. Product experience

The owner describes a goal in Thai or English, sees an understandable visual plan, works with a persistent bot team, follows phase/task progress and reviews code, notebooks, artifacts, inference interfaces and monitoring evidence. Normal use must not require writing code, editing environment files, hand-authoring MCP JSON or remembering terminal commands.

Keep the FORGE identity. Thai is the default, with a working TH/EN switch; major headings use English with Thai support. Provider/runtime implementation details belong in advanced settings unless they help the user make a decision.

Reuse **actual T3 source/components plus matching server, thread and provider-session contracts** as the application foundation. Opening FORGE's repository in the T3 development application does not satisfy this product integration. Preserve one owner of each provider turn; FORGE coordinates tasks above that execution boundary.

## 3. Complete feature families

| Area | Required behavior |
|---|---|
| Local setup and operation | Guided dependency/account checks, simple Windows setup/start, automatic localhost opening, truthful readiness, Stop/Restart, logs and actionable recovery. Preserve projects and settings across restart/update. |
| Projects and workspace | Create/open/select projects through the GUI, remember local workspace and project profile, track actual source changes, separate FORGE source from user output repositories. |
| Persistent teams | Named resident bots plus temporary task helpers, editable role assignments, accountable task ownership and scoped memory/history. |
| Communication | Private bot chats, project/team rooms and task tracking inside FORGE for v1. External messaging channels are not required now. |
| Visual planning | Present a large-picture plan before execution. Canvas, Kanban and task detail share persistent Plan/Phase/Task records and evidence-backed progress. |
| Coding execution | Real T3 coding threads, changes/diff/review, isolated workspaces when needed, run/attempt IDs, status, error, cancellation and recovery. |
| Agent–UI protocol | AG-UI bridge for real harness events, typed messages/tools, state projections, user input, stop/recovery and bot attribution; preserve T3 execution ownership and separate MCP/tool responsibilities. |
| Office workspace | Embedded Univer Sheets and Docs: create/edit/save/reopen, formulas and relevant formatting, human/agent edits through one revision-aware command boundary. Core operation is independent of separately licensed advanced extensions. |
| Report Studio | Select source data/artifacts, template and language; edit report source, generate WordCraft DOCX/PDF and use PdfCraft for qualified PDF processing; preview/download/save verified outputs with lineage. |
| AI engineering workspace | Create/edit/open notebooks, run configured jobs, register dataset/config/model/weight artifacts, preserve lineage, expose inference/deployment work and dashboards through task-connected workflows. |
| Compute | Select local Windows CPU, owner server, Colab, Runpod, Vast and extensible targets through supported adapters. Surface actual runtime capabilities, logs, artifacts and lifecycle limits. |
| Model serving | Choose a verified model artifact and serving target, connect inference UI and health/latency/error views, and implement requested LitServe REST/MCP integration. Serving and training are separate targets. |
| Monitoring | Run history, training metrics where the job emits them, resource/job status, serving metrics where available, logs and artifact/evidence links. Do not manufacture metrics from agent narration. |
| Providers and harnesses | Initial provider priorities are ChatGPT/Codex, Claude, Gemini and OpenRouter. Extend to Grok, OpenCode, Kimi, Qwen, DeepSeek, MaxPlus, KOB and compatible custom providers. Distinguish model APIs from coding harnesses and MCP tools. |
| MCP | No-code connection setup, discovery/refresh, tool availability, project enablement, connection tests and diagnostics. Use suitable existing servers or implement adapters against verified APIs when needed. |
| Native computer use | Operate native GUI on main Windows and a separately configured desktop/VM; browser automation is an additional capability. Target identity, one mutable controller, Stop and Take over are required. |
| Adaptive behavior | Hermes-inspired on-demand skills and capability-aware harness choice, scoped/versioned improvement proposals and evaluation evidence. Apply task-loop improvements from single-agent-loop-kit within the multi-bot system. |
| Storage and recovery | Independently selectable local storage, Drive and Git, destination/file routing, Save/Commit/Push policy, sync status, retry, verified restore, retention and portable configuration. |

Each feature family needs a usable end-to-end path within FORGE, not merely its navigation item. A named external service requires an implemented supported route or a precise remaining blocker. A generic protocol adapter can cover several services only after their actual contract and required features are checked; a custom-base-URL field alone is not proof of universal compatibility.

## 4. Settings and connection truth

Use global machine/account connections plus **per-project settings**, with compatible phase-specific execution overrides. Users select provider/harness, compute, notebook environment, serving, storage, tracking, MCP tools, desktop target and limits independently.

Separate bot identity, model/provider account, coding harness, MCP tool, compute resource and trained model. A provider brand or web subscription does not establish API access or credits. A discovered executable does not establish authentication. A connected service is not automatically qualified for every operation.

Record adapter implementation, dependency readiness, authentication, supported capabilities and verification evidence separately. Provide GUI setup and recovery for missing external bindings. Continue independent work while a specific account/VM is unavailable.

## 5. Prior reference profile retained for later use

The future CA-EWS profile selected Windows public-data CPU work, **Colab Free** training, requested **LitServe MCP**, and **Google Drive + Local Windows + project Git**. These remain supported configuration choices and input to product design. Do not automatically create the project, acquire its data, train its models or implement its medical replay application now.

For the later profile, proposed routing is Drive for model/checkpoint bundles, Windows for workspace and verified inference copies, and project Git for source/notebooks/config/reports/manifests. Other FORGE projects can choose other combinations. An output-project remote is never inferred from FORGE's own source remote.

Keep Colab browser-notebook and remote API routes distinct, each with actual eligibility/capability checks. Free is the owner's current tier, not a universal guarantee or a permanent product constraint. Support appropriate interruption states and checkpoints without promising continuous sessions or resumability for every model.

The source plan's scientific distinctions remain relevant only if that future work is activated. They must not become domain-specific assumptions in FORGE's schema or release gates for this round.

## 6. Selective reuse of every requested reference

Evaluate all named references and record an explicit disposition in the component map: actual source reuse, compatible integration, adopted design concept, or rejected copying with a reason. Do not combine every upstream backend or treat reference selection as permission to ignore licenses.

- T3 Code: actual GUI/server/thread/provider foundation.
- Orca: task lifecycle, attempts, workspaces and review behavior.
- Paseo and Happy: connection/session/reconnect/client patterns where compatible.
- Agent Orchestrator: useful existing bounded worker/worktree mechanics without a second competing planner.
- Anthropic single-agent-loop-kit: task-loop efficiency and evaluation.
- Hermes: adaptive skills, capability filtering and evidence-based improvement.
- OpenBot: persistent bot identity, team and conversation behavior; copying depends on the actual applicable license.
- Existing MCP and UI/tooling research: reuse appropriate components and adapters with source/version/license records.

The commercial direction remains undecided. Preserve options rather than silently committing to a restrictive dependency. Revalidate only the upstream sources actually incorporated, not a full research restart before coding.

The newly requested references are [AG-UI](https://github.com/ag-ui-protocol/ag-ui), [Univer](https://github.com/dream-num/univer), [WordCraft](https://github.com/storytold/wordcraft) and [PdfCraft](https://github.com/storytold/pdfcraft). Their runtime and file-format boundaries are specified in documents 10 and 11. Keep native snapshot storage, Office exchange, document generation and PDF processing as explicit adapters; they are not automatically interchangeable formats.

## 7. Developer verification, main delivery and home UAT

Before main delivery, build and launch the integrated application, exercise core UI/persistence/recovery and meaningful adapter tests, inspect the release diff and verify that a fresh checkout can initialize without unpublished developer files. Use harmless generic test tasks; this is not a request to build a demonstration product.

The home computer is a second installation, not a presumed copy of developer state. Do not hard-code the owner's development path into application behavior. Keep credentials, sessions, databases, model binaries and caches outside tracked source. Provide setup, optional export/import of appropriate project metadata, backup/migration behavior and a version/commit display.

The intended delivery branch is `main`. Prepare the tested integration and a concrete release report. The owner may push manually or send the supplied RELEASE_MAIN prompt to delegate a normal push to the confirmed FORGE remote. Once that explicit instruction is supplied, do not add another routine approval loop. Do not force-push or bypass branch protection; use the available authorized merge route.

Home UAT checks startup and full product flows after pull. Service-specific sign-in and hardware-dependent checks may occur there. Record actual results and fix product bugs; do not pre-label those tests passed. No CA-EWS or other product prototype is automatically activated by home UAT.

## 8. Multi-model development

The owner initially selected GPT 6.1 xhigh, considered Astra orchestration with branch-separated workers, and now reports 6.2 missing from T3. Use the model/provider choices actually exposed and successfully invoked by the installed T3/account. Record the exact model ID; do not infer a Sol/Astra variant from an ambiguous UI label. An available Astra may coordinate/review, but 6.2 is not a prerequisite for building FORGE. The matching upstream catalog issue is evidence for diagnosis, not proof of the owner's cause or a shipped fix.

An orchestrator may read stable `main`, but it should own an integration branch/worktree for implementation and merging. Give every writing worker a separate worktree, scoped task, shared-contract agreement and completion evidence. One integration owner handles shared contracts, migrations, lockfiles and final validation. Concurrent agents must not modify the same checkout or run conflicting app instances against the same state.

Refer to the model/worktree strategy, complete plan and acceptance matrix. Execute through the whole agreed product scope; checkpoint progress when context ends, then resume rather than declaring completion at the first milestone.

## 9. New capability boundaries

AG-UI standardizes agent–application interaction; it does not replace the coding harness, persistent scheduler, native GUI driver or MCP tools. Keep one authoritative domain state and project real lifecycle events to the UI. Recover dropped streams through persisted execution reconciliation rather than duplicate submissions.

Univer is the embedded office editing surface. FORGE owns document identity, snapshots/revisions, project links and agent commands. Keep native save/reopen functional without assuming unlimited Office-format conversion, paid collaboration or commercial AI extensions.

WordCraft/PdfCraft are native engines with automation interfaces, not React editor components. FORGE supplies the no-code Report Studio and previews, invokes qualified local engines, and saves generated files as artifacts. Maintain report source separately from generated DOCX/PDF and distinguish content generation, conversion and PDF postprocessing. Show engine dependencies, actual export progress and format/fidelity limits truthfully.

All four additions must work with the same task/run/artifact model, settings, storage policy and Thai/English experience. Test generic workbooks, documents and reports as engineering fixtures; do not activate a domain prototype.
