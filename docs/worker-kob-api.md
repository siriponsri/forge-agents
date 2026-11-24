# KOB API adapter handoff

Date: 2026-11-24, Asia/Bangkok. Worker branch: `t3/kob-api-adapter`.
Base: `7e9452e6c74246bfe1195f3e10c6a0a482f49936`.
Actual inherited model: `gpt-6.1-sol`, `reasoningEffort=xhigh`, from the T3 runtime information supplied to this worker. No model switch or additional agents.

Owner confirmed KOB **API-key** access. No owner credential was supplied or requested. No KOB CLI/extension was installed, imported, copied or executed. This adapter compiles OpenCode 2.x setup and explicitly discovers models; the existing OpenCode → T3 provider/thread path owns inference, tools, events and cancellation of turns. There is no second inference loop.

## Primary evidence

Inspected current `master`, resolved through GitHub's commit API to `452e16bcc62ef285dce78dfaf01faa7e0b484d7a` (commit timestamp `2026-06-13T09:17:35Z`), and fetched the following pinned files. Hashes cover fetched UTF-8 content; upstream source files are not vendored.

| File | SHA-256 |
|---|---|
| [src/core/api.ts](https://github.com/thekaroe-thailand/kobcli/blob/452e16bcc62ef285dce78dfaf01faa7e0b484d7a/src/core/api.ts) | `c52c8a4b4389ad884cebe27918feba64ea3a9bf38ab21542e384e2861e6154bc` |
| [src/core/config.ts](https://github.com/thekaroe-thailand/kobcli/blob/452e16bcc62ef285dce78dfaf01faa7e0b484d7a/src/core/config.ts) | `650ac8660fcd8f46b73fdbbc2c3fb8ead6e1bd3bfc61d967c2dae0cffa324fe2` |
| [README.md](https://github.com/thekaroe-thailand/kobcli/blob/452e16bcc62ef285dce78dfaf01faa7e0b484d7a/README.md) | `f7352eaa8427b794b16f4b19732ac2898eb5e6bf3a704654e832eee34372f43d` |
| [LICENSE](https://github.com/thekaroe-thailand/kobcli/blob/452e16bcc62ef285dce78dfaf01faa7e0b484d7a/LICENSE) | `fa37531ebc0fb2f6bfbffe487ab5f01785a052d313aa6ad67798eb31c2ebc29c` |
| [package.json](https://github.com/thekaroe-thailand/kobcli/blob/452e16bcc62ef285dce78dfaf01faa7e0b484d7a/package.json) | `8dcb813524d2e53cc3f7fb8cf239b90cf052f8f4772fc97df731805e1df6ea9a` |

The CLI LICENSE restricts commercial use; README/package metadata claim MIT. That conflict remains unresolved. FORGE uses an independent API implementation without that dependency. Service access terms and account eligibility remain external qualifications, not commercial clearance inferred from README metadata.

Wire facts from `api.ts` lines 48–72, 95–115, 165–215 and `config.ts` lines 18–21, 53–61:

| Operation | Method/path and wire fields |
|---|---|
| Chat evidence only; delegated to OpenCode | `POST /api/v2/chat/completions` on KOB's default origin. JSON `model`, `messages`, `stream:true`; optional `temperature`, `max_tokens`; system prompt prepends a system message. Source may set `enable_thinking` for its selected model heuristic; FORGE does not copy that heuristic. |
| First discovery | `GET /v1/models`; no request body. |
| Second discovery | `POST /api/models`; JSON `{"api_key":keyPrefix,"api_token":tokenSuffix}`. Omit `api_token` for a key without a colon. |
| Third discovery | `GET /api/v2/models`; no request body. |
| Auth on all three | `Authorization: Bearer <entire raw key>`; `Content-Type: application/json`. Split POST fields at the first colon only. |
| Catalog envelopes | `data:[{id,display_name}]`, `models:[{id,...}]`, or `providers:[{provider,models:[{modelId/id,displayName/display_name}]}]`. |

README's backend table instead starts with `POST /api/ai/models`; it contradicts executable source. This adapter follows the source order above. It does not probe the README-only path. The source config loader also strips terminal version paths, contradicting the API client's `/v1` handling; FORGE preserves explicit API bases and does not import that loader or its environment overrides.

OpenCode's [primary provider documentation](https://opencode.ai/docs/providers/#custom), inspected 2026-11-24, specifies the v2 `providers`, `env`, `package`, `settings.baseURL` and `models` structure and the `@opencode/ai/providers/openai-compatible` package. This worker follows the existing service compiler's `providers.forge`, `{env:NAME}` and `modelID` conventions. Runtime compatibility still requires the actual installed OpenCode version and T3 catalog.

## Integration exports and bodies for the lead

All exports are in `app/providers/kob-api.mjs`:

- `kobApiRoute`: replaces only the unsupported KOB descriptor in `routes.mjs`. Driver `opencode`, mode `opencode-api`, family `chat-completions`, default API base `https://www.kob-ai.dev/api/v2`, machine env auth. Existing `configure` can already execute default-base setup with explicit models. Route presence means setup is implemented, not live qualification.
- `normalizeKobEndpoint(baseURL?)`: returns `{baseURL,chatURL,modelsEndpoints:[{id,method,url}]}`. Accepts HTTPS service origins, bases ending `/v1` or `/api/v2` (including a proxy prefix), or full URLs ending `/chat/completions`; permits HTTP only on loopback. Default KOB origin resolves to `/api/v2`; other origins resolve to `/v1`. Full chat suffix is removed for OpenCode's base. Discovery derives the service root by removing the API suffix. Credentials/query/fragment, ambiguous paths, wrong-family endpoint paths and encoded/dot segments are rejected with a fixed error. No host-substring matching.
- `compileKobApiConfig({baseURL?,apiKeyEnv,models})`: pure, no network/env access. Returns normalized endpoints plus `apiKeyEnv` and `opencodeConfig`. `models` must contain 1–100 distinct literal upstream IDs. Unknown fields, literal credential fields, arbitrary headers and model options are rejected. Output contains no inferred capabilities, pricing or default model IDs.
- `discoverKobModels({baseURL?,apiKeyEnv}, options?)`: explicit discovery only. Options are server-owned `{fetchImpl,env,resolveEnv,signal,timeoutMs,maxResponseBytes,clock}`; defaults are native fetch/process env, 10 seconds and 1 MiB. `resolveEnv(name)` can resolve the same machine env reference through a vault-backed mechanism, without inventing a vault URI format. Returns `{models:[{id,name?,provider?}],attempts:[{endpoint,method,status,outcome}],observedAt,source:'kob-api-discovery',verification:'discovery-only',executionVerified:false}`. Attempts contain endpoint enums, not raw responses/URLs. Unknown prices/options/capabilities are excluded; empty observed catalogs remain empty.

Lead-owned `service.mjs` compiler integration:

```js
const compiled = compileKobApiConfig({
  baseURL: input.baseURL, apiKeyEnv: input.apiKeyEnv, models: input.models,
});
apiConfig = compiled.opencodeConfig;
// Continue existing isolated config files + T3 instance creation.
```

The GUI/provider configure body remains the existing service shape:

```json
{
  "operationId": "<unique operation>",
  "projectId": "<current project>",
  "routeId": "kob",
  "apiKeyEnv": "KOB_API_KEY",
  "baseURL": "https://www.kob-ai.dev/api/v2",
  "models": ["<literal model ID from discovery or owner input>"]
}
```

`apiKeyEnv` names a machine-local secret/env binding, never its value. Compiler output uses:

```json
{
  "update": "disable",
  "providers": {
    "forge": {
      "name": "KOB",
      "env": ["KOB_API_KEY"],
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "https://www.kob-ai.dev/api/v2",
        "apiKey": "{env:KOB_API_KEY}"
      },
      "models": {
        "<literal upstream ID>": {
          "modelID": "<literal upstream ID>",
          "name": "<literal upstream ID>"
        }
      }
    }
  }
}
```

Expose discovery through the lead's project-scoped service/GUI action using `{projectId,operationId?,baseURL?,apiKeyEnv}` as appropriate for the existing HTTP boundary. Validate project scope before passing **only** `{baseURL,apiKeyEnv}` to the helper. No HTTP route is added by this worker. Keep secret resolution server-side. Associate cached results with the exact project/provider instance, endpoint/env reference and connection generation; discard stale responses. Never promote this list to T3 selection directly: configure models, refresh the instance through the existing T3 catalog service, and select exact IDs/options actually advertised there. A configured custom catalog entry alone does not establish account entitlement or tool support.

## Error, cancellation and retry semantics

Discovery follows redirects manually and refuses all 3xx responses, so auth does not cross a redirect. It falls back after 404/405/410/501, malformed JSON/envelopes or empty catalogs. Auth failures (401/403), rate limits (429), other HTTP failures, transport failures and overflow stop immediately. There are no automatic retries. This intentionally differs from the CLI's permissive fallback/retry policy.

Errors have fixed messages and `code`, `statusCode`, optional numeric `httpStatus`; no upstream body, URL, cause, key or token is attached. Codes: `KOB_INPUT`, `KOB_API_URL`, `KOB_SECRET_REFERENCE`, `KOB_SECRET_REQUIRED`, `KOB_MODELS`, `KOB_AUTH_REQUIRED`, `KOB_RATE_LIMIT`, `KOB_UNAVAILABLE`, `KOB_REDIRECT`, `KOB_TIMEOUT`, `KOB_ABORTED`, `KOB_RESPONSE_TOO_LARGE`, `KOB_CATALOG_INVALID`, `KOB_DISCOVERY_FAILED`. Stop/deadline covers pending vault lookup, fetch and response-body reading. This is cancellation of **discovery**, not evidence of stopping remote inference.

## Developer verification and remaining work

Node `v24.19.0`, Windows PowerShell, ephemeral loopback HTTP and clearly labelled fixture keys/model IDs only.

- `node --test tests/kob-api-config.test.mjs tests/kob-api-discovery.test.mjs`: **17/17 PASS**. Covers actual HTTP methods, key/body split, three envelopes, malformed/empty lists, default T3 setup fixture, URL normalization, no secret config, redirect refusal, response limits, error redaction and cancellation during secret lookup/headers/body. No account inference request.
- `node --test tests/providers.test.mjs tests/providers-mcp.test.mjs`: **7 pass, 4 fail**. One expected integration update: `providers.test.mjs:80` still expects `UNSUPPORTED_ROUTE` for unconfigured KOB; now receives `SECRET_REFERENCE` from the existing service (new compiler uses `KOB_SECRET_REFERENCE`). Lead owns this test adjustment. Three MCP discovery/call failures also reproduce with the **original HEAD routes module**, loaded in memory using `node:module.registerHooks` and `git show HEAD:app/providers/routes.mjs`; they are unrelated to this KOB diff. No MCP paths modified.
- `node --check app/providers/kob-api.mjs` and `git diff --check`: PASS.

Implementation gaps outside this worker's assigned files: lead must wire compiler normalization for user-entered root/full endpoint, add the project-scoped discovery action/GUI secret reference flow, and update the obsolete unsupported-route assertion. Default KOB setup already executes through the existing generic OpenCode compiler. No changes to central progress, manifests, T3, frontend, MCP OAuth, protected legacy boundaries or credentials.

External checks: **LIVE_KOB_DISCOVERY_NOT_RUN**, **LIVE_KOB_T3_REQUEST_NOT_RUN**, tools/images/structured outputs/reasoning/account pricing/cancellation **NOT_RUN**, **HOME_UAT_NOT_RUN**. Custom discovery paths beyond the three evidenced patterns are not implemented; configure a compatible service root or report the actual contract for a future narrow extension. A live key may have account-specific models/permissions.

Home/lead qualification: bind the key through machine-local masked secret setup, choose KOB API, explicitly discover (no inference), configure exact selected IDs, refresh the isolated T3 OpenCode 2.x catalog, then make an explicitly authorized live T3 request and separately test tools/Stop/recovery. Record actual runtime/account/model/options and observed results; do not infer them from this fixture suite.
