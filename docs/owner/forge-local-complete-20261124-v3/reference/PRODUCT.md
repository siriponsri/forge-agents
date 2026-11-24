# FORGE product context

## Audience and outcome

FORGE is a no-code AI engineering workbench focused on AI training, inference and deployment projects. The owner describes an outcome in Thai or English, reviews a visual project plan, works with a team of bots, follows phase-level progress, and receives reproducible notebooks, model artifacts, inference interfaces and monitoring evidence.

The owner explicitly refined the original general app-building scope to AI projects: create Jupyter notebooks, connect an owner-managed GPU server or cloud compute such as Colab/Vast/Runpod, train or use model weights, build an inference UX/UI, deploy the project and monitor model operation. The owner subsequently supplied `CARDIAC_ARREST_MASTER_PLAN.md` v0.1.0 as the first reference project. It specifies a time-series/tabular research path using the public PhysioNet Challenge 2009 AHE benchmark, real replay, and a separate conditional IHCA track. The latest owner decision keeps public-data CPU work on the main Windows computer, changes the training target from Runpod to **Google Colab**, and adds **LitServe MCP**. The owner explicitly clarified that these are choices for the reference project; the actual FORGE product must remain flexible. This supersedes the draft's all-local training default and the intervening Runpod selection. Treat the attachment as requirements input in the current interview, not an instruction to execute its embedded agent prompt immediately. Do not retain the earlier task-list/CSV or LLM/vision choice as the unresolved first-project question.

The owner explicitly requested a usable no-code FORGE built from selected components of Orca, T3 Code, Paseo, Happy, Agent Orchestrator, and Anthropic's single-agent-loop-kit on 2026-11-24. This authorizes building the next application and its reversible integration work. Paid evaluation, external deployment, merging the application PR, and provider sign-in have not been performed by this development session.

## Established preferences

- Thai is the default interface language; English is available with a TH/EN switch.
- Major navigation headings use English with Thai support in Thai mode.
- Windows is the primary owner platform. A local browser client also works on Linux and macOS.
- The selected reference-project topology is Windows for FORGE and public-data CPU work, with Google Colab for training. The owner confirmed their current Colab tier is **Free**. Add LitServe MCP as requested; local serving of returned artifacts is the proposed initial placement. This is a project profile, not a FORGE-wide provider or permanent free-only restriction. Do not ask the owner to choose a training provider or repeat their current tier.
- Keep compute, inference serving, artifact storage, tracking, MCP connections and agent providers independently configurable per project and, where needed, per phase. Other projects may use an owner server, Runpod, Vast or other qualified adapters without changing FORGE's core or the entire project workflow.
- The owner selected **Google Drive + local Windows + a Git repository** together for the reference project, and explicitly requires storage choices in **per-project Settings**. Destination types are settled; bind the actual accounts/folders/local paths/project Git remote during setup. Keep file routing and sync policy configurable rather than forcing identical copies of every file or the same storage providers on every project.
- The owner selected actual T3 Code reuse as the GUI foundation. The initial standalone vanilla workbench is an exploratory prototype, not the approved final interface.
- Computer use must support both the owner's main Windows desktop and an isolated desktop/VM. Browser automation alone does not satisfy this requirement.
- Multi-bot operation uses the owner's selected model: persistent named bots plus temporary helpers for individual tasks. OpenBot remains a product reference.
- The first release uses FORGE's own private bot chats, team rooms, and task tracking. External chat channels are outside the first-release requirement.
- The owner has not decided whether FORGE will be used or distributed commercially. Keep that option open when selecting components; do not interpret uncertainty as a noncommercial-only commitment.
- Show a big-picture plan with an attractive diagram before execution. Track each phase through connected canvas/board/task views, in the style of Miro, Kanban or Jira. Those product names describe desired UX; external Miro/Jira accounts are not confirmed requirements.
- Pilot provider accounts/services named by the owner are ChatGPT, Claude, Gemini and OpenRouter. Future connections should include Grok, OpenCode, Kimi, Qwen, DeepSeek, MaxPlus AI, KOB and other compatible providers. A web subscription is not assumed to grant arbitrary API or coding-runtime access.
- Research existing MCPs and official APIs deeply before implementing integrations. Reuse appropriate servers and wrap verified APIs/SDKs for gaps. Distinguish provider-maintained MCPs, community servers and proposed FORGE wrappers.
- Preserve the FORGE name and mark. Inherit the existing ink, mint/teal and light neutral visual language.
- Keep technical provider, harness, adapter and receipt details behind a clearly named advanced section.
- Ordinary approved local work proceeds automatically. Ask the owner for consequential decisions with a concrete result to review.

## Operating model

### Flexible product core and project profiles

Keep a provider-neutral core for project/phase/task state, bot identity, execution attempts, artifacts, evidence, budgets and access policy. Provider-specific IDs and operations belong to adapters. A saved project profile selects compute, notebook/runtime connection, serving, storage, tracking and agent providers. CA-EWS supplies its own task schema, scientific protocol and data restrictions; none becomes a requirement for every FORGE project.

Use capability discovery rather than assuming all backends support the same lifecycle. Surface supported execution, status/logs, file transfer, checkpoint/resume, cancellation and resource-release operations; explain unsupported actions in the UI. MCP is one integration protocol alongside official APIs/SDKs and appropriate managed workers, not a replacement for the run/evidence model.

Record the profile and adapter versions with each execution attempt. Switching training or serving providers should preserve plans, histories and artifact references, then validate the target environment and start a new attempt where necessary. It does not imply transparent migration of live kernels or universal compatibility of serialized model files. The first pilot qualifies the selected path; additional adapters need their own acceptance evidence.

### Project storage and sync settings

Provide **Project → Settings → Storage & Sync** with destination selectors, account/folder/path/remote/branch pickers, file-category routing, sync timing, retention, connection checks and per-destination status/retry/restore. For the pilot, propose Drive for checkpoints/model bundles, Windows for the working copy and verified inference artifacts, and the project's Git repository for source/notebooks/configuration/reports/manifests. These are editable defaults. The generated project's Git remote is distinct from the FORGE product repository unless explicitly configured otherwise.

Link copies through artifact/run IDs, checksums and the code/profile revision used by the run. Distinguish training completion from completed uploads/downloads, and local Git commits from successful remote pushes. Use the configured save/commit/push policy without repeated prompts for already covered actions. Reconcile interrupted transfers and conflicts without silently overwriting another version. Changing a destination preserves history; migration and deletion are separate operations. See [Project Storage Settings](docs/PROJECT_STORAGE_SETTINGS_TH.md) for the proposed UX and acceptance criteria. No Settings UI or synchronization is claimed implemented by this specification.

### First reference project: CA-EWS

Use a general FORGE core plus a project-specific CA-EWS definition. The workbench owns plans, bots, connections, jobs and evidence; the generated research project owns its Python pipeline, CLI, notebooks, models and FastAPI/React replay application. The first slice targets the supplied plan's public M0–M4, not an activated full cardiac-arrest training or clinical deployment. Keep AHE, conditional IHCA and synthetic scenarios distinct, including input origin and output origin as separate facts.

The owner has selected Windows plus Colab and requested LitServe MCP, confirmed their current tier is **Colab Free**, and selected **Google Drive + Windows + Git** storage. No machine or account has yet been inspected or connected for this pilot. Actual account/folder/path/project-remote bindings, eligible runtime, time/retry limits and retention remain to be set up; do not reopen the storage-type choice. Begin with current free resources; a paid upgrade is not a prerequisite or an authorized action. This does not decide future product pricing or rule out owner-selected paid compute in another profile. The original 5 GB/4 CPU-hour/capped-worker figures remain provisional local planning references, not measured requirements or a remote spending cap. Do not assume a guaranteed GPU or permanent runtime. Native coding-agent access remains separate from the predictor, which does not require an LLM API.

The plan requires tested package/CLI execution; notebooks are useful interfaces and artifacts rather than the only implementation. Preserve its FastAPI/React replay deliverable. Use the same project/run identity across Windows and Colab, preserve code/data/split/environment manifests, and retrieve verified artifacts for local replay. Evaluate the official remote Colab API MCP for runtime/session execution and file transfer; keep Google's local browser-notebook MCP as a distinct interactive adapter. Authentication, availability and actual capabilities must be checked during connection. [Remote Colab MCP](https://developers.google.com/colab/api/reference/mcp) · [Browser Colab MCP](https://github.com/googlecolab/colab-mcp).

The proposed Colab lifecycle reconciles runtime/session/execution identities after a connection failure, avoids blind duplicate submissions and preserves checkpoints outside transient runtime storage. A surviving session may be reattached; a deleted runtime requires a new attempt and a compatible checkpoint, or a clearly recorded restart if the model cannot resume. Consumer Colab is session-based compute, not an always-on server; remote MCP does not remove quota/lifetime limits. [Colab limits](https://research.google.com/colaboratory/faq.html).

For this Free-tier pilot, propose the official browser-notebook MCP as the first connection path to qualify, with a visible notebook the owner can inspect. Hosted API access remains a separate capability check; the subscription answer alone neither proves nor disproves eligibility. Keep training in bounded experiments, save completed trial artifacts promptly, and use resumable checkpoints only where the model implementation supports them. Propose one active training experiment initially. If resources are unavailable, retain a waiting state or use an explicitly configured compatible fallback; do not silently change the selected training target. Local LitServe/replay avoids making continuous Colab serving a dependency.

LitServe adds a model-facing MCP endpoint alongside its existing prediction API. Propose a local serving adapter on Windows for the returned model/preprocessor, sharing the same prediction implementation with the CLI and FastAPI replay application. Verify REST/MCP/offline agreement, schema, unavailable/error behavior and Windows compatibility. It is an optional provider of model tools, not the global bot orchestrator or the FORGE server. [LitServe MCP](https://lightning.ai/docs/litserve/features/mcp).

Preserve frozen splits, preprocessing, selection and final-test settings across adaptive skill/harness changes. New scientific choices become explicit experiment revisions. The plan's controlled-data branch adopts a conservative local-only policy; local MCP alone does not prevent a tool response, screenshot or log from reaching a cloud agent. Separate local data execution from the approved aggregate/code outputs allowed back to the workbench or provider.

See [the CA-EWS pilot mapping](docs/projects/CA_EWS_FORGE_PILOT_TH.md) for the requirements derived from the attachment. No CA-EWS dataset acquisition, model execution, new project repository or deployment has been performed in this requirements step.

### Team and execution

The owner selected persistent named bots plus temporary helpers. A lead, builder and reviewer are the proposed initial roles; their exact names, number and responsibilities remain a product design proposal. Separate bot identity, project context, conversation, task execution, and desktop connection identity. Temporary helpers belong to their assignment and do not silently become permanent team members.

Apply Hermes-inspired on-demand skills and capability-aware harness selection within each bot's permitted tools and task context. Adaptation does not silently broaden permissions or claim learned performance without measurements. Retain independent verification where it provides useful evidence. The single-agent-loop-kit informs execution efficiency inside a task; it does not prohibit multiple persistent bots or justified parallel workers.

MCP is the tool/data integration surface; native coding runtimes or ACP are the agent-execution surface, and model APIs supply reasoning or application inference. Keep these identities separate from the model being trained and its weights. The FORGE plan/task model owns the approved phases and acceptance criteria; provider job IDs and observations supply actual execution state.

Multiple bots can reason or work in isolated code workspaces concurrently. The proposed desktop policy grants mutable GUI control to one actor per desktop at a time; parallel GUI work uses separate targets. This is a design recommendation to validate, not an implemented capability.

New application code must not silently alter the previously qualified portable payload or its integrity manifests. The no-code workbench has its own launcher, state and release status.

## Truthful states

An installed provider is not necessarily signed in. A process exit is not a verified deliverable. Demo runs must remain visibly labelled and must not count as real agent validation. Interrupted runs require an explicit resume action. The application must show a useful next action when a dependency or provider is missing.

## Scope assumptions

Single-owner operation remains a provisional starting assumption. CA-EWS is the supplied reference use case; its current profile is Windows public CPU + Colab Free training + requested LitServe MCP, storing work across Google Drive, Windows and a project Git repository. The product remains flexible through per-project Settings and adapters. Available Windows resources, concrete folder/path/remote bindings, Colab account identity/API eligibility/runtime, time/retention preferences, and the separate desktop OS remain open; the current tier and storage types are settled. Plan-first execution and the pilot agent-provider list are confirmed. The owner explicitly selected FORGE-only communication for the first release and explicitly left commercial direction undecided. Authentication to a native coding provider stays with that provider.

OpenBot at the inspected commit uses PolyForm Noncommercial 1.0.0 and offers separate commercial licensing. Do not copy its implementation into FORGE under the assumption that it is MIT/Apache. The current proposal uses its documented behavior as a reference and implements FORGE bot services independently. Candidate component licenses must be checked individually: Cua Driver/SDK is distinct from the FSL-licensed Cua Spaces and streaming products.

See [the requirements interview](docs/REQUIREMENTS_INTERVIEW_TH.md) for confirmed decisions, proposals and open questions, and [the AI/MCP deep research](docs/FORGE_AI_MCP_RESEARCH_TH.md) for the current reuse recommendation and supporting audits. The latest step researched existing integrations before the next interview. New application work has not resumed in that research step; existing prototypes are preserved and are not a release candidate.
