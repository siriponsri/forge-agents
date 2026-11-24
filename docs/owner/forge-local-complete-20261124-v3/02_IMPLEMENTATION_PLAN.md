# Complete FORGE implementation plan

## Delivery target and working rules

The owner's latest instruction is to complete the **FORGE product**, so a no-code Windows user can open it on localhost and use the requested capabilities through the GUI. After development, `main` is the delivery branch; the owner will pull at home and conduct system-flow acceptance there.

**G0–G6 form the implementation scope. G1 is an intermediate milestone, not the final deliverable.** Continue through dependency-ready work across sessions. Do not stop at a roadmap, a first slice, a connector catalog or a mock interface. Record progress before context exhaustion and resume the next executable task. Ordinary reversible work already within this scope does not require renewed permission at every milestone.

Do **not** create, train, deploy or evaluate CA-EWS or another prototype product in this round. The archived project plan supplies examples of capabilities FORGE must support; its embedded execution prompt is inactive. Small, disposable engineering fixtures may verify FORGE itself. They must not become a separate product project or be reported as a real research experiment.

Read the core handoff documents and actual repository instructions. All shortened document paths below are relative to this handoff directory. Inspect the owner's checkout rather than assuming preparation-workspace files exist. Preserve unrelated changes, valid account boundaries and protected legacy payloads/manifests. Read relevant research when integrating a component; do not repeat the complete repository survey before coding.

## G0 — Establish the implementation and reuse boundary

Inspect actual HEAD, branch, dirty files, scripts, runtime, persistence, tests and existing release boundaries. Record the gap against **the complete product scope**, a compact architecture diagram and executable tasks.

Pin usable T3 source and inspect its license, entry points and server contracts. Reuse actual T3 GUI components and matching provider/thread/session mechanisms. Running the coding session inside T3 is separate from integrating T3 into FORGE. Keep application processes, ports and state separate from the installed development application.

For T3, Orca, Paseo, Happy, Agent Orchestrator, single-agent-loop-kit, Hermes and OpenBot, record the chosen contribution: copied compatible code, dependency/adapter, or adopted design pattern. Record the source revision and notices where code is incorporated. Explain rejected duplication or incompatible licensing without silently dropping the associated user capability. One authoritative execution owner must control each provider turn.

Include AG-UI, Univer, WordCraft and PdfCraft in that assessment. Define the protocol projection, document/revision authority, report source model and local engine boundaries before parallel workers invent separate implementations. Read the new focused research rather than assuming features from repository names.

**Exit:** source-backed architecture and reuse decisions, protected paths identified, current commands known, and implementation begun. Continue directly into G1.

## G1 — Establish the persistent T3-based application

Build FORGE project navigation, workspace selection, editable project profiles, real T3 conversations and file/diff/artifact review. Use durable records for projects, bots, conversations, plans, phases, tasks, runs, attempts, artifacts and connection profiles, with explicit relationships and migrations.

Introduce the AG-UI bridge over the actual T3-backed harness, preserving its single execution owner. Persist the mappings among task/attempt, provider session and protocol thread/run. Add document/workbook and report-source revisions to the common domain model; raw UI state must not become another authoritative database.

Keep Thai as the default, working TH/EN switching and English major headings with Thai support. Include useful empty, loading, connection, error and recovery states. The primary GUI must work without editing code or configuration files. Install/start mechanics are finalized in G6 but the application must already run during development.

**Exit:** running application, real T3 source/runtime integration, project/task/thread navigation and persisted state after reload/restart. Missing login may leave a provider-specific check unrun; it does not prevent the local foundation or end the product task.

## G2 — Complete teams, conversations and visual coordination

Implement named persistent bots plus task-scoped helpers, editable roles, private bot chats and project/team rooms inside FORGE. Separate bot identity, provider account, harness, conversation, task ownership and execution attempt. Make delegation, result handoff, cancellation and failure visible.

The user describes a goal and sees an understandable overview and dependency diagram before execution. Canvas, Kanban, phase detail and task detail use the same persistent plan/task service. Changes must agree across views; a card move cannot manufacture successful execution evidence.

Link tasks to accountable bots, real T3 threads, workspaces, attempts, changes, artifacts and verification. Bound concurrent work and isolate conflicting file edits. Show phase progress, blockers and the next action from recorded events. Review policy applies to the concrete plan; routine covered work must not repeatedly ask the owner to approve the same scope.

**Exit:** functional team and private conversations, shared plan/board state, task lifecycle and traceable execution, with meaningful persistence and isolation checks.

## G3 — Complete connections, MCP and flexible Settings

Implement per-project provider/harness, compute, notebook, serving, storage, tracking and MCP choices, with compatible phase overrides. Settings changes create profile revisions while preserving historical run evidence. Normal setup uses forms, account handoffs and connection checks rather than manual MCP JSON or shell editing.

Prioritize ChatGPT/Codex, Claude, Gemini and OpenRouter. Account for Grok, OpenCode, Kimi, Qwen, DeepSeek, MaxPlus, KOB and custom compatible providers. Keep coding harness/native/ACP routes, model APIs, MCP tools and trained models distinct. A subscription or executable does not establish API credits or authentication.

For compute, account for local Windows/CPU, owner-managed servers, Colab, Vast and Runpod, plus extensible backends. Use verified existing MCP/API/SDK/native routes where suitable and build an adapter when the supported contract permits it. Keep Colab browser-notebook and hosted API paths separate; do not infer eligibility, GPU availability or session lifetime from a Free profile.

Maintain an integration ledger for **every named provider, compute target and requested connector**: chosen route, implementation paths, supported capabilities, dependency/setup flow, local evidence, live status and exact blocker. Implement a real adapter path rather than a label or placeholder. If an external service offers no usable route or access is unavailable, record the precise affected scope. An implementation gap remains a gap; unavailable credentials may defer live qualification only.

MCP management needs connection/install configuration, discovery, enabled tools, capability refresh where supported, structured results/errors, cancellation and actionable recovery. Preserve account isolation and use supported sign-in flows. Changing a harness must preserve history and acknowledge operations that require a new session.

Complete AG-UI message/tool/state/interrupt handling and application-level recovery, including pending frontend-tool results and no duplicate side effects on reconnect. Its standard HTTP/SSE binding does not promise transport resumption. Add model-catalog freshness/error visibility, manual refresh and preservation of valid selections; a slow catalog must not be silently presented as proof a model does not exist. Diagnose the owner's T3 instance separately and keep development moving with a verified available model.

**Exit:** functional Settings and connector lifecycle, two independent project profiles, local adapter checks, and an honest integration ledger. Continue independent implementation while specific live checks are pending.

## G4 — Complete the AI engineering workbench

Deliver GUI workflows for creating/importing/editing notebooks, selecting execution targets, launching bounded jobs, viewing logs and run status, stopping work, handling disconnection and inspecting outputs. Provide source/config/environment/run lineage, artifact registration, version selection and checksum verification. Reconcile execution identity before retrying; checkpoint restore is available only when the model and backend support it.

Implement the product facilities for inference-weight selection, interface generation/preview, serving configuration, health checks and inference inspection. Include the requested LitServe MCP integration. Keep serving and training targets independently selectable. FORGE's own T3 server remains separate from user-generated applications and model-serving processes.

Build monitoring views from real recorded events and metrics, with filters, run comparison, failures and unavailable-data states. Do not invent model scores or display fixture telemetry as production measurements.

Storage & Sync must support local Windows, Google Drive and project Git through configurable account/folder/path/remote/branch selection, file routing, sync timing, retention and restore. Separate save, commit, push, training completion and artifact-transfer completion. Handle partial transfer, offline destinations, conflicts and retries without silent overwrites. User-project Git is not automatically FORGE's source repository; generic Drive sync must not mirror `.git` internals.

Verify these facilities using small engineering inputs and temporary workspaces. Do not acquire the CA-EWS dataset, fit its models, generate its application or execute a future product workflow as a release requirement.

### G4 office and reporting workstreams

Embed Univer Sheets/Docs in the existing shell, with actual editor lifecycle/disposal, save/reopen, formula behavior, agent edit commands, undo/review behavior and stale-revision handling. Keep native snapshot persistence independent of optional Exchange/collaboration licensing. Build Office conversion adapters only for qualified supported paths, exposing format/quota/fidelity status.

Implement Report Studio with a versioned report source model, templates, data/artifact selection, TH/EN text and source citations/provenance. Map report content into WordCraft's qualified automation interfaces to generate editable DOCX and PDF. Integrate PdfCraft for supported inspection/page operations/postprocessing and any separately qualified conversion path. Do not assume a Univer snapshot can be passed directly to either engine.

Manage report jobs through the same task/attempt/artifact services. Verify output existence/type/integrity, inspect representative layouts and preserve the editable source revision. Distinguish successful generation, successful download and successful storage sync. Cancellation/progress must reflect actual engine support; process termination is not automatically a safely cancelled export.

**Exit:** working notebook/job/artifact/inference/monitoring/storage and office/report flows at product level, meaningful local and contract tests, real inspectable report outputs, and explicit live-service evidence gaps for the later home test.

## G5 — Complete desktop use and adaptive execution

Implement native GUI control for the main Windows target and a separate desktop/VM target, plus browser automation as its own capability. Include target registration, readiness, visible target identity, action feedback and effective Stop/Take over. One mutable controller owns a desktop at a time; parallel desktop work requires separate targets. Colab compute is not a substitute for a desktop target.

Use Hermes-inspired skills on demand and harness selection based on available capabilities, owner preferences and recorded outcomes. Make selection understandable, preserve task constraints and version proposed skill improvements. Use single-agent-loop-kit ideas to improve execution within a task while preserving the selected multi-bot team model. Rule-based selection does not establish a learned optimizer.

Verify local selection, failure, control ownership and stop semantics. Perform a harmless native-app action on an available permitted target. If the home desktop or guest is absent, complete the adapter/setup code and mark only that target's live qualification pending; browser tests cannot stand in for it.

**Exit:** completed desktop/browser/adaptation implementation, meaningful checks and target-specific qualification states.

## G6 — Finish no-code startup and deliver through main

Provide a documented Windows entry point, such as a double-click launcher, that performs preflight, guides first setup, starts the local service and opens the browser. Ordinary users must not need to assemble multiple terminal commands. Detect missing dependencies, occupied ports and failed starts; provide understandable recovery, restart/stop and diagnostic export. Bind to loopback by default. Do not require paid cloud services to open the application.

Package or provide guided installation for the pinned native reporting engines and necessary fonts/dependencies. Normal users must not have to build Rust tools manually. Keep optional conversion dependencies separate and explain the affected capability when absent. Check office/report assets, engine discovery and locale rendering from a clean Windows installation, with unsupported checks explicitly NOT_RUN.

Store durable local application data and secrets separately from source and build output. Support migration/backup and preserve user settings during updates. Avoid hard-coded development-machine paths. On the home machine, accounts are connected through supported setup; never commit or copy session credentials as part of the Git delivery.

Validate a clean dependency installation/build and launcher path using a fresh checkout or equivalent isolated environment. Run relevant automated checks and exercise local UI flows before release. The owner's later home flow test is **acceptance on another machine**, not a substitute for developer verification.

Prepare source, lockfiles, notices, setup instructions, the integration ledger, release evidence and home-test steps. Inspect the release diff; exclude secrets, personal data, dependencies, generated runtime state and irrelevant binaries. Bring the completed changes to `main` and push according to the active owner instruction/release prompt using a normal non-force workflow. Preserve unrelated changes and branch protections. Record the actual resulting commit and remote result; never report a push that did not occur.

**Exit:** product implementation accounted for, developer evidence recorded, portable localhost setup documented, main delivery status explicit, and home UAT marked pending. A missing product feature prevents a blanket “complete” claim; an unavailable external account can leave that integration implemented but not live-qualified.

## Continuation and completion reporting

Update `progress/` after each session with goal, changes, actual commands/results, capability gaps, blockers and the next executable task. Continue until G0–G6 are accounted for; a working G1 or a successful mock demo does not finish this assignment.

Use the acceptance matrix to distinguish implementation, developer verification, release readiness and home UAT. Report the release commit, exact launch method and remaining target-specific checks. Revisit the deferred prototype only after a new owner instruction activates it.
