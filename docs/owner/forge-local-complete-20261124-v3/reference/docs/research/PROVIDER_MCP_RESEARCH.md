# Provider, harness and MCP integration research for FORGE

Research date: **2026-11-24**. Scope: the owner's initial ChatGPT, Claude, Gemini and OpenRouter choices; future Grok, OpenCode, Kimi, Qwen and DeepSeek; and the named MaxPlus and KOB services.

This is a requirements and reuse assessment. Public first-party documentation, publisher listings and source files were read. No software was installed, credentials entered, authenticated API requests made, models invoked, or integration tests run. “Documented” below means an upstream describes the capability; it does not mean FORGE has implemented or qualified it.

## Recommended direction

Keep the T3-based FORGE experience, and represent three separate things behind its connection wizard:

1. **A coding harness** owns a working session, tools, approvals and execution. Prefer an existing native adapter or ACP integration.
2. **A model provider** supplies inference, credentials, model IDs, limits and billing. A compatible API endpoint can sit behind a harness that supports it.
3. **A tool connector** exposes an application or service through MCP or a purpose-built adapter. It extends the harness; it does not automatically supply an interchangeable coding session.

This is a proposed FORGE design. It follows the distinct responsibilities described by [MCP's architecture][mcp-architecture] and [ACP's protocol][acp-overview]. An MCP wrapper around a CLI or API is feasible, but the wrapper still has to define permissions, job state, cancellation, output and billing behavior. Protocol packaging does not create those behaviors by itself.

### Findings that change the initial assumptions

- OpenRouter has an **official remote MCP server**, in addition to its inference API. It is useful for model discovery and account information; inference and other write tools require separate treatment. [Official MCP documentation][openrouter-mcp]
- Google's consumer route has changed. The dated Google announcement moves free individual and Google AI Pro/Ultra access from Gemini CLI to **Antigravity CLI** from June 18, 2026. Enterprise Code Assist and paid API-key routes remain available through Gemini CLI. [Google transition announcement][google-transition]
- Grok has an official **Grok Build coding harness** with ACP and MCP, as well as the xAI model API. [Grok Build overview][grok-overview]
- The current Kimi harness is **MoonshotAI/kimi-code**. The older Python `kimi-cli` repository is archived. [Current repository][kimi-repo] · [Legacy notice][kimi-legacy]
- KOB's products must be distinguished: its **VS Code extension documents MCP support**, while an MCP/ACP interface for the inspected **KOB CLI** remains unverified. Its CLI also has a material license mismatch. [Publisher listing][kob-extension] · [CLI README][kob-readme] · [Actual LICENSE][kob-license]

## 1. What each connection means

| Connection | What FORGE receives | What it does not establish |
|---|---|---|
| Native coding harness / ACP | Session and turn lifecycle, progress events, permission requests and the harness's supported file/terminal functions | A shared API credit balance, arbitrary model compatibility, or desktop control |
| Model inference API | Responses from a chosen model, streaming and supported inference features | A coding loop, project isolation, approval UI, durable bot identity or job recovery |
| MCP client → tool server | Discovered tools/resources and structured calls to a connected service | A universal model-provider protocol or a complete coding-session protocol |
| CLI wrapped as an MCP tool | A defined operation exposed to another agent | Safe execution, reliable interruption or resumability unless the wrapper implements and verifies them |

ACP explicitly describes session creation/loading and prompt lifecycle. MCP focuses on context exchange rather than prescribing how an application manages its LLM. These protocols can be used together. [ACP][acp-overview] · [MCP][mcp-architecture]

Do not infer “can connect to an MCP server” from “can be exposed as an MCP server,” or vice versa. For example, `claude mcp serve` exposes Claude Code's **tools**; Anthropic states that the connecting client is responsible for individual tool confirmation. That command is not a general Claude model API. [Claude Code MCP guide][claude-mcp]

## 2. Native harness and subscription routes

| Owner/product | Account route and session integration | Verified MCP relationship | Source/reuse status |
|---|---|---|---|
| **OpenAI — Codex** | Native ChatGPT sign-in or API-key sign-in. Prefer the existing T3 native integration where qualified; Codex App Server is a documented session interface. A maintained ACP adapter also exists. | Native MCP client for stdio and Streamable HTTP. | Codex: Apache-2.0. Maintained `agentclientprotocol/codex-acp`: Apache-2.0; it wraps App Server. [Auth][codex-auth] · [App Server][codex-app-server] · [MCP][codex-mcp] · [Source][codex-repo] · [ACP][codex-acp] |
| **Anthropic — Claude Code** | Native Claude account or Console/API/cloud-provider route. Native session integration or the maintained Claude Agent ACP adapter are candidates. | Native MCP client; also a tool-server mode, `claude mcp serve`. | Claude Code is subject to Anthropic terms, not an OSS component to copy. The separate ACP adapter is Apache-2.0; that does not change Claude's underlying terms. [Auth][claude-auth] · [MCP][claude-mcp] · [CLI license][claude-license] · [ACP adapter][claude-acp] |
| **Google — Antigravity CLI** | Current consumer Google-account route; native `agy acp` over stdio. Account entitlements remain the provider's responsibility. | Local stdio and remote Streamable HTTP MCP; legacy HTTP+SSE is not supported by its CLI documentation. | Treat as an external installed product; no source redistribution license was established in this review. [Transition][google-transition] · [ACP][antigravity-acp] · [MCP][antigravity-mcp] |
| **Google — Gemini CLI** | Enterprise Code Assist or paid API-key route after the consumer transition. Native `gemini --acp`. | Native MCP client; the ACP guide describes attaching client-provided MCP tools. | Apache-2.0. Older authentication documentation still mentions consumer subscriptions, so use the dated transition notice and account-specific eligibility. [Current README][gemini-repo] · [ACP][gemini-acp] · [Transition][google-transition] |
| **Anomaly — OpenCode** | Multi-provider harness, including OpenRouter and configurable endpoints. Native `opencode acp`; it is a harness, not one model family. | Native MCP client for local and remote connectors. | MIT repository. Reuse candidate for model APIs lacking a dedicated preferred harness. [Providers][opencode-providers] · [ACP][opencode-acp] · [MCP][opencode-mcp] · [Source][opencode-repo] |
| **xAI — Grok Build** | Browser sign-in, device authentication or API key. Native `grok agent stdio` ACP and headless structured output. | Native MCP client. Separately, the xAI inference service can invoke remote MCP tools. | First-party harness code: Apache-2.0, with separate third-party notices. [Overview][grok-overview] · [ACP/headless][grok-headless] · [MCP client][grok-mcp] · [API remote MCP][xai-remote-mcp] · [Source][grok-repo] |
| **MoonshotAI — Kimi Code CLI** | Native login or provider credentials. `kimi acp` is documented. | MCP client supporting stdio, HTTP and legacy SSE. | Current `kimi-code`: MIT. Do not select archived Python `kimi-cli` for new work merely because an older guide links it. [Current source][kimi-repo] · [MCP][kimi-mcp] · [Provider configuration][kimi-providers] · [Legacy notice][kimi-legacy] |
| **QwenLM — Qwen Code** | Qwen-account subscription, QwenCloud/Model Studio or third-party API routes. Native `qwen --acp`. | Native MCP client. | Apache-2.0. Account, region and plan selection matter; language must not silently determine region. [Auth][qwen-auth] · [ACP][qwen-acp] · [MCP][qwen-mcp] · [Source][qwen-repo] |
| **DeepSeek — DeepSeek Harness** | Official developer-preview harness in addition to the model API. Native `dsh --profile acp` exposes persistent ACP sessions. | Its documented MCP client supports stdio and Streamable HTTP; ACP sessions can attach MCP servers. | MIT; upstream warns of compatibility-breaking changes. ACP supports list/resume/close/cancel, but documents no transcript replay, forks or additional directories. [README][deepseek-harness] · [ACP contract][deepseek-acp] · [MCP guide][deepseek-mcp] |
| **KOB — KOB CLI** | Local agentic CLI with KOB/custom endpoint configuration and one-shot `ask`. | CLI MCP/ACP interface **not established** by the README, package manifest and API client reviewed. | License conflict; see section 5. Keep separate from the MCP-capable VS Code extension. [CLI][kob-readme] · [Code][kob-api-source] · [LICENSE][kob-license] |

All rows are **documented, not integration-tested here**. An available ACP process is a reuse opportunity; the selected T3 build still needs to map its capabilities and permission events correctly. A model that can use tools does not by itself operate Windows applications—desktop tools and desktop ownership remain a separate connection.

### Current T3 reuse boundary

T3's current ACP guide describes built-in providers including Grok and Antigravity, plus generic Registry and local ACP commands. It prefers ACP v2 preview where supported and negotiates v1 for others; it explicitly gives `dsh --profile acp` as the DeepSeek Harness example. This supports reusing T3's integration surface before writing another wrapper. [T3 ACP guide][t3-acp]

The same guide limits the promise: agents run under their own sandbox/approval rules; T3 does not run or stop most agents' terminals. ACP does not supply portable native subagent lineage or account isolation. File rollback starts a fresh ACP conversation with retained history rather than rewinding the agent's own conversation. Therefore FORGE must qualify interruption, takeover, account separation and delegation for each actual adapter/version. A protocol connection alone is insufficient. [T3 ACP guide][t3-acp]

### Subscription boundary

Show “Sign in to the coding agent” and “Connect a model API key” as distinct choices. Codex documents subscription access and usage-based API access separately; Claude Code also offers distinct account/API paths. A web subscription must not be assumed to be a general API credit balance. Do not extract web cookies or copy native credential stores into FORGE to simulate another access method. [Codex authentication][codex-auth] · [Claude authentication][claude-auth]

For Google, use a consumer-aware Antigravity option and an API/enterprise option rather than promising all existing Gemini accounts will work through the same legacy CLI login. The current migration is an actual provider change, not a user configuration preference. [Google announcement][google-transition]

## 3. Model API routes

The table lists interfaces explicitly supported in the material reviewed. It is not a claim that every model at an endpoint supports tools, vision, structured output or every SDK option.

| Service | Kind | Documented interface / base | FORGE treatment |
|---|---|---|---|
| OpenAI | First-party model provider | Use OpenAI's API route with an API key; keep it distinct from native Codex subscription access. [Auth][codex-auth] | Named provider preset and native Codex option. |
| Anthropic | First-party model provider | Anthropic API/Console authentication is separate from native Claude subscription login. [Auth][claude-auth] | Named provider preset; choose an applicable Claude/native harness route. |
| Gemini API | First-party model provider | Google's own OpenAI-compatibility notebook uses `https://generativelanguage.googleapis.com/v1beta/openai/` and Chat Completions. [Google cookbook][gemini-openai-cookbook] | Separate Gemini API connection; do not infer Responses API parity. |
| OpenRouter | Aggregator | `https://openrouter.ai/api/v1`; current quickstart explicitly uses `/responses`. It documents OpenAI SDK compatibility. [Quickstart][openrouter-quickstart] | Prefer a harness's native OpenRouter provider package. Treat its MCP connection separately. |
| xAI/Grok | First-party model provider | `https://api.x.ai`; inference reference includes Responses and Chat Completions. Anthropic-compatible legacy endpoints are explicitly deprecated. [API reference][xai-api] · [Deprecation][xai-legacy] | OpenAI/Responses-oriented preset; do not build a new Anthropic-compatibility dependency. |
| Moonshot/Kimi | First-party model provider and managed coding service | Current Kimi provider documentation gives `https://api.moonshot.ai/v1`; native managed-service login configures its own endpoint and credentials. [Provider guide][kimi-providers] | Separate direct API and managed harness choices. |
| Qwen/Alibaba Cloud | First-party model provider | OpenAI-compatible `/compatible-mode/v1/chat/completions`; current docs use workspace- and region-specific domains. Keys are region-bound. [Model Studio compatibility][qwen-api] | Region/workspace-aware preset; avoid one hardcoded global endpoint. |
| DeepSeek | First-party model provider | OpenAI base `https://api.deepseek.com`; example route `/chat/completions`. Anthropic base `https://api.deepseek.com/anthropic`. [API docs][deepseek-api] | Supported API preset behind a compatible harness; DeepSeek Harness is an independent preview choice. |
| MaxPlus | Third-party multi-provider service | Multiple protocol/pool combinations, detailed below. | Explicit custom-provider preset with a selected pool/protocol. |
| KOB | Third-party multi-provider service | Its CLI uses an OpenAI-style SSE payload at a KOB-specific path, detailed below. | Custom endpoint/path adapter; do not infer every OpenAI feature from the marketing label. |

OpenCode documents a native OpenRouter runtime/catalog and custom-provider configuration. Its current guide recommends retaining that native package for OpenRouter routing behavior. This makes it a concrete reuse candidate, while keeping custom gateways as separate providers with their own model inventories. [OpenCode providers][opencode-providers]

## 4. MaxPlus: concrete compatibility and limits of evidence

MaxPlus's reference identifies its production base as `https://api.maxplus-ai.cc`. Inference authentication accepts `Authorization: Bearer <ccsk-key>` or `x-api-key`. Key-management uses a different `ccmk-` token; ordinary inference integration should not require that management credential. [API reference][maxplus-api]

| Documented route | Meaning |
|---|---|
| `POST /v1/messages` | Anthropic-compatible inference in supporting pools |
| `POST /v1/chat/completions` | OpenAI-compatible chat in supporting pools |
| `POST /v1/responses` | Responses-compatible route in supporting pools |
| `GET /v1/models` | Key/pool-scoped model catalog |
| `GET /v1/me`, `GET /v1/usage` | Account/credit and usage information |

Pool prefixes alter availability. The reference excludes Responses for MiniMax and Claude Vertex; Gemini pools additionally document native `generateContent` routes. Some Responses routes are bridges rather than native upstream Responses. No official MCP or ACP endpoint was located in the inspected reference/site search. The rendered reference also displayed a temporary no-open-pools notice; that is not an authenticated service health check. [Same reference][maxplus-api]

**Proposed integration:** a provider preset first. An optional FORGE MCP wrapper could expose tightly scoped model-list/usage operations or an explicitly billable inference tool. That wrapper would be FORGE's component, not an upstream MaxPlus MCP implementation. Native tool-call reliability, structured-output parity, cancellation and per-model capabilities remain untested.

## 5. KOB: separate the API, CLI, extension and planned proxy

### KOB CLI source contract

The site's linked repository is `thekaroe-thailand/kobcli`; its package manifest reports `2.0.52`, while the landing page advertises `1.0.3`. Use a pinned release/source contract when implementing an adapter, not the landing-page version label. [Package manifest][kob-package] · [Landing page][kob-site]

The current `src/core/api.ts` establishes these behaviors:

| Condition | Client behavior |
|---|---|
| KOB host | `POST /api/v2/chat/completions` |
| Base ends in `/v1` | Append `/chat/completions` |
| Base already ends in `/chat/completions` | Use the full endpoint |
| Other base | Append `/v1/chat/completions` |
| Explicit override | `KOB_API_CHAT_PATH` determines the path |
| Model discovery | Try `GET /v1/models`, `POST /api/models`, then `GET /api/v2/models`; an override uses `KOB_API_MODELS_PATH` |
| Authentication/output | Bearer authorization; JSON request with `stream: true`; SSE `data:` chunks |

[Source file][kob-api-source]

The README instead lists `POST /api/ai/models` as primary discovery. That does not match the inspected client source. Its conversation Markdown/JSON export is an unchecked roadmap item. MCP/ACP and reliable machine-readable agent-event output remain unverified for this CLI. [README][kob-readme]

### KOB VS Code extension

The publisher listing for `thekaroe.kob-ai` documents an MCP client, a connection UI, local command-based servers, a Chrome DevTools MCP example and per-server tool controls. It also describes API keys in VS Code SecretStorage and OpenAI-compatible/Ollama servers. These are **extension capabilities**, not proof of a corresponding KOB CLI MCP interface or a KOB-hosted MCP server. [Publisher's listing][kob-extension]

### Kob Proxy

The proxy page labels its compatibility, cache and cost-guard features **Coming Soon**. Do not use that page as evidence that those proxy features are deployed. [Kob Proxy page][kob-proxy]

### License conflict affecting code reuse

The README and `package.json` identify MIT. The actual `LICENSE` file instead names a non-commercial license and prohibits commercial use without the copyright holder's written permission. This is an unresolved upstream conflict, not a cleared MIT dependency. [Manifest][kob-package] · [LICENSE][kob-license]

**Recommendation:** do not vendor or bundle KOB CLI code into a potentially commercial FORGE release until the owner clarifies the applicable license. A clean FORGE adapter to a documented external API is a different integration decision, still subject to the service's terms. This finding does not establish the license of KOB's separate VS Code extension.

## 6. OpenRouter's official MCP: reuse it for the right job

The documented endpoint is `https://mcp.openrouter.ai/mcp`, operated by OpenRouter. It uses OAuth and creates a dedicated, expiring, capped key. The current tool set covers models, endpoints, benchmarks, rankings, credits and docs. `send-message` and `generate-image` perform billable inference; `send-feedback` writes feedback. Therefore “all MCP tools are read-only” would be incorrect. [Official MCP guide][openrouter-mcp]

OpenRouter's announcement explicitly distinguishes this developer-assistance MCP from the API used by applications. [Official announcement][openrouter-mcp-announcement]

**Proposed reuse:** enable approved catalog/credit/docs tools for the FORGE planner and provider wizard, with billable or write tools classified separately. Continue normal agent inference through the chosen harness's OpenRouter provider. Do not silently route every bot turn through the MCP's test-message tool or make the short-lived MCP key FORGE's only model credential.

## 7. Reuse versus wrapper proposal

| Need | Reuse first | What FORGE still owns |
|---|---|---|
| Codex coding sessions | Existing qualified T3 native integration / Codex App Server; maintained ACP adapter if useful | Bot identity, task scope, event normalization, permission presentation and delivery |
| Claude coding sessions | Native integration or maintained Claude Agent ACP adapter | Authentication-mode clarity and the same session/permission contract |
| Google consumer coding | Antigravity ACP | Eligibility-aware setup and compatibility qualification |
| OpenRouter and diverse model APIs | OpenCode's existing provider support, where compatible | Connection wizard, secret references, account/model selection and capability evidence |
| Grok/Kimi/Qwen/DeepSeek sessions | Existing T3 providers where present, otherwise their documented ACP modes | Version-specific qualification, lifecycle and tool/approval UI |
| OpenRouter discovery/account tools | Official hosted MCP | Tool allowlist, permission/billing labels and connector lifecycle |
| MaxPlus inference | Custom model-provider preset | Pool/protocol selection and feature qualification; optional explicit MCP tool wrapper |
| KOB inference | Independently implemented endpoint adapter after contract confirmation | Path/auth normalization and tool-call qualification |
| KOB CLI delegation | Only after license/interface clarification | Structured job adapter; do not drive an interactive TUI by scraping terminal text as a production protocol |
| A custom application with no MCP | Narrow MCP wrapper over its documented API/CLI | Typed operations, cancellation, permissions, idempotency and evidence |

The table is a design recommendation, not a claim that these combinations already run in FORGE. Reuse a native protocol when it preserves the required behavior. Use MCP for a delegated operation when its inputs, outputs and lifecycle can be made explicit. For a long-running wrapper, expose or implement job identity, status, progress, cancellation and result retrieval rather than one opaque call that cannot be supervised.

## 8. Proposed registry and no-code setup

### Internal registry

The user should not maintain JSON/TOML files. FORGE should internally store:

| Record | Essential fields |
|---|---|
| Provider | Owner, service URL, protocol family, exact endpoint paths, authentication kind, secret reference, region/workspace/pool, model discovery method, billing source |
| Harness | Owner, source/license, executable/package and pinned version, native/ACP transport, supported authentication routes, supported providers |
| Tool connector | Owner, official/community/custom classification, MCP transport/version, executable or URL, authentication, tool scope, side-effect/billing classification |
| Capability evidence | Feature, `documented` / `qualified` / `unsupported` / `unknown`, source URL, checked date, tested version and limitations |
| Bot assignment | Stable bot identity and instructions, selected harness/provider/model, permitted tools, current task/session IDs and budget/time limits |

Capabilities should include prompt streaming, tool calls, images, structured output, permission events, session resume, cancellation, subprocess cleanup, MCP transports, OAuth/elicitation, tool-list refresh, artifact delivery and usage reporting. Keep these independent: support for a protocol label must not imply every optional capability.

A dynamic tool list should be refreshed according to the negotiated MCP version and the harness's behavior; otherwise explicitly restart/reconnect the affected session. Version-specific behavior belongs in the adapter, with an honest connection status in the UI. Unknown usage stays unknown, not zero.

### Wizard visible to the owner

1. **Choose a familiar service:** ChatGPT, Claude, Google/Gemini, OpenRouter, or “Add another.”
2. **Choose the account route when needed:** “Use my coding-agent account” or “Use an API key.” Presets explain the billing account in ordinary language.
3. **Connect:** launch the provider's own login flow, or accept a masked API key into the local credential store. For a custom service, ask for its URL; expose protocol/path overrides only when the preset cannot determine them.
4. **Select a model from the account's available list:** preserve explicit model IDs and capabilities. Model discovery is not permission to perform a billable trial.
5. **Attach tools and scope:** show what the bot may read, change or control. Computer control is its own visible permission and one-desktop-owner rule.
6. **Assign to a bot and save:** show “ready,” “needs sign-in,” “limited features,” or “not yet qualified.” Offer a clearly labelled connection check; explain if a subsequent test call costs money.

These are proposed UX requirements. Model API credentials and MCP OAuth grants should have separate records even when they belong to the same brand. Revoking one must not silently break or broaden the other. Automatic harness selection should consider both availability and the capabilities required by the task; it should never hide a switch in billing account or permissions.

## 9. Qualification gates before a provider is advertised as ready

No further owner questions are needed to design these engineering checks:

- Validate the installed/pinned adapter version and its actual authentication method without exposing credentials.
- Confirm text, structured tool calls and images separately; do not infer them from an OpenAI-compatible label.
- Exercise permission denial, stop, restart, reconnect and resume; distinguish cancellation of the local request from cancellation of remote work.
- Ensure provider-native MCP calls still appear in FORGE's activity/approval view, including failures and background work.
- Verify that a changed model/provider does not silently reuse another service's credentials or route.
- Record real artifacts and test evidence; protocol success alone cannot mark the owner's goal complete.
- Verify Windows behavior for the actual installed versions and subprocess boundaries.

The research supplies the reuse candidates and the unknowns. Qualification must occur later against the selected T3 build and owner-authorized accounts.

## Primary sources

All links below were read or their owner-published source content was retrieved during this review. They are live upstream pages rather than frozen release guarantees.

[mcp-architecture]: https://modelcontextprotocol.io/docs/learn/architecture
[acp-overview]: https://agentclientprotocol.com/protocol/overview
[codex-auth]: https://developers.openai.com/codex/auth/
[codex-app-server]: https://developers.openai.com/codex/app-server/
[codex-mcp]: https://developers.openai.com/codex/mcp/
[codex-repo]: https://github.com/openai/codex
[codex-acp]: https://github.com/agentclientprotocol/codex-acp
[claude-auth]: https://code.claude.com/docs/en/authentication
[claude-mcp]: https://code.claude.com/docs/en/mcp
[claude-license]: https://github.com/anthropics/claude-code/blob/main/LICENSE.md
[claude-acp]: https://github.com/agentclientprotocol/claude-agent-acp
[google-transition]: https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/
[antigravity-acp]: https://antigravity.google/docs/cli/acp
[antigravity-mcp]: https://antigravity.google/docs/cli/mcp/
[gemini-repo]: https://github.com/google-gemini/gemini-cli
[gemini-acp]: https://geminicli.com/docs/cli/acp-mode/
[gemini-openai-cookbook]: https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Get_started_OpenAI_Compatibility.ipynb
[openrouter-quickstart]: https://openrouter.ai/docs/quickstart
[openrouter-mcp]: https://openrouter.ai/docs/guides/overview/mcp-server
[openrouter-mcp-announcement]: https://openrouter.ai/blog/announcements/openrouter-mcp-server/
[opencode-providers]: https://opencode.ai/docs/providers/
[opencode-acp]: https://opencode.ai/docs/cli/acp/
[opencode-mcp]: https://opencode.ai/docs/mcp-servers/
[opencode-repo]: https://github.com/anomalyco/opencode
[grok-overview]: https://docs.x.ai/build/overview
[grok-headless]: https://docs.x.ai/build/cli/headless-scripting
[grok-mcp]: https://docs.x.ai/build/features/mcp-servers
[grok-repo]: https://github.com/xai-org/grok-build
[xai-api]: https://docs.x.ai/developers/rest-api-reference/inference
[xai-legacy]: https://docs.x.ai/developers/rest-api-reference/inference/legacy
[xai-remote-mcp]: https://docs.x.ai/developers/tools/remote-mcp
[kimi-repo]: https://github.com/MoonshotAI/kimi-code
[kimi-legacy]: https://github.com/MoonshotAI/kimi-cli
[kimi-mcp]: https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/mcp.md
[kimi-providers]: https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/configuration/providers.md
[qwen-auth]: https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/
[qwen-acp]: https://qwenlm.github.io/qwen-code-docs/en/users/integration-zed/
[qwen-mcp]: https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/
[qwen-repo]: https://github.com/QwenLM/qwen-code
[qwen-api]: https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
[deepseek-api]: https://api-docs.deepseek.com/
[deepseek-harness]: https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md
[deepseek-acp]: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md
[deepseek-mcp]: https://deepseek-harness.github.io/deepseek-harness/en/guide/mcp-memory
[t3-acp]: https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-acp.md
[maxplus-api]: https://maxplus-ai.cc/docs/api
[kob-site]: https://www.kob-ai.dev/kob-cli
[kob-readme]: https://github.com/thekaroe-thailand/kobcli
[kob-package]: https://github.com/thekaroe-thailand/kobcli/blob/master/package.json
[kob-api-source]: https://github.com/thekaroe-thailand/kobcli/blob/master/src/core/api.ts
[kob-license]: https://github.com/thekaroe-thailand/kobcli/blob/master/LICENSE
[kob-extension]: https://marketplace.visualstudio.com/items?itemName=thekaroe.kob-ai
[kob-proxy]: https://www.kob-ai.dev/kob-proxy
