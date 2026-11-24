import { createHash } from 'node:crypto';

// T3 v0.1.11, 59651c1761f6c63e9b6056839067066968e6a406 (MIT).
// See docs/worker-native-catalog.md for the pinned contracts and helper mapping.
const SNAPSHOT_TTL_MS = 5 * 60_000;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => nonempty(value) && Number.isFinite(Date.parse(value));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function invalid() {
  throw Object.assign(new Error('Invalid pinned T3 native catalog response.'), { code: 'NATIVE_CATALOG_INVALID' });
}
function distinct(items, key) {
  if (new Set(items.map(key)).size !== items.length) invalid();
}

// capabilityModelOption in OrchestratorMcpService.ts calls
// getProviderOptionCurrentValue(descriptor) without selection/reported context.
function modelOptions(capabilities) {
  if (capabilities === null) return { options: [], optionsKnown: false };
  if (!record(capabilities)) invalid();
  const descriptors = capabilities.optionDescriptors;
  if (descriptors === undefined) return { options: [], optionsKnown: false };
  if (!Array.isArray(descriptors)) invalid();
  const options = descriptors.map(descriptor => {
    if (!record(descriptor) || !nonempty(descriptor.id) || !nonempty(descriptor.label)) invalid();
    let values, defaultValue;
    if (descriptor.type === 'boolean') {
      if (descriptor.currentValue !== undefined && typeof descriptor.currentValue !== 'boolean') invalid();
      values = [false, true];
      defaultValue = descriptor.currentValue;
    } else if (descriptor.type === 'select') {
      if (!Array.isArray(descriptor.options)) invalid();
      for (const choice of descriptor.options) {
        if (!record(choice) || !nonempty(choice.id) || !nonempty(choice.label) ||
            (choice.isDefault !== undefined && typeof choice.isDefault !== 'boolean')) invalid();
      }
      values = descriptor.options.map(choice => choice.id);
      distinct(values, value => value);
      if (descriptor.currentValue !== undefined && !nonempty(descriptor.currentValue)) invalid();
      defaultValue = descriptor.currentValue || descriptor.options.find(choice => choice.isDefault)?.id;
    } else invalid();
    // A reported currentValue can be outside the available choices. Preserve it
    // exactly, as T3 does; it does not add that value to the allowed choices.
    return { id: descriptor.id, values, ...(defaultValue === undefined ? {} : { default: defaultValue }) };
  });
  distinct(options, option => option.id);
  return { options, optionsKnown: true };
}

function normalizeModels(models, scope) {
  if (!Array.isArray(models)) invalid();
  const normalized = models.map(model => {
    if (!record(model) || !nonempty(model.slug) || !nonempty(model.name) || typeof model.isCustom !== 'boolean') invalid();
    const options = modelOptions(model.capabilities);
    return {
      id: model.slug,
      name: model.name,
      ...options,
      isCustom: model.isCustom,
      capabilities: structuredClone(model.capabilities),
      ...Object.fromEntries(['shortName', 'subProvider', 'aliases', 'badge', 'isDefault', 'isLegacy', 'supportsTextGeneration']
        .filter(key => model[key] !== undefined).map(key => [key, structuredClone(model[key])])),
      provenance: { source: 'server.refreshProviders', scope, origin: model.isCustom ? 'custom' : 'provider' },
    };
  });
  distinct(normalized, model => model.id);
  return normalized;
}

function nativeProvider(value, id) {
  if (!record(value) || !Array.isArray(value.providers)) invalid();
  const matches = value.providers.filter(provider => provider?.instanceId === id);
  if (matches.length === 0) {
    throw Object.assign(new Error('Provider instance absent from the native catalog.'), { code: 'NATIVE_PROVIDER_ABSENT' });
  }
  if (matches.length !== 1) invalid();
  const provider = matches[0];
  if (!nonempty(provider.driver) || !timestamp(provider.checkedAt) || !Array.isArray(provider.models) ||
      !['ready', 'warning', 'error', 'disabled'].includes(provider.status) ||
      typeof provider.enabled !== 'boolean' || typeof provider.installed !== 'boolean' ||
      !record(provider.auth) || !['authenticated', 'unauthenticated', 'unknown'].includes(provider.auth.status)) invalid();
  if (provider.modelsRetained !== undefined && typeof provider.modelsRetained !== 'boolean') invalid();
  if (provider.workspaceSnapshots !== undefined && !Array.isArray(provider.workspaceSnapshots)) invalid();
  if (provider.supportedRuntimeModes !== undefined && (!Array.isArray(provider.supportedRuntimeModes) ||
      provider.supportedRuntimeModes.some(mode => !nonempty(mode)))) invalid();
  return provider;
}

// Eligibility is a caller/project/adapter policy decision owned by MCP. Native
// health or model membership alone cannot establish canRunChildTask.
async function orchestration(capabilities, id, driverKind) {
  const unavailable = { known: false, canRunChildTask: false, canRunCrossProviderChildTask: false,
    constraints: ['Orchestration eligibility was not available for this provider instance.'] };
  if (typeof capabilities !== 'function') return unavailable;
  try {
    const value = await capabilities();
    const matches = value?.providers?.filter(provider => provider.providerInstanceId === id);
    if (matches?.length !== 1) return unavailable;
    const provider = matches[0];
    if (provider.driverKind !== driverKind || typeof provider.canRunChildTask !== 'boolean' ||
        !Array.isArray(provider.constraints) || provider.constraints.some(value => typeof value !== 'string') ||
        (provider.runtimeModes !== undefined && (!Array.isArray(provider.runtimeModes) ||
          provider.runtimeModes.some(value => !nonempty(value))))) return unavailable;
    return { known: true, canRunChildTask: provider.canRunChildTask,
      canRunCrossProviderChildTask: provider.canRunCrossProviderChildTask === true,
      constraints: [...provider.constraints], runtimeModes: provider.runtimeModes && [...provider.runtimeModes] };
  } catch {
    // Never propagate native/provider errors that may contain account details.
    return unavailable;
  }
}

/** Read full native membership; use MCP only for the caller's run eligibility.
 * rpc(tag,payload) and capabilities() return decoded success payloads, not
 * Effect frames or MCP content envelopes. This reader never starts a turn.
 */
export function createNativeProviderCatalog({ rpc, capabilities, clock = Date.now }) {
  if (typeof rpc !== 'function' || typeof clock !== 'function') throw new TypeError('rpc and clock must be functions');
  const flights = new Map(), content = new Map();
  async function load({ providerInstanceId, cwd }, key) {
    let value;
    try {
      value = await rpc('server.refreshProviders', {
        instanceId: providerInstanceId,
        ...(cwd === undefined ? {} : { cwd }),
        fresh: false,
        refreshModels: false,
        workspaceSnapshotsOnDemand: false,
      });
    } catch {
      throw Object.assign(new Error('Unable to read the native T3 provider catalog.'), { code: 'NATIVE_CATALOG_UNAVAILABLE' });
    }
    const fetchedAt = clock();
    if (!Number.isFinite(fetchedAt)) throw new TypeError('clock must return epoch milliseconds');
    const provider = nativeProvider(value, providerInstanceId);
    const snapshots = cwd === undefined ? [] : (provider.workspaceSnapshots ?? []).filter(snapshot => snapshot?.cwd === cwd);
    if (snapshots.length > 1) invalid();
    const workspace = snapshots[0];
    if (workspace && (!timestamp(workspace.checkedAt) ||
        ['modelsPending', 'slashCommandsPending'].some(key => workspace[key] !== undefined && typeof workspace[key] !== 'boolean') ||
        (workspace.models !== undefined && !Array.isArray(workspace.models)) ||
        (workspace.optionDescriptors !== undefined && !Array.isArray(workspace.optionDescriptors)))) invalid();
    // withWorkspaceModels in the pinned MCP service REPLACES the array, even
    // when the override is empty. Cwd comparison is exact, not path folding.
    const scope = workspace?.models === undefined ? 'machine' : 'workspace';
    const models = normalizeModels(workspace?.models ?? provider.models, scope);
    const reasons = [];
    if (provider.modelsRetained === true) reasons.push('models-retained');
    if (fetchedAt - Date.parse(provider.checkedAt) >= SNAPSHOT_TTL_MS) reasons.push('provider-snapshot-expired');
    if (provider.status === 'error' || provider.status === 'disabled') reasons.push('provider-unhealthy');
    if (!provider.enabled || !provider.installed || provider.availability === 'unavailable') reasons.push('provider-unavailable');
    if (cwd !== undefined && !workspace) reasons.push('workspace-snapshot-missing');
    if (workspace) {
      // isProviderWorkspaceSnapshotPending includes both flags in v0.1.11.
      if (workspace.modelsPending === true || workspace.slashCommandsPending === true) reasons.push('workspace-snapshot-pending');
      if (fetchedAt - Date.parse(workspace.checkedAt) >= SNAPSHOT_TTL_MS) reasons.push('workspace-snapshot-expired');
    }
    const eligibility = await orchestration(capabilities, providerInstanceId, provider.driver);
    const fingerprint = digest([provider.driver, scope, models]);
    const previous = content.get(key);
    const modelContentObservedAt = previous?.digest === fingerprint ? previous.observedAt : fetchedAt;
    // checkedAt is a native health/scan observation, not the provider model
    // manifest's modification time. That upstream timestamp is not exposed.
    const catalogComplete = reasons.length === 0;
    const result = {
      providerInstanceId,
      driverKind: provider.driver,
      displayName: provider.displayName ?? null,
      models,
      omittedModels: catalogComplete ? 0 : null,
      catalogComplete,
      stale: !catalogComplete,
      completenessReasons: reasons,
      canRunChildTask: eligibility.canRunChildTask,
      canRunCrossProviderChildTask: eligibility.canRunCrossProviderChildTask,
      constraints: eligibility.constraints,
      orchestrationKnown: eligibility.known,
      runtimeModes: eligibility.runtimeModes ?? [...(provider.supportedRuntimeModes ?? [])],
      checkedAt: provider.checkedAt,
      workspaceCheckedAt: workspace?.checkedAt ?? null,
      modelsRetained: provider.modelsRetained === true,
      modelsPending: workspace?.modelsPending === true,
      ...(workspace?.optionDescriptors === undefined ? {} : { workspaceOptionDescriptors: structuredClone(workspace.optionDescriptors) }),
      fetchedAt,
      modelContentObservedAt,
      modelContentDigest: fingerprint,
      modelContentUpdatedAt: null,
      modelContentSource: scope === 'workspace' ? 'workspace-snapshot' : 'machine-snapshot',
      upstreamFreshness: 'unknown',
      source: 'server.refreshProviders',
    };
    content.delete(key);
    content.set(key, { digest: fingerprint, observedAt: modelContentObservedAt });
    // Bound process-local content history; persistence/account generations
    // remain the owner's catalog service responsibility.
    if (content.size > 128) content.delete(content.keys().next().value);
    return result;
  }
  return {
    async read({ providerInstanceId, cwd } = {}) {
      if (!nonempty(providerInstanceId) || (cwd !== undefined && !nonempty(cwd))) throw new TypeError('providerInstanceId and optional cwd must be nonempty strings');
      const key = JSON.stringify([providerInstanceId, cwd ?? null]);
      if (!flights.has(key)) {
        const promise = load({ providerInstanceId, cwd }, key).finally(() => flights.delete(key));
        flights.set(key, promise);
      }
      // Callers cannot mutate shared in-flight results or content history.
      return structuredClone(await flights.get(key));
    },
  };
}
