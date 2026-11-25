// Full NEW compiled CLI + matching compiled T3 private adapter, loopback model.
// No account, installed runtime, external turn, spend or prototype activation.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../../app/server/store.mjs';
import { createLocalAuthority } from '../../app/server/authority.mjs';
import { createFrontendToolBroker } from '../../app/frontend-tools/broker.mjs';
import { openFrontendNativeGateway } from '../../app/frontend-tools/native-gateway.mjs';
import { FRONTEND_TOOL } from '../../app/frontend-tools/contract.mjs';
import { digest } from '../../app/guarded-runtime/profile.mjs';
import { extendT3HostSource } from '../../app/frontend-tools/root-host-tools.mjs';
import { openLocalGateway } from '../../app/guarded-runtime/local-gateway.mjs';
import { boundedToolSchemas } from '../../app/guarded-runtime/transport.mjs';

const generation = path.resolve(process.argv[2]), meta = JSON.parse(await readFile(path.join(generation, 'generation.json'), 'utf8'));
const guardDefault = process.argv.includes('--guarded-stop');
if (meta.root !== generation || !path.basename(generation).startsWith('forge-frontend-generation-')) throw Error('NEW_GENERATION_REQUIRED');
for (const name of ['t3', 'opencode']) if (JSON.parse(await readFile(path.join(generation, name + '-frontend-build.json'), 'utf8')).exitCode !== 0) throw Error('SUCCESSFUL_NEW_BUILD_REQUIRED');
const root = await mkdtemp(path.join(os.tmpdir(), 'forge-frontend-cli-')), home = path.join(root, 'home'), cwd = path.join(root, 'runtime');
await mkdir(home); await mkdir(cwd);
await writeFile(path.join(cwd, 'AGENTS.md'), 'UNAPPROVED_FRONTEND_CONTEXT_SENTINEL');
await writeFile(path.join(cwd, 'opencode.json'), '{"mcp":{"evil":{"command":["shell"]}}}');
const store = await openStore(root), authority = createLocalAuthority(), owner = authority.owner({ expiresAt: Date.now() + 120000 });
const password = randomBytes(32).toString('hex');
const binary = path.join(generation, 'opencode/forge-frontend-cli-build/cli-windows-x64/bin/opencode.exe');
const binaryHash = createHash('sha256').update(await readFile(binary)).digest('hex');
let profile = { runId: 'run' }, currentThread, currentTurn, driver, native, stopped = false, events = [], calls = 0, requests = [], nativeLogs = '', driverLogs = '';
const live = () => { if (stopped || !profile || Date.now() >= profile.expiresAt) throw Error('FRONTEND_CURRENT_DENIED'); };
const binding = () => {
  live(); if (!currentThread?.nativeThreadRef?.nativeId || !currentTurn?.nativeTurnRef?.nativeId || currentTurn.runAttemptId !== 'attempt' || currentTurn.nodeId !== 'node' || currentTurn.providerThreadId !== currentThread.id) throw Error('FRONTEND_NATIVE_NOT_OBSERVED');
  return { projectId: 'project', runId: 'run', attemptId: 'attempt', identityKind: 'private-adapter', threadId: 'thread', rootNodeId: 'node', providerThreadId: currentThread.id, providerTurnId: currentTurn.id, nativeThreadRef: currentThread.nativeThreadRef, nativeTurnRef: currentTurn.nativeTurnRef, nativeSessionId: currentThread.nativeThreadRef.nativeId, nativeTurnId: currentTurn.nativeTurnRef.nativeId, documentId: 'document', documentRevision: 1 };
};
await store.transaction(s => { s.projects.push({ id: 'project', workspace: root }); s.documents.push({ id: 'document', projectId: 'project', kind: 'doc', revision: 1 }); s.runs.push({ id: 'run', projectId: 'project', attemptId: 'attempt', threadId: 'thread', rootNodeId: 'node', status: 'running', revision: 1 }); });
const broker = createFrontendToolBroker({ store, authorizeOwner: authority.goalAuthorize, authorizeNativeBinding: b => { try { return digest(b) === digest(binding()); } catch { return false; } } }); await broker.recover();
const steps = [['shell', { command: 'MUST_NOT_EXECUTE' }], ['unknown_future', {}], ['execute', { code: 'MUST_NOT_EXECUTE' }], ['task', { prompt: 'MUST_NOT_EXECUTE' }], ['forge_frontend_selection_read_alias', { documentId: 'document', expectedRevision: 1 }], ['alternate_selection_read', { documentId: 'document', expectedRevision: 1 }], ['forge_guarded_read_text', { path: 'AGENTS.md' }], ['forge_frontend_selection_read', { documentId: 'document', expectedRevision: 1 }]];
const model = createServer(async (req, res) => {
  let raw = ''; for await (const b of req) raw += b;
  const body = JSON.parse(raw); requests.push(body); const index = calls++;
  if (guardDefault) return; // actual native model request held for real Stop
  const step = steps[index];
  const delta = step ? { role: 'assistant', tool_calls: [{ index: 0, id: 'native_protocol_call_' + index, type: 'function', function: { name: step[0], arguments: JSON.stringify(step[1]) } }] } : { role: 'assistant', content: 'frontend fixture complete' };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end('data: ' + JSON.stringify({ id: 'chatcmpl_frontend', object: 'chat.completion.chunk', created: 1, model: 'forge-fixture', choices: [{ index: 0, delta, finish_reason: step ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } }) + '\n\ndata: [DONE]\n\n');
}); await new Promise(r => model.listen(0, '127.0.0.1', r));
const ownerHeaders = { 'x-fixture-owner': 'opaque-owner-session', 'x-fixture-csrf': 'same-origin', 'Content-Type': 'application/json' };
const defaultKey = randomBytes(32);
const defaultGateway = guardDefault ? await openLocalGateway({ authority: { assert() { live(); return profile; } }, handle: {}, key: defaultKey, broker: { receive() { throw Error('NO_FILE_ACTION_IN_STOP_FIXTURE'); } }, withFence: (_runId, fn) => fn(), nativeSessionId: () => currentThread?.nativeThreadRef?.nativeId }) : null;
const gateway = defaultGateway ? { ...defaultGateway, bootstrap: () => ({ key: defaultKey.toString('hex'), brokerUrl: defaultGateway.url }) } : await openFrontendNativeGateway({ broker, assertCurrent: () => { live(); return profile; }, bindingProvider: () => binding(), authorizePhase: body => { live(); return body.sessionID === null || body.sessionID === currentThread?.nativeThreadRef?.nativeId; }, authenticateOwner: req => req.headers['x-fixture-owner'] === ownerHeaders['x-fixture-owner'] && req.headers['x-fixture-csrf'] === 'same-origin' ? owner : null });
const gatewayUrl = gateway.url;
const provider = { id: 'openai', model: 'forge-fixture', compatibility: { streamUsage: true }, settings: { baseURL: `http://127.0.0.1:${model.address().port}/v1`, apiKey: 'fixture-no-account', transport: 'http' } };
const toolManifest = guardDefault ? boundedToolSchemas.map(t => ({ operation: t.name, rawName: 'forge_guarded_' + t.name, schemaDigest: digest(t.inputSchema) })) : [{ operation: 'selection_read', rawName: 'forge_frontend_selection_read', schemaDigest: digest(FRONTEND_TOOL.inputSchema) }];
profile = { version: 1, ...(guardDefault ? {} : { purpose: 'supervised-frontend-v1' }), projectId: 'project', taskId: 'task', runId: 'run', threadId: 'thread', route: { providerInstanceId: 'fixture', apiProviderId: 'openai', modelId: 'openai/forge-fixture', options: [{ id: 'variant', value: 'default' }], opencodeBinarySha256: binaryHash }, expiresAt: Date.now() + 120000, manifestDigest: digest(toolManifest), contextDigest: digest({ provider, runtimeDirectory: cwd, toolManifest }), toolGeneration: guardDefault ? 'guarded-v1' : 'frontend-v1', policyGeneration: '1' };
const { key: token } = gateway.bootstrap();
const env = { SystemRoot: process.env.SystemRoot, TEMP: home, TMP: home, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home, FORGE_GUARDED_BOOTSTRAP_FD: '3', OPENCODE_PASSWORD: password, OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FILEWATCHER: '1', OPENCODE_DISABLE_FFF: '1' };
try {
  native = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  native.stdout.on('data', b => { nativeLogs += b; }); native.stderr.on('data', b => { nativeLogs += b; });
  native.stdio[3].end(JSON.stringify({ version: 1, profile, key: token, brokerUrl: gatewayUrl, provider, runtimeDirectory: cwd, toolManifest }));
  let url;
  for (let n = 0; n < 300; n++) { url = nativeLogs.match(/http:\/\/127\.0\.0\.1:[0-9]+/)?.[0]; if (url || native.exitCode !== null) break; await new Promise(r => setTimeout(r, 50)); }
  if (!url) throw Error('CLI_START_FAILED ' + nativeLogs.slice(-2000));
  const driverPath = path.join(generation, 't3/packages/provider-opencode/forge-frontend-driver.ts'); await copyFile(fileURLToPath(new URL('./t3-cli-driver.ts', import.meta.url)), driverPath);
  const sharedHost = new URL('../../app/guarded-runtime/t3-host.mjs', import.meta.url);
  const stagedHost = path.join(root, 'purpose-separated-root-host.mjs');
  await writeFile(stagedHost, extendT3HostSource(await readFile(sharedHost, 'utf8')).replace("'./profile.mjs'", JSON.stringify(new URL('../../app/guarded-runtime/profile.mjs', import.meta.url).href)));
  driver = spawn(process.execPath, [driverPath], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
  const done = new Promise(r => driver.once('close', r));
  driver.stderr.on('data', b => { driverLogs += b; });
  driver.stdio[3].end(JSON.stringify({ nativeEntry: path.join(generation, 't3/apps/server/dist/forge-guarded-host.mjs'), hostModule: stagedHost, binary, url, password, cwd, profile, guardDefault }));
  const lines = createInterface({ input: driver.stdout }); let pendingWrites = Promise.resolve();
  lines.on('line', line => {
    try {
      const value = JSON.parse(line); events.push(value);
      if (value.kind === 'thread') {
        currentThread = value.thread;
        pendingWrites = pendingWrites.then(() => store.transaction(s => { Object.assign(s.runs[0], { nativeProviderThreadId: currentThread.id, nativeThreadRef: currentThread.nativeThreadRef }); })).then(() => guardDefault ? driver.stdin.write('mapped\n') : driver.stdin.end('mapped\n'));
      }
      if (value.kind === 'native' && value.event.type === 'provider_turn.updated') {
        currentTurn = value.event.providerTurn;
        const observed = structuredClone(currentTurn);
        pendingWrites = pendingWrites.then(() => store.transaction(s => { Object.assign(s.runs[0], { nativeProviderTurnId: observed.id, nativeTurnRef: observed.nativeTurnRef }); }));
      }
    } catch { driverLogs += line + '\n'; }
  });
  if (guardDefault) {
    for (let n = 0; n < 1200 && (!calls || !currentTurn?.id); n++) { if (driver.exitCode !== null) break; await new Promise(r => setTimeout(r, 25)); }
    assert.equal(calls, 1, driverLogs);
    await pendingWrites;
    await store.transaction(s => { s.runs[0].stopRequest = { status: 'requested', source: 'actual-t3-native-fixture' }; });
    stopped = true; driver.stdin.end('stop\n');
    const timeout = setTimeout(() => driver.kill(), 20000); const exit = await done; clearTimeout(timeout);
    assert.equal(exit, 0, driverLogs); assert.equal(events.find(x => x.kind === 'done')?.status, 'interrupted');
    assert.deepEqual(requests[0].tools.map(x => x.function.name).sort(), ['forge_guarded_edit_text', 'forge_guarded_propose_change', 'forge_guarded_read_text']);
    assert.equal(store.read().receipts.filter(r => r.type === 'frontend-tools.result').length, 0);
    const evidence = { version: 1, scope: 'actual NEW compiled CLI/default Guarded profile + matching T3 private adapter Stop during held deterministic model request', cliBinarySha256: binaryHash, actualT3Stop: 'PASS', actualTerminal: 'interrupted', modelRequests: calls, advertisedTools: requests[0].tools.map(x => x.function.name).sort(), frontendGrants: 0, nativeThreadRef: currentThread.nativeThreadRef, nativeTurnRef: currentTurn.nativeTurnRef, proof: null, externalRequests: 0 };
    await writeFile(path.join(root, 'sanitized-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ ...evidence, evidencePath: path.join(root, 'sanitized-evidence.json') }, null, 2));
  } else {
  let pending;
  for (let n = 0; n < 1200; n++) { pending = broker.state({ projectId: 'project', runId: 'run', attemptId: 'attempt' }, owner).calls.find(r => r.status === 'pending'); if (pending || driver.exitCode !== null) break; await new Promise(r => setTimeout(r, 25)); }
  if (!pending) throw Error('CLI_FRONTEND_PENDING_NOT_REACHED ' + driverLogs.slice(-4000) + nativeLogs.slice(-1500));
  assert.equal(calls, steps.length, 'native model turn must remain held until Owner result');
  assert.equal(pending.native.callId, 'native_protocol_call_' + (steps.length - 1));
  const result = { status: 'ok', documentId: 'document', revision: 1, selection: { start: 0, end: 18, text: 'full native result' } };
  const input = { projectId: 'project', runId: 'run', attemptId: 'attempt', pendingId: pending.pendingId, operationId: 'owner-cli-result', result };
  const response = await fetch(gatewayUrl + '/api/frontend-tools/result', { method: 'POST', headers: ownerHeaders, body: JSON.stringify(input) }); assert.equal(response.status, 200, await response.text());
  const timeout = setTimeout(() => driver.kill(), 30000); const exit = await done; clearTimeout(timeout); await pendingWrites;
  if (exit !== 0) throw Error('T3_DRIVER_FAILED ' + driverLogs.slice(-4000));
  assert.equal(calls, steps.length + 1);
  const modelTool = requests.at(-1).messages.find(m => m.role === 'tool' && m.tool_call_id === pending.native.callId);
  assert.ok(modelTool); assert.equal(JSON.parse(modelTool.content).selection.text, 'full native result');
  for (let n = 0; n < steps.length - 1; n++) assert.equal(JSON.parse(requests.at(-1).messages.find(m => m.role === 'tool' && m.tool_call_id === 'native_protocol_call_' + n).content).error.message, 'FORGE_NATIVE_ACTION_DENIED');
  assert.deepEqual(requests[0].tools.map(t => t.function.name), ['forge_frontend_selection_read']);
  assert.equal(JSON.stringify(requests).includes('UNAPPROVED_FRONTEND_CONTEXT_SENTINEL'), false);
  assert.equal(JSON.stringify(requests).includes(token), false);
  assert.equal(store.read().runs[0].providerRunId, undefined);
  const observedTool = events.filter(x => x.kind === 'native' && x.event.type === 'turn_item.updated').map(x => x.event.item ?? x.event.turnItem).find(x => x?.output && JSON.stringify(x.output).includes('full native result'));
  const t3Files = (await readdir(path.join(generation, 't3/apps/server/dist'))).filter(n => n.endsWith('.mjs')).sort();
  const t3BundleSha256 = digest(await Promise.all(t3Files.map(async name => ({ name, sha256: createHash('sha256').update(await readFile(path.join(generation, 't3/apps/server/dist', name))).digest('hex') }))));
  const evidence = { version: 1, observedAt: new Date().toISOString(), scope: 'actual NEW compiled CLI and matching compiled T3 private adapter, deterministic loopback model; no external account', node: process.version, cliBinarySha256: binaryHash, t3BundleSha256, actualCompiledCli: 'PASS', actualT3Attachment: 'PASS', modelProtocolRequests: calls, advertisedTools: requests[0].tools.map(t => t.function.name), modelObservedToolRoleResult: true, actualNativeCallId: pending.native.callId, nativeThreadRef: currentThread.nativeThreadRef, nativeTurnRef: currentTurn.nativeTurnRef, nativeProviderThreadId: currentThread.id, nativeProviderTurnId: currentTurn.id, inventedProviderRunId: false, nativeResultObservation: Boolean(observedTool), ownerResultReceipts: store.read().receipts.filter(r => r.type === 'frontend-tools.result').length, nativeTerminal: events.find(x => x.kind === 'done')?.status, deniedTools: steps.slice(0, -1).map(x => x[0]), externalRequests: 0, proof: null, homeUat: 'NOT_RUN' };
  await writeFile(path.join(root, 'sanitized-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...evidence, evidencePath: path.join(root, 'sanitized-evidence.json') }, null, 2));
  }
} finally {
  stopped = true; await gateway.close(); await broker.close(); defaultKey.fill(0); if (driver?.exitCode === null) driver.kill(); if (native?.exitCode === null) native.kill();
  model.closeAllConnections(); await new Promise(r => model.close(r));
  await writeFile(path.join(root, 'native.log'), nativeLogs); await writeFile(path.join(root, 'driver.log'), driverLogs); await store.close();
  await writeFile(path.join(root, 'fixture-debug.json'), JSON.stringify({ calls, events, requestMessages: requests.map(r => r.messages), driverExit: driver?.exitCode }, null, 2));
}
