# AG-UI Integration Research

Reviewed 2026-11-24, Asia/Bangkok. Read-only inspection through the GitHub connector and official protocol documentation. No package installation, native-provider connection or FORGE integration test was performed.

## Inspected source

- Repository: [ag-ui-protocol/ag-ui](https://github.com/ag-ui-protocol/ag-ui).
- Observed main commit: `c31e1e819e3a3c3b4af14add04f5b9a9a0208cae`.
- At that revision, TypeScript `@ag-ui/core` and `@ag-ui/client` package manifests report `1.0.5`; the repository license is MIT. This is a research snapshot, not an instruction to follow a mutable main branch in production.
- The repository includes a frozen [1.0 schema](https://github.com/ag-ui-protocol/ag-ui/blob/c31e1e819e3a3c3b4af14add04f5b9a9a0208cae/spec/1.0/schema.json) and generated SDK definitions. Pin compatible published SDKs and protocol behavior when implementing.

Primary files: [README](https://github.com/ag-ui-protocol/ag-ui/blob/c31e1e819e3a3c3b4af14add04f5b9a9a0208cae/README.md), [core package](https://github.com/ag-ui-protocol/ag-ui/blob/c31e1e819e3a3c3b4af14add04f5b9a9a0208cae/sdks/typescript/packages/core/package.json), [client package](https://github.com/ag-ui-protocol/ag-ui/blob/c31e1e819e3a3c3b4af14add04f5b9a9a0208cae/sdks/typescript/packages/client/package.json), [license](https://github.com/ag-ui-protocol/ag-ui/blob/c31e1e819e3a3c3b4af14add04f5b9a9a0208cae/LICENSE).

## Role in FORGE

AG-UI standardizes the event interaction between an agent and a user-facing application. The project distinguishes this from MCP's tool/context boundary and A2A's agent-to-agent boundary. It does not replace FORGE's scheduler, coding harness, provider account or native desktop driver. [Protocol roles](https://docs.ag-ui.com/agentic-protocols)

**Design proposal:** integrate an AG-UI bridge around FORGE's existing T3-backed execution lifecycle. The bridge projects real messages, tool activity, task state and results to the GUI. Keep one provider-turn owner and one persistent domain model. The AG-UI starter's separate application template is not a reason to replace the selected T3 foundation.

## Event semantics that affect implementation

Run lifecycle distinguishes normal completion, interruption awaiting input, cancellation and failure. A consumer losing its connection has not observed cancellation or success. A producer that stops cleanly reports the cancelled outcome; the GUI must retain partial results without calling the task verified. Protocol success and domain acceptance are separate facts. [Lifecycle](https://docs.ag-ui.com/spec/1.0/events/lifecycle)

Tool arguments stream as text; the executor waits for argument completion and validates them. `TOOL_CALL_END` means argument transmission ended, not that execution succeeded. A frontend-executed tool is answered by the application through the subsequent run's messages; a backend must not invent its frontend result. The ordinary frontend-tool round trip differs from an explicit interrupt/resume. [Tool calls](https://docs.ag-ui.com/spec/1.0/events/tool-calls)

State snapshots replace the projected state, while state deltas apply RFC 6902 patches to the current baseline. Message snapshots have their own reconciliation semantics. Use the SDK's protocol rules rather than treating every event as an arbitrary shallow merge. Validate state values before using them as application commands and keep secrets out of round-tripped state. [State](https://docs.ag-ui.com/spec/1.0/events/state)

The standard HTTP/SSE binding is a POST with `RunAgentInput`, followed by complete JSON events in the response stream. It does not use SSE `Last-Event-ID` resumption. A dropped response is truncated; submitting again is a new protocol run. Therefore FORGE must supply its own persisted execution reconciliation and state recovery instead of promising automatic transport-level continuation. [HTTP/SSE](https://docs.ag-ui.com/spec/1.0/basic/transports/http-sse)

## Proposed FORGE implementation contract

Persist explicit mappings between project, bot, task, provider session, conversation/thread, execution attempt and protocol run. Stable identity and actual lifecycle observations drive the UI. Reconcile any still-running backend job before submitting a new action after disconnect.

Use domain service commands for plan updates, notebook jobs, sheet edits and report jobs. Publish their accepted revisions through AG-UI rather than letting a UI state patch bypass persistence. A replayed display event must not re-execute a tool or create a second report.

Keep large workbooks, documents, model weights and PDFs in the artifact/document service. Stream compact revision references, selected-range context and progress metadata. Events must not contain an entire workbook at every token or binary model files masquerading as shared state.

Use the protocol's supported extension carriers for FORGE-specific metadata and version them. Do not invent incompatible event types or assume unknown receiver fields will survive. Preserve only appropriate provider-exposed summaries and observable progress for display; do not request or store private hidden reasoning. Opaque provider values should remain opaque.

AG-UI supports events that describe subagents, but FORGE still owns assignment, isolation, policy and result integration. Show distinct bot/run identities instead of flattening all workers into a single assistant message.

## Acceptance to add

Exercise a real T3-backed bounded run through the bridge when a provider is available, plus meaningful local protocol fixtures. Verify message/tool lifecycle, project isolation, state reconciliation, a stopped run, a dropped stream, pending frontend-tool results, and stale document revisions. Do not require a prototype product to test these contracts.

Tests should specifically establish that a browser disconnect does not falsely complete/cancel a job, reconnect does not duplicate an action, replay does not invoke tools, and a successful report event points to a verified artifact. Source/schema checks alone do not prove runtime integration.
