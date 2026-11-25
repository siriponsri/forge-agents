// Deterministic MODULE fixture in a fresh Bun process. Imports the existing
// native modules read-only. No native process configuration, user home, provider,
// inference loop, CLI binary or installed runtime is changed or qualified.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { NATIVE_TOOL_NAME } from '../../app/frontend-tools/native-tool.mjs';

const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const boot = JSON.parse((await lines.next()).value);
const source = file => import(pathToFileURL(path.join(boot.opencode, file)).href);
const { Effect, Layer } = await source('packages/core/node_modules/effect/dist/index.js');
const { Tool } = await source('packages/core/src/tool.ts');
const { installHost } = await source('packages/core/src/forge-guard.ts');
const { LayerNode } = await source('packages/util/src/effect/layer-node.ts');
const { Image } = await source('packages/core/src/image.ts');
const { Permission } = await source('packages/core/src/permission.ts');
const { Flag } = await source('packages/core/src/flag.ts');
const { PluginHooks } = await source('packages/core/src/plugin/hooks.ts');
// The runner stages the NEW hook in its new disposable home, changing ONLY its
// three import specifiers to the exact matching read-only native dependencies.
const { registerSupervisedFrontend } = await import(pathToFileURL(boot.hookFile).href);
const client = new Client({ name: 'native-frontend-module-fixture', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(boot.endpoint), { requestInit: { headers: { Authorization: boot.authorization } } }));
let current = true, hookBefore = 0, hookAfter = 0;
const context = { sessionID: boot.binding.nativeSessionId, agent: 'build', messageID: 'msg_native_fixture' };
let executor;
// Test-only process-private function-identity gate. Production Guarded binaries
// remain unchanged and still refuse this tool. This is no installation proof.
installHost({ assert(x) {
  if (!current || x.tool?.execute !== executor || x.rawName !== NATIVE_TOOL_NAME || x.resolvedName !== x.rawName || x.context && (x.context.sessionID !== context.sessionID || x.context.codemode)) throw Error('DENIED');
} });
const layer = LayerNode.compile(LayerNode.group([Tool.node, PluginHooks.node]), { replacements: [
  Image.node.replace(Layer.succeed(Image.Service, {})),
  Permission.node.replace(Layer.succeed(Permission.Service, { assert: () => Effect.void })),
  Flag.node.replace(Layer.succeed(Flag.Service, { enabled: () => Effect.succeed(false) })),
] });
await Effect.runPromise(Effect.gen(function* () {
  const registry = yield* Tool.Service, hooks = yield* PluginHooks.Service;
  yield* hooks.register('tool', 'execute.before', () => Effect.sync(() => { hookBefore++; }));
  yield* hooks.register('tool', 'execute.after', event => Effect.sync(() => {
    hookAfter++; assert.equal(event.id, 'call_native_fixture'); assert.equal(event.status, 'completed');
    assert.equal(event.result.output.selection.text, 'native result');
  }));
  // Exact supported seam: registry belongs to the matching native Location.
  yield* registerSupervisedFrontend({ client, binding: boot.binding, assertCurrent: (binding, ctx) => current && ctx.sessionID === binding.nativeSessionId });
  executor = (yield* registry.list())[0].execute;
  const snapshot = yield* registry.snapshot();
  assert.deepEqual(snapshot.definitions.map(x => x.name), [NATIVE_TOOL_NAME]);
  const result = yield* snapshot.execute({ ...context, call: { type: 'tool-call', id: 'call_native_fixture', name: NATIVE_TOOL_NAME, input: { documentId: 'document', expectedRevision: 1 } } });
  assert.equal(result.output.source, 'owner-frontend-selection');
  assert.equal(result.output.selection.text, 'native result');
  assert.equal(JSON.parse(result.content[0].text).selection.text, 'native result');
  current = false;
  const stale = yield* snapshot.execute({ ...context, call: { type: 'tool-call', id: 'stale', name: NATIVE_TOOL_NAME, input: { documentId: 'document', expectedRevision: 1 } } }).pipe(Effect.result);
  assert.equal(stale._tag, 'Failure');
}).pipe(Effect.scoped, Effect.provide(layer)));
assert.equal(hookBefore, 1); assert.equal(hookAfter, 1);
console.log(JSON.stringify({ nativeModule: 'PASS', registeredTool: NATIVE_TOOL_NAME, realContextCallId: 'call_native_fixture', nativeHooksBefore: hookBefore, nativeHooksAfter: hookAfter, originalExecutePromiseReturned: true, staleDispatchDenied: true, cliQualification: null, providerTurns: 0, externalRequests: 0 }));
await client.close(); process.stdin.destroy();
