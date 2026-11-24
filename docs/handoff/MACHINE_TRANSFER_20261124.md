# FORGE — machine-transfer checkpoint

Owner instruction: **stop all work and push the current source to main for moving
to another machine**. This instruction supersedes continued implementation and
the previous complete-release sequencing. Do not treat this checkpoint as
`READY_FOR_HOME_UAT` or a completed product.

Status: **IMPLEMENTATION_INCOMPLETE / HOME_UAT_NOT_RUN**.
Actual development model: `gpt-6.1-sol`, reasoningEffort `xhigh`, serviceTier
`default`. No model switch, external account migration or public deployment.

## Preserved work

- Current integrated `app/` code, shared contracts, root lockfile and all
  completed scoped workers, including central Owner Memory, Context, Goals,
  provider setup/catalogs, supervised MCP/OAuth, compute, reports, storage,
  desktop, native office edits/images, themes and Telegram relay.
- Standalone public website under `apps/website`, commit originally `477a8b1`.
  Worker build/typecheck/browser/a11y evidence is included. Lead's independent
  review was interrupted; public deployment has not run.
- Encrypted machine-key service and GUI, plus latest host runtime integration.
  Provider keys enter the T3 process environment only. A changed key after T3
  startup requires restarting FORGE; no key value is persisted in provider config.
- Pending compute environment work is preserved in
  [pending-compute-environment.patch.gz](pending-compute-environment.patch.gz).
  It is **not applied to the running product**. The interrupted worker reported
  five new checks passing, but did not finish its handoff/commit or lead integration.
  The patch includes its scoped source and tests; no machine credentials.

## Last observed verification

- Final checkpoint `npm run build` **PASS** (19.92 seconds), Node syntax checks
  and staged whitespace check **PASS**. Existing native dependency/chunk-size
  warnings remain. Core GUI/Univer/Python/restart smoke passed before the latest
  credential/setup edits; it was not rerun after the Owner stop instruction.
- Production controls and knowledge/compute browser smoke passed; JSON evidence
  is in `docs/evidence`. Latest secret panel/KOB preview UI edits need a fresh
  integrated browser pass on the next machine.
- Full suite: 408 runner entries, 401 passed, one failed, six optional skips.
  Failure was the isolated Owner-memory browser fixture missing `/api/session`.
  That fixture was corrected; the subsequent affected 25-entry group passed.
  The complete suite was not rerun after later credential changes.
- Production DPAPI → actual SDK MCP child → rotation → revoke/isolation check
  passed (`tests/product-secret-runtime.test.mjs`, disposable keys only).
- Fresh isolated T3 setup/full-native-catalog RPC passed with no account login or
  model turn. Unauthenticated catalog correctly reported incomplete.
- Independent integrated code review was stopped before inspection. **NOT_RUN**.

## Resume on the next machine

1. Preserve local edits, then `git pull --ff-only origin main` in a clean clone.
2. Read root `AGENTS.md`, v3 `00_START_HERE_TH.md`, this file and CURRENT_STATUS.
3. Install Node 24.13+, then run `Start-FORGE.cmd`. For CLI verification:
   `npm ci --include=dev`, `npm run build`, `npm start`.
4. Configure accounts, keys, engines and destinations on this machine. Git does
   not transfer local databases, private vaults, provider sessions or model weights.
5. When resuming implementation, decompress the gzip patch to a temporary
   `.patch` file, inspect it, then use `git apply --check <file.patch>` before
   `git apply <file.patch>`. It touches only compute adapter source and tests.

## Next executable work

- Wire trusted compute runtime `{env}` into baseline SSH/Jupyter/cloud calls and
  redaction, using the saved project/purpose key resolver. Do not set global env
  or persist key values. Hosted Colab has a separate project-scoped resolver.
- Verify latest provider environment/bootstrap/restart fences, secret UI, KOB
  pre-configuration discovery and MCP invalidation together in the built App.
- Review metadata-restore quiescence and goal/relay/adaptive admission races;
  finish the interrupted independent review before claiming release readiness.
- Finish explicit interrupted/unknown recovery UX, production memory MCP setup,
  required integration/acceptance gaps and public-website lead review. Optional
  DSH/native parallel isolation and macOS secure entry remain unqualified or
  unimplemented as documented; do not relabel them as missing credentials.
- Run affected checks plus final integrated build/core/persistence/package
  verification. Then complete documentation/README polishing and the original
  release documentation gate for a future complete-product release.

Telegram is the confirmed first Hermes/OpenClaw mobile channel. Owner Memory is
central and private, shared into each project only with explicit permission.
No CA-EWS/prototype, resource purchase, force-push or public hosting is authorized
by this transfer instruction.
