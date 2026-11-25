# Root seams for Research native integration

These host-only seams narrow the existing private Guarded owner. They do not activate Research, widen the three native tools, or issue runtime proof.

- `createGuardedRuntimeHost` accepts optional synchronous `authorizeNativePhase(detail)` and `beforeAction(detail)`. Existing phase/current/attestation/Stop checks always run first. The authenticated gateway calls the phase hook inside the same writer fence. The action hook runs once only for a new authenticated operation, after exact replay lookup and before durable reservation/path opening.
- `createGuardedExecutionBridge` forwards `onNativePhase(state, detail)` (must return true) and `onBeforeAction(state, detail)` (must return undefined) under that same canonical writer. The detail includes the canonical run, actual profile/workspace/attestation and authenticated phase or operation metadata. Ordinary Proactive use does not require these additional hooks and retains its existing guards.
- Action metadata contains `operationId`, `requestDigest`, `capability`, `path`, `tool` and `priorOperations`. The latter is read from the existing durable broker ledger, including unknown and completed operations, with run IDs. A canonical transaction rollback therefore cannot make that local consumed capacity disappear. Exact replay does not call the resource owner again.
- `inspectGuardedOperations` and bridge `inspectOperations(runId)` are host-only read-only metadata recovery. They return no content, lease, credential or replay permission. Root may union exact trial/cohort run ledgers before global resource admission.
- Research startedAt/deadlineAt now use one captured clock value per transition; deadline equality can be bound exactly.

Verification: 26 broker/private-host/Research core+safety tests passed, including real Windows operations, durable unknown/completed resource counts, exact replay/restart and cap rejection before a new path/effect. Actual native Research integration and component ownership are separate pending work. No automatic qualifier is created by these seams.

Current phase callback payload places the canonical state run last, so the private runtime projection cannot overwrite that reference. Installed image hashes are still recomputed before each authority phase; hashing now streams through a 1 MiB buffer instead of allocating an executable-sized Buffer for each nested check. There is no digest cache or relaxed image fence. Regular-file size/time/inode changes during a read reject. The actual pinned OpenCode image digest matches the previous whole-file digest; runtime artifact-drift and five policy regressions pass. This reduces transient memory pressure during concurrent native checks; it does not extend deadlines or claim a performance SLA.

## Independent correction and explicit trial timing

Review fb1bf89 found a content substring could impersonate SSE completion and allow another upstream request. The gateway now incrementally parses UTF-8 SSE events, requires an actual complete `[DONE]` data event, and rejects malformed/incomplete data. Text containing that spelling is not completion. HTTP regressions cover forged content, malformed chunks, fragmented UTF-8/CRLF and denied subsequent requests.

Fixed-output bootstrap now selects the canonical run's allocated Workspace context, preserving the same root Research context for helpers. The real Git/SQLite allocation regression creates only the helper's empty output and confirms the primary remains untouched. Existing orphan/link/current-authority protections remain.

Combined core/native-owner/gateway checks28 PASS. Agent configurations can explicitly select up to3600000ms before experiment creation; local fixtures retain30000ms maximum and their5000ms default. No active deadline or native30s transport timeout is extended. Preparation remains inside the immutable trial envelope, including cold Workspace/native startup. A300000ms agent envelope is accepted as immutable configuration; the same local fixture value is rejected. This enables realistic bounded native trials without resetting their start time.
