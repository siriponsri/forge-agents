# Session generation installer handoff

Base: required local `26ae0ca`. Assigned files only; no nested agents, push,
provider/account turn, credential migration or public service. Retained base,
frontend and session source generations were read only.

The no-code source setup now calls `runSessionPipeline` under the existing
Windows JobObject command owner after the pinned acquire/base-patch/dependency
and base-build stages. It prepares the existing minimal SDK1.32.2 closure from
the unchanged root lock (95 packages, integrity checked by npm, scripts ignored),
then clones and patches a NEW private generation and builds the session CLI and
matching T3 graph. Both SDK module import paths must point into the private
pipeline during source setup; approved cached images retain their reviewed
absolute compile paths. There is no model-selected executable path.

Verification keeps the exact base archive and patch pins. It checks the complete
frontend patch report, session patch preimages/postimages, upstream audited source
files, added contract/tool/profile/runtime modules, SDK import normalization,
Bun/build-Node executable pins, successful build reports, all45 emitted T3 modules
plus the actual root Node, CLI, broker and notices. The session patch-chain digest
is `d301fbbfa07b51da44e6d087e74714e07b082292de985b7613140998b07a5a47`.
The existing profile source pin is explicitly updated to the reviewed session
profile; `PIPELINE_CHANGED` and `PATCH_CHANGED` remain fail-closed.

Approved session pair:

- CLI `2.4.1-forge-sessions.0`:
  `2224d7edb8a06f241c5ec764b506607af110bfec5300e91a03e00421854aef17`.
- T3 all45 plus actual root Node, canonical name-sorted aggregate:
  `1435d81ad72b5838dd6f8b413bfda3576a4878f0845ec40e474758c333ba538e`.

`artifacts()` retains exactly the existing top-level `t3`, `opencode`,
`fileBroker` descriptors. The verified `opencode` descriptor adds
`{version,purposes,proof:null}`. Supported purpose inventory is:

| Verified generation | purposes |
| --- | --- |
| Original approved base | `guarded-default` |
| Approved frontend | `guarded-default`, `supervised-frontend-v1` |
| New session | `guarded-default`, `supervised-frontend-v1`, `supervised-orchestrator-v1` |

This is installation inventory only. Every route still requires current canonical
admission, exact live images and native attestation. Root owns the installation
probe's version acceptance, purpose checks, session route qualifier, singleton
host mounting and active-lease upgrade exclusion.

Setup persists an HMAC binding of the verified inventory and generated private
directory, using a private setup key under the existing exclusive ACL/owner lock.
On restart, edited/rehashed setup JSON cannot promote old images to session or
change the copied package identity. Hashes are streamed again on every descriptor
read; there is no digest cache. Pre-change persisted ready records lack this
binding and reject actionably with `ARTIFACT_CHANGED` /
`reinstall-private-artifacts`. Installing again from either old approved cache
remains supported and assigns its exact prior purpose set.

The session distribution retains six notices: FORGE, T3, OpenCode, MCP SDK,
the actual runtime Node, and `NODE-BUILD-LICENSE.txt` for the distinct pinned
build Node license. The original generation's five notices are checked intact;
the build Node notice is preserved without replacing the actual runtime notice.
Older installations retain their existing five-notice layout.

## Developer verification

`tests/guarded-session-install.test.mjs` uses actual retained source/images and
private disposable copies. It checks exact all45+Node hashes, CLI pin, descriptor
and notices, replay, reopen, image and authenticated metadata tamper, old-cache
purpose classification, session/frontend source and patch drift, SDK/runtime
additions, failed report, notice and image drift, pipeline/profile drift, and base
archive/patch drift. Its separate injected-output default-stage fixture verifies
the newest setup sequence and scrubbed environment; it is explicitly not a fresh
compile claim.

Relevant existing installer checks include actual Windows descendant cancellation
and app-crash recovery with no provider turns, old/unified private copies,
minimal SDK closure, failed-stage safety and manifest forgery. The new scoped
fixture supersedes the earlier nine-stage fixture and preserves its exact Bun
dependency arguments, T3 install/build modes and actual-Node verify assertions,
alongside the complete15-stage sequence. Lead owns removal of the superseded
fixture from the older test file; all existing safety tests remain.

Run the explicit heavy reproduction with
`node tests/guarded-session-install-fresh.mjs`. It creates a NEW private root,
seeds pinned archives by copy, executes real extraction/base patch/base and session
compilation plus private SDK npm ci, verifies installed images and reopens them.
Base dependency install stages explicitly reuse retained package stores read only
through NEW remapped importer links; they do not claim a clean dependency download.
For that reuse run only, the base T3 stage directly executes the exact
`build:bundle` compiler (`pinned Node` + `vite-plus/bin/vp pack`), recording its
observed exit code and patch digest in an explicitly labeled harness build report.
This avoids pnpm's automatic pre-run reinstall against reused stores. The pinned
production `build-t3.mjs`, package-manager stages, source checks and output checks
are unchanged. One earlier reuse attempt was stopped at pnpm's pre-run dependency
verification; it is not a successful compile claim.
It retains private command logs and `fresh-build-evidence.json`, including stage
results, source/build-report hashes, all45+actualNode/CLI/broker hashes and unchanged
retained source/image fingerprints. No native/provider turn is part of the run.

The first real source run exposed Python's Windows MAX_PATH failure on an upstream
fixture under the deep private build directory. Acquisition commands now receive
Windows extended-length cache paths; ordinary artifact descriptors keep their
strict normal private paths. A subsequent real pnpm build exposed the same limit
in its long task-state filenames; each build now uses a short unique `build-*`
directory directly beneath the existing protected artifact root. Its ACL and
ownership are inherited without links or a second authority. No source, patch or
artifact pin was relaxed. The dependency-reuse harness also materializes each NEW
importer's `node_modules` directory because pnpm refuses a junction at that root;
the package stores remain read-only links.

Fresh extraction, base CLI/T3/broker builds and the complete45-module base
verification subsequently passed. The actual SDK npm ci then exposed a separate
production prerequisite bug: npm rejects double-loading the same empty file as
both user and global config. Setup now creates two distinct empty private config
files. The full stage fixture checks this alongside its existing scrubbed-env and
command assertions; no lock, source, patch or image trust check was relaxed.

Actual fresh source compile evidence is pending completion of the heavy run.
No live provider/account session, Owner home workflow or product activation is
claimed. HOME_UAT_NOT_RUN. These external checks are separate from root-owned
integration and implementation obligations.
