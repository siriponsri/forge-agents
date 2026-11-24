# AG-UI at the FORGE Harness Boundary

Status: required v3 implementation. AG-UI is part of this product scope, not an optional research item. Keep the existing complete no-code localhost target and defer prototype creation.

## Architecture placement

Use AG-UI between FORGE's agent/harness service and its user-facing application. Keep actual T3 GUI/server/provider-thread integration beneath and beside that bridge as appropriate. Do not introduce a second planner, a second provider-turn controller or an unrelated AG-UI demo app.

| Boundary | Responsibility |
|---|---|
| T3/provider execution | Own the actual coding session, provider turn, changes and native lifecycle |
| FORGE task/harness services | Assign work, enforce the selected project policy, persist attempts and evidence, choose compatible capabilities |
| AG-UI bridge | Translate observed run/message/tool/state/activity events into the pinned protocol and accept supported user interactions |
| GUI projection | Render conversation, plan, progress, tool cards, document/report activity and recoverable setup states |
| MCP adapters | Connect tools/resources such as compute, storage and document engines; preserve their actual tool semantics |
| Team coordination | Persist delegation/ownership and optional inter-agent transports separately from the UI protocol |

The core concept is a protocol adapter around actual execution. It must not become a mock stream that makes unsupported features look live. Source details and observed versions are in [AGUI_INTEGRATION_RESEARCH.md](reference/research/AGUI_INTEGRATION_RESEARCH.md).

## Identity and event ownership

Create a documented mapping for project, bot, task, conversation, provider session, attempt and AG-UI `threadId`/`runId`. Do not equate a whole long-lived task with a single provider turn. Track parent/subagent relationships and preserve attribution in task history.

Use schema-compatible typed events and a pinned SDK. Producer validation uses the declared protocol contract; consumer compatibility follows the selected SDK's version rules. FORGE-specific values use documented extension carriers rather than invented protocol members.

| Observed behavior | UI/protocol treatment |
|---|---|
| Provider run begins | Start the mapped protocol run with its real identity |
| Text streams | Message lifecycle and content events, preserving IDs |
| Tool arguments finish | Argument completion only; validate before dispatch |
| Tool execution returns | Record actual result/error and resulting domain revision |
| Plan/document state changes | Publish an authoritative projection snapshot or valid delta |
| Backend pauses for required input | Use supported interrupt/resume semantics and the existing policy |
| User stops execution | Send the real cancellation request and show outcome only when known |
| Connection drops | Mark the observation truncated/disconnected; reconcile backend state |
| Report artifact is ready | Publish verified artifact/revision metadata, not merely an agent assertion |

No protocol terminal event automatically marks a task's acceptance criteria passed. Tool-call argument completion is not a successful tool result. Pending frontend calls must be answered before their thread continues according to the protocol; the bridge must not fabricate those results.

## Shared state without duplicate authority

The authoritative application services own plans, task state, documents, workbook revisions, reports and artifact locations. AG-UI transports a projection of that state. It is not an independent database that may disagree with Kanban, Univer or the report queue.

Apply user and agent edits through the same validated command boundary. A GUI patch must not grant tool permissions or bypass workspace/revision checks. Use optimistic revision checks or a suitable serialized writer policy; on conflict, return an actionable result and refresh the relevant projection.

Maintain identifiers for sheets, documents, report sources and artifacts. Send selected context and revision references for large content. Do not stream whole documents for every event, expose account secrets in shared state, or treat client-supplied state as proof that a backend action happened.

## Transport and recovery

Use the standard HTTP/SSE binding as the initial interoperability route unless the actual T3 integration needs another documented transport. A POST initiates a protocol run and the response carries events. The pinned 1.0 HTTP/SSE binding does not provide `Last-Event-ID` stream resumption.

FORGE recovery therefore happens at the application layer: persist the task/attempt and provider execution identity; query actual status after disconnect; restore a current snapshot and message state; submit a new run only when it is needed and cannot duplicate an already-started action. Do not re-run a training submission, sheet mutation or report export merely because a browser reconnected.

Support Stop/Take over through the actual harness/target controls. Closing a browser stream alone must not be presented as a confirmed remote cancellation. Preserve partial outputs and distinguish completed, interrupted, stopped, failed and unknown states.

Replay is display/state reconciliation. It must never execute tool calls again. For frontend tools, implement the documented result-return path and reuse already established owner policy; AG-UI does not require adding a confirmation prompt to every normal action.

## No-code visible behavior

Users see streaming replies, current bot/task, tool actions, phase progress, pending input, document edits and report status in the existing FORGE interface. They can stop, retry appropriately, review changes and open artifacts. Raw protocol JSON remains a diagnostic option rather than a normal user workflow.

Expose appropriate provider-produced summaries and observable progress only. Do not request hidden chain-of-thought or reveal opaque reasoning payloads as a debug feature. Subagent status must retain bot/task attribution.

## Verification

Add meaningful checks for:

- A provider-backed run reaching the existing T3 thread and GUI through the bridge, when access exists.
- Message/tool/state ordering and distinct frontend versus backend tool results.
- A stopped run and a dropped stream producing truthful status.
- Reconciliation without duplicate side effects or duplicate conversation text.
- Two projects/bots and two document revisions retaining correct scope.
- A sheet/document mutation followed by reload and a report event resolving to actual saved output.

Use focused fixtures to test failure semantics and a harmless actual operation to qualify the live path. Keep NOT_RUN for unavailable providers explicit. Do not create a prototype product to satisfy protocol acceptance.
