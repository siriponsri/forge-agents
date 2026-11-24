# Component Reuse and Requirement Coverage

This map preserves every named upstream reference and the associated product intent. Contributions below are **integration directions to inspect**, not claims that code has already been imported or that every repository exposes a stable package API. Pin and inspect the selected revision/license when incorporating code.

## Named repository references

| Reference | Intended contribution to FORGE | Integration boundary and required evidence |
|---|---|---|
| [T3 Code](https://github.com/pingdotgg/t3code) | Actual application UI, thread/project flows, diff/review and matching provider/server lifecycle | Mandatory actual foundation; identify upstream revision, reused source, modifications and real task-to-thread path |
| [Orca](https://github.com/stablyai/orca) | Task lifecycle, attempts, workspaces and review patterns | Adopt compatible code or behavior without introducing a competing task owner; record disposition |
| [Paseo](https://github.com/getpaseo/paseo) | Session/client connection, recovery and remote-agent patterns | Reuse compatible modules or design findings; do not add an unrelated second application to simulate integration |
| [Happy](https://github.com/slopus/happy) | Session continuity, connection recovery and client/runtime patterns | Consider actual compatibility and licensing; keep FORGE's v1 communications inside FORGE |
| [Agent Orchestrator](https://github.com/OrchestratorInc/agent-orchestrator) | Bounded workers, worktrees and lifecycle mechanisms | Preserve useful existing FORGE adapter work; one authoritative planner/execution ownership model |
| [single-agent-loop-kit](https://github.com/anthropics/single-agent-loop-kit) | Efficient task execution and evaluation feedback | Improve loops inside a task; do not remove persistent teams or justified helpers |
| [Hermes](https://github.com/NousResearch/hermes-agent) | Skills on demand, adaptation, capability-aware harness choice and learning from outcomes | Scoped/versioned skill candidates, understandable selection and measured evidence; do not label rules as a learned optimizer |
| [OpenBot](https://github.com/nightly-labs/openbot) | Persistent bot identity, roles, teams and conversation semantics | Review the exact license before copying; a behavior reimplementation may be appropriate while retaining required UX |
| [AG-UI](https://github.com/ag-ui-protocol/ag-ui) | Typed agent/harness-to-GUI events, state projection and supported user interactions | MIT protocol/SDK bridge around actual T3-backed execution; pin compatible schema/SDK, keep one turn owner and implement application-level recovery |
| [Univer](https://github.com/dream-num/univer) | Embedded Sheets/Docs editing, formulas, document commands and shared human/agent artifact surfaces | Apache-2.0 core; FORGE owns persistence/revision policy. Exchange, collaboration and advanced modules have separate boundaries/licensing; qualify enabled optional features and do not promise unlimited watermark-free conversion |
| [WordCraft](https://github.com/storytold/wordcraft) | Structured document/report automation, editable DOCX and direct PDF generation | Dual MIT OR Apache-2.0 native engine with CLI/headless MCP; use confined sessions, pinned qualified binaries and output inspection. It is not a drop-in React editor or an assumed live connection to its desktop window |
| [PdfCraft](https://github.com/storytold/pdfcraft) | PDF inspection/rendering, supported page operations and report postprocessing | Dual MIT OR Apache-2.0 native CLI/headless MCP adapter; respect synchronous operation/progress limits. Office conversion is a separately qualified installed-LibreOffice route, not a guaranteed browser/WASM feature |

The implementation should record for each row: source revision checked, license/notices, adopted files or dependency, design-only use, reason for alternatives, related FORGE modules and acceptance evidence. No requirement says to fork every runtime wholesale.

The four v3 additions are required product integrations at their documented boundaries. Their inspected versions, source/licensing evidence and capability limitations are recorded in the focused research below. Preserve appropriate third-party attribution and inspect separately licensed fonts, assets, native dependencies and brand marks when packaging; the top-level code license alone does not settle every bundled file.

## Capability and component families

| Family | Required output | Reference to consult |
|---|---|---|
| Planning and GUI | T3-based shell plus shared visual plan, phase, Kanban and task detail | [Planning/UI research](reference/docs/research/PLANNING_UI_MCP_RESEARCH.md) |
| Model/harness connectivity | Prioritized native/provider/API routes plus custom compatible providers | [Provider research](reference/docs/research/PROVIDER_MCP_RESEARCH.md) |
| Compute and notebooks | Local/owner-server/Colab/Vast/Runpod adapters and notebook/job lifecycle | [Compute research](reference/docs/research/COMPUTE_MCP_RESEARCH.md) |
| Serving and monitoring | Artifact-linked inference, weights, model health and observable runs; requested LitServe MCP | [Training/monitoring research](reference/docs/research/TRAINING_MONITORING_MCP_RESEARCH.md), [LitServe MCP docs](https://lightning.ai/docs/litserve/features/mcp) |
| Native and browser GUI use | Separate main Windows, desktop/VM and browser targets | [Computer-use research](reference/docs/research/COMPUTER_USE_MCP_RESEARCH.md) |
| Storage | Editable local/Drive/project-Git routing and recovery | [Storage requirements](reference/docs/PROJECT_STORAGE_SETTINGS_TH.md) |
| Harness-to-UI protocol | Real message/tool/state/activity projection with stable identity and recovery | [AG-UI contract](10_AGUI_HARNESS_PROTOCOL.md), [AG-UI research](reference/research/AGUI_INTEGRATION_RESEARCH.md) |
| Editable office artifacts | Embedded Sheets/Docs, native snapshot save/reopen, formula behavior and agent edits through revision-aware commands | [Univer research](reference/research/UNIVER_INTEGRATION_RESEARCH.md) |
| Report Studio | Versioned report source, WordCraft DOCX/PDF, PdfCraft preview/page operations, TH/EN rendering and artifact provenance | [Report-engine research](reference/research/REPORT_ENGINES_RESEARCH.md) |
| Model catalog resilience | Actual provider-instance catalogs, refresh/freshness/error visibility and continued use of available models | [T3 model-discovery research](reference/research/T3_MODEL_DISCOVERY_RESEARCH.md) |

Existing open-source GUI, graph, notebook, metrics and desktop components in those reports are candidates. Select suitable dependencies instead of recreating well-supported functionality, but preserve compatible licensing and the coherent T3 application/runtime boundary.

## Integration coverage policy

Maintain [progress/INTEGRATION_LEDGER.md](progress/INTEGRATION_LEDGER.md) for every named provider, compute target and requested connector. Keep implementation coverage separate from installed dependencies, account readiness, advertised capabilities and observed live qualification.

An MCP server may expose tools without supplying the model, coding harness, job scheduler or metrics instrumentation. A wrapper should map real supported operations, preserve execution IDs, handle failures/cancellation and return structured evidence. Use the API/SDK directly when it is the appropriate boundary; MCP is a connection option, not a reason to add a second execution owner.

AG-UI projects accepted domain changes to the UI; it does not replace MCP tool execution, the task scheduler or authoritative document storage. Keep Univer snapshots, report source, native engine state and emitted files as distinct versioned representations with explicit adapters. A stream event or successful save in one representation cannot claim that another representation or destination has been updated.

Package report engines through the no-code setup path and expose their actual capabilities. Discover versioned MCP schemas; do not assume desktop-connect support, native percentage progress, cancellation acknowledgement or arbitrary file-format fidelity. Keep localhost editing usable when an optional conversion dependency is absent.

The owner reports a missing GPT-6.2 entry in T3. The diagnosis research identifies relevant upstream evidence but does not inspect the owner's machine or establish a fix. Develop with the exact model that works, record its actual ID/options and qualify 6.2 separately if available. FORGE's catalog implementation should handle stale or partial discovery without hard-coding one model as a prerequisite.

Requirements for AI-project output remain product capabilities this round. Verify them with engineering fixtures where possible; the archived CA-EWS plan is not an active application-building task or release benchmark.
