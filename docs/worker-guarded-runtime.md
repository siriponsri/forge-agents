# Guarded runtime implementation checkpoint

2026-11-25. Assigned isolated worktree, baseline `86c9c27`. Actual inherited
`gpt-6.1-sol / xhigh`; no model switch or nested agent. Only new
`app/guarded-runtime/**`, `tools/guarded-runtime/**`,
`tests/guarded-runtime*.test.mjs` and this note are owned here.

**IN_PROGRESS / proof:null / automatic execution not qualified.**
This checkpoint is executable implementation, not a product activation. The
lead's qualifier remains null. Full matching T3 lifecycle, native context and
actual CLI negatives remain work in progress. No global app/account changes,
push, deployment, prototype or external provider/model invocation occurred.

## Implemented and executed

- Windows native `ConfinedText.cs`, compiled with existing Framework64 csc.
  Drive-root-to-leaf relative `NtCreateFile`, `FILE_OPEN_REPARSE_POINT`,
  same-handle metadata/read/write, held parents without write/delete sharing,
  exclusive existing final file, single hardlink/local fixed NTFS only. No
  `lstat` followed by pathname reopen. UTF-8 existing text <=64KiB, bounded
  whole-file replacement with SHA256 revision precondition; no create, shell,
  directory listing, URL, executable/config, arbitrary command or generic tool.
- HMAC authenticated run-bound inbound broker, exact schemas, current private
  profile and canonical action checks under a host-supplied shared Stop/policy
  fence. SQLite WAL/FULL durable unknown reservation before file access;
  completed exact receipts replay without effects; collision/unknown refuse.
  Interrupted writes may be partial and remain unknown, never auto-replayed.
- Host bridge for actual route/provider/account/model/options, binary hashes,
  current manifest/context/policy observations and canonical enforcement/action
  plus ordinary governance. Private handles cannot be forged by JSON. Root
  `proofForRun` must supply actual current runtime evidence; a supported flag,
  audit/config/module-fixture result cannot qualify the product.
- Reproducible pinned archive acquisition, patch preparation, native fixtures,
  compiled OpenCode CLI build and isolated `--version` probe. Source and MIT
  notices are committed, machine binaries/cache/credentials are excluded.

Executed Windows tests: **6/6 PASS**, no skips:

```
node --test tests/guarded-runtime-broker.test.mjs
```

Includes read/propose/edit; concurrent replay; restart/lost acknowledgement;
Stop; outside paths/ADS/junction/hardlink; actual directory/file replacement and
hardlink creation while handles are held; stale revision; transport/run/tool/
account/route/policy/tool-manifest/context/expiry/governance swaps; durable
unknown outcome with actual write performed and acknowledgement discarded.

Actual patched OpenCode Tool service/raw dispatcher/hooks/central executor:
TypeScript and built 8.5MB fixture bundle both PASS. Unknown native names,
permission aliases, alternate namespaces, Code Mode, aliases and hook rewrites
produce zero untrusted executor effects; raw denied calls produce zero prehooks.
A separate native-executor -> private authenticated pipe -> compiled Windows
broker fixture PASS performs read/propose/revision edit/replay, denying outside
read/write and shell with zero outside-file effects. These are labelled native
module/protocol fixtures, not full matching runtime qualification.

## Pins and toolchain

- T3 tag 0.1.11, revision `59651c1761f6c63e9b6056839067066968e6a406`, MIT.
  Pinned server package bytes say 0.1.10: do not infer artifact version from tag.
  Requires Node26.13.1 / pnpm12.14.0 / effect4.1.3. Matching T3 build pending.
- OpenCode2 revision `6f0514052a3c859894ad01bb14cc14dda1e44b96`, MIT,
  package2.4.1, Bun1.4.4/effect4.1.0. Actual compiled derivative probe:
  `opencode v2.4.1-forge-guarded.0`, SHA256
  `ce9779e67e7884c8b1f90d2c0b5fb32efe3572de0a937a3a2c98c5b13acd0fab`.
  Build/version success is not enforcement proof.
- Archive SHA256 pinned in `tools/guarded-runtime/acquire.mjs`. All 31 prior
  reviewed upstream hashes validate before patches. Transformation preimages
  validate before writing; patch reports contain before/after hashes. Windows
  extraction materializes internal symlinks and records one dangling T3 editor
  link into ignored node_modules; no target is invented or followed outside.

Use a new isolated cache (never installed T3/OpenCode or app/vendor):

```powershell
node tools/guarded-runtime/acquire.mjs <absolute-cache>
node tools/guarded-runtime/prepare-native.mjs <cache>/t3 <cache>/opencode <cache>/patch-report.json
# Execute the cache-local Bun from cache/bun/bin/bun.exe, in cache/opencode:
bun install --frozen-lockfile --ignore-scripts --filter @opencode/core --filter @opencode/cli
node tools/guarded-runtime/run-native.mjs <cache>/opencode <cache>/bun/bin/bun.exe
node tools/guarded-runtime/run-native-broker.mjs <cache>/opencode <cache>/bun/bin/bun.exe
node tools/guarded-runtime/build-native.mjs <cache>/opencode <cache>/bun/bin/bun.exe
node tools/guarded-runtime/probe-native.mjs <cache>
```

An initial plain Bun fixture bundle exposed its known `NodeWS` reexport issue;
upstream CLI build already supplies the needed plugin. The final isolated
module bundle passes. An initial native default service graph observed ancestor
config watchers outside the disposable home. That graph was stopped, and final
module fixtures replace ambient services; this finding is a concrete reason
full native context qualification is still required.

## Exact unfinished integration

The checkpoint derivative refuses prompt preparation and native agent/instruction
expansion. Native Code Mode is disabled, discovery is allowlisted by private
host identity, raw/prehook/post-rewrite/central execution is gated. T3 patch
adds a private profile policy slot/resolver and checks ensure/resume/fork/start,
submit/final-send/steer; broad upstream session grants are disabled. The opaque
host bridge is not installed into a matching running T3 server yet. No complete
native bootstrap/MCP provenance handshake or sanitized-context transport exists.
Cached resumes/compaction/background/internal non-tool input paths still require
full confinement and actual CLI tests, including profile/identity/Stop loss.

The lead subsequently authorized continuing this same assignment with a local
loopback deterministic model-protocol fixture driving the actual CLI. It is
engineering qualification, not a real provider/model-quality run. External
providers/accounts/spending remain forbidden. Continue implementation; do not
mint proof from the passing subset or end at this checkpoint. **HOME_UAT_NOT_RUN**.
