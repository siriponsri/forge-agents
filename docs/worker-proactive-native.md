# Proactive native enforcement research handoff

2026-11-25. Branch `t3/proactive-native-enforcement`, baseline `35803d4`.
Actual inherited worker selection: **gpt-6.1-sol / xhigh**, as declared by the
T3/Codex harness. No switch, nested agent or extra provider/model verification
turn was used. Work was performed in the assigned isolated worktree. Only NEW
`app/proactive-native/**`, `tests/proactive-native*.test.mjs` and this note are
owned here. The lead's integration checkout was read-only.

## Decision and exact integration seam

**IMPLEMENTATION_INCOMPLETE: no qualified native automatic execution route was
established. Keep the lead's `t3.qualifyProactive(){ return null; }`.** Neither the
source audit below nor a generated configuration is an enforcement proof.
Unqualified recipe triggers must continue entering Inbox before `startRun`.
This is an implementation/enforcement blocker, separately from missing provider
credentials and **HOME_UAT_NOT_RUN**.

The existing `app/proactive/enforcement.mjs` seam is appropriate: the private,
synchronous qualifier must bind project/task/envelope/identity/scope, actual
route evidence, mode, native/normalized action enforcement and expiry. The lead
already invokes it at reservation and final provider dispatch. A later route
must also recheck it immediately before every normalized effect and return null
on unknown, changed or expired runtime/tool policy. T3 remains the sole
`startRun`/Stop/turn owner, with `approval-required` retained.

No compiler, guarded MCP execution server or proof issuer was added: this
research did not establish the required universal native-action boundary. There
is no safe basis here to claim those missing implementations are complete.

Delivered supporting research artifacts:

- `app/proactive-native/source-pins.json`: exact primary revisions, licenses,
  URLs and LF-normalized SHA256 hashes for 31 reviewed source files.
- `app/proactive-native/audit-upstream.mjs`: read-only, local source-integrity
  diagnostic. No provider, subprocess, network, account/config write or listener.
  It verifies those selected source bytes and always reports
  `automaticExecutionQualified:false`, `proof:null` and
  `runtimeEnforcement:NOT_TESTED_BY_SOURCE_AUDIT`. Do not mount this source-root
  diagnostic as an app/MCP action or use its output in `qualifyProactive`.
- `app/proactive-native/source-audit.json`: actual successful source audit. It
  contains upstream relative paths/hashes, not machine account paths or secrets.
- `tests/proactive-native-source.test.mjs`: missing/altered-source refusal and
  opt-in experiments on the actual reviewed primary source helpers. These are
  **source-contract experiments**, not native runtime/model tests.

## Primary source facts

**T3 0.1.11**, tag and revision
`59651c1761f6c63e9b6056839067066968e6a406`, MIT. Its matching executable was not
started in this worker. **OpenCode 2.4.1**, tag and revision
`6f0514052a3c859894ad01bb14cc14dda1e44b96`, MIT. Both tag identities were checked
with `git ls-remote`; source blobs were read from those fixed commits. No moving
documentation version was treated as the runtime contract.

1. T3's [OpenCode settings](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/provider-opencode/src/settings.ts)
   expose binary path, server URL/password and custom models, not a mediated
   action policy. The [driver](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/provider-opencode/src/server/driver.ts)
   probes and selects separate v1/v2 adapters. An executable being on PATH is not
   evidence of a particular v2 server or a restricted tool policy.
2. The [v2 adapter](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/provider-opencode/src/server/v2/adapter.ts#L448)
   `sessionRules` installs shell/edit/external-directory **ask** rules under
   `approval-required`, adds grants/agent paths and allows the whole thread's T3
   MCP namespace. `writeRules` updates session permissions on resume/turns and
   children. This is not native default-deny mediation. Its `RulesPolicy` only
   selects runtime/interaction mode; the v2 adapter does not consume arbitrary
   `sandboxPolicy` as a filesystem sandbox. Its `prepareTurn` registers T3's own
   MCP server with a per-thread credential; this is not FORGE's normalized MCP
   action guard.
3. [ProviderAdapter runtime policy](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/provider-core/src/server/ProviderAdapter.ts#L56)
   has opaque approval/sandbox fields. That schema is not proof every adapter
   implements them. [RuntimePolicy](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/apps/server/src/orchestration-v2/RuntimePolicy.ts)
   resolves policy from the T3 thread. The existing orchestration input does not
   provide a documented FORGE all-tool enforcement contract. Do not add invented
   `tools`, `allowedTools` or `sandbox` JSON to `t3_thread_launch`.
4. OpenCode's [Tool snapshot](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/tool.ts#L327)
   filters by `tool.options?.permission ?? name`, using the last matching rule.
   `whollyDisabled` requires a matching deny with resource `*`. Disabling
   `execute` makes other tools direct; it does not by itself remove them. A
   top-level wildcard permission deny is useful, but T3's appended shell/edit
   rules override those actions. A newly registered native tool declaring an
   `edit` permission alias remains discoverable under those combined rules.
5. OpenCode's [configuration policy plugin](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/config/plugin/policy.ts#L99)
   enforces `tool.use` by hooking **permission evaluation**. The central
   [tool executor](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/tool/runtime.ts#L40)
   calls the tool executor without universally asserting that policy. For a
   concrete current example, [opencode.worktree_create](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/tool/plugin/opencode.ts#L180)
   directly invokes worktree creation without its own permission check.
   **This shows a `tool.use`-only deny is insufficient. It is not a demonstrated
   bypass of combined wildcard permissions plus policies on the pinned binary.**
   That combination can hide the current unguarded tools; it still does not
   establish a universal name/provenance gate for future tools, aliased actions
   or policy changes.
6. [Session context](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/session/context.ts#L160)
   merges agent rules followed by session rules. Therefore a custom agent/global
   permissions file cannot be assumed to override T3's session additions.
   [Managed policy](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/managed-policy.ts)
   evaluates earlier configuration sources with higher policy priority;
   settings and policies have different precedence. The
   [configuration loader](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/config.ts)
   also loads managed/integration/global/project/explicit/content sources. A
   single written JSON file is not an effective-policy attestation.
7. Native [instruction loading](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/config/plugin/instruction.ts#L69)
   reads instruction files through FSUtil outside model tool permission checks.
   Native context sources must be confined or explicitly included in an approved
   read scope; merely disabling the `read` tool does not do that. The
   [CLI server process](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/cli/src/server-process.ts#L122)
   recognizes `OPENCODE_CONFIG_PROJECT_DISABLE` /
   `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG`,
   `OPENCODE_CONFIG_CONTENT` and separate Claude compatibility flags. These
   affect configuration discovery; they are not an OS sandbox and must not be
   described as disabling all native context reads.
8. OpenCode's [MCP executor](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/tool/mcp.ts)
   does call Permission for MCP operations. That can support a *future* exact
   bounded FORGE tool allowlist. It does not make T3's broader MCP namespace safe
   to expose, authenticate FORGE calls, or interpret arbitrary shell/tool
   arguments into path capabilities. The source schema uses v2 `permissions`,
   `policies`, and `mcp.servers`; v1 examples have different contracts.
9. The [Codex mode defaults](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L740)
   use `readOnly` plus user approvals for `approval-required`. This is useful
   supervision but does not itself prove recipe-specific read-path/capability
   confinement. No generic sandbox support was inferred for OpenCode, ACP or
   another native provider from this Codex implementation. OS ACL/VM/container
   isolation is a different possible route and was not configured/tested here.

## Candidate considered, and why it was not enabled

The plausible existing-v2 configuration approach is **both** a wildcard native
permission deny and a hard `tool.use` deny, permitting only exact authenticated
FORGE MCP tool actions. Also deny plugins, skills, other MCP/integrations and
native automation; bind the exact API-backed provider/model/options/account and
isolate all discovered context/config sources. No arbitrary shell, JS, Code Mode,
subagent or general T3 tool namespace can be admitted. Exact provider/account
and package controls matter: an OpenCode CLI-backed provider is not automatically
equivalent to its API-backed providers.

This worker did not generate a deployment configuration for that idea because:

- The installed binary is **OpenCode 1.18.30**, not the reviewed v2 runtime.
  It was queried only with `--version` in a fresh temporary cwd/home/XDG/data/
  cache, a small OS-only environment and update/model-fetch flags disabled.
  No account/config/catalog was read. Binary SHA256:
  `c1bdbb18767048e1853af4238311b3f7e16ff2f91b68fb4c7ced3c5175347eea`.
- The current T3 contract does not bind a private FORGE mediation profile at
  session creation/resume/turn dispatch or acknowledge installation of an exact
  native deny policy. Dynamic writes into an OpenCode session beside T3 would
  race T3's `writeRules`; a watchdog after a policy loss is not a pre-effect gate.
- Config/permission policy composition needs actual version-specific negative
  testing, mandatory enforcement of raw tool identity/provenance (including
  future tools), and bounded native context loading. The source-only helper
  experiments do not prove that composed runtime.
- An authenticated, bounded inbound FORGE action transport and race-safe file
  broker with current proof fencing have not been supplied by this worker. The
  existing outgoing MCP client and normalized action check are supplemental;
  neither automatically mediates native OpenCode tools.

These are precise implementation/qualification limits, not a request for the
Owner to provide credentials. No provider login/key is needed to implement and
test a deny-all runtime boundary with local engineering protocol fixtures.

## Executable next implementation change for the lead

The narrow route is a **T3-owned controlled OpenCode2 API session with all native
tools denied and only a bounded FORGE MCP gateway**, not a second inference loop.
It requires changing the selected native runtime integration, which is outside
this worker's permission to edit existing/shared/vendor/manifests. The lead can
assign a fork/build worker the following concrete patch scope:

1. Extend T3's private `ProviderAdapterV2RuntimePolicy` / `RuntimePolicy` with a
   trusted, versioned mediation profile carrying route/tool-policy generation
   and explicit FORGE tool identities. Populate it from FORGE admission, not
   model-visible launch arguments or a JSON `supported` flag. Carry and validate
   it at `ensureThread`, resume/fork and every final `sendTurn`; profile absence,
   mismatch or unsupported provider generation refuses the turn. Keep T3's
   existing lifecycle/Stop and `approval-required` ceiling intact.
2. In the controlled OpenCode2 adapter, do not append generic shell/edit allows
   or asks over its native deny. Require an all-tool gate which defaults to deny
   **raw tool identity and trusted MCP provenance**, before executor/hook effects
   and again after any tool-name rewrite. Apply it to direct tools, Code Mode,
   background/scheduled actions and child/native provider routes; unknown tools
   remain denied. A small tested OpenCode core fork at `Tool.snapshot`,
   `Tool.check` and `Tool.execute` is a concrete enforcement location. Reuse
   existing permission checks as further restrictions. No detached shell,
   arbitrary program, model-created plugin or alternate automation is allowed.
3. Register only exact bounded FORGE tools on an authenticated run-bound private
   transport. Proposed initial operations can be `read_text`, `propose_change`
   and a bounded revision-checked text mutation; their schemas must have no
   generic command/script/URL/server/tool argument. They are **proposed operations,
   not currently implemented tools**. Deny the broad T3 MCP namespace including
   delegation/config/approval/service actions. Bootstrap calls needed by T3
   itself remain in its control plane, outside model tool authority.
4. In the gateway, derive project/task/run/context from the authenticated private
   transport binding. Before every effect re-read canonical state, verify current
   route/binary/config/tool generation, invoke the existing
   `validateProactiveContext`, `validateProactiveEnforcement` and
   `validateProactiveAction`, plus ordinary governance. Guard every affected
   path. Use an actual race-safe confined file broker / OS boundary; a symlink
   check followed by an unprotected path open is not sufficient. Persist action
   operation/receipt identity before effects, retain unknown outcomes and never
   automatically replay. Stop/revoke/expiry/policy loss fences the next effect.
5. Bind the provider instance, API-backed provider implementation, exact observed
   model and typed options, account/secret generation, binary hash/version,
   effective policy and complete tool manifest to the evidence generation.
   Restrict startup/context reads and config imports too. A model option or
   account change invalidates qualification; a model alias is not evidence.
   Keep account credentials machine-only. No credential migration or global
   installed-app mutation is part of this patch.
6. Build the matching pinned T3/OpenCode artifacts with recorded licenses,
   changes and checksums. Before enabling the lead qualifier, use actual native
   dispatch with a deterministic nonauth local model/protocol fixture to attempt
   denied read/write/shell, unknown/aliased/new tools, Code Mode, nested/child and
   alternate MCP actions. Confirm zero effects and no prompts granting bypasses.
   Test valid bounded actions, identity swaps, stale policy/manifest, expiry,
   revoke/Stop, races, lost acknowledgements and restart recovery. Mint proof
   only from that private current runtime evidence. An authorized live T3 run
   then qualifies actual provider/model/Stop behavior separately.

The alternative is a genuinely provider/OS-enforced filesystem/process/network
sandbox plus a guarded normalized action surface. It still needs actual Windows
read/write scope, secret/account isolation and current per-effect evidence. No
such installed sandbox was proven in this assignment.

## Verification actually performed

Host: Windows / PowerShell, **Node v24.19.0**. No Bun/dependency installation was
required. No T3/OpenCode server, paid inference, local/public listener, provider
catalog/session, native tool execution, credential/account inspection, external
message, purchase, deployment, prototype or push was performed. Internal task
updates were sent to the lead only.

```powershell
# Substitute two LOCAL upstream source checkouts at the revisions above.
$env:FORGE_NATIVE_T3_SOURCE = '<T3-source-root>'
$env:FORGE_NATIVE_OPENCODE_SOURCE = '<OpenCode-source-root>'
node app/proactive-native/audit-upstream.mjs $env:FORGE_NATIVE_T3_SOURCE $env:FORGE_NATIVE_OPENCODE_SOURCE
node --test tests/proactive-native-source.test.mjs
node --check app/proactive-native/audit-upstream.mjs
git diff --check
```

Actual result: **31/31 selected source files matched**, **6/6 tests passed with
zero skips**, module syntax and diff whitespace checks passed. Two tests compile
only extracted, hash-checked pure TypeScript rule-selection helpers with Node's
`stripTypeScriptTypes`; Node reports its normal experimental-feature warning.
No upstream plugin/provider/runtime module is imported/executed. The alias test
does not execute a hypothetical future tool or prove an exploit on the installed
binary. Without both source-root environment variables the three source-backed
tests skip explicitly; the three negative diagnostic tests still run.

Automatic native enforcement, combined-v2-policy runtime testing, actual guarded
MCP actions, live provider/model execution and cancellation are **NOT_RUN**.
Home acceptance remains **HOME_UAT_NOT_RUN**. The source diagnostic is complete;
the required native automatic execution implementation is not.
