# Root seams for Research native integration

These host-only seams narrow the existing private Guarded owner. They do not activate Research, widen the three native tools, or issue runtime proof.

- `createGuardedRuntimeHost` accepts optional synchronous `authorizeNativePhase(detail)` and `beforeAction(detail)`. Existing phase/current/attestation/Stop checks always run first. The authenticated gateway calls the phase hook inside the same writer fence. The action hook runs once only for a new authenticated operation, after exact replay lookup and before durable reservation/path opening.
- `createGuardedExecutionBridge` forwards `onNativePhase(state, detail)` (must return true) and `onBeforeAction(state, detail)` (must return undefined) under that same canonical writer. The detail includes the canonical run, actual profile/workspace/attestation and authenticated phase or operation metadata. Ordinary Proactive use does not require these additional hooks and retains its existing guards.
- Action metadata contains `operationId`, `requestDigest`, `capability`, `path`, `tool` and `priorOperations`. The latter is read from the existing durable broker ledger, including unknown and completed operations, with run IDs. A canonical transaction rollback therefore cannot make that local consumed capacity disappear. Exact replay does not call the resource owner again.
- `inspectGuardedOperations` and bridge `inspectOperations(runId)` are host-only read-only metadata recovery. They return no content, lease, credential or replay permission. Root may union exact trial/cohort run ledgers before global resource admission.
- Research startedAt/deadlineAt now use one captured clock value per transition; deadline equality can be bound exactly.

Verification: 26 broker/private-host/Research core+safety tests passed, including real Windows operations, durable unknown/completed resource counts, exact replay/restart and cap rejection before a new path/effect. Actual native Research integration and component ownership are separate pending work. No automatic qualifier is created by these seams.
