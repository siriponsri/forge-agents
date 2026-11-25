# Research native owner handoff — 2026-11-25

Scope: NEW `app/research-native/**`, `tests/research-native*.test.mjs` and this
note. No nested delegates, credentials/provider accounts, public listeners,
global installs, cache writes or push. Lead-authorized shared seam commits were
cherry-picked only to test against the exact integration API: upstream
`3a1db5a` (local `c835137`) and `161352d` (local `702bd70`). The worker's own
commit contains only the new assigned files. Protected portable/legacy paths,
shared contracts, manifests/locks and progress remain lead-owned.

## Implemented private callbacks

```js
import {createResearchNativeOwner} from '../research-native/owner.mjs';
import {openResearchModelGateway} from '../research-native/model-gateway.mjs';
import {precreateResearchOutput} from '../research-native/output.mjs';

const owner = createResearchNativeOwner({observeGuarded, resolveAllocation, clock});
// All mutating callbacks below run inside the SAME canonical store writer as
// Stop/restore/route/account/policy and existing Guarded effects. Never HTTP/MCP.
owner.retain(state, exactResearchRequest);
owner.qualification(state, exactResearchRequest); // synchronous read-only/null
owner.requestForRun(state, canonicalRun);
owner.admit(state, {run, stage, profile, attestation}); // true or throws
owner.nativePhase(state, {run, profile, body, attestation}); // true or throws
owner.modelRequest(state, {run}); // {deadlineAt,requestDigest,maxSteps}
owner.modelFailure(state, {run}); // void; fail closed for subsequent attempts
owner.action(state, {run,profile,capability,path,attestation}); // true or throws
owner.reserveAction(state, {
  run,profile,operationId,requestDigest,capability,path,attestation,
  priorOperations, // [{runId,operationId,requestDigest,status:'unknown'|'completed'}]
}); // true or throws; wrap in a void-returning onBeforeAction callback
owner.recordReceipt(state, {run,receipt}); // void
owner.resourceSnapshot(state, exactResearchRequest); // private metadata only
owner.close();
```

`observeGuarded(state,{request,trial,workspace,run,allocation,stage})` must be a
synchronous PRIVATE current lookup of the actual live installation/lease. It
has no default. It must return:

```js
{
  route, policyGeneration, toolGeneration,
  routeProof, // actual installation.qualifyRoute / bridge current route proof
  scope:{paths:['output.json'],capabilities:['read','propose','workspace.write']},
  limits:{maxRunMs, maxTokens:null, maxCost:null},
  profile, // actual private reserved Guarded profile; null before reservation
  attestation, // actual runtimeHost.attest result; null before native attestation
  phases, // actual private observeInstalledT3Host phases, includes open/ensure
}
```

Do not recreate this observation from persisted events, test reports, source
hashes or configuration. Root retains original selected upstream/account refs
and private prepared route identity, observes current full route/policy/tool
generation every time, and must validate the original exact credential reference.
This module never resolves credentials or creates a provider/run/turn itself.

The exact request matches `app/server/research.mjs`: version, projectId, trialId,
manifestDigest, workspaceId, taskId, runOperationId, runId, attemptId, deadlineAt,
route, components, limits. Both IDs are null before reservation and exact after.
Actual `verifyTrial`, canonical Workspace/task/run/context, source profile,
context policy, absolute deadline, Stop and restore fences are repeated.
The initial subset accepts static/single task with FORGE optional components
off, plus Memory through actual Context as separately validated by the bridge.
Unknown-accounting policy must be `allow`; tokens/cost/currency/finality remain
null. Non-null token/cost caps, byte caps above64KiB and agent faults refuse.

`retain` writes exact `research.native-actions`, `research.native-resources` and
`research.enforcement` events; existing bridge receipt validation consumes them.
Stage `route-admission` qualifies only the actual live installation and installed
mandatory callback contract before allocation. `reserved-mandatory-gates`
qualifies only a private current reserved run with all final gates pending.
Neither stage claims a model request or successful native attestation. Final
`send`, every model egress attempt, and each effect require actual attestation
matching binary/profile/context/manifest/policy/tool,17 zero-effect negatives and
actual T3 openSession/ensureThread phases. Root must install these final guards;
it cannot use a preparation receipt alone as permission to send.

Process capabilities bind each exact request to the current private observation.
Events cannot reconstruct them after restart. New host against retained resource
claims requires reconciliation, never a fresh counter/reset or native replay.

## Actual resource enforcement

Each exact run/attempt has its own action/resource qualification receipts. These
reference ONE `research.native-envelope` per trial/immutable manifest/deadline.
All resolved allocations share that envelope, including prepared model requests,
real HTTP attempts, total created sessions and distinct actions. These resource
counters are private evidence of admission/consumption, not token estimates or
agent success reports. Owner receipt events preserve unknown accounting.

- Absolute deadline is exactly `trial.startedAt + manifest.limits.maxMs` and is
  never restarted. Guarded profile expiry cannot extend it; gateway aborts held
  upstream at the same retained deadline. Root Stop must close both native lease
  and model gateway, and recovery never recreates either.
- Native `model-request` fence counts prepared logical requests before native
  model preparation. Egress gateway independently counts EVERY upstream HTTP
  attempt, including SDK/native retries that reuse one prepared request.
  Each ceiling is `maxSteps`; no extra request can spend a second allocation's
  independent budget. Distinct bounded actions also have a `maxSteps` ceiling.
- Zero retries after failed/partial/unknown upstream delivery is the supported
  conservative subset for any maxRetries cap, including0. Successful tool-loop
  continuations remain permitted. `retries:0` reports actual behavior; it does
  not assert unknown token/cost accounting is free.
- Native create is at most once for each exact canonical run and bounded by the
  global maxAgents ceiling. Nested/delegated/background/auxiliary/native Memory
  remain denied by the compiled three-tool profile.
- `reserveAction` uses the UNION of canonical consumed actions AND the actual
  durable local broker unknown/completed operation ledger. Root must union all
  exact trial/cohort broker ledgers before invoking it. A receipt callback or
  store transaction rollback cannot erase already consumed local capacity.
  Replayed operations stay in the broker's exact replay path, before this hook.
  Full broker receipts bind exact profile/run/request; they never mint trial
  success. Only the existing independent Research checker can do that.

## Model egress gateway and fixed output

```js
const gateway=await openResearchModelGateway({
  provider, // private already-resolved original upstream descriptor
  withFence, // SAME store writer; callback result must remain serializable
  authorizeRequest:({runId,attemptId,priorAttempts}) => {
    const run = canonicalRunFromCurrentFence(runId,attemptId);
    return owner.modelRequest(currentState,{run});
  },
  onFailure:({runId,attemptId}) => {
    owner.modelFailure(currentState,{run:canonicalRunFromCurrentFence(runId,attemptId)});
  },
});
// use gateway.provider in the private Guarded provider/context digest;
// keep actual original selected account/route admission independent of wrapping.
gateway.bind({runId,attemptId}); // one exact binding, cannot rebind
await gateway.close(); // prepare failure, launch failure, terminal, Stop, shutdown
```

Gateway may listen during preparation but denies all traffic before binding.
It accepts only authenticated local POST `/v1/chat/completions` for the exact
model, streaming chat transport, bounded request/response bytes and fixed
host-selected upstream. No redirects, forwarded model headers, arbitrary URLs,
model tools, retry/backoff loop or additional provider family is introduced.
Private credentials, URL and pending fetch Promise stay outside the store/model.
The fetch is launched under the writer; its Promise remains in a private closure
so SQLite's serializable transaction return boundary does not receive it.
Network waiting releases the writer so Stop can proceed. Local monotone attempts
and failed/uncertain state survive a failed canonical commit.

After `bridge.prepare` has completed its pristine check, before native bind/send:

```js
await precreateResearchOutput({
  store,dataDir,runId,admit:(s,detail)=>owner.admit(s,detail),clock,
});
```

This helper holds the existing store writer, resolves actual Git worktree
registration/source/branch/base and canonical run, and exclusively creates the
empty regular single-link `output.json` there. It accepts no path/name/text from
the caller. Replay requires its exact retained empty inode/device receipt.
Existing unclaimed/orphan/linked/dirty/changed output refuses; no overwrite,
adoption or cleanup of unknown files. Native broker still edits existing files
only; no new-file tool, arbitrary Memory MCP, scope or path widening.
This bootstrap runs before native launch; it is not a general race-proof OS
file creation primitive against an unrelated local administrator.

## Component integration seam

Optional `resolveAllocation(state,{projectId,trialId,workspaceId,runOperationId,
runId,attemptId})` is a trusted root wrapper over the component owner's pure
resolver. Null means NO composition and only primary immutable binding applies.
Foreign/stale/unclaimed allocation throws. Non-null exact shape:

```js
{
  composition,allocation,workspace,task,trial,manifest:trial.manifest,
  envelope:{trialId,manifestDigest,limits,deadlineAt,allocationCount,allocationIds},
}
```

Returned records must be actual canonical copies. Allocation has an `id`, exact
`workspaceId` and `runOperationId` or `operationId` equal to the owned Workspace
operation. Trial/manifest/limits/deadline, workspace/task and full allocation set
are verified; run must retain `researchComponentContext`. Each member has its
own exact fixed output scope/checkout, context/run/attempt and private lease;
resources remain global. Allocation identity is part of process capability.

Enabled FORGE components are accepted only through this actual owner resolver.
**Root/component owner MUST still validate their real consumption at final
send/action.** Allocation/configuration is not skill/memory/staffing/adaptation
consumption proof. This owner reports only ambient native optional features
disabled; it does not fabricate a FORGE component-effect receipt. Existing
Research bridge rejects component/non-static policies until shared integration
installs the component owner's actual validation. Memory remains actual Context
selected refs, never a broader MCP attachment.

## Verification and remaining integration

Owner tests:9/9 PASS, including actual SQLite/Git worktrees/fixed output, exact
null-versus-run proofs, Stop/restore/drift/restart, shared allocation envelope,
unknown accounting and durable local operation union. Live Guarded observations
in this unit suite are explicitly `INJECTED_NATIVE_PROOF_NOT_LIVE`.

Gateway tests:7/7 PASS, actual loopback upstream and SQLite writer, unauthorized
prebind/path/model/auth, bounded continuation, failure/redirect no retry,
absolute deadline abort and Stop close. No external provider/account calls.

Actual compiled binary fixture: **5/5 PASS,271.4s,no skips**. Actual compiled
T3/OpenCode/Windows broker completed one canonical attempt and edited existing
output to the independently asserted aggregate bytes. The native maxSteps
continuation denial, durable action-budget batch and503 upstream-retry denial
also passed. Full run observed5 loopback upstream requests,3 completed broker
receipts, native prepared-request counts `[2,1,2,1]`,17 installation negatives
and2 compiled T3 connection negatives. No outside edit occurred. Pinned actual
T3 graph+Node hash `3494a3e4bce00e971a999fe51f5334d471e8d7a220db43e90f50f535314b0bf9`,
OpenCode hash `33ef775f30afbf7808773e97bc4d70e1dc990155541162c92e5b6e2dc1c18ad3`.

The test exercises the existing compiled private T3/OpenCode/Windows broker
with deterministic loopback model protocol and injected canonical owner policy;
it cannot independently qualify the assembled production Research owner.
`productionResearchProof:null`, `externalProviderTurns:0`. Qualified cache
`%TEMP%/forge-guarded-timeout30s-20261125` was read only; no binary/source/cache
or native timeout/pin was changed. Earlier developer runs exposed and fixed
the store Promise-return error; only the corrected final run is a passing result.

**Timing boundary:** binary fixture uses existing native maxRunMs300000 and a
fixed30s egress deadline captured at engineering final-send admission. Positive
bind/attest/turn took58.8s including setup; this is NOT proof that the complete
production Research preparation+execution fits the currently declared30s cap.
Production must retain its one absolute trial deadline from dispatch, choose an
explicit schema-supported cap that covers measured setup, and refuse on expiry.
No resetting of actual trial deadlines or expansion of native30s fence patience.

Action-only diagnostic rerun can be selected with
`FORGE_RESEARCH_NATIVE_CASE=actions`; unselected cases are explicitly skipped.
This case additionally requires an actual observed `onBeforeAction` budget
denial, so a deadline-induced no-edit result alone cannot satisfy it.
Strengthened action-only rerun: **PASS84.3s**, actual `deniedActions:1`,1
upstream loopback request,1 broker receipt, native prepared requests `[2]`;
3 unrelated cases explicitly skipped. This rerun does not replace the full
5/5 result above. All processes/gateways/stores were closed by the fixtures.

Worktree lacks dependency links. Verification used Node24.19.0 with an in-memory
`node:module.registerHooks` fallback resolving already pinned dependencies from
the existing root checkout. No installation, manifest/lock edit or cache write.
On the integrated root with dependencies, ordinary commands are:

```powershell
node --test tests/research-native-owner.test.mjs tests/research-native-gateway.test.mjs
node --test tests/research-native-binary.test.mjs
node --check app/research-native/owner.mjs
node --check app/research-native/model-gateway.mjs
node --check app/research-native/output.mjs
git diff --check
```

**Lead-owned implementation work:** production observeGuarded/retain ordering,
Resource callbacks installed in generalized Research-capable Guarded and T3
branch; gateway bind/cleanup on every lifecycle edge; fixed-output bootstrap
after pristine check; full component consumption and cohort ledger union;
actual Context and independent checker plus authenticated Research GUI flow.
Absence of those is implementation integration, not missing credentials/UAT.
No production qualifier is activated by importing these modules.

**External NOT_RUN:** real provider/account/model-quality result or public
benchmark score. **HOME_UAT_NOT_RUN:** complete authenticated local product
Research workflow on owner's home machine. No measured research improvement.
