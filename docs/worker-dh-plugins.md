# DH-01 / scoped DH-02 worker handoff

2026-11-24. Worker: Codex / gpt-6.1-sol / xhigh. Branch
`t3/native-plugin-registry`, based on `43e71ef`. Assigned paths only:
`app/plugins/**`, `app/web/src/Plugins.jsx`, `tests/plugins*.test.mjs`, this note.
No main/domain/T3/App/Settings/migration/dependency/progress changes or push.

## Actual coverage

Implemented a native, runtime-validated capability registry and a functional
Thai/English PluginManager component. Existing FORGE `store.transaction`,
`state.events`, and `state.receipts` remain authoritative. No plugin database,
planner, module discovery execution, package installer, credential transfer,
prototype, external provider turn, or DSH runtime has been added.

The registry supports trusted compiled providers and consumers, stable semantic
versions, declared dependencies, cycle checks, enable/disable, scoped config,
real injected health, lazy activation, reverse disposal, active call leases,
failed-cleanup quarantine, optimistic revisions, durable selection/call receipts,
idempotent commands, and explicit startup recovery. A missing adapter cannot be
enabled and cannot return healthy. The registry version is `1.0.0`; supported
ranges are exact stable `major.minor.patch`, caret, and `*` only. Unknown syntax
fails closed; there is no risk-exemption or install interface.

Scopes: project, session (canonical conversation ID), agent (bot ID), task.
Configuration merges project → session → agent → task; every explicit ancestor
Off blocks a child On. Unconfigured scopes inherit. Configuring a new binding
starts it Off; enable is a separate action. A task's assigned bot and a private
conversation's bot are derived into the effective context so omission cannot
bypass agent Off. Contradictory/foreign claims fail. Scope entity revisions are
part of the selection signature; changes during authorization fail admission.

Selection records contain exact plugin/service versions, effective safe config,
scope/revision bindings, a signature, and a concise rationale. They explicitly
record `authorization:not_granted`. Native call records persist request hashes,
selection metadata, and status only. Neither arguments, output, arbitrary native
errors, credentials, native prompts nor provider-internal context are copied into
plugin snapshots. Configuration schemas accept native IDs rather than account
settings; existing provider/MCP setup owns credentials.

## Exact lead integration contract

```js
import {createPluginService, dispatchPluginRequest} from './app/plugins/index.mjs';
const plugins = createPluginService({store, adapters, authorize});
await plugins.recover(); // exactly once during startup, before serving requests
// Existing loopback/origin/request-size controls remain on the HTTP boundary.
// POST /api/plugins/:action => dispatchPluginRequest(plugins, action, parsedBody)
// React Settings => <PluginManager t={t} state={state} projectId={projectId}
//                                  run={run} busy={busy}/>
// Shutdown: stop/reconcile owned native work, await plugins.close(), then store.close().
```

`PluginManager` is the default export of `app/web/src/Plugins.jsx`.
`dispatchPluginRequest` accepts exactly `list`, `configure`, `enable`, `disable`,
`health`, `resolve`. All are **POST**, including reads, to keep bodies/scopes
consistent. `invoke`, `recover`, `close`, arbitrary registration and factory
selection are not HTTP routes. Errors carry `{statusCode,code,message}` for the
existing `{error:{code,message}}` response mapper.

| Action | Request body | Result |
| --- | --- | --- |
| list | `{projectId,scope?}` | `{scope,plugins:[...]}`; metadata, own/effective config/enabled, own revision, compatibility, runtime drain status |
| configure | `{projectId,scope?,pluginId,operationId,expectedRevision,config}` | Durable `plugin.binding` event; full own config replacement, inherited values retained from ancestors |
| enable / disable | Same as configure without `config` | Durable binding event with incremented revision |
| health | `{projectId,scope?,pluginId}` | `{pluginId,status,checkedAt,results? ,code?,message?}`; actual adapter result, sanitized |
| resolve | `{projectId,sessionId?,agentId?,taskId?,operationId,requires:[{capability,version}]}` | `{context,scopeRevisions,plugins,signature,rationale,receipt:{id,operationId,authorization}}` |

`scope` is `{kind:'project'|'session'|'agent'|'task',id}`. It defaults to the
project; a project scope may omit `id`. Initial `expectedRevision` is **0**;
subsequent writes use the binding's own revision, not the global state revision.
List plugin identity is `id`; mutation identity is `pluginId`. Operation IDs are
globally replay-bound to exact payload/method/scope. Replays return historical
receipts, not newly qualified runtime state.

### Trusted native adapter injection

The factory's `adapters` dictionary keys are `models`, `provider`, `mcp`, `skills`,
`environment`, `desktop`, `browser`. Builtin IDs are `forge.<key>`; all provide
their same-named capability at `1.0.0`. Builtins do not invent dependencies between
otherwise independent native services. Inject each adapter explicitly:

```js
const adapters = {
  models: {
    async health(ctx) { /* actual native readiness */ return {status:'ready'}; },
    async invoke(method, args, ctx) { /* call existing authoritative service */ },
    async dispose(ctx) { /* release only resources belonging to this scope */ },
  },
};
```

The comments illustrate integration points, not a shipped default. Missing
adapters fail `ADAPTER_MISSING`; invalid injected factories fail
`ACTIVATION_FAILED`. Adapter context:
`{scope:{projectId,sessionId?,agentId?,taskId?},config,dependencies,signal}`.
`health` must return `{status:'ready'|'degraded'|'unavailable',code?:UPPER_CASE}`.
Arbitrary health fields/messages are discarded. `invoke` must return bounded
JSON; a malformed result becomes an unconfirmed outcome. `dispose` is optional
on the native adapter and required on a custom factory result. The default
builtin wrapper supplies it even when the adapter has no resources to release.

The AbortSignal is aborted when disposal begins **after active leases drain**.
Disable never claims cancellation of an in-flight tool. Use existing native
Stop/Take over controls for that. Do not wire a scoped dispose to a global
`connections.close()` or shared T3 shutdown: it may only release scope-owned
resources. Stateless adapters can omit dispose. Factories must roll back their
own resources if they throw before returning an instance.

| Capability | Config form fields | Runtime-validated methods |
| --- | --- | --- |
| models | providerInstanceId | catalog({providerInstanceId?}) |
| provider | providerInstanceId | dispatch({taskId}), stop({runId}) |
| mcp | connectionId | discover({connectionId}), call({connectionId,name,arguments:JSON}) |
| skills | skillIds[] | select({taskId,skillIds?}) |
| environment | connectionId | inspect({connectionId}) |
| desktop | targetId | inspect({targetId}), stop({targetId,controllerId}) |
| browser | targetId | inspect({targetId}) |

Adapters should merge the registry's **trusted** context/operation into their
existing service call, never accept payload-supplied approved flags, owner IDs,
credentials or arbitrary subprocess arguments. Resource IDs in args/config must
belong to the project; a pinned config ID cannot be overridden in method args.
Provider instance identity remains owned by the native provider catalog, and
the provider adapter must verify that native identity and current configuration.

Custom compiled definitions may be supplied at application composition through
`builtins` (not HTTP): `{id,version,requiresHost,configSchema,provides:[{capability,
version,methods:{method:inputSchema}}],consumes:[{capability,version}],create}`.
`create(ctx)` returns `{services:{capability:{method:async args=>JSON}},health,
dispose}`. Definition metadata and schemas are cloned; returned lists cannot
mutate active contracts. JSDoc and the bounded JSON-schema validator in
`contracts.mjs` define the contract. Schemas reject unknown object fields;
the JSON leaf type permits untrusted MCP payload data only after recursive
JSON/prototype/size validation. The native MCP service must also validate its
actual discovered tool schema and enforce governance before dispatch.

Consumer factories see only declared dependency versions and guarded
`ctx.dependencies[capability].invoke(method,args,operationId)` facades. These
facades re-enter admission/authorization with the same scope. Factories must not
invoke dependencies while constructing or disposing; those phases run inside
the lifecycle lock. Ordinary service methods may invoke dependencies. Arbitrary
unguarded dependency service handles are never exposed.

### Runtime authorization and execution

`plugins.invoke({operationId,projectId,sessionId?,agentId?,taskId?,capability,
method,arguments})` is an internal gate. It calls the injected
`authorize({context,selection,capability,method,arguments,operationId})` and
requires literal `true`. Missing or false authorization fails 403. The lead must
bind this to existing operation-specific policy, approval and workspace/target
boundaries. The backend rechecks scope/config/entity revisions after async
authorization and before the durable call reservation. Every dependency is
leased for the whole call, and stale instances are disposed in reverse order.

First calls return `{callId,status:'completed',result}`. A duplicate reservation
returns `{replayed:true,...originalCallEvent}` without running an effect. Output
is deliberately not stored for replay; use existing native result/artifact
records for content. A native exception, invalid output or response uncertainty
is `unknown`/`NATIVE_OUTCOME_UNCONFIRMED`; no automatic resubmission occurs.
`recover()` marks old `pending` reservations `unknown`, reports
`externalProcesses:'not_recovered'` and `effectsReplayed:0`; it never restores a
process or repeats a tool. `close()` returns `draining` with active count or
`disposed`; the lead must not close SQLite while active calls are finishing.

Existing execution entry points must use this gate (or perform the same registry
admission in their existing authoritative boundary). Merely mounting the six
management routes does not make existing provider/MCP/desktop calls registry
enforced. Existing native services still enforce their own approvals and state.

## Source reuse decision

Primary repository: https://github.com/deepseek-ai/deepseek-harness
All upstream paths below inspected at exact pin
`4b399c39a6d1479cd84ca591b4d7c88e24d38a96`; no upstream executable/code was vendored.
Raw pinned source and GitHub recursive tree were read directly. Root `LICENSE`
and `package.json`: MIT, `@deepseek-ai/dsh-root` `0.2.3-alpha.2`, Node
`^24.22.3 || >=26.13.1`. Local Node is **24.19.0**, outside that runtime range.
No global/root runtime upgrade, DSH dependency installation or monorepo build.

| Decision | Pinned source paths and component/version/license | Native integration target, compatibility risk, verification |
| --- | --- | --- |
| ADOPT (existing FORGE) | `app/server/store.mjs`, current worker base `43e71ef`; existing project authority, not upstream DSH code | Existing transactions/events/receipts only; SQLite restart and replay tests |
| REFERENCE | `vendor/cordis/src/{context,service,registry,fiber}.ts`, `vendor/cordis/README.md`, `vendor/cordis/{package.json,LICENSE}`; `@deepseek-ai/cordis` **4.2.0-alpha.1**, MIT, Shigma notice | Scoped service providers/consumers, explicit injection, lifetimes/reverse disposal → native registry. No Cordis loader/proxy/tree added. Native lifecycle tests cover local implementation, not Cordis itself |
| ADAPT (pattern only) | `packages/boot/app-boot/{README.md,package.json}`; `@deepseek-ai/dsh-app-boot` **0.2.3-alpha.2**, MIT | Composition compatibility checks become exact/caret service/host checks at the native boundary; DSH profile/runtime composition remains external. Dependency/version/cycle tests |
| REFERENCE | `apps/cli/src/plugin.ts`, `packages/boot/plugin-manager/{README.md,package.json}`; `@deepseek-ai/dsh-plugin-manager` **0.2.3-alpha.2**, MIT | Explicit config/enable/compatibility/lifecycle → native PluginManager. No package installs, YAML loaders, build-script grants or version exemptions. Browser and malformed-request tests |
| REFERENCE | `SAFETY.md`, `docs/subsystems/sandbox.md`, `packages/sandbox/sandbox-windows-acl/README.md`; repository MIT, no sandbox component reused | Treat plugin tree as composition, never a security boundary. Windows backend documents write restrictions with unconfined reads/network/process visibility and partial/hard-link/AppContainer limitations. Native registry grants no OS isolation; existing approved target/VM boundaries remain required |
| DEFER | Root `package.json`, optional SDK/ACP/runtime composition described by the owner addendum | Optional DSH execution is outside this worker and unqualified on current Node. Separate DSH_HOME/workspace/SDK and approval/cancellation qualification required before enabling. Never silently replace T3 |

Native implementation was chosen because FORGE already has a canonical store,
governance, adapters and T3 turn owner. The inspected Cordis fork uses workspace
dependencies (`@deepseek-ai/cosmokit`, optional loader/include peers), and the DSH
root is not runtime compatible with this machine. A second context/module loader
and persisted plugin profile would add authority/lifecycle surfaces without
providing missing native adapter qualifications. This work translates bounded
concepts into original FORGE code; it does not claim to adopt audited sandboxing
or execute upstream code. No upstream attribution notice is needed for copied
source because none was copied; exact component licenses remain recorded here.

## Developer verification

`node --test tests/plugins*.test.mjs`: **24 PASS, 0 fail, 0 skip** (22 registry
tests, 1 actual Chromium UI test, plus the fixture module reported by Node).
`node --check` passed for all three new production `.mjs` files.
`git diff --check` passed. Tests use real FORGE SQLite and a real loopback HTTP
server, with trusted engineering factories/native adapters. They do not simulate
LLM output as evidence of a live model run.

Covered: durable configure/resolve/restart/replay; operation-ID collision;
malformed/prototype/extra-field requests; foreign and contradictory identities;
all four scopes/inheritance/disabled capability; task/bot inference; dependency
ordering/cycle/missing/version/host checks; metadata immutability; authorization
separate from visibility; asynchronous config/task revision changes; active-call
drain and new-call blocking; duplicate effects; unknown results; startup recovery;
scope-bound resources; actual health vs missing adapters; sanitized native errors;
malformed factory cleanup/disposal failure; shutdown.

Browser: bundled the actual React PluginManager using existing installed Vite's
esbuild, mounted it against the real registry/SQLite HTTP fixture, then used
installed Playwright Chromium. Configuration, enable, health, receipt selection,
task disable, refresh/reload, 375 px layout (no horizontal overflow), accessible
labels, a genuine second-writer stale save and zero uncaught browser errors PASS.
No request interception/mocked success responses. The isolated browser test does
not qualify the shared Settings mount or the lead's adapters. Existing dependency
directory was linked into this worktree for testing; no dependency/lockfile edits.

## Remaining implementation seams versus external qualification

**Lead integration required:** mount the six routes under existing HTTP security;
mount PluginManager in project Settings; inject actual service adapters; call
recover before admissions; gate actual execution boundaries with existing exact
operation policy; attach selection receipt IDs/signatures to native run receipts;
assemble task-relevant skill instructions and permitted discovered MCP schemas
from existing adaptive/governance services. Registry service methods are not an
automatically approved list of model tools. These shared-path seams are genuine
remaining implementation work, not missing-credential excuses.

**External/live qualification NOT_RUN:** provider/model turns, external MCP
accounts, guest desktops, cloud/compute, optional DSH runtime/SDK, DSH native
sandbox execution and owner home UAT. Native provider authentication/context is
preserved by delegation to existing service adapters; no credentials were read,
copied, migrated or included in plugin snapshots. **HOME_UAT_NOT_RUN**.

Next executable lead action: cherry-pick this scoped worker commit, wire the
documented factory/routes/Settings, and run the combined shared-path HTTP/UI and
execution-gate regression tests. Only then mark integrated DH-01/DH-02 coverage.
