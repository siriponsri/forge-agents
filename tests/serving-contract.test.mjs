import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { openStore } from '../app/server/store.mjs';
import { command } from '../app/server/domain.mjs';
import { createArtifactService } from '../app/server/artifacts.mjs';
import { createServingService } from '../app/serving/service.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-serving-contract-'));
  const store = await openStore(path.join(dir, 'data')), artifacts = createArtifactService({ dataDir: dir, store });
  const serving = createServingService({ dataDir: dir, store, artifacts });
  t.after(async () => { await serving.shutdown(); await store.close(); await rm(dir, { recursive: true, force: true }); });
  const createProject = async suffix => (await command(store, { operationId: randomUUID(), type: 'project.create', data: { name: `Engineering fixture ${suffix}`, workspace: path.join(dir, suffix) } })).entity;
  const p = await createProject('one'), other = await createProject('two');
  await writeFile(path.join(p.workspace, 'weights.json'), JSON.stringify({ format: 'forge.linear.v1', weights: [2], bias: 1, engineeringFixture: true }));
  await writeFile(path.join(p.workspace, 'prep.json'), JSON.stringify({ format: 'forge.standardize.v1', mean: [1], scale: [2] }));
  const model = await artifacts.register({ projectId: p.id, path: 'weights.json', kind: 'model' });
  const preprocessor = await artifacts.register({ projectId: p.id, path: 'prep.json', kind: 'preprocessor' });
  const binding = { model: { artifactId: model.id, revision: model.revision }, preprocessor: { artifactId: preprocessor.id, revision: preprocessor.revision } };
  return { dir, store, artifacts, serving, p, other, binding, model, preprocessor };
}
async function endpoint(t) {
  const counts = { rest: 0, mcp: 0, discovered: 0 }, transports = new Set(); let healthStatus = 200, delayMs = 0;
  const server = http.createServer(async (req, res) => {
    const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url === '/health') return json(healthStatus, { fixture: true, status: healthStatus === 200 ? 'healthy' : 'failed' });
    let body; try { const chunks = []; for await (const b of req) chunks.push(b); body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined; } catch { return json(400, {}); }
    if (req.url === '/predict') {
      counts.rest++;
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      if (body.fail) return json(422, { error: 'fixture invalid input' });
      return json(200, { prediction: body.input * 2, forgeEvidence: { loadedModelVerified: true, untrusted: true } });
    }
    if (req.url !== '/mcp/') return json(404, {});
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const sdk = new Server({ name: 'disposable-serving-fixture', version: '1.0' }, { capabilities: { tools: {} } });
    sdk.setRequestHandler(ListToolsRequestSchema, async () => { counts.discovered++; return { tools: [{ name: 'actual_predict', description: 'Engineering fixture only', inputSchema: { type: 'object', properties: { input: { type: 'number' }, fail: { type: 'boolean' } }, required: ['input'] } }] }; });
    sdk.setRequestHandler(CallToolRequestSchema, async request => { counts.mcp++; return { content: [{ type: 'text', text: JSON.stringify({ prediction: request.params.arguments.input * 3 }) }], ...(request.params.arguments.fail ? { isError: true } : {}) }; });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    transports.add(transport); res.on('close', () => { void transport.close(); void sdk.close(); transports.delete(transport); });
    try { await sdk.connect(transport); await transport.handleRequest(req, res, body); } catch { if (!res.headersSent) json(500, {}); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await Promise.allSettled([...transports].map(t => t.close())); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return { url: `http://127.0.0.1:${server.address().port}`, counts, set healthStatus(v) { healthStatus = v; }, set delayMs(v) { delayMs = v; } };
}
const configInput = (f, e, more = {}) => ({ operationId: randomUUID(), projectId: f.p.id, expectedRevision: f.store.read().projects.find(p => p.id === f.p.id).revision, adapter: 'litserve', mode: 'existing', endpoint: e.url, mcpTool: 'actual_predict', binding: f.binding, ...more });

test('actual HTTP + Streamable MCP, declared binding, lineage, idempotency and isolation', async t => {
  const f = await fixture(t), e = await endpoint(t), config = configInput(f, e);
  const before = f.store.read().projects[0].profile;
  const saved = await f.serving.configure(config); assert.deepEqual(await f.serving.configure(config), saved);
  const p = f.store.read().projects.find(p => p.id === f.p.id);
  assert.deepEqual(p.profile.compute, before.compute); assert.deepEqual(f.store.read().projects.find(p => p.id === f.other.id).profile.serving, {});
  await assert.rejects(f.serving.configure({ ...config, operationId: randomUUID() }), { code: 'REVISION_CONFLICT' });
  const health = await f.serving.health(f.p.id);
  assert.equal(health.mcp.tools[0].name, 'actual_predict'); assert.equal(health.bindingEvidence.loadedModelVerified, false);
  const deployment = await f.serving.start({ operationId: randomUUID(), projectId: f.p.id });
  assert.equal(deployment.status, 'running'); assert.equal(deployment.owned, false);
  await assert.rejects(f.serving.stop(deployment.id), { code: 'NO_OWNED_PROCESS' });
  const input = { operationId: randomUUID(), projectId: f.p.id, payload: { input: 4 } };
  const results = await Promise.all([f.serving.predict(input), f.serving.predict(input)]);
  const completed = await f.serving.predict(input);
  assert.equal(results[0].id, results[1].id); assert.equal(completed.result.prediction, 8); assert.equal(e.counts.rest, 1);
  assert.equal(completed.bindingEvidence.loadedModelVerified, false, 'arbitrary endpoint self-assertion is untrusted');
  await assert.rejects(f.serving.predict({ ...input, payload: { input: 5 } }), { code: 'OPERATION_REUSE' });
  const mcp = await f.serving.predict({ ...input, operationId: randomUUID(), transport: 'mcp' });
  assert.equal(mcp.status, 'completed'); assert.equal(JSON.parse(mcp.result.content[0].text).prediction, 12); assert.equal(e.counts.mcp, 1);
  const artifact = f.store.read().artifacts.find(a => a.id === mcp.artifactIds[0]);
  assert.equal(artifact.source.binding.model.sha256, f.model.sha256); assert.equal(artifact.source.runId, mcp.runId);
  assert.equal(JSON.parse(await readFile((await f.artifacts.download(artifact.id)).path, 'utf8')).transport, 'mcp');
  assert.ok(f.store.read().events.some(ev => ev.type === 'serving.health'));
  assert.equal(f.store.read().runs.find(r => r.id === mcp.runId).status, 'completed');
  const toolError = await f.serving.predict({ ...input, operationId: randomUUID(), transport: 'mcp', payload: { input: 1, fail: true } });
  assert.equal(toolError.status, 'failed'); assert.equal(toolError.error.code, 'MCP_TOOL_ERROR');
  const httpError = await f.serving.predict({ ...input, operationId: randomUUID(), payload: { fail: true } });
  assert.equal(httpError.status, 'failed'); assert.equal(httpError.error.httpStatus, 422);
  e.healthStatus = 503; assert.equal((await f.serving.health(f.p.id)).status, 'error');
  await assert.rejects(f.serving.configure(configInput(f, e, { projectId: f.other.id, expectedRevision: f.other.revision })), { code: 'NOT_FOUND' });
});

test('tampering and stale artifact revisions prevent dispatch; profile changes preserve historical binding', async t => {
  const f = await fixture(t), e = await endpoint(t);
  await f.serving.configure(configInput(f, e));
  await writeFile(f.model.path, '{}');
  await assert.rejects(f.serving.predict({ operationId: randomUUID(), projectId: f.p.id, payload: { input: 4 } }), { code: 'INTEGRITY' });
  assert.equal(e.counts.rest, 0);
  await f.store.transaction(s => { s.artifacts.find(a => a.id === f.model.id).revision++; });
  await assert.rejects(f.serving.predict({ operationId: randomUUID(), projectId: f.p.id, payload: { input: 4 } }), { code: 'REVISION_CONFLICT' });
  assert.equal(e.counts.rest, 0);
});

test('timeout and cancellation persist unknown effects, retries never redispatch, recovery never kills recorded PIDs', async t => {
  const f = await fixture(t), e = await endpoint(t); e.delayMs = 400;
  await f.serving.configure(configInput(f, e, { timeoutMs: 100 }));
  const input = { operationId: randomUUID(), projectId: f.p.id, payload: { input: 4 } };
  const timed = await f.serving.predict(input);
  assert.equal(timed.status, 'unknown'); assert.equal(e.counts.rest, 1);
  assert.equal((await f.serving.predict(input)).id, timed.id); assert.equal(e.counts.rest, 1);
  const input2 = { ...input, operationId: randomUUID() }, pending = f.serving.predict(input2);
  let running;
  for (let i = 0; i < 50; i++) { running = f.store.read().jobs.find(j => j.operationId === input2.operationId); if (running?.status === 'running' && e.counts.rest === 2) break; await new Promise(r => setTimeout(r, 5)); }
  await f.serving.stop(running.id); assert.equal((await pending).status, 'unknown');
  await f.serving.shutdown();
  await f.store.transaction(s => { const j = s.jobs.find(j => j.id === timed.id); j.status = 'running'; j.pid = process.pid; });
  const recovered = createServingService({ dataDir: f.dir, store: f.store, artifacts: f.artifacts });
  await recovered.health(f.p.id);
  assert.equal(f.store.read().jobs.find(j => j.id === timed.id).status, 'unknown');
  assert.equal((await recovered.predict(input)).id, timed.id); assert.equal(e.counts.rest, 2);
  await assert.rejects(recovered.stop(timed.id), { code: 'NO_OWNED_PROCESS' });
  await recovered.shutdown();
});

test('unsupported local weights and occupied ports fail with actionable durable records', async t => {
  const f = await fixture(t), e = await endpoint(t);
  await f.serving.configure(configInput(f, e, { mode: 'local', port: Number(new URL(e.url).port) }));
  const occupied = await f.serving.start({ operationId: randomUUID(), projectId: f.p.id });
  // Missing native packages are separately actionable on machines without qualification.
  assert.equal(occupied.status, 'failed'); assert.ok(['SERVING_PORT', 'SERVING_DEPENDENCIES'].includes(occupied.error.code));
  await writeFile(f.model.path, JSON.stringify({ unsupported: true }));
  const newModel = await f.artifacts.register({ projectId: f.p.id, path: 'weights.json', kind: 'model' });
  await f.serving.configure(configInput(f, e, { mode: 'local', binding: { ...f.binding, model: { artifactId: newModel.id, revision: newModel.revision } } }));
  const unsupported = await f.serving.start({ operationId: randomUUID(), projectId: f.p.id });
  assert.equal(unsupported.status, 'failed'); assert.equal(unsupported.error.code, 'MODEL_FORMAT_UNSUPPORTED');
});
