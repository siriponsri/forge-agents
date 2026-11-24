# FORGE local product contract v1

Lead owns this contract, `app/server/`, root dependencies and migrations.
Frontend worker owns `app/web/`. Report worker owns `app/reports/` and
`tests/reports*.test.mjs`. Workers may use the handoff docs but do not edit progress.

One Node HTTP service binds loopback. Built assets: `app/web/dist`.
JSON requests have `Content-Type: application/json`. Responses are JSON except
downloads, SSE and the independently managed pinned T3 coding surface.
Errors: `{error:{code,message,details?}}`, 409 for stale revisions.

## Domain API

`GET /api/state` returns `{schemaVersion:1,revision,projects,bots,conversations,
plans,phases,tasks,runs,artifacts,documents,reports,connections,notebooks,jobs,
desktopTargets,skills,receipts,events,settings}`. All collection values are arrays.
Every entity has `id,projectId?,revision,createdAt,updatedAt`. Project has
`name,workspace,description,profile`. Defaults: Thai; no example product created.

`POST /api/command` accepts `{operationId,type,projectId?,id?,expectedRevision?,data}`.
An operation ID is required; retries return the original receipt without effects.
Response `{receipt:{operationId,type,entityId,revision,outcome},entity,stateRevision}`.
Entity updates require the current `expectedRevision`. Bad project scope fails.

Supported CRUD types `project.create/update`, `bot.create/update`,
`conversation.create`, `message.send` (data: `conversationId,text,role?`; local
message persistence only, never invented assistant reply), `plan.create/update`,
`phase.create/update`, `task.create/update`, `connection.create/update`,
`notebook.create/update`, `document.create/save/restore`, `report.create/save`,
`desktopTarget.create/update`, `skill.create/update`, `settings.update`.

Tasks: `title,description,status` (`backlog,ready,running,blocked,review,done`),
`planId,phaseId,botId,dependsOn:[],threadId,runIds:[],artifactIds:[],evidence:[]`.
Mark done only with evidence; moving a card cannot claim a run succeeded.
Conversation: `kind:team|private,botId?,messages:[]`.
Project profile stores independent `provider,compute,serving,storage,mcp,desktop,
phaseOverrides,limits`; runs capture the profile revision.

Documents: `kind:sheet|doc,name,snapshot,packageVersion,resources:[],history:[]`.
Native full Univer snapshots are stored unchanged. `document.save` data includes
`snapshot,summary,actor` and expectedRevision. Restore names `sourceRevision`.
Use the mounted Facade command/undo APIs for bounded agent edits and then save
through the same endpoint. Do not claim persisted live undo after restart.

Report source: `name,spec:{schemaVersion:1,title,language,fontFamily,template:
{id,version},sections:[{heading,text,table?,figure?}],citations:[],inputs:[]}`.
Reports keep history. `POST /api/reports/generate` accepts
`{operationId,projectId,reportId,expectedRevision}` and returns a job.

## Additional product endpoints (lead implementation)

`GET /api/health`: version, git revision, dataPath, T3/engine readiness.
`GET /api/events`: SSE authoritative state invalidation; reconnect fetches state,
never resubmits effects. `GET /api/runs/:id/events`: persisted AG-UI projection.
`POST /api/jobs/start`: `{operationId,projectId,notebookId}` local Python notebook.
`POST /api/jobs/:id/stop`; `GET /api/jobs/:id` returns persisted logs/status.
`POST /api/connections/:id/check`: actual transport/dependency check.
`POST /api/mcp/:id/discover`, `/call`: discovered MCP via SDK; no fabricated tools.
`POST /api/artifacts/register`: projectId,path,kind; verify file and SHA256.
`POST /api/artifacts/upload`: operationId,projectId,name,kind,base64; immutable
project-owned verified files up to16 MB; replay IDs cannot change content/scope.
`POST /api/reports/extract-document`: projectId,documentId,expectedRevision,
sheetId?,range?,formulaMode?; returns section/input hash/warnings for explicit
review before report source save. Generation freezes selected native revision.
`GET /api/artifacts/:id/download`; `POST /api/storage/backup` and `/restore`.
`POST /api/t3/start`; `GET /api/t3/status`; independent T3 app URL returned.
`POST /api/runs/start`: bounded task to owned T3 thread; never another direct CLI turn.
`POST /api/runs/:id/stop`; never infer cancellation from stream close.

## Report worker integration boundary

Export `createReportService({dataDir,store})` from `app/reports/service.mjs`.
Store interface: `store.read()` returns snapshot; `store.transaction(fn)` serialized
atomic persistence of changes; fn mutates state and returns result. No nested tx.
`store.emit()` notifies subscribers after successful transaction (automatic).
Service exports `health(),configure(config),generate(input),getJob(id),stop(id),
pdfOperation(input),download(artifactId)`; async methods; throw errors with
`statusCode,code`. `download` returns `{path,contentType,filename}`.
Engine machine settings may use a separate file under dataDir. Do not store secrets
in domain projections. Job records and artifacts use common state arrays.
HTTP endpoints mounted by lead. Native engine absence is actionable readiness,
not a fabricated successful report. Report worker writes its own engine tests.

## UI conventions

React 19 + Vite. Dependencies managed by lead, initially React/react-dom, Vite,
@univerjs/presets, @univerjs/preset-sheets-core, @univerjs/preset-docs-core 1.6.1,
lucide-react. No commercial extension required. Use fetch relative APIs, native
labels, visible errors, keyboard focus, Thai default with English switch.
Latest owner steering supersedes the initial warm palette: use named pinned VS
Code builtins, default Dark Modern; orange FORGE brand and theme-derived accent.
Bundle Manrope/IBM Plex Sans Thai. Runtime/tool details belong in advanced settings.
