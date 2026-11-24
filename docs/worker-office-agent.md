# A24 inbound office agent commands — worker handoff

สถานะ: backend queue/MCP พร้อมรวมงาน; ยังไม่ใช่หลักฐานว่า tool ถึง mounted FORGE editor แล้ว

Date: 2026-11-24, Asia/Bangkok. Base `16ae6c9`, branch `t3/office-agent-command-queue`. Actual inherited model verified with `orchestrator_capabilities`: **gpt-6.1-sol**, `reasoningEffort=xhigh`, `serviceTier=default`, `cyberAccessProgram=standard`. No model switch, provider/account/prototype execution, push or PR.

Only new `app/office/agent*.mjs`, `tests/office-agent*.test.mjs` and this handoff are owned. No existing office service, web, domain, main, manifest/lockfile, central progress or protected legacy file was changed.

## Implemented boundary

`createOfficeAgentService({store,dataDir})` in `app/office/agent-service.mjs` uses existing `store.transaction`/SQLite. It persists **queue metadata/evidence only**, under:

```js
state.officeAgent = {
  schemaVersion: 1,
  requests: [/* scope, operationId, fingerprint, edit, scalar/text proof,
               expectedRevision, status, timestamps, session IDs,
               applyLeaseTokenHash, verified receipt */],
  leases: [/* projectId, documentId, editorSessionId,
             leaseTokenHash, expiresAt */]
}
```

The existing store tolerates this namespace. No migration, second database, document snapshot replacement, provider-turn owner, arbitrary JavaScript tool, commercial AI SDK or T3 frontend-tool-result path is introduced. Read/status operations never execute document edits. Queue completion does not mark a task accepted/done.

The only production snapshot writer remains existing `document.save`. The mounted editor must apply the accepted operation using its existing public Facade command/undo path, then save the same live snapshot through that command. Importing these modules starts no listener or provider.

## Exact service hooks

All `scope` values are mandatory bounded strings: `{projectId,documentId,botId,taskId,runId,attemptId}`. The service verifies project membership and `task.botId`, `run.botId`, `run.taskId`, `run.attemptId`. Missing/mismatched attribution fails rather than guessing a current bot/run.

`key = {...scope,operationId}`. `editor = {projectId,documentId,editorSessionId,leaseToken,expectedRevision,dirty:false}`. Session ID identifies a mounted editor instance, not just a user or a shared tab key. Raw token stays in that instance's memory.

| Method | Input | Output / semantics |
|---|---|---|
| `recover()` | none | Run once at application startup, before accepting requests. Revokes leases, marks issued applications uncertain, verifies any already saved receipts. Never applies an edit. |
| `requestEdit()` | `{...key,expectedRevision,edit}` | `{request,replayed}`. New valid operation is `pending`; exact repeated delivery returns same request/status without reapplying. Fingerprint uses canonical key ordering over scope/revision/raw edit. |
| `readDocument()` | `{...scope,expectedRevision,selection}` | Synchronous `{schemaVersion,scope,kind,revision,content,source:'durable-snapshot',unsavedEditorContent:'excluded'}`. Sheet selection `{sheetId,range}`; Docs selection `{index,length}`. No whole snapshot or private editor content is sent. |
| `status()` | `key` | `{request}`; reconciles stored evidence only. |
| `list()` | `{projectId,documentId}` | `{requests}` for the local owner GUI. No lease credentials in the result. |
| `claim()` | `editor` without `leaseToken` | `{leaseToken,expiresAt,leaseMs}`. Requires clean current revision; only one claim per document. Persisted state contains the token hash only. |
| `renew()` | `editor` | `{expiresAt}`. Same session/token only, current revision and clean state required. |
| `release()` | `{projectId,documentId,editorSessionId,leaseToken}` | `{released:true}`. An issued edit remains fenced/uncertain until reconciled. |
| `review()` | `{...key,...editor}` | `{request}` with `status:'review'`. Review belongs to claiming session. |
| `beginApply()` | `{...key,...editor}` | First issuance `{request,mayApply:true,saveCommand}`. Subsequent issuance returns `mayApply:false`; it must never trigger another Facade mutation. |
| `ack()` | `{...key,editorSessionId,leaseToken}` | `{request}`. Reads trusted store receipts; caller-supplied receipt/snapshot/result fields are rejected. Old applying session may reconcile after token expiry if its save already committed. |
| `reject()` | `{...key,editorSessionId,leaseToken}` | `{request}` with `rejected`; only before application begins. Cannot erase an uncertain issued effect. |

Typed edits:

```js
{kind:'sheet.setValues', sheetId, range:'A1:B2', text:'one\t=1+2\nไทย\t42'}
{kind:'doc.insertText', index:0, text:'ข้อความ within one paragraph'}
```

Up to 1000 cells, 10000 input characters, existing worksheet bounds, explicit sheet ID, exact TSV rectangle; Docs index is an integer UTF-16 offset before the final CRLF. Docs insertion cannot contain CR/LF. Qualified snapshot package version must equal `1.6.1`. Unsupported fields/operations fail. Reads are bounded to 1000 cells or 10000 text characters, with a 64000-character result limit.

Queue caps: 1024 retained operation IDs total, 32 active requests per document, 256 active leases; 30-second lease. No automatic tombstone eviction: a full queue refuses a new request rather than enabling duplicate replay. Future retention requires a reviewed archival contract.

## Required lead integration (implementation work, not missing credentials)

1. Construct the service with the existing store; call `await officeAgent.recover()` once during startup. Expose owner-only GUI routes for the hooks above with the application's existing Host/Origin protections. `list` and editor hooks are deliberately absent from MCP.
2. **Domain transaction guard:** import `validateOfficeAgentSave` from `app/office/agent-contract.mjs`; invoke `validateOfficeAgentSave(state,input)` inside the existing command transaction, **after existing receipt replay validation, before any entity mutation**, for every command. This synchronous guard never saves anything. It reserves queued operation IDs, validates session/token/current lease, exact actor/operation/revision and requested snapshot effect, and blocks competing `document.save/update/restore` while an edit is applying/uncertain. Guard must cover alternate document mutation endpoints too. Do not call it outside the transaction as the only check.
3. Extend actual durable `document.save` receipt with `{projectId,baseRevision,actor,operation}` plus existing fields. `operation` equals `data.operation` (legacy `data.edit` is separate compatibility work); actor must retain and validate bot/task/run/attempt. Receipt verifier requires the exact accepted queue metadata. Missing/wrong metadata yields `uncertain / RECEIPT_UNVERIFIED`, never completion. Do not put `input.officeAgent`, raw input, raw tokens or credentials in receipts/events/entity/logs.
4. In the real mounted editor, fetch queue requests, refuse dirty/unsaved human work, claim, renew while clean/reviewing, and show a review action. On apply: lock human input/autosave/undo/navigation, recheck the actual live snapshot/name is clean and revision current, call `beginApply` **before** any Facade command. Only when `mayApply:true`, apply that request once to the same live unit, snapshot it, POST the complete returned command template with snapshot/name/resources added under `data`, then `ack` or query status after an uncertain network response. `saveCommand.officeAgent` is top-level and contains this session's lease proof. Keep it only in pending request memory. Do not construct a fresh operation ID or use the existing API helper if it drops the returned template fields.
5. Sheet target is explicit. Existing `univer.mjs` uses the active sheet; lead must use public `unit.getSheetBySheetId(edit.sheetId)` or refuse when active sheet differs before applying. Use public `unit.undo()/redo()` for both document kinds to focus the right unit (global `univerAPI.undo()` needs an already focused unit). Keep one `setValues` call for a batch. If command/save is uncertain, keep the live editor recovery state and do not issue another mutation.
6. Reconcile `/api/state`/AG-UI projections from the authoritative saved request/receipt. A completed MCP request is a document receipt, not a fabricated provider frontend-tool result. Generic T3 frontend-tool-result remains unsupported upstream.
7. Mount MCP before the ordinary JSON/body router; close the mount on app shutdown. Exclude machine-private credential file/directory from backup/export and any diagnostics. Project/domain metadata backup contains queue state/hashes but no raw lease/bearer secrets. Portable import must not reactivate old leases or reapply imported requests.

Example returned save template (metavariables only):

```js
{
  type:'document.save', operationId, projectId, id:documentId, expectedRevision,
  officeAgent:{editorSessionId,leaseToken},
  data:{
    actor:{kind:'agent',botId,taskId,runId,attemptId},
    operation:{...edit,region,expectedRevision,requestFingerprint},
    summary
  }
}
// Mounted editor adds data.snapshot, data.resources and data.name.
```

Completion verification checks store `receipts[operationId].result.receipt` and saved entity: same operation/document/project/kind/base/result revision, actor/operation fingerprint, actual requested region/content, and identical snapshot hash in the current durable revision or its durable history. Formula expression is checked, not its calculated cached value. Docs verification hashes the entire expected inserted text stream, not just a substring. Sheet proof uses pinned public scalar coercion and existing base cell styles; it never creates a replacement workbook.

## MCP transport and private setup

`createOfficeAgentMcpHandler({service,dataDir,endpoint})` in `app/office/agent-mcp.mjs` returns async `(req,res) => boolean` and `handler.close()`. `endpoint` must be the final explicit loopback HTTP URL/path, e.g. `http://127.0.0.1:<actual-port>/api/office-agent/mcp`. Handler returns false for other paths; mount before consuming the raw request body. It uses official `@modelcontextprotocol/sdk` **1.32.2** `Server` and `StreamableHTTPServerTransport` in stateless JSON-response mode, one bounded request per transport. No SSE replay/session is claimed or needed: application operation IDs own recovery.

It enforces loopback remote address, exact configured Host, absent or exact same Origin, constant-time bearer check, JSON POST only, no query credentials, no JSON-RPC batches, 64 KiB body limit (including chunked), 10s body timeout and 32 active requests. GET/DELETE are 405; this endpoint offers normal request/status results rather than a server notification stream. SDK reconnect does not dispatch another document effect.

Tools (machine-local bearer capability; every call still requires full scope):

| Name | Arguments beyond mandatory scope |
|---|---|
| `office.document.read` | `expectedRevision, selection` |
| `office.sheet.setValues` | `operationId,expectedRevision,sheetId,range,text` |
| `office.doc.insertText` | `operationId,expectedRevision,index,text` |
| `office.request.status` | `operationId` |

Results provide both MCP text and typed `structuredContent`. Queue requests return `{request,replayed}`; status returns `{request}`. Pending/review/applying/uncertain are valid request states, not tool execution completion. Validation/scope/conflict errors use `isError:true` and typed error code, without internal stack/path/raw input. No MCP tool claims an editor, saves a snapshot, acknowledges an edit or evaluates code.

`loadOfficeAgentSecret(dataDir)` creates a 256-bit secret at `<machine-dataDir>/.office-agent-private/mcp-bearer.secret`, outside the domain; returns `{secret,secretFile}` for trusted process setup only. Never expose this result via `/api/state`, connection config, command line, telemetry, artifact or log. POSIX modes are 0700/0600; Windows must retain the account-private parent directory ACL (mode bits alone are not a Windows ACL). Symlink directory/file references are rejected. The `.secret` filename also matches the existing repository ignore rule. Secret creation/rotation must not run against an arbitrary public/shared directory.

`officeAgentStdioConfig({endpointEnv:'FORGE_OFFICE_MCP_URL',secretFileEnv:'FORGE_OFFICE_MCP_SECRET_FILE'})` returns:

```js
{command:process.execPath,args:[absoluteBridgeModule,
 '--url-env','FORGE_OFFICE_MCP_URL',
 '--secret-file-env','FORGE_OFFICE_MCP_SECRET_FILE']}
```

Trusted launcher binds the local endpoint and private file path via those environment variables. Actual bearer bytes never enter arguments/domain config. `agent-stdio.mjs` reads the referenced private file locally and bridges the same four official SDK tool requests through Streamable HTTP; it does not open a second store/writer. The normal FORGE connector's environment allowlist will need a deliberate setup binding for these env references, without copying secret values into state. No provider configuration was modified here.

## Evidence and limits

Windows, Node **24.19.0**. Dependencies installed using existing lock with `npm.cmd ci --ignore-scripts --no-audit --no-fund`; no manifest/lock changes. Pinned MCP SDK is MIT; coordinated Univer 1.6.1 packages are Apache-2.0.

Primary installed source inspected: MCP `dist/esm/examples/server/simpleStatelessStreamableHttp.js`, transport/server/client declarations, Univer Sheets `lib/es/facade.js` (`setValues`, workbook undo/redo), core scalar helper and Sheets mutation/type helper declarations/source. Public [Univer range guide, version 1.6.1](https://docs.univer.ai/guides/sheets/features/core/range-selection) confirms rectangular values, formula and cell-object semantics. Docs headless insertion attempted through public API but needs the real render manager; it was **not** replaced with a mock rendering service to claim success.

Focused command: `node --test tests/office-agent*.test.mjs`. Includes real SDK Streamable HTTP and actual spawned SDK stdio subprocess; real SQLite restart; one-time permit/reconnect/replay; competing tabs, stale revisions, dirty work, token hashes/expiry, uncertain restart, false ack/receipt/content/scope; bounded retention; domain guard; real Univer **headless** `createWorkbook/getSheetBySheetId/getRange.setValues` and snapshot verification, one-step workbook undo/redo, interleaved human command and redo invalidation. Receipt-extension fixture is clearly labelled: this checkout's existing domain does not yet persist the accepted extra receipt fields, so tests explicitly add them as the lead integration seam.

Final verification command: `node --test tests/office-agent*.test.mjs tests/product-domain.test.mjs tests/product-office.test.mjs` — **28 PASS, 0 FAIL, 0 SKIP**, including the fixture module as a test-runner entry. Four production module syntax checks and scoped staged `git diff --check` pass. No build/browser claim is made for unchanged, unintegrated UI.

Implementation gaps assigned to lead: HTTP/GUI/domain guard + receipt extension/setup/projection integration and integrated mounted Docs/Sheets acceptance. Mounted FORGE editor route, provider MCP invocation, Docs rendering/undo, takeover after a genuinely uncertain unsaved apply, UI Thai/EN flow, persistent drawing upload/insertion and portable recovery are **not established** by these worker tests. Drawing persistence is separate work, not expanded here.

Safety-first availability limit: an issued apply with no verified save remains uncertain and fences subsequent document writers; there is intentionally no automatic reset/reassignment or pretend-success acknowledgement. An owner recovery/inspection flow may be added by lead with explicit evidence. Requests/leases do not restore a lost in-memory editor undo stack. Live provider/account checks and **HOME_UAT_NOT_RUN** remain separate from the listed integration implementation gaps.
