# Private Guarded artifact setup handoff

2026-11-25, baseline `10e536b`, isolated branch `t3/guarded-artifact-setup`.
Actual runtime model/effort: `gpt-6.1-sol / xhigh`. No switch or nested delegates.
Only the assigned new installer, GuardedSetup/CSS, installer tests and this note
are owned here. No existing shared source, tools, manifests/locks, progress,
README, ordinary installed T3, protected launcher payload or legacy edits.
No provider/account calls, credential migration, prototype, public listener,
paid compute, push or activation. `HOME_UAT_NOT_RUN`.

## Private host API

```js
const service = await createGuardedArtifactService({
  dataDir,                  // trusted machine data root, outside editable projects
  workspaceRoots,           // root supplies ALL editable workspace roots
  // approvedCache,         // OPTIONAL host-only known qualified developer cache
  // pythonPath,            // OPTIONAL host-only existing Python prerequisite
  // commandRunner,         // OPTIONAL trusted engineering injection, never HTTP
});
await service.state();
await service.install({operationId}); // durable preparing response, then background job
await service.cancel({operationId});  // exact CURRENT setup operation only
await service.artifacts();            // verified descriptor, or null
await service.close();                // drain exact owned tree; idempotent concurrent close
```

`install` and `cancel` accept ONLY `{operationId}`; browser project IDs are
root routing context, not installer authority. Operation IDs are bounded opaque
strings; replay of any known operation returns its metadata without dispatch.
New operations while another is active refuse. New explicit setup uses a new
private generation and never overwrites files referenced by an older descriptor.
History is bounded at 1000 operations; there is no unbounded subprocess queue.

Public state is only:

```js
{
  status: 'missing' | 'preparing' | 'ready' | 'failed' | 'cancelled',
  operationId: null | 'opaque-id',
  progress: {stage: 'preflight' /* fixed stage code */, completed: 0, total: 11},
  recovery: null | 'reconcile-required' | 'retry-with-new-operation',
  error: null | {code: 'fixed-code', action: 'named-setup-action'},
  checkRequired: true
}
```

No physical paths, raw process output, provider settings, keys or PIDs are public.
`ready` means file integrity only; it never means an installed live route is
qualified. Installer never imports the native runtime, opens a listener, creates
a canonical task/run/thread, makes a model request or mints Owner authority.

Descriptor EXACTLY matches the native handoff:

```js
{
  t3: {entry: absolutePrivateEntry, files: [
    /* all 45 .mjs files, original chunk names */
    {name: 'forge-guarded-host.mjs', path: absolutePrivateEntry},
    {name: 'node.exe', path: process.execPath}
  ]},
  opencode: {path: absolutePrivateExe},
  fileBroker: {path: absolutePrivateBroker, sha256: checkedBinaryHash}
}
```

The actual current process executable is fingerprinted with the T3 graph.
Reopen and every descriptor request rehash the copied private files and current
Node. A changed file, missing chunk, extra file, link, hardlink, escaped generation
or changed runtime Node yields null and explicit integrity recovery. No runtime
Bun, pnpm, Node26 or external Effect install is needed by the compiled entry.

## Owned build pipeline and trust

Production default creates a fresh `dataDir/guarded-artifacts/builds/<uuid>`.
It copies 21 exact pinned pipeline/source/license inputs to that private tree,
verifies the pins before executing, and invokes existing scripts in this order:

1. acquire pinned T3/OpenCode/Bun archives;
2. acquire Node26.13.1/pnpm12.14.0 toolchain;
3. validate original source pins and exact native patch preimages, apply patches;
4. isolated Bun1.4.4 frozen dependency install, scripts ignored;
5. isolated T3 frozen dependency install, scripts ignored;
6. build native OpenCode;
7. build the T3 standalone module graph;
8. build the broker with Windows Framework64 csc;
9. generate checksum inventory using the actual runtime Node;
10. verify source archives, both pnpm archives, original source pins, all patched
    source bytes, patch/build-report digests, compiler/source/final binary hashes,
    complete graph and inventory; privately copy and independently rehash outputs.

The compiler is pinned by bytes; its Windows system hardlink is deliberately
allowed only at the fixed compiler path. Private inputs/outputs reject links and
hardlinks. Paths reject UNC and alternate streams. Runtime payload is copied into
`generations/<uuid>` with T3/OpenCode/FORGE/Node notices. All paths are host-only.
The private root uses a current-user-only Windows DACL; child dirs/files inherit
it. Root must provide a machine data directory and the complete workspace list.
There is no arbitrary executable/cache directory picker exposed to HTTP.

`approvedCache` is an explicit developer optimization for the lead-approved
`%TEMP%/forge-guarded-build`. It is never discovered automatically. It must pass
the same source/patch/build checks PLUS these trusted final fingerprints:

| Actual component | SHA256 |
| --- | --- |
| OpenCode | `309f61f0fc52f849256a9e4e26af55365da32d9ff4773f273bd6a186ae296def` |
| T3 all45 + actual root Node24.19.0 aggregate | `3494a3e4bce00e971a999fe51f5334d471e8d7a220db43e90f50f535314b0bf9` |
| Broker | `0c8a796db59f0829ac4b28b97be774523210f5ff99b7e6139e3fc442e8d2e08d` |
| Framework compiler | `46809206887326d2d24db1eff1f3064de972c3451abe766b49111450a5e08e00` |
| Patch changes aggregate | `18ae81444cbb94948c977dd319f675f58433bf6f714412587f2029e67b230479` |

The native worker already ran the full expensive source build. Its inventory
has `proof:null`. This worker exercised the actual cache/private copy; it did
not repeat that expensive build. A fresh compiler build may produce different
PE bytes: those are bound to that owned build and still require an actual live
native check. A self-declared cache manifest cannot approve changed binaries.

Missing Windows x64, Framework, Python3 or changed pinned compiler reports a
named setup action. Default Python discovery uses existing per-user
`Programs/Python/Python3*/python.exe`, newest numeric version first; trusted hosts
can supply an existing absolute `pythonPath`. There is no global install or PATH
change. The child environment is an allowlist with isolated homes/config/cache,
no inherited credentials, NODE_OPTIONS, proxy tokens or provider environment.

## Process ownership, Stop and recovery

A private compiled .NET helper holds `owner.lock` with `FileShare.None` for the
service lifetime. A second live setup owner refuses; the machine file has no
persisted PID recovery logic. Each subprocess starts suspended, is assigned to
a Windows JobObject with kill-on-close and a 64-process cap, then resumes.
Every stage has a ten-minute bound; existing scripts have shorter child bounds.
Output is discarded, not forwarded to public logs/state. The helper accepts only
the trusted host's fixed stage commands through a private stdin pipe.

Cancel closes the exact owned JobObject, including descendants. App process death
closes stdin, which closes the job and exclusive owner lock. `close()` revokes
setup, waits for the active stage/job and drains the helper. No persisted PID is
killed. A prior `preparing` operation on reopen becomes failed with
`INSTALL_INTERRUPTED/reconcile-required`. Reads/replay do not rerun an ambiguous
stage. Only a NEW explicit setup operation can build a fresh generation. There is
no automatic restart/resume/repair. Cancellation never turns a partial build ready.
Storage acknowledgement failure fails closed with reconciliation metadata.

## UI and lead integration

`GuardedSetup({t,state,projectId,run,busy})` preserves the existing Operate surface,
native buttons, semantic theme tokens and TH/EN copy. It accepts either
`state.guarded={installation,readiness}` or direct `{installation,readiness}`.
It POSTs `/api/guarded/state` with `{projectId}`; install/check add fresh
`operationId`, cancel uses the exact current installation operationId.
Every response should be `{installation,readiness}`. Only state is polled;
mutations/checks are never replayed. Install progress, empty/loading, disconnected,
failed/recovery, cancelled and installed-but-check-required states are explicit.

Lead-owned integration remains:

- strict Owner + browser-session/CSRF HTTP routes and safe errors;
- add `/guarded/` to api.mjs Owner header routing;
- mount in per-project Settings;
- lazily consume `artifacts()` for the canonical Guarded bridge;
- block upgrade while active native leases exist; new generations never overwrite;
- `/check` invokes actual native installation check for the selected project route,
  not the installer, and returns safe readiness metadata;
- coordinate app shutdown with bridge and installer cleanup;
- independent review, canonical execution/activation, and final product release.

## Executed checks and limits

- `node --test tests/guarded-install.test.mjs`: 8 backend checks, including actual
  approved cache private copy/all45/current Node, exact replay, restart, tamper,
  forged cache inventory rejection, prerequisite action, real Windows descendant
  cancellation/close, real app crash/recovery. No live provider calls.
- Build-stage sequence and nonzero failure tests use an injected command runner
  and explicit build execution fixtures. Their output copy is NOT a fresh build.
- `node --test tests/guarded-install-ui.test.mjs`: standalone Vite/React/Chromium
  fixture, TH/EN states at375px, desktop1100px, no overflow, keyboard focus and
  strict request bodies. No actual HTTP install/check. Worker used the lead's
  existing dependency tree through `FORGE_GUARDED_TEST_DEPENDENCIES`; no lock edits.
- Actual rendered progress/recovery/ready screenshots inspected. Impeccable
  mechanical detector: `[]`. No nested review agents; independent review remains
  lead-owned per brief. Screenshots are disposable TEMP evidence, not committed.
- Syntax and diff whitespace checks pass. No caches, executables or credentials
  committed. Whole-product build and native activation are lead-owned.

This worker has no missing live-credential implementation dependency. Actual
selected-account live qualification and `HOME_UAT_NOT_RUN` remain separate from
the installer checks above.
