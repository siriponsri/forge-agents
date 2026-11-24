# FORGE architecture and Project Settings

Status: **Implementation requirements**, not an assertion that these capabilities already exist. The current scope is the complete FORGE localhost product. Creating CA-EWS or another prototype product is outside this delivery.

## 1. One product and one execution model

Build FORGE on actual T3 source/components and the matching server, provider-turn and thread lifecycle. Opening the repository in the installed T3 development application does not integrate T3 into FORGE. Pin the source actually incorporated and record upstream notices and changes.

FORGE owns projects, teams, plans and coordination above the selected runtime. Preserve one owner for each provider turn. Reuse useful upstream components around that boundary; do not combine several independent planners or duplicate session stores without a deliberate migration contract.

Use one authoritative model for project, bot, conversation, plan, phase, task, run, attempt, artifact and connection identities. Canvas, Kanban, task detail, chats, notebook views and dashboards read those records. A card movement cannot manufacture execution evidence. The interface remains Thai-first with working TH/EN switching and English major headings with Thai support.

Persistent bots retain identity, preferences and appropriate memory across tasks. Temporary helpers belong to a task and have bounded lifetime and tool access. Keep bot identity separate from provider account, harness, thread, role and workspace. Several bots may use one account without sharing every conversation. Private bot chats and project/team rooms operate inside FORGE for v1.

## 2. Core and adapter boundaries

| Layer | Responsibility |
|---|---|
| Product core | Projects, visual plans, teams, conversations, task ownership, execution history, documents, report specifications, artifacts and evidence |
| Project profile | Providers, skills, tools, compute by phase, storage, serving, desktop targets, execution limits and policies |
| Capability adapters | Native coding harnesses/ACP, model APIs, MCP servers, compute, notebooks, serving, storage, tracking and desktop control |
| Local application service | Startup, persistence, connection lifecycle, logs, migrations, health and recovery |
| AG-UI bridge | Project the existing harness/domain lifecycle into typed UI events and reconcile validated UI commands without creating another execution owner |
| Office and report adapters | Embed Univer, persist document revisions, translate report specifications explicitly, manage native WordCraft/PdfCraft jobs and outputs |

Distinguish model APIs from coding harnesses, MCP tools, training compute and the trained model produced by a job. Implement a connection inventory with the requested provider and compute routes; preserve the broader catalog in the product plan. A logo or connection form does not implement an adapter.

Each adapter exposes configuration validation, dependencies, authentication state, connection health, observed capabilities and last verified result. Where applicable it supports execute, status/logs, cancellation, reconnect, transfer and cleanup. Persist provider execution/session IDs beneath FORGE run/attempt IDs. Reconcile after uncertainty before repeating an operation that could duplicate work.

MCP management must support usable install/connect flows, discovery/refresh, enablement by project, tool inspection and meaningful errors. Prefer available maintained MCP integrations where suitable; implement a custom adapter/server when required by an actual missing contract. Simple operation must not require users to edit MCP JSON. Keep advanced import/export available without making it the default path.

## 3. Complete AI engineering capabilities

Provide generic product flows for notebook creation/import/editing, execution target selection, training/job submission and observation, artifact registration, inference testing, serving configuration and model/job dashboards. Tie notebooks, logs, metrics, checkpoints and endpoints to projects and attempts. Distinguish metric provenance and unavailable data; do not fill dashboards with invented performance values.

Treat an execution environment as a capability-qualified target. Owner servers, Colab, Runpod, Vast and additional supported targets must fit the same user-facing lifecycle while preserving their real operational differences. Credentials and access affect live qualification; they do not justify substituting placeholders for required implementation.

For Colab, keep browser-notebook integration and remote API access as separate connection routes. Discover eligibility and runtime capabilities rather than assuming Free guarantees hardware, API access or uninterrupted sessions. Preserve completed outputs outside an ephemeral runtime. Checkpoint resume is available only when the training implementation supports it; otherwise record a new attempt.

LitServe REST/MCP is a requested serving integration. Let the user choose a verified model/preprocessor revision, inspect readiness, test an inference and view logs/metrics. Serving is independent of training location. A notebook kernel does not automatically become a persistent inference service.

Use temporary, harmless engineering fixtures to verify these contracts during development. Do not create a domain product, acquire a research dataset, run a research training campaign or generate a CA-EWS application in this round. The later Windows CPU + Colab Free + LitServe + Drive/Windows/Git profile remains a future selectable use case.

## 4. No-code Settings and storage

Settings provide project defaults and explicit phase overrides. Users select accounts, paths, resources and policies through forms or pickers. Changing one project's profile must not change another project's configuration or rewrite historical run evidence.

| Settings area | User controls |
|---|---|
| Agents and Connections | Bot assignments, model/harness, native sign-in, connection check, available skills/tools |
| Compute and Notebooks | Target, runtime capabilities, concurrency, time/retry limits, permitted fallback |
| Models and Serving | Artifact revision, preprocessing, serving adapter, endpoint and health/inference checks |
| Storage & Sync | Destinations, file routing, save/commit/push, retention, sync and restore |
| Desktop Targets | Main Windows, separate desktop/VM and browser connections, readiness and controller |
| Office & Reports | Document/template defaults, report language, qualified fonts, WordCraft/PdfCraft engines, export profile, optional exchange/conversion dependencies and output routing |

Support local Windows, Google Drive and project Git as independently selectable storage destinations. The previously chosen combination is a future profile, not a requirement that every project use all three. Proposed routing is Drive for model/checkpoint bundles, local storage for workspace and verified inference copies, and Git for source/notebooks/configuration/reports/manifests. Users can change these mappings.

Separate the **FORGE source repository**, whose delivery branch is `main`, from each **user project repository**. Select each output remote and branch explicitly in project setup. Save, commit and push are separate operations and policies. Never synchronize `.git` internals through an ordinary Drive mirror.

Record artifact type, size, checksum, companion files, run/attempt, source/config/environment revision and verified locations. Transfer to staging, verify bytes, then register availability. Expose pending, failed and completed destination states with retry and conflict resolution. A successful Drive transfer does not imply a local copy or Git push succeeded. Restore must select an actual revision; ordinary local deletion must not silently cascade to all destinations.

## 5. Computer use and adaptive execution

Native GUI use must work through target-aware adapters for main Windows and a separate desktop/VM. Browser automation is an additional capability. Training compute and desktop targets are independent: a Colab kernel is not a desktop guest.

Display the target and active controller. One mutable controller owns a desktop at a time, with effective Stop and Take over actions that cancel or reconcile queued input. Parallel GUI tasks require separate qualified targets. A browser-only test does not establish native-app operation.

Hermes-inspired adaptation selects relevant skills on demand and chooses available harnesses using capability, owner preference and measured evidence where available. Keep skill changes versioned and reversible; evaluate improvement candidates before promoting them. Do not claim learned optimization from static routing rules. The single-agent-loop-kit informs efficient execution within tasks while persistent teams and justified helpers remain supported.

## 6. Persistence and portability

Keep portable source/defaults separate from machine-local secrets, accounts, caches, logs and mutable application state. Resolve locations through configuration and OS-appropriate defaults; never embed the developer's absolute Windows home path. Reuse existing T3 persistence ownership where appropriate rather than creating an inconsistent shadow database.

Version the schema, back up before migrations and preserve project history across restart/update. Store secret references in configuration and secret values in the chosen local credential mechanism. Exclude machine state and secrets from Git. Export/import or backup/restore must state which data is portable and which connections require sign-in again.

Implementation completeness, local verification and later home/live qualification are separate recorded facts. Required unfinished code remains unfinished; unavailable credentials leave a specific live check pending. See the acceptance matrix and localhost/home guide for evidence requirements.

## 7. AG-UI at the harness boundary

Implement [10_AGUI_HARNESS_PROTOCOL.md](10_AGUI_HARNESS_PROTOCOL.md). Preserve the T3 provider-turn owner and place an adapter around its observed events. AG-UI conveys agent/UI lifecycle, messages, tools and state; MCP remains the tool/context connection protocol. Multi-bot scheduling and any future A2A connection remain separate concerns.

Map project, bot, conversation, task, run and attempt identities explicitly. Project durable changes into both the planning views and office/report views from the same domain records. Domain mutations use validation, scoped authority and revision checks; a frontend state delta does not directly grant file or desktop access. Large spreadsheets, report binaries and screenshots travel through bounded artifact references instead of repeated full-state payloads.

Treat UI disconnect, user stop, backend failure and successful completion as distinct states. Standard AG-UI HTTP/SSE does not itself resume a truncated response using Last-Event-ID. FORGE must restore snapshots, reconcile actual backend work and prevent duplicated effects before issuing another run. Persist the application evidence needed for that recovery without creating an inconsistent duplicate T3 history store. Do not expose private chain-of-thought as a progress feature.

## 8. Office documents and report jobs

Implement [11_OFFICE_AND_REPORTS.md](11_OFFICE_AND_REPORTS.md). Embed Univer Sheets and Docs inside the selected T3-derived shell with proper mount/dispose lifecycle. Use the public Facade/command surface; human and agent edits share revision checks and attributable undo behavior. Native snapshots and metadata belong to FORGE persistence. Office-format exchange is a separate capability with its actual dependency/license/fidelity limits.

Define a versioned FORGE ReportSpec linked to source artifacts, table/figure data, citations, template and locale. Convert it explicitly to the selected WordCraft document model, then produce DOCX and PDF from the same recorded revision. PdfCraft supplies qualified PDF operations and optional conversion; current native Office-to-PDF conversion requires installed LibreOffice. A Univer snapshot is not a WordCraft document, and a PDF is not the canonical editable source.

Run WordCraft/PdfCraft through isolated local engine adapters using the actual CLI/MCP contracts. They are native engines, not components to import directly into React. The launcher/settings must locate or install qualified binaries and fonts; normal users must not compile Rust or configure raw MCP command arguments. Current WordCraft headless MCP requires read/write roots and refuses connection to an existing desktop app; honor that boundary. PdfCraft's synchronous exports do not supply native progress/cancellation notifications, so show truthful waiting state and reconcile process-level interruption.

Version report jobs and output artifacts independently of editable source. An export passes only after file validation and registration; preserve partial/unverified outputs outside the completed artifact list. Save, export, sync, Git commit and Git push have separate outcomes. Engine/fidelity evidence includes mixed Thai/English, font embedding, tables, figures and pagination on the supported Windows build.

## 9. Model catalog reliability

Keep each model catalog associated with the actual provider instance, account route and executable/runtime. Expose freshness and refresh errors without falsely removing otherwise usable cached models. A slow discovery response must not silently become a claim that a model does not exist. Exact model IDs and reasoning controls come from observed capabilities; an editable custom ID does not grant provider access. The installed development T3 and FORGE's incorporated T3 code are separate installations: diagnosing or fixing one does not establish a fix for the other.
