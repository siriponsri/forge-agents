# Native provider catalog worker handoff

Scope: only `app/providers/native-catalog.mjs`,
`tests/providers-native-catalog.test.mjs`, and this note. Integration into the
existing catalog, T3 service, persistence, selection and UI belongs to the lead.
No manifest, shared contract, central progress or legacy file was changed.

Actual worker runtime reported by the T3/Codex harness: **gpt-6.1-sol, xhigh**.
The assignment inherited this selection. No model switch, nested delegation or
billable verification turn was performed. This is the harness identity, not a
separate assertion of a provider `executedModel` receipt.

## Inspected primary contracts

Pinned T3 **v0.1.11**, revision
`59651c1761f6c63e9b6056839067066968e6a406`, MIT. Matching source files were read
from that immutable upstream revision; this worker checkout has no `.data`
source checkout or `app/server/t3-native.mjs`. Existing local evidence is
`app/server/t3.mjs`, `app/providers/catalog.mjs`,
`app/providers/t3-setup-rpc.mjs`, and `app/vendor/t3/FORGE_CHANGES.md`.

- [Native server schemas and exported workspace current/pending helpers](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/server.ts):
  `ServerProvider`, `ServerProviderModel`, `ServerProviderWorkspaceSnapshot`,
  `ServerProviderUpdatedPayload`. Native model identity is `slug`; the refresh
  success payload is `{providers:[...]}`. The full native array has no MCP
  shortlist cap. Workspace `models` replaces the machine array if present.
  `modelsRetained` denotes preserved models after a failed provider check.
  Workspace TTL is five minutes; either pending flag makes the snapshot pending.
- [Effect-RPC refresh contract](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/rpc.ts):
  `WsServerRefreshProvidersRpc` accepts `instanceId`, `cwd`, `fresh`,
  `refreshModels`, and `workspaceSnapshotsOnDemand` among other fields. This is
  not a JSON-RPC method or an MCP tool name.
- [Actual native refresh handler](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/apps/server/src/ws.ts):
  `workspaceSnapshotsOnDemand:true` with instance/cwd intentionally clears the
  machine models array in its reply. The reader uses `false`, retaining full
  native models and workspace snapshots. It does not use `omitProviders` or
  `modelCatalogOnly`, which can reply with an empty provider array.
- [MCP service implementation](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/apps/server/src/mcp/OrchestratorMcpService.ts):
  `listCapabilityModels` limits large catalogs to eight models, applies hidden
  model preferences, and has no pagination. `withWorkspaceModels` uses exact
  cwd equality and replaces, rather than unions, model arrays.
  `capabilityModelOption` reads each model's own capabilities. `providerConstraints`
  also depends on adapter and caller/project policy, so native readiness alone
  cannot establish orchestration eligibility.
- [Typed option schemas](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/contracts/src/model.ts)
  and [exported option helper](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/packages/shared/src/model.ts):
  `ModelCapabilities.optionDescriptors` carries the exact per-model options.
  `getProviderOptionCurrentValue(descriptor)` without selection/report context
  returns boolean `currentValue`, or select `currentValue` followed by the first
  default choice. The reader implements this limited mapping, including `false`
  and defaults outside the current choices, exactly as MCP does. It does not
  invent universal effort, service tier or workspace-wide model options.
- [Provider registry merge/scan implementation](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/apps/server/src/provider/ProviderRegistry.ts):
  `upsertProviderWorkspaceSnapshot` can retain earlier workspace models while
  setting `modelsPending`; `mergeProviderSnapshot` can retain machine models and
  republish health metadata. A new `checkedAt` is not a model-content timestamp.

## Integration API

```js
import { createNativeProviderCatalog } from './native-catalog.mjs';

const nativeCatalog = createNativeProviderCatalog({
  rpc: (tag, payload) => t3.providers.rpc(tag, payload),
  capabilities: () => t3.catalog(),
  // clock: Date.now, // optional; returns epoch milliseconds
});

const provider = await nativeCatalog.read({
  providerInstanceId: connection.providerInstanceId,
  cwd: project.workspace, // omit only for a machine catalog
});
```

Both callbacks must resolve **decoded success payloads**. The owner handles
Effect-RPC transport, ticket/session cleanup, and MCP result-envelope decoding.
One read calls `server.refreshProviders` with:

```js
{
  instanceId: providerInstanceId,
  // cwd, if supplied
  fresh: false,
  refreshModels: false,
  workspaceSnapshotsOnDemand: false,
}
```

This requests the full native inventory without explicit model-cache invalidation
or provider `refreshModels()` calls. The pinned contract warns that explicit
rediscovery may open provider sessions. Ordinary checks/scans may still be done
by native T3; the reader sends no prompt, launches no run, reloads no secrets,
starts no login, installs nothing and owns no provider turn. Upstream cache age
remains unknown. The existing explicit refresh flow can rediscover separately;
do not interpret this read as proof that the provider fetched a new manifest.

The result is **one normalized provider**, not `{providers:[...]}`:

- `providerInstanceId`, `driverKind`, `displayName`, `models`, `runtimeModes`,
  `canRunChildTask`, `canRunCrossProviderChildTask`, `constraints`.
- Each model has exact native `id`/`name`, normalized
  `options:[{id,values,default?}]`, original typed `capabilities`, `optionsKnown`,
  `isCustom`, relevant native identity/availability metadata, and provenance
  `{source:'server.refreshProviders',scope:'machine'|'workspace',origin:'custom'|'provider'}`.
  Legacy and custom entries are retained; aliases never create extra model IDs.
  Null/absent capability descriptors grant no fabricated options.
- `catalogComplete`, `stale`, `completenessReasons`, `modelsRetained`,
  `modelsPending`. `omittedModels` is **0 only when complete**, otherwise `null`.
  Returned cached models remain visible on retained/pending/expired snapshots.
  Missing exact-cwd snapshots, unhealthy/unavailable native providers and expiry
  cannot claim a newly complete catalog. Machine snapshots use the same
  conservative five-minute freshness ceiling as workspace snapshots.
- Exact native `checkedAt` and `workspaceCheckedAt` (ISO strings), `fetchedAt`
  (local epoch milliseconds), `modelContentObservedAt` (first local observation
  of the current content in this reader), and `modelContentDigest` (SHA256).
  Re-reading unchanged content or changing only health timestamps does not move
  `modelContentObservedAt`. Changing model metadata/options does. Retained/pending
  flags do not change that digest. `modelContentUpdatedAt:null` and
  `upstreamFreshness:'unknown'` explicitly avoid inventing the actual upstream
  model-content time or cache age.
- `modelContentSource` is `machine-snapshot` or `workspace-snapshot`; `source` is
  `server.refreshProviders`. `workspaceOptionDescriptors`, if present, preserves
  the separate native workspace controls without granting them to every model.
- MCP is queried once per coalesced read, solely for exact-instance eligibility,
  runtime modes and constraints. No per-model MCP search is needed: native
  descriptors already contain the source data used by MCP. When MCP is missing,
  fails or mismatches the instance/driver, `orchestrationKnown:false` and both
  child flags are false, while native membership remains available.

Completeness describes the observed full native snapshot, not entitlement,
execution verification, every model a provider might accept, or a successful
live request. An empty native list is an observed empty list, not proof that an
arbitrary slug does not exist. MCP hidden preferences do not truncate this full
native reader; selection policy/preferences remain the lead's responsibility.

Identical in-flight reads coalesce. Results are cloned per caller. Content
observation history is process-local, bounded to 128 instance/cwd keys; the lead
must persist the digest/timestamp and preserve the prior timestamp on equal
digests across reader recreation/restarts. Account route/generation identity,
durable last-known-good state, selection validation, timeout presentation and
GUI integration remain in the existing owner catalog. Do not coerce incomplete
`omittedModels:null` back to zero with `?? 0`.

Native RPC failures throw sanitized `NATIVE_CATALOG_UNAVAILABLE`; malformed
native data throws `NATIVE_CATALOG_INVALID`; an absent exact instance throws
`NATIVE_PROVIDER_ABSENT`. There is no fallback that silently substitutes the MCP
shortlist. The existing catalog owner should preserve its prior snapshot and
report the failed discovery separately.

## Verification and remaining work

Deterministic, synthetic **pinned native/MCP contract fixtures** cover full
27-versus-eight model lists; exact typed/default/boolean/custom options; unknown
capabilities; exact-cwd overrides, empty/inherited/missing workspace lists;
pending and retained models; five-minute expiry; failing RPC/MCP; model-content
timestamp retention; instance/driver isolation; malformed responses; and shared
in-flight reads without caller mutation leakage.

Commands:

```text
node --test tests/providers-native-catalog.test.mjs
node --check app/providers/native-catalog.mjs
git diff --check
```

No account, provider refresh or live catalog query was performed. Live native
runtime qualification and HOME_UAT are **NOT_RUN**. This worker delivers the
implemented reader and deterministic evidence; existing catalog/service/UI
integration is the lead's next step, not a missing-credentials explanation for
unimplemented integration. No push or PR was made.
