# Storage worker handoff — FORGE v3

2026-11-24. Branch `t3/forge-storage-service`, base `10e38aa`.
Observed execution: Codex harness **gpt-6.1-sol**, **reasoningEffort=xhigh**, supplied by the active runtime. No model switch, child agents, credential migration, push, public service, compute purchase or prototype activation. Node **24.19.0**, Windows. Applicable scope A14/A15/A20; root AGENTS.md and v3 start/product/architecture/acceptance/current progress read.

Only new `app/storage/**`, `tests/storage*.test.mjs` and this handoff are owned/changed. No dependency, snapshot-schema or legacy changes. Lead owns HTTP/GUI integration, shared contracts and central progress. Existing metadata backup/restore in `app/server/artifacts.mjs` remains unchanged and must remain labeled **metadata only**.

## Implementation and integration

```js
import { createStorageService } from '../storage/service.mjs';
const storage = await createStorageService({ dataDir, store, artifacts });
```

The async factory reconciles persisted active storage jobs to `interrupted` after process restart. Construct once per authoritative store/application process; it does not create an execution owner. Optional `vault:{get(name),set(name,value)}` must be machine-only; Windows defaults to DPAPI CurrentUser at `%LOCALAPPDATA%/FORGE/secrets/storage`, outside portable application data. Non-Windows browser sign-in needs an injected OS vault; environment secret references work without one. `env`, `fetchImpl`, `wait`, `adapters` and `transferHook` are engineering injection points, not HTTP fields.

Suggested HTTP routes and exact service bodies follow. Mutating actions require unique `operationId`; replay returns the durable existing result without re-dispatch. Validation/setup may throw domain errors before reservation. After reservation, failures return a job with `status:'failed'|'interrupted'|'conflict'`, `error:{code,message}`; HTTP 200 is **not** transfer success. Only `status:'completed'` qualifies. Sync/backup requests await completion while domain jobs/events expose progress to existing polling/SSE; no background worker or automatic SSE resumption is claimed.

| Route suggestion | Method and JSON body |
|---|---|
| POST `/api/storage/configure` | `configure({operationId,projectId,expectedRevision,destinations,routes,retention})` |
| POST `/api/storage/health` | `health({projectId,destinationId})` returns readiness or actionable setup error |
| POST `/api/storage/status` | `status({projectId})` returns independent save/sync/Git states plus durable jobs |
| POST `/api/storage/inspect` | `inspect({projectId,destinationId})` returns `{token,heads,conflicted,commits}` |
| POST `/api/storage/sync` | `sync({operationId,projectId,destinationId?,artifactIds?,resolution?})` |
| POST `/api/storage/bundles/backup` | `backup({operationId,projectId,destinationId?,resolution?})` includes **all** registered artifacts/companions and portable project records |
| POST `/api/storage/retry` | `retry({operationId,projectId,jobId,mode:'resume'|'restart',resolution?,expectedRevision?,targetDirectory?})` |
| POST `/api/storage/bundles/restore` | `restore({operationId,projectId,destinationId,bundleId,manifestSha256,targetDirectory,expectedRevision})` |
| POST `/api/storage/retention` | `retention({operationId,projectId,destinationId,keepLast?,dryRun:true|false,expectedHead?})` |
| POST `/api/storage/drive/auth/begin` | `beginDriveAuth({clientId,clientSecretRef?,redirectUri})` returns authorization URL/state, ten-minute expiry |
| POST loopback OAuth callback | `finishDriveAuth({state,code})` returns `{connected,secretRef,scope}`, never credential values |
| POST `/api/storage/drive/folders` | `listDriveFolders({projectId,destinationId})` returns app-visible folder IDs/names |
| POST `/api/storage/drive/folders/create` | `createDriveFolder({projectId,destinationId,name})` creates an explicitly requested child folder; returns ID/name |

Configuration example (project Git configuration remains independent and is preserved):

```json
{
  "operationId": "a-unique-operation-id",
  "projectId": "project-uuid",
  "expectedRevision": 3,
  "destinations": [
    {"id":"local","name":"Local archive","kind":"local","directory":"D:\\FORGE-Backups"},
    {"id":"drive","name":"Drive archive","kind":"drive","folderId":"owner-selected-folder-id","secretRef":"vault:drive-generated-id"}
  ],
  "routes": [
    {"kinds":["model","checkpoint"],"destinationIds":["drive"]},
    {"kinds":["report","pdf","docx"],"destinationIds":["local"]}
  ],
  "retention":{"keepLast":5}
}
```

Local directories are real absolute Windows/local paths, separate from FORGE source/state and project workspaces. A destination may be newly created. Routes match artifact `kind`, with `'*'` available. With no explicit `destinationId`, sync produces `{jobs:[...]}` by routing each selected artifact independently; complete backup targets every configured destination. An explicit destination copies the selected artifacts for sync. Empty-project metadata backups are valid complete bundles. Project defaults are scoped; no other project profile is changed.

`status.save` reports authoritative saved state/project revisions, not unsaved browser editor contents. `status.sync[destinationId]` reports the latest transfer status/error and `lastVerified` separately. Successful Drive or local transfer never runs or marks a Git commit/push. `status.git.commit`/`push` read existing `storage.git` events, defaulting to `not_run`. Configuration is kept at `project.profile.storage`; jobs/events/receipts use existing snapshot collections, no migration.

## Bundles, conflicts, resume and restore

Each destination contains immutable objects beneath `projects/<projectId>/bundles/<bundleId>/` and content-addressed `commits/<sha256>.json`. Binary file bytes and the manifest are read back and SHA-256/size verified before a commit advertises availability or artifact locations are added. Local writes fsync a temporary file then hard-link without replacing an existing key (NTFS and ordinary local filesystems supported; a filesystem without hard links reports a storage error). Drive stores binary objects in the selected folder, with appProperties identifying immutable keys. It never mirrors `.git` or creates public sharing permissions.

Commit parents record lineage; commits are append-only. Local/Drive concurrent writers can form a fork instead of overwriting each other. `inspect` detects forks and returns all heads. A changed/unknown destination baseline fails `DESTINATION_CONFLICT` with current head token. Show its revisions, then explicitly retry with:

```json
{"operationId":"new-id","projectId":"project-uuid","jobId":"failed-job-id","mode":"resume","resolution":{"strategy":"replace","expectedHead":"exact-current-token-from-inspect"}}
```

Despite the API strategy name `replace`, this advances/joins destination lineage while retaining previous bundles. It never overwrites their bytes. An outdated acknowledgement fails again. Selecting **restart** creates a new job/stage/bundle from current source; **resume** keeps the same job/bundle and validates every staged/destination file rather than trusting progress flags. Changed source metadata/bytes/configuration prevents publication and requires restart. A new artifact revision must be registered after changing verified files; unavailable superseded artifact revisions are not silently skipped.

Staging is at `<dataDir>/storage/jobs/<jobId>/`, excluded from portable bundles. Resume is **file-granular across process restart**. Drive uses official resumable chunks and queries the server offset after a lost acknowledgement within a live session. Session URLs remain in memory; an incomplete individual Drive file restarts after process exit, while already verified files are reused. This does not claim cross-restart byte-offset resume or checkpoint resume. Uncommitted stages are not advertised as verified backups. Destination retention does not automatically remove local staging; old stages are retained for explicit recovery/diagnosis.

Complete project backup includes all registered artifact and declared companion files, native document snapshots/history/resources, report sources/history, notebooks, teams/chats/plans/tasks and artifact provenance. Source/config/environment revisions already recorded on artifacts remain present. Report Studio's exact `dataDir/reports/published/<jobId>/filename` paths are admitted only with authoritative ready owning report job/project/artifact membership; arbitrary external/dataDir/config paths remain rejected. Workspace serving/upload files are ordinary registered artifacts. Report outputs map into `.forge-artifacts/reports/<originalJobId>/filename` in the restored workspace.

**Excluded:** unregistered workspace files, arbitrary directory trees, `.git`, obvious credential filenames, connection/account configuration, machine settings, secret values/references, provider/process sessions and live execution jobs. Native user content/registered binary files are copied as selected content; this is not a general secret scanner for secrets deliberately embedded in prose/files. Metadata-only legacy backup remains separately usable for whole-domain metadata. This bundle is not a complete machine/system backup.

Restore requires the exact selected `bundleId` **and** trusted `manifestSha256` from the completed job/inspect result. Artifact-only syncs cannot masquerade as complete project backups. Every manifest/file/binding is validated in staging first. A **new absolute folder** is required; existing folders, links, other projects, FORGE source/state and storage destinations are rejected. Restore creates an **independent project** with fresh record IDs; it never silently overwrites an existing project. Native `/api/artifacts/ID/download` URLs and record relations remap to copied artifact IDs. Temporary/cross-project resource references fail validation.

Restored artifact contract: `restoredFrom:{projectId:<original>,artifactId:<original>,bundleId,manifestSha256}`, new `id`/`projectId`, workspace-owned `path`, `status:'verified'`, verified local location. No `artifact.jobId` is retained; historical identity remains in `lineage.originalJobId` and `lineage.originalArtifactId`. Existing report provenance/lineage are preserved. Lead artifact routing can therefore use generic artifact download instead of treating imported artifacts as live report-job members. Restored project settings require explicit local reconfiguration; no accounts or credentials migrate.

A new restore folder contains `.forge-storage-restore.json` with its job/checksum receipt. An interrupted restore can resume only its own matching folder; it verifies already copied bytes and imports project records in one store transaction. Retry does not duplicate records. If the original project revision changed, the user can review and supply `expectedRevision` on resume; restart may select a different `targetDirectory`. There is no automatic destructive rollback of a partially materialized new recovery folder.

Retention defaults to a preview (`dryRun` omitted/true), keeps at least one revision, protects current heads, the latest complete backup and backups used by incomplete restores. Before deletion it re-verifies protected manifests/files, and checks the reviewed destination head. It only deletes older explicitly selected bundle objects, preserves commit lineage and never deletes source files or remote copies in another destination. Historical commit rows can refer to pruned bundles: GUI should distinguish historical lineage from currently available backups. Cross-machine distributed deletion leases are not claimed; do not run retention concurrently with a restore on another installation. Deleting a source locally does not cascade through synchronization.

## Executable Drive setup path for lead GUI

1. Owner supplies their Google **Desktop OAuth** client ID after enabling Drive API and configuring the consent/test-user settings in their own Google Cloud project. If the issued desktop client needs a client secret, put it in the machine OS vault or an environment secret, pass only `clientSecretRef` to begin. No owner account is launched until they choose Connect.
2. Lead registers a loopback callback in its existing HTTP service (`http://127.0.0.1:<port>/api/storage/drive/auth/callback`). Call begin, open the returned Google authorization URL on explicit Connect, and deliver callback `state`/`code` to finish. The server checks pending state, PKCE, expiry and replay before saving a **new** refresh credential in Windows DPAPI. Do not log callback code/query/body. No credential import/migration occurs.
3. Configure a Drive destination temporarily with `folderId:'root'` and the returned `secretRef`. Call `createDriveFolder` on explicit Create folder, then configure its returned ID. With the minimal `drive.file` scope, use app-created or explicitly app-granted folders; a random preexisting private folder ID may not be accessible. `listDriveFolders` supports an app-visible folder picker. Health checks writable-folder capability and account authentication.
4. Configure routes, transfer, inspect actual folder contents, then restore selected bundle to a new folder. A setup/permission/refresh error is actionable and never a falsely completed destination.

Advanced existing-secret route: `env:FORGE_DRIVE_ACCOUNT` references a machine environment value containing an access token or JSON `{access_token}` / `{client_id,client_secret?,refresh_token}`. Values are read at request time and never returned, stored in domain snapshots, exported or logged. An access token alone expires and needs owner refresh/reconnection. The browser OAuth route provides offline refresh without asking normal users to edit files. On non-Windows, inject the host's OS vault for OAuth; do not replace it with plaintext portable state.

Primary official contracts checked 2026-11-24:

- [Drive resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Binary downloads](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list) and [files.generateIds](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds)
- [Drive error handling](https://developers.google.com/workspace/drive/api/guides/handle-errors)
- [Desktop OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)

REST implementation uses built-in fetch only: generated file IDs, appProperties lookup, paginated listing, resumable 1 MiB/256 KiB-aligned chunks, 308 Range/status recovery, binary readback, bounded retry for 429/5xx/rate-limit 403, explicit auth/permission errors. Requests use only official Google HTTPS origins; credential/provider bodies and session URLs never enter durable jobs/events.

## Developer evidence and remaining checks

`node --test tests/storage*.test.mjs`: **18 passed, 0 failed, 0 skipped** on Windows Node24.19.0 after final document-resource validation hardening. Meaningful coverage:

- Local complete backup/native metadata/model+companion bytes, restart, new-project verified restore and lineage.
- Interruption/resume/restart, persisted process recovery, operation replay and no duplicate import/effects.
- Source changes, stale destination acknowledgement, concurrent fork preservation and explicit lineage convergence.
- Artifact/manifest tampering, traversal, credentials/Git exclusions, Windows junction escape and unchanged existing/absent destination on rejection.
- Configured routing, independent destination/save/commit/push outcomes and settings revision conflicts.
- Retention preview, protected newest full backup, retained restore and refusal to delete old valid copies when retained bytes are corrupt.
- Native report-owned files, artifact URL/ID remapping and removal of live report-job bindings.
- Official Drive REST fixture: real binary chunk transfer/download, lost ACK/status recovery, bounded transient/permission errors, duplicate-key conflict, full service backup/restore with no credential exposure.
- OAuth state/PKCE/replay/offline-refresh fixture; actual disposable **Windows DPAPI encrypt/decrypt across instances**, with no owner credentials.

All six new implementation modules passed `node --check`; `git diff --check` passed. No root dependency install/build/full application test was run in this isolated worker (node_modules absent and integration is lead-owned).

Implementation boundary pending with lead: add HTTP dispatch and no-code Storage/Sync/Drive OAuth callback/folder picker/restore/conflict/retention GUI; wire ready/error/result states and keep metadata-only controls distinct. Worker backend has no required missing Drive adapter. **LIVE_DRIVE_NOT_RUN** (no owner client/account config supplied); no OAuth browser/account launched. **HOME_UAT_NOT_RUN**. macOS/Linux filesystem/OS-vault live qualification NOT_RUN; local builtins are portable, browser OAuth needs host vault injection outside Windows. Registered files currently share the existing 512 MiB-per-file in-memory verification limit, which should be disclosed for large weights. Remote staging/retention races across machines and automatic stage garbage collection are explicitly outside the claimed guarantees above.
