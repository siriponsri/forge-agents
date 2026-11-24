import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeProviderCatalog } from '../app/providers/native-catalog.mjs';

// Synthetic contract fixtures, NOT a live provider/account qualification.
// Schemas/helpers: T3 v0.1.11, 59651c1761f6c63e9b6056839067066968e6a406.
const NOW = Date.parse('2026-11-24T08:00:00.000Z');
const CHECKED = new Date(NOW - 1000).toISOString();
const CWD = 'C:\\fixture\\workspace';
const select = (id = 'thought_level') => ({ id, label: 'Thinking', type: 'select', role: 'reasoning',
  currentValue: 'high', options: [{ id: 'low', label: 'Low', isDefault: true }, { id: 'high', label: 'High' }] });
const model = (slug, capabilities = { optionDescriptors: [] }, extra = {}) => ({
  slug, name: `Name ${slug}`, isCustom: false, capabilities, ...extra,
});
const native = (extra = {}) => ({ providers: [{
  instanceId: 'fixture-work', driver: 'opencode', displayName: 'Fixture', enabled: true, installed: true,
  version: 'fixture-only', status: 'ready', auth: { status: 'authenticated' }, checkedAt: CHECKED,
  models: Array.from({ length: 27 }, (_, i) => model(`fixture/model-${i}`)), slashCommands: [], skills: [],
  supportedRuntimeModes: ['approval-required', 'full-access'], ...extra,
}] });
const mcp = (extra = {}) => ({ providers: [{
  providerInstanceId: 'fixture-work', driverKind: 'opencode', displayName: 'Fixture',
  models: Array.from({ length: 8 }, (_, i) => ({ id: `fixture/model-${i}` })), omittedModels: 19,
  runtimeModes: ['approval-required'], canRunChildTask: true, canRunCrossProviderChildTask: true,
  constraints: [], ...extra,
}] });
const workspace = (extra = {}) => ({ cwd: CWD, checkedAt: CHECKED, slashCommands: [], skills: [], ...extra });
const setup = ({ response = native(), capability = mcp(), clock = () => NOW, rpc, capabilities } = {}) => {
  const calls = [], capabilityCalls = [];
  const reader = createNativeProviderCatalog({
    clock,
    rpc: rpc ?? (async (tag, payload) => { calls.push({ tag, payload }); return response; }),
    capabilities: capabilities ?? (async (...args) => { capabilityCalls.push(args); return capability; }),
  });
  return { reader, calls, capabilityCalls, read: (input = {}) => reader.read({ providerInstanceId: 'fixture-work', ...input }) };
};

test('pinned native full list beats the eight-model MCP shortlist without pagination or option searches', async () => {
  const fixture = setup();
  const result = await fixture.read();
  assert.equal(result.models.length, 27);
  assert.equal(result.models.at(-1).id, 'fixture/model-26');
  assert.equal(result.omittedModels, 0);
  assert.equal(result.catalogComplete, true);
  assert.equal(result.canRunChildTask, true);
  assert.deepEqual(result.runtimeModes, ['approval-required']);
  assert.deepEqual(fixture.calls, [{ tag: 'server.refreshProviders', payload: {
    instanceId: 'fixture-work', fresh: false, refreshModels: false, workspaceSnapshotsOnDemand: false,
  } }]);
  assert.deepEqual(fixture.capabilityCalls, [[]]);
  assert.equal(result.checkedAt, CHECKED);
  assert.equal(result.fetchedAt, NOW);
  assert.equal(result.upstreamFreshness, 'unknown');
  assert.equal(result.modelContentUpdatedAt, null);
});

test('pinned option helper mapping preserves exact select/default precedence and boolean false', async () => {
  const descriptors = [select(), { id: 'fastMode', label: 'Fast', type: 'boolean', currentValue: false },
    { id: 'thinking', label: 'Thinking', type: 'boolean' },
    { id: 'variant', label: 'Variant', type: 'select', options: [{ id: 'v1', label: 'One', isDefault: true }] },
    { id: 'no-default', label: 'No default', type: 'select', options: [{ id: 'only', label: 'Only' }] }];
  const result = await setup({ response: native({ models: [model('custom/exact', { optionDescriptors: descriptors }, {
    isCustom: true, isLegacy: true, subProvider: 'custom-host', aliases: ['display-alias'], supportsTextGeneration: false,
  })] }) }).read();
  assert.deepEqual(result.models[0].options, [
    { id: 'thought_level', values: ['low', 'high'], default: 'high' },
    { id: 'fastMode', values: [false, true], default: false },
    { id: 'thinking', values: [false, true] },
    { id: 'variant', values: ['v1'], default: 'v1' },
    { id: 'no-default', values: ['only'] },
  ]);
  assert.deepEqual(result.models[0].capabilities.optionDescriptors, descriptors);
  assert.equal(result.models[0].isCustom, true);
  assert.equal(result.models[0].isLegacy, true);
  assert.equal(result.models[0].supportsTextGeneration, false);
  assert.deepEqual(result.models[0].provenance, { source: 'server.refreshProviders', scope: 'machine', origin: 'custom' });
  assert.equal(result.models[0].optionsKnown, true);
});

test('no guessed universal options for native models with absent capabilities', async () => {
  const result = await setup({ response: native({ models: [model('unknown', null), model('unspecified', {}), model('none')] }),
    capability: mcp({ models: [{ id: 'unknown', options: [{ id: 'invented', values: ['xhigh'] }] }] }),
  }).read();
  assert.deepEqual(result.models.map(m => m.options), [[], [], []]);
  assert.deepEqual(result.models.map(m => m.optionsKnown), [false, false, true]);
});

test('pinned helper preserves an out-of-choice current default without authorizing it', async () => {
  const descriptor = { ...select(), currentValue: 'reported-old-value' };
  const result = await setup({ response: native({ models: [model('exact', { optionDescriptors: [descriptor] })] }) }).read();
  assert.deepEqual(result.models[0].options, [{ id: 'thought_level', values: ['low', 'high'], default: 'reported-old-value' }]);
});

test('exact-cwd workspace models REPLACE the machine array, preserving workspace model capabilities', async () => {
  const response = native({ workspaceSnapshots: [workspace({ models: [model('workspace-only', { optionDescriptors: [select()] })],
    optionDescriptors: [{ id: 'global-toggle', label: 'Global', type: 'boolean', currentValue: true }],
  })] });
  const fixture = setup({ response });
  const result = await fixture.read({ cwd: CWD });
  assert.deepEqual(result.models.map(m => m.id), ['workspace-only']);
  assert.deepEqual(result.models[0].options.map(o => o.id), ['thought_level']);
  assert.equal(result.models[0].provenance.scope, 'workspace');
  assert.equal(result.workspaceCheckedAt, CHECKED);
  assert.equal(result.workspaceOptionDescriptors[0].id, 'global-toggle');
  assert.equal(result.catalogComplete, true);
  assert.equal(fixture.calls[0].payload.cwd, CWD);
  assert.equal(fixture.calls[0].payload.workspaceSnapshotsOnDemand, false);
});

test('empty workspace override stays empty; absent override inherits full machine array', async () => {
  const empty = await setup({ response: native({ workspaceSnapshots: [workspace({ models: [] })] }) }).read({ cwd: CWD });
  assert.equal(empty.models.length, 0);
  assert.equal(empty.catalogComplete, true);
  const inherited = await setup({ response: native({ workspaceSnapshots: [workspace()] }) }).read({ cwd: CWD });
  assert.equal(inherited.models.length, 27);
  assert.equal(inherited.modelContentSource, 'machine-snapshot');
  assert.equal(inherited.catalogComplete, true);
});

test('missing or differently cased workspace snapshot cannot claim complete workspace coverage', async () => {
  for (const snapshots of [[], [workspace({ cwd: CWD.toLowerCase(), models: [model('wrong-cwd')] })]]) {
    const result = await setup({ response: native({ workspaceSnapshots: snapshots }) }).read({ cwd: CWD });
    assert.equal(result.models.length, 27);
    assert.equal(result.catalogComplete, false);
    assert.equal(result.omittedModels, null);
    assert.deepEqual(result.completenessReasons, ['workspace-snapshot-missing']);
  }
});

test('pending workspace keeps returned prior lists but cannot become freshly complete', async () => {
  for (const pending of [{ modelsPending: true }, { slashCommandsPending: true }]) {
    for (const override of [{}, { models: [model('prior-workspace')] }]) {
      const result = await setup({ response: native({ workspaceSnapshots: [workspace({ ...pending, ...override })] }) }).read({ cwd: CWD });
      assert.equal(result.models.length, override.models ? 1 : 27);
      assert.equal(result.catalogComplete, false);
      assert.equal(result.stale, true);
      assert.equal(result.omittedModels, null);
      assert.deepEqual(result.completenessReasons, ['workspace-snapshot-pending']);
    }
  }
});

test('retained native models are visible but not complete even with a recent health checkedAt', async () => {
  const result = await setup({ response: native({ modelsRetained: true, status: 'warning' }) }).read();
  assert.equal(result.models.length, 27);
  assert.equal(result.checkedAt, CHECKED);
  assert.equal(result.modelsRetained, true);
  assert.equal(result.catalogComplete, false);
  assert.equal(result.omittedModels, null);
  assert.deepEqual(result.completenessReasons, ['models-retained']);
});

test('snapshot expiry uses the pinned five-minute boundary and preserves native timestamps', async () => {
  const expired = new Date(NOW - 300_000).toISOString();
  const result = await setup({ response: native({ checkedAt: expired, workspaceSnapshots: [workspace({ checkedAt: expired })] }) }).read({ cwd: CWD });
  assert.equal(result.checkedAt, expired);
  assert.equal(result.workspaceCheckedAt, expired);
  assert.equal(result.omittedModels, null);
  assert.deepEqual(result.completenessReasons, ['provider-snapshot-expired', 'workspace-snapshot-expired']);
  const current = new Date(NOW - 299_999).toISOString();
  assert.equal((await setup({ response: native({ checkedAt: current }) }).read()).catalogComplete, true);
});

test('model content observation does not advance with fetch or native health timestamps', async () => {
  let now = NOW, response = native();
  const fixture = setup({ clock: () => now, rpc: async () => response });
  const first = await fixture.read();
  now += 20_000;
  response.providers[0].checkedAt = new Date(now).toISOString();
  const second = await fixture.read();
  assert.equal(second.fetchedAt, now);
  assert.equal(second.checkedAt, response.providers[0].checkedAt);
  assert.equal(second.modelContentObservedAt, first.modelContentObservedAt);
  assert.equal(second.modelContentDigest, first.modelContentDigest);
  now += 20_000;
  response.providers[0].models[0].capabilities = { optionDescriptors: [select()] };
  const third = await fixture.read();
  assert.equal(third.modelContentObservedAt, now);
  assert.notEqual(third.modelContentDigest, first.modelContentDigest);
  now += 20_000;
  response.providers[0].modelsRetained = true;
  const retained = await fixture.read();
  assert.equal(retained.modelContentObservedAt, third.modelContentObservedAt);
  assert.equal(retained.catalogComplete, false);
});

test('native failure is classified and never replaced by the MCP shortlist; content history survives', async () => {
  let now = NOW, failed = false;
  const fixture = setup({ clock: () => now, rpc: async () => {
    if (failed) throw new Error('token=secret-provider-value');
    return native();
  } });
  const first = await fixture.read();
  failed = true;
  await assert.rejects(fixture.read(), error => error.code === 'NATIVE_CATALOG_UNAVAILABLE' && !error.message.includes('secret'));
  failed = false;
  now += 20_000;
  assert.equal((await fixture.read()).modelContentObservedAt, first.modelContentObservedAt);
});

test('MCP failure, absent instance, mismatched driver and malformed eligibility fail closed without hiding native models', async () => {
  for (const capabilities of [async () => { throw new Error('private-account-data'); }, async () => ({ providers: [] }),
    async () => mcp({ driverKind: 'other' }), async () => mcp({ constraints: null })]) {
    const result = await setup({ capabilities }).read();
    assert.equal(result.models.length, 27);
    assert.equal(result.catalogComplete, true);
    assert.equal(result.orchestrationKnown, false);
    assert.equal(result.canRunChildTask, false);
    assert.equal(result.canRunCrossProviderChildTask, false);
    assert.ok(!JSON.stringify(result).includes('private-account-data'));
  }
});

test('MCP project restrictions remain authoritative even for a native ready/authenticated provider', async () => {
  const result = await setup({ capability: mcp({ canRunChildTask: false, canRunCrossProviderChildTask: false,
    constraints: ['Provider instance is disabled.'] }) }).read();
  assert.equal(result.orchestrationKnown, true);
  assert.equal(result.canRunChildTask, false);
  assert.deepEqual(result.constraints, ['Provider instance is disabled.']);
});

test('native instance identity never falls back to another instance with the same driver', async () => {
  const fixture = setup({ response: native({ instanceId: 'fixture-personal' }) });
  await assert.rejects(fixture.read(), { code: 'NATIVE_PROVIDER_ABSENT' });
});

test('malformed native catalog/options reject instead of claiming zero omissions', async () => {
  const bad = [native({ models: null }), native({ models: [model('duplicate'), model('duplicate')] }),
    native({ checkedAt: 'not-a-timestamp' }), native({ modelsRetained: 'true' }), native({ supportedRuntimeModes: 'full-access' }),
    native({ models: [model('bad', { optionDescriptors: [{ id: 'flag', label: 'Flag', type: 'boolean', currentValue: 'false' }] })] }),
    native({ models: [model('bad', { optionDescriptors: [select(), select()] })] }),
    native({ models: [model('bad', { optionDescriptors: [{ ...select(), type: 'slider' }] })] }),
    native({ models: [model('bad', { optionDescriptors: [{ ...select(), options: [{ id: 42, label: 'Bad' }] }] })] })];
  for (const response of bad) await assert.rejects(setup({ response }).read(), { code: 'NATIVE_CATALOG_INVALID' });
  for (const override of [{ models: null }, { models: {} }, { checkedAt: 'invalid' }, { modelsPending: 'true' }, { optionDescriptors: {} }]) {
    await assert.rejects(setup({ response: native({ workspaceSnapshots: [workspace(override)] }) }).read({ cwd: CWD }), { code: 'NATIVE_CATALOG_INVALID' });
  }
});

test('duplicate native identities and duplicate cwd snapshots reject instead of choosing an arbitrary route', async () => {
  const response = native();
  response.providers.push(structuredClone(response.providers[0]));
  await assert.rejects(setup({ response }).read(), { code: 'NATIVE_CATALOG_INVALID' });
  await assert.rejects(setup({ response: native({ workspaceSnapshots: [workspace(), workspace()] }) }).read({ cwd: CWD }), { code: 'NATIVE_CATALOG_INVALID' });
});

test('unavailable native health does not turn a returned cache into a complete catalog', async () => {
  for (const state of [{ status: 'error' }, { enabled: false }, { installed: false }, { availability: 'unavailable' }]) {
    const result = await setup({ response: native(state) }).read();
    assert.equal(result.models.length, 27);
    assert.equal(result.catalogComplete, false);
    assert.equal(result.omittedModels, null);
  }
});

test('concurrent identical reads share native/MCP requests but return independent mutable copies', async () => {
  let release, nativeCalls = 0, mcpCalls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const fixture = setup({ rpc: async () => { nativeCalls++; await gate; return native(); },
    capabilities: async () => { mcpCalls++; return mcp(); } });
  const a = fixture.read(), b = fixture.read();
  release();
  const [first, second] = await Promise.all([a, b]);
  assert.equal(nativeCalls, 1);
  assert.equal(mcpCalls, 1);
  first.models[0].id = 'mutated';
  assert.equal(second.models[0].id, 'fixture/model-0');
  assert.equal((await fixture.read()).models[0].id, 'fixture/model-0');
});

test('workspace and provider instance content histories stay separate', async () => {
  let now = NOW;
  const fixture = setup({ clock: () => now, rpc: async (_tag, input) => native({ instanceId: input.instanceId,
    workspaceSnapshots: input.cwd ? [workspace({ cwd: input.cwd })] : [],
  }), capabilities: async () => mcp() });
  const first = await fixture.read({ cwd: CWD });
  now += 1000;
  assert.equal((await fixture.read({ cwd: `${CWD}-other` })).modelContentObservedAt, now);
  now += 1000;
  assert.equal((await fixture.read({ providerInstanceId: 'other-instance' })).modelContentObservedAt, now);
  assert.equal((await fixture.read({ cwd: CWD })).modelContentObservedAt, first.modelContentObservedAt);
});
