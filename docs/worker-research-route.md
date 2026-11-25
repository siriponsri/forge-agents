# Research root route integration

Assigned implementation: `app/server/research-route.mjs`, existing
`app/server/research.mjs`, new `tests/product-research-route*.test.mjs`, and this
handoff. Base a408ac2 includes the actual native owner/gateway and components.
Lead prerequisite a3eab7f was cherry-picked as e773d91 solely to test distinct
pending allocation identities; do not cherry-pick that prerequisite twice.
No main/T3/Workspace/Context/Guarded/installer/protected legacy path, contract,
migration, manifest/lockfile, source cache, credential or central progress edit.

## Root API

```js
import {createResearchRoute} from './research-route.mjs';
const route = createResearchRoute({
  store, dataDir, components,
  policy: {observe:(s,i)=>guardedPolicy.observe(s,i),
           resolve:(i,o)=>guardedPolicy.resolve(i,o)},
  getGuarded:()=>guarded,
});
```

`getGuarded` must return the SAME singleton Guarded owner selected and checked
through Settings. `observe` is the actual current selected policy/account/tool
observer. This module never constructs route proof, attestation or host phases.
It uses `qualifyProactive(state,guardedRequest)` and the bridge worker's private
`privateSnapshot(runId)`. The latter must return actual
`{profile,attestation,phases,live,...}`; pending profiles may have `live:false`.
Only real live attestation/phases can qualify send, effects or model requests.
No HTTP/MCP/source-body setter is supplied.

Synchronous callbacks below require the CURRENT canonical writer state used
by Stop, restore, policy/account changes and the existing Guarded broker:

```js
route.requestForInput(s,input); // Guarded request or null for ordinary input
route.researchRequestForInput(s,input); // exact native owner request or null
route.retainInput(s,input); // BEFORE prepare/allocation: pending capability
// guarded.reserve(s,detail) FIRST, then under the same allocation transaction:
route.reserve(s,{run,input}); // private reserved profile; pending final gates
route.qualification(s,exactResearchRequest); // read-only native owner qualifier
route.allowUnknownAccounting(s,{run,input}); // explicit allow AND both caps null
route.validate(s,{run,input,stage,profile,attestation,messageDigest,...}); // true
route.onNativePhase(s,detail); // true
route.onBeforeAction(s,detail); // void
route.onReceipt(s,detail); // void
```

`reservation` permits only reservation after all canonical member guards; the
new run capability must then be retained BEFORE committing. No reservation or
qualification receipt proves a native send. Ordinary callbacks retain their
existing guards and must still run. The adapter rejects stripped claimed
Research/component identity and applies the existing mixed-controller checks.

The guarded request fixes only `output.json` and the three native capabilities.
`scope` contains paths/capabilities; `maxBytes` is a separate request field for
the shared bridge. `envelopeDigest` is the immutable manifest digest;
`identitySnapshot` additionally binds exact trial/allocation/task/workspace/op.
`deadlineAt` is the original absolute trial deadline; `maxRunMs` is the reviewed
trial maximum, never remaining-time reset. Native owner independently refuses
unknown-accounting policies other than explicit `allow`, non-null token/cost
caps, over-64KiB bytes and unsupported native faults/components.

Async provider lifecycle:

```js
const resolved = await route.resolveProvider(guardedInput,{selected});
// Pass resolved.provider to existing Guarded preparation and digest it there.
// Preserve resolved.credentialRef/accountGeneration as original-route refs.
resolved.bind({runId,attemptId}); // AFTER successful canonical allocation commit
await resolved.close(); // failed prepare/reserve/launch, Stop, terminal, shutdown
await route.precreate(runId); // AFTER pristine Research prepare, BEFORE native bind
await route.closeRun(runId); // extra root cleanup, idempotent
await route.close(); // closes all pending/bound gateways and owner capabilities
```

The returned gateway is unbound/denying before canonical allocation. Binding
checks the exact prepared member against the committed run and attempt. Each
real HTTP attempt uses the canonical writer and native owner's global resource
envelope. Original secrets remain private, never canonical run/event fields.
The bridge worker must own `bind`/`close` callbacks on every lifecycle branch.
Root must also close/revoke on restore, including pending preparation handles.

The before-action hook reads the durable broker operation ledgers for EVERY
exact allocated run, including completed and unknown members, and unions them
with the current callback ledger before the native owner reserves capacity.
An unreadable/foreign ledger refuses admission, rather than returning capacity.

## Research/Context/component bridge

```js
const bridge = createResearchExecutionBridge({
  store,dataDir,workspaces,t3,authorizeOwner,
  qualification:route.qualification,components,
  // Optional PRIVATE narrow existing-owner Stop, never human-authority minting:
  stopExistingWorkspace:(input,{runId,reason})=>trustedWorkspaceStop(input,runId),
});
```

Component runs resolve canonical membership using the existing resolver and
repeat actual component and Workspace admission. Primary-only checks remain
strict when no composition exists. `buildResearchContext` remains the SAME
immutable root trial context for all members; actual member task/workspace/op
are checked separately. `researchReceipt.workspaceId` is the member checkout,
while `researchContext.workspaceId` remains the immutable primary identity.

`bridge.prepare({run,baseMessage})` invokes `components.preparePrompt`, retains
the actual owner `researchComponentReceipt`, and returns its prepared message.
The existing Context owner must then consume that message with real Memory ON/
OFF behavior. It must not skip Context for components.

Immediately after actual Context preparation, under the canonical transaction:

```js
run.contextId = contextResult.contextId;
run.contextReceipt = contextResult.receipt;
run.contextMode = contextResult.mode;
run.researchReceipt = bridge.validateFinalMessage(s,run,contextResult.message);
// equivalently validatePrepared(s,run,{message:contextResult.message})
```

This verifies the actual Context event/receipt, pinned policy, benchmark/component
consumption and selected Memory references. It hashes the EXACT final Context
wrapper, retaining `finalMessageHash` and Guarded's `finalMessageDigest` in the
separate Research receipt. Sending the raw prepared prompt instead of the
Context wrapper refuses. Later `validatePrepared(s,run)` verifies the retained
receipt; at final send `route.validate` compares the actual native message digest
and requires real native attestation. Component text is never membership proof.

`executionOwner.validate` resolves the requested exact run/attempt, branches to
the real component owner's checker for cohort runs, and returns its canonical
evidence ID. Helpers do not use the primary input directory or primary run lookup.
`bridge.cohortState(input,opaqueOwner)` and
`bridge.exportComposition(input,opaqueOwner)` return actual owner status,
allocations, Context/component receipts, independently checked evidence, event
records and real Budget usage; missing values remain null. `executionOwner`
dispatch/reconcile/Stop branch to the real component owner when composed.

Startup `bridge.recover(opaqueOwner?)` marks surviving active process runs
unknown, never redispatches, and never invents a human Owner. With a real opaque
Owner it delegates component recovery. Without one, an optional trusted
`stopExistingWorkspace` can stop only retained existing canonical runs when
expired/stopped. Cohort Stop claims are retained once with unknown outcomes;
missing acknowledgement never grants retry. Without that trusted callback,
recovery remains unknown/reconciliation-only until real Owner reconciliation.

## Verification and integration boundaries

`node --test tests/product-research-route.test.mjs` exercises real Git worktrees,
SQLite, Context, Memory, Adaptive selection, provider catalog validation, Budget
aggregation and independent artifact checking. Installation/profile/attestation
and T3 lifecycle observations are explicitly INJECTED_NATIVE_PROOF_NOT_LIVE.
The local HTTP gateway is real loopback, never an external account/provider call.
Dependencies are read from the existing ignored node_modules junction to the
development checkout; no package install, lockfile or cache change.

Existing `tests/product-research-bridge.test.mjs`: **20/20 PASS**, 102.3 seconds.
New integration suite including held upstream close and actual component Context
wrappers: **3/3 PASS**, 42.6 seconds,
no skipped/cancelled tests. The callback permitting unknown accounting only
accepts explicit allow with BOTH caps null; it never changes usage/finality.

Shared integration still belongs to lead: main singleton/policy wiring; T3
request/retain/reserve/final-message forwarding; Workspace component forwarding;
shared Research admission/allocation rules; guarded lifecycle callbacks;
GUI/HTTP/headless cohort mounting; restore preservation/revocation and root
trial status/export selection based on cohort owner status rather than the
legacy root service's primary-only canonicalRun path. Agent `maxMs:300000`
requires the lead-owned config validator's agent-only extension; this adapter
accepts the canonical absolute deadline and never changes local-execution caps.

One test fixture pins the real catalog-validated selection BEFORE creating its
Workspaces. Shared Context currently compares full ordinary selection metadata;
lead is adding a narrow canonical component-selection branch so this does not
require rewriting already approved workspace/project profiles.

No new native binary qualification is claimed by these injected integration
tests. Native/tool mediation remains the existing actual owner/bridge evidence.
External provider credentials/billing/model-quality checks: NOT_RUN.
Owner home GUI/start/restart/Stop UAT: HOME_UAT_NOT_RUN. These are separate from
the shared implementation integration work listed above.
