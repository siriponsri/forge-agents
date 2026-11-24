# Protocol worker handoff — 2026-11-24

Branch `t3/agui-t3-lifecycle`, base `10e38aa`. Only assigned protocol/server/test
paths changed. No push, main/PR changes, shared contract/schema/manifest changes,
legacy changes, prototype, credential migration, or public service.

Observed worker settings from actual `orchestrator_capabilities`:
`providerInstanceId=codex`, `model=gpt-6.1-sol`, options
`reasoningEffort=xhigh`, `serviceTier=default`, `cyberAccessProgram=standard`.
No child agents were started by this worker.

## Implemented behavior

`app/protocol/controller.mjs` observes the existing T3 run; it does not plan,
launch provider turns, run frontend effects, or apply document/report commands.
The existing MCP launch path remains in `app/server/t3.mjs`.

- Native authenticated `orchestration.getThreadProjection`, `getTurnItem` and
  `subscribeThread` feed; proper Effect RPC Request/Exit/Chunk/Ack framing.
  Feed events trigger reads of current native authority, including corrections
  to existing items. Withheld tool outputs use `getTurnItem`.
- Optional explicit `reconcile(id,{source:'mcp'})` reads paginated activity and
  continued text. MCP activity titles/text cannot establish structured arguments
  or tool results, so this fallback does not invent tool events.
- Native `dynamic_tool` complete JSON input and `command_execution` input map to
  START/ARGS/END. END means argument completion. A RESULT requires a terminal
  native item with an actual output; missing/cancelled/nonexecuted outputs remain
  explicit observations. Exit code, failure and nonexecution metadata are kept
  in projected tool state. Result corrections reconcile through message snapshots.
- Incremental public assistant text retains message IDs; non-prefix corrections,
  removals, reorders and changed tool messages replace the message projection.
  Recovery snapshots include tool declarations and tool-role results. Opaque
  reasoning, raw provider sessions and credentials are not persisted by the adapter.
- Every validated AG-UI event has a durable per-run source receipt, event ID and
  sequence committed atomically in the existing SQLite domain transaction.
  Repeating the same observation emits no duplicate text, result or terminal event.
  Repeated real state transitions still publish, including A/B/A/B transitions.
- State snapshots/deltas contain run/task identity/status, pending inputs and
  permissions, tool status, native attempt references and document/report/artifact
  revision references. These are projections of domain authority, not commands
  or permission-bearing client state. No document bodies or account profiles.
- Stop targets the mapped `providerRunId` with `t3_thread_interrupt`, not
  `stop:true` (which ignores runId and can stop a different later thread turn).
  `interrupt_requested` is an acknowledgement, not confirmed cancellation.
  A durable stop reservation prevents repeated stops after uncertain responses.
- Explicit detach/read-feed close sets nonterminal state to unknown, retaining
  `lastKnownStatus`, partial messages and all execution identities. Reconnect reads
  and subscribes to that existing thread; it cannot launch/resubmit tools, edits,
  jobs or answers. There is no automatic reconnect/effect retry or SSE resumption.
- Restart recovery marks stale connections and in-flight response receipts
  uncertain. Unknown submissions without an observed thread are not automatically
  retried. A different thread/latest run can never complete this mapped attempt.
- Supported user questions use real `t3_pending_request` list/respond. Native
  permission requests use explicit `runtime-request.respond` with single-request
  `accept`, `decline` or `cancel`, validated against the mapped run. Neither route
  fabricates a tool result; both reserve durable receipts before dispatch. Broad
  session/always-accept decisions are not exposed.

FORGE-only native read credentials use a fresh scoped pairing bootstrap,
`POST /oauth/token`, and one-use `POST /api/auth/websocket-ticket`. Tokens remain
in memory and are never returned in domain events/health/evidence. Read feed has
only `orchestration:read`. An explicit permission answer gets a separate temporary
`orchestration:operate` channel, closed and revoked afterward. All state/runtime
files stay under the selected FORGE dataDir; no development T3 session is imported.

Two launcher issues found while qualifying are fixed: repeated tasks reuse an
already registered project instead of failing `project add`, and failure before
launch is distinguished from an ambiguous submitted launch. The selected workspace
path is included explicitly in the provider prompt. A plan approval and project
scope checks remain required; active/queued/waiting/unknown attempts block overlap.

## Exact upstream contract and blocker

Inspected the pinned T3 **0.1.11** source archive at commit
`59651c1761f6c63e9b6056839067066968e6a406` (MIT), matching the retained vendor launcher
and runtime release. No upstream source was copied into protected/vendor paths.

- [MCP timeline/read/send/interrupt schemas](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/orchestratorMcp.ts#L446)
  expose timeline text/status, not structured tool input/output. Send takes a text
  message, not AG-UI tool-role messages.
- [Native turn items and runtime requests](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/orchestrationV2.ts#L1322)
  include dynamic-tool request kinds, but the supported
  [runtime-request.respond command](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/orchestrationV2.ts#L3553)
  accepts only `decision`, `feedback`, `answers`, `attachmentsByQuestionId` alongside
  command/thread/request IDs. There is no arbitrary tool output payload.
- [Native RPC methods](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/orchestrationV2.ts#L4580),
  [RPC framing/backpressure tests](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/apps/server/src/terminal/OutputProtocol.test.ts#L30),
  [native authentication routes](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/environmentHttp.ts#L590),
  and [MCP-audience isolation test](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/apps/server/src/auth/McpOAuth.test.ts#L377)
  establish the separate authenticated read-feed path. An MCP OAuth token cannot
  be reused for native UI RPC.
- [CLI session metadata](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/apps/server/src/cliAuthFormat.ts#L152)
  places the label under `client.label`, not a top-level label. Both the prior MCP
  cleanup lookup and new native cleanup now use that matching contract.
- [Codex complete argument projection](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L563)
  maps item.arguments to native tool input. Other providers' malformed/partial
  string input is not treated as completed JSON arguments.
- AG-UI producer validation remains pinned `@ag-ui/core=1.0.5`, protocol 1.0;
  [tool semantics](https://docs.ag-ui.com/spec/1.0/events/tool-calls) and
  [HTTP/SSE binding](https://docs.ag-ui.com/spec/1.0/basic/transports/http-sse)
  require actual result return and application-level recovery.

**IMPLEMENTATION_BLOCKED: arbitrary frontend-executed tool result return.**
`capabilities().frontendToolResults` is false. `returnToolResult()` returns
`T3_FRONTEND_TOOL_UNSUPPORTED` (409) with the exact blocker above. It never sends a
plain text imitation, accepts a forged result, or executes a frontend tool. Full
A21/A22 acceptance must remain incomplete for this part until T3 exposes a suitable
contract or the lead selects and qualifies a compatible supported boundary. User
question/permission answers are implemented alternatives for their own semantics,
not substitutes for a generic frontend result channel.

## Lead API integration (next executable task)

These methods are returned by `createT3Service`; main/server routes and web edits
were outside this worker's ownership. Call them from the existing application:

| Method | Lead usage |
|---|---|
| `await t3.recover()` | Once during application startup before showing persisted run status; no provider launch. Also called before T3 start/startRun. |
| `await t3.observe(runId)` | After a successful existing startRun; reconcile initial snapshot and attach native feed. Repeated attachment does not create another run. |
| `await t3.reconcile(runId, options?)` | Existing reconcile route remains compatible; native is default. Explicit `{source:'mcp'}` is diagnostic text-only fallback. |
| `t3.recovery(runId)` | GET/POST recovery response: current typed message/state snapshots, identities, sequence, status, connection, capabilities. |
| `await t3.disconnect(runId)` | Explicitly detach observation; does not stop T3. A browser merely closing SSE must not call stop. |
| `await t3.reconnect(runId)` | Explicit user reconnect; authoritative snapshots + attach existing native thread, no launch. |
| `await t3.stop(runId)` | Existing stop route, now attempt-scoped and truthful about acknowledgement/outcome. |
| `await t3.respondInput(runId,{operationId,requestId,answers})` | Answer only an observed pending user question, using actual MCP contract. |
| `await t3.respondApproval(runId,{operationId,requestId,decision})` | Explicit native permission decision for this run only; never infer a decision from a reconnect or state patch. |
| `t3.returnToolResult(...)` / `t3.capabilities()` | Expose truthful unsupported frontend-tool result error/capability; do not offer executable frontend tools. |
| `await t3.refreshState(runId)` | After domain edits/jobs or from guarded state subscription; emits only changed authoritative revision references and avoids a subscription feedback loop. |
| `protocolRecords(state,runId,{afterSequence})` from `agui.mjs` | Read durable event envelopes for application replay/display cursors; `protocolEvents` remains compatible. |

The current main.mjs GET run-events endpoint is a finite historical SSE dump.
Lead should wire POST initiation/observation plus live event delivery on the current
application transport, and use the explicit recovery API for reconnect. An
`afterSequence` display cursor is FORGE application recovery, not standard SSE
Last-Event-ID resumption. Never feed historical TOOL_CALL events to an executor.
Use `stopRequest.status` separately from confirmed `run.status`; native interrupted
and cancelled map to AG-UI cancelled outcome while the exact T3 status stays in the
domain projection. Failed/rolled_back produce RUN_ERROR; unknown has no terminal
success event. Provider completion moves the task to review, never directly done.

## Developer verification and sanitized evidence

Windows, Node **24.19.0**. Commands run in this isolated worktree:

```text
npm.cmd ci --ignore-scripts --no-audit --no-fund
node --test tests/protocol-lifecycle.test.mjs
npm.cmd test
npm.cmd run check
node --check app/server/t3.mjs
node --check app/protocol/controller.mjs
node --check app/protocol/observations.mjs
node --check app/protocol/t3-rpc.mjs
git diff --check
node tests/live-agui-lifecycle.mjs
```

Focused fixtures: **14 passed**. Full suite: **37 passed, 2 optional native-report
checks skipped** after the final protocol tests were added. All syntax/diff checks
passed. Fixtures cover real failure risks: argument/result separation, missing and
failed outputs, corrections/repeated suffixes, repeated state transitions, atomic
receipts across SQLite reopen, identity confinement, unknown drop/stop outcomes,
startup recovery, supported answer idempotency, explicit permission scope, rejected
frontend results, and MCP page/text continuation. No fixtures claim provider execution.

Live command completed **PASSED**, isolated home
`%TEMP%/forge-agui-live-bDYFsf/t3`, sanitized JSON at
`%TEMP%/forge-agui-live-bDYFsf/sanitized-evidence.json`.

```json
{
  "observedAt": "2026-11-24T05:41:00.144Z",
  "provider": "codex",
  "requestedModel": "gpt-6.1-sol",
  "executedModel": "gpt-6.1-sol",
  "options": [{"id":"reasoningEffort","value":"xhigh"}],
  "readRunId": "498c74eb-c194-4294-8eec-83e4f941a892",
  "readThreadId": "mcp:launch:e8bb2e1ce3014d08815da3a9c23c1084f3a362c90c1a1279aca6ec3b56ac62d1",
  "readStatus": "completed",
  "replyAndActualToolResult": "FORGE_AGUI_TOOL_READ_OK",
  "toolResults": {"workspacePreparation":1,"actualFixtureRead":1},
  "singleReadPermission": "accept once; separate native channel; durable receipt",
  "idempotentReconcile": true,
  "stopRunId": "1657c161-045b-437e-b132-19f2cc55689b",
  "stopThreadId": "mcp:launch:e2bddc97bb826d4db9391a0bd69bba4b17ae4ce60aec4300487d7a8ef566385f",
  "stopAcknowledgement": "interrupt_requested",
  "confirmedStopStatus": "interrupted",
  "detachReconnectIdentityPreserved": true,
  "runCountAfterReconnect": 2
}
```

Actual event types observed: RUN_STARTED, TOOL_CALL_START/ARGS/END/RESULT,
MESSAGES_SNAPSHOT, TEXT_MESSAGE_START/CONTENT/END, STATE_SNAPSHOT/DELTA, CUSTOM,
RUN_FINISHED. The bounded second provider run was interrupted before a command
result; this qualifies provider interruption/reconnect, not cancellation of an
already running OS process. Actual socket loss is fixture-qualified; live check
uses explicit detach/reconnect. Live user-question response and non-Codex providers
are **NOT_RUN**. Live dynamic_tool conversion has fixture coverage; the actual
tool qualification exercised native command_execution. No home UAT or product
GUI integration was claimed by this worker.

Earlier qualification attempts caught a cold catalog/readiness race (bounded
read-only catalog retry in the explicit live script), a wrong token route corrected
to `/oauth/token`, and a real relative-path read failure. That failed read's actual
error result was preserved even though the provider's turn completed. The final
qualification uses the exact absolute selected fixture path, proves the expected
read output, and does not count workspace-preparation output as the fixture result.
After correcting session metadata lookup, a separate actual startup/read of the
already completed run/shutdown check reported `newProviderRuns=0` and
`remainingSessions=0`. Credentials left by earlier attempts were revoked only in
this worker's four named disposable FORGE homes; no development sessions were read
or modified. Do not reuse those disposable homes as user application state.

Coverage: supported backend observation/recovery and native permission path
**DEVELOPER_VERIFIED** to the evidence above. Arbitrary frontend tool return and
lead HTTP/no-code integration remain **IMPLEMENTATION_INCOMPLETE**; missing
contract is independent of credentials. **HOME_UAT_NOT_RUN**.
