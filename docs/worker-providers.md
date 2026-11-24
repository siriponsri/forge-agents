# Provider / conversation worker handoff — 2026-11-24

Worker branch `t3/provider-conversation-setup`, integration base `16ae6c9`.
Exact inherited development model: **gpt-6.1-sol**, reasoning **xhigh**, Codex
provider in T3 Code. No model switch or child delegation was performed.
Owned paths only: `app/providers/**`, `tests/providers*.test.mjs`, this note.
No main, push, PR, public service, paid provisioning or prototype work.

## Implementation and ownership

`createProviderService({dataDir,store,t3,clock?,catalogTimeoutMs?,authorizeTool?})`
is exported by `app/providers/service.mjs`. No store migration or new root
dependency is needed. Existing `connections`, `conversations`, `runs`, `bots`,
`receipts` and `events` remain the authoritative state. Machine configuration
files are created below `dataDir/providers/<FORGE instance>/`; credentials are
not copied from the development T3 installation. Setup and account sign-in use
the separate FORGE-owned T3 server. Native executables may be selected without
modifying the installed development application.

The service provides configuration, dependency/auth checks, executable T3
install/sign-in/cancel/status actions, catalog refresh/selection and a scoped
conversation service. Every chat turn is a T3 MCP launch/send. It records actual
T3 project/thread/provider run under FORGE project/bot/conversation/run/attempt/
operation IDs. Supervised runtime mode is fixed on launch and checked before
continuation. Chat advice does not set task plan approval or approve tools.

Private chat requires its named bot; team chat targets an explicit bot, with
separate bindings per bot. Fresh bindings receive only that conversation's
visible history. Temporary helpers retain their task identity and may retire
through reviewed handoff. Handoff from one private bot to another creates a new
private conversation containing only the owner-reviewed summary. Active or
uncertain project runs prevent handoff/new turns. Execution task starts must
also respect these conversation runs in the lead's shared busy policy.

No assistant output is synthesized. Native T3 messages are projected by item ID
with actual run attribution. MCP text-only reconciliation is available when
the native observer is absent, explicitly labelled `MCP-text-only`; it does not
invent structured tool results. Unknown launch/send reconciliation searches the
owned project and verifies original run/attempt/operation markers. It never
resubmits a prompt. Stops delegate to native `t3.stop`, retaining its uncertain
stop reservation. Restart recovery marks unfinished observations unknown.

Catalogs retain the last successful list during slow/error refresh, publish
late results only for the same provider/account generation, deduplicate probes,
and expose the source and observation time separately from upstream cache age
(unknown). Exact instance/model/option-value validation is mandatory. Desired
selection is catalog-verified only; it does not claim request success or model
access. There is no fabricated GPT-6.2 entry or fallback model switch.

## Lead hook agreement and GUI task

The lead owns all changes to main/T3/domain/store/web/contracts. Hook messages
were sent early and acknowledged. Required T3 service surface:

```js
t3.providers = {
  call(name, input), // only six named MCP methods below
  ensureProject(projectId), // FORGE project -> actual owned T3 project {id}
  rpc(tag, payload), // short-lived provider-management Effect RPC channel
};
// Existing native observer/control owner:
t3.observe(runId); t3.reconcile(runId); t3.stop(runId);
```

MCP allowlist: `orchestrator_capabilities`, `t3_thread_launch`, `t3_thread_send`,
`t3_thread_read`, `t3_thread_interrupt`, `t3_thread_list`. The existing public
`t3.catalog()` supplies capabilities. `providers.cli` is unnecessary for this
implementation: pinned T3 has no provider setup CLI commands.

`openT3ProviderChannel({url,ticket})` in `t3-setup-rpc.mjs` implements pinned
Effect RPC frames. Lead issues/revokes the isolated session, with
`providers:manage` and `orchestration:read` (there is no `settings:read` scope).
The channel exposes `request(tag,payload)` and `close()`; subscriptions return
their first authoritative snapshot, acknowledge and interrupt that subscription.
It allows only `server.getConfig`, `server.refreshProviders`,
`server.updateSettings` with an empty patch and single provider mutation,
`provider.install.start/cancel/subscribe`, and
`provider.auth.start/respond/complete/cancel/subscribe`. Respond accepts only
browser consent. Credential transfer/import/logout and arbitrary dispatch are
absent. Raw settings/RPC errors are not returned by the service.

Next executable lead GUI task: mount these methods, wire the Settings wizard
and replace local-only chat submission. **Do not call domain `message.send`
before `conversations.send`: the service inserts the user message itself.**

| Method | Input / behavior |
|---|---|
| `routes()`, `health()` | Implemented route or explicit contract blocker; live state remains NOT_RUN |
| `configure` | `{operationId,projectId,routeId,name?,executable?,args?,envRefs?,apiKeyEnv?,baseURL?,apiFamily?,models?}`; returns connection |
| `check`, `refresh`, `catalog` | `{projectId,connectionId}`; dependency/auth vs model inventory kept separate |
| `select` | `{operationId,projectId,connectionId,expectedRevision:project.revision,selection:{instanceId,model,options:[{id,value}]}}`; saves `profile.provider` with connection/generation/catalog metadata |
| `setup` | `{projectId,connectionId,operationId,action,...}`; actions `install`, `install-status`, `install-cancel` (`installOperationId`), `signin` (`methodId?`), `signin-status`, `signin-cancel` (`flowId`), `consent` (`flowId,interactionId,decision`), `callback` (`flowId,callbackUrl`); status reads need no operation ID |
| `conversations.send` | `{operationId,projectId,conversationId,botId?,text,selection?}`; returns run, team requires target bot |
| `conversations.reconcile/stop` | `{projectId,runId,conversationId?}` |
| `conversations.handoff` | `{operationId,projectId,conversationId,fromBotId,toBotId?,summary,retireHelper?}`; returns target conversation |
| `conversations.recover` | Explicit restart recovery; no automatic turn replay |
| `conversations.projectRun(runId)` | Idempotent observed assistant projection; invoke after native run-message changes |
| `close()` | Settles catalog and in-flight chat calls, closes SDK transports |

Lead native AG-UI handling must support `kind:'conversation'` without `taskId`,
keep operation ID in event identity, and call `projectRun` on observed message
changes. Task-side code must avoid treating a conversation completion as task
approval or task completion. Existing task protocol handling assumes task IDs
in this worker's base and is intentionally not edited here.

Setup URLs/device codes/callbacks are transient response data. Render them only
in the active wizard; do not persist/log them. Browser/device code sign-in can
be completed here. Terminal/credential forms return `requiresNativeUi:true`;
lead should open the separate FORGE T3 Settings surface for those flows. Values
are not accepted into persistent provider configuration. Environment names are
references; secret values are never read back or logged by these modules.
DPAPI resolution has no implemented bridge in the assigned contract and is not
advertised as working. New user sign-in may populate the agent's own fresh
account store; it does not migrate an owner's existing credentials.

## Named provider disposition

| Provider | Concrete route / limitation |
|---|---|
| Codex | Native `codex` driver, distinct managed ChatGPT / fresh local-login routes, fresh `homePath`, actual T3 install/auth/check/catalog |
| Claude | Native `claudeAgent`, fresh `homePath`; subscription/API eligibility stays provider-specific |
| OpenCode | Native `opencode`; isolated home/XDG dirs; T3 owns both v1/v2 session adapters |
| Gemini | Local installed `gemini --acp` through `acpRegistry`; API route below. Consumer Antigravity eligibility is distinct and not inferred |
| Grok | Local `grok agent stdio` ACP; xAI Responses API config below; no deprecated Anthropic fallback |
| Kimi | Current `kimi acp` contract, not archived Python Kimi CLI; Moonshot chat API config below |
| Qwen | Local `qwen --acp`; API requires explicit region/workspace base (no language-based region guessing) |
| DeepSeek | `dsh --profile acp`; API chat config below; preview lifecycle limits remain qualification requirements |
| OpenRouter | OpenCode **2.x** native `@opencode/ai/providers/openrouter`, API env reference, actual T3 catalog; its MCP is a separate tool connection |
| MaxPlus | OpenCode **2.x** config requiring explicit pool-specific base/protocol/model IDs, env inference key reference; no management key required, no claim every pool supports Responses/tools |
| Custom | Installed ACP executable + literal argv, or OpenCode **2.x** explicit chat/Responses/Anthropic-compatible package + base + upstream model IDs; T3 must subsequently advertise selected models/options |
| KOB | `UNSUPPORTED_ROUTE`: endpoint discovery/client-source disagreement, unqualified CLI session contract and license conflict. No KOB source was copied or installed |

API configuration compilation writes real OpenCode 2.x `providers` entries into
app-owned global/XDG `opencode.json`. It uses native OpenRouter or an explicitly
chosen compatible package. T3's observed runtime version must be 2.x before API
selection; v1 config is a different contract. User-supplied custom model names
become configured candidates, then require actual T3 catalog observation and
validated option values. Compiling configuration is not a live inference test.
Project/system OpenCode policy/config precedence still applies; this does not
claim an account sandbox supplied by ACP. Account-store isolation and child
process cleanup need per-agent qualification.

## MCP SDK adapter

`createMcpService({store,authorizeTool?,timeoutMs?,machineEnv?})` is exported by
`mcp.mjs` and exposed as `providerService.mcp`. Existing
`@modelcontextprotocol/sdk@1.32.2` supplies stdio and Streamable HTTP transports,
actual init, paged tool discovery, list-change notifications, schema validation,
structured calls and protocol cancellation. Secret references are named machine
environment variables (HTTP bearer or named stdio environment), never raw keys.

Methods: `configure({operationId,projectId,name?,route:'stdio'|'http',command?,args?,url?,envRefs?,authEnv?})`,
`enable({projectId,connectionId,enabled})`, `discover({projectId,connectionId})`,
`call({operationId,projectId,connectionId,name,arguments})`,
`stop({projectId,connectionId,callId})`, `recover()`, `close()`.
All lookups and effects enforce project scope. Refresh errors do not become
fake tool lists; changed/disabled connections invalidate discovery and close
transports. Calls persist idempotent effect reservations. Disconnect/cancel
after dispatch is `unknown`, not proof that a remote effect was rolled back.
Recovery never replays calls. Tool list annotations are retained as metadata,
not treated as authorization.

Execution requires a **server-side `authorizeTool` callback from the existing
supervised tool policy**. Default is `SUPERVISED_POLICY_REQUIRED`, without
dispatch. A client boolean cannot grant execution. Lead must route the bounded
GUI tool tester through that boundary before claiming full A08 execution.
OAuth MCP account binding is not implemented by this adapter; in particular,
the OpenRouter OAuth MCP cannot be called authenticated merely by entering its
URL. Its catalog/docs/account tools and billable write/inference tools remain
distinct. Remote/native external live checks remain NOT_RUN.

## Verification and remaining scope

Commands run on Node **24.19.0**:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
node --test tests/providers*.test.mjs
node --check app/providers/service.mjs
node --check app/providers/conversations.mjs
node --check app/providers/mcp.mjs
git diff --check
```

Eleven focused tests pass: labelled pinned T3 setup/thread schemas and Effect
RPC frames; actual SDK stdio server init, two-page discovery, input schema
validation, listChanged invalidation and cancellation; two-project/private/team
isolation; duplicate concurrent sends and operation reuse; no invented output;
slow/failing/stale-generation catalogs and exact model-option validation;
unknown launch/send recovery without dispatch; native observation-hook use,
stop uncertainty, private summary handoff and helper retirement.

Implementation gaps requiring lead integration or further implementation:
GUI/endpoints and native task-free conversation projection are lead-owned;
full terminal/credential sign-in uses native T3 surface; MCP OAuth and supervised
policy wiring; DPAPI bridge; KOB contract/license qualification. API/harness
fixtures do not prove a live external service. No upstream runtime fix or model
picker repair was applied to the installed development T3.

External account/model request checks: **NOT_RUN** for all named routes.
Installed local ACP CLI/account qualification: **NOT_RUN**.
Integrated GUI verification: **NOT_RUN by this worker**, next lead task above.
Home flows: **HOME_UAT_NOT_RUN**. These pending live checks are separate from the
implementation gaps just listed. The worker does not mark A04/A07/A08/A29 or
the entire product complete.

## Inspected source and reuse

No upstream provider runtime was copied. T3 remains the execution/session owner;
the FORGE modules adapt its pinned contracts. No OpenBot code was copied: only
the required durable bot/scoped-conversation behavior was independently written.
No extra planner or direct provider SDK inference loop was introduced.

Primary references inspected 2026-11-24:

- [Pinned T3 contracts](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/orchestratorMcp.ts), [setup](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/providerSetup.ts), [RPC](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/rpc.ts), [provider config](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/providerInstance.ts), [settings](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/settings.ts). MIT baseline already pinned by lead.
- [Pinned T3 ACP](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/docs/user/providers-acp.md), [Codex](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/docs/user/providers-codex.md), and `packages/provider-opencode/src/{settings.ts,server/driver.ts}` plus ACP registry settings/driver. These establish setup fields, separate native runtime generations and the limits of generic ACP promises.
- [OpenCode providers](https://opencode.ai/docs/providers/), [configuration](https://opencode.ai/docs/config/), [models](https://opencode.ai/docs/models/): compiler uses their actual v2 schema; package/API/model support remains route-specific. Model discovery is delegated to T3.
- [Google OpenAI interface](https://ai.google.dev/gemini-api/docs/openai), [xAI Responses](https://docs.x.ai/developers/rest-api-reference/inference/responses), [Kimi compatibility](https://platform.kimi.ai/docs/guide/migrating-from-openai-to-kimi), [Qwen region/workspace endpoints](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope), [DeepSeek](https://api-docs.deepseek.com/), [MaxPlus API](https://maxplus-ai.cc/docs/api). Endpoint differences are preserved in setup; compatibility does not prove all coding capabilities.
- Existing owner provider/MCP research and T3 model-discovery research under the v3 handoff were read. KOB remains a documented implementation blocker, not a verified compatible service.
- Actual installed SDK client/transport/validator sources at root's pinned dependency were inspected and exercised; no new dependency or lockfile change.
