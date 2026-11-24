import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture } from './office-agent-fixtures.test.mjs';
import { createOfficeAgentMcpHandler, loadOfficeAgentSecret, localEndpoint } from '../app/office/agent-mcp.mjs';
import { officeAgentStdioConfig } from '../app/office/agent-stdio.mjs';

async function endpointFixture(t, f) {
  let handler;
  const server = createServer(async (req, res) => { if (!await handler(req, res)) res.writeHead(404).end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/office-agent/mcp`;
  const { secret, secretFile } = await loadOfficeAgentSecret(f.dataDir);
  handler = await createOfficeAgentMcpHandler({ service: f.service, dataDir: f.dataDir, endpoint });
  t.after(async () => { await handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { endpoint, secret, secretFile };
}
async function clientFor(t, endpoint, secret) {
  const client = new Client({ name: 'official-sdk-engineering-fixture', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }));
  t.after(() => client.close()); return client;
}
const argsFor = input => { const { edit, ...args } = input; const { kind, ...values } = edit; return { ...args, ...values }; };
function rawRequest(endpoint, { method = 'POST', headers = {}, body = '{}' } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(endpoint, { method, headers: { 'Content-Type': 'application/json', ...headers } }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() })); });
    req.on('error', error => reject(new Error(`HTTP fixture error: ${error.code} (method=${method}, bodyLength=${body.length}, headerNames=${Object.keys(headers).join(',')})`))); req.end(method === 'GET' ? undefined : body);
  });
}

test('official SDK Streamable HTTP call queues rather than mutates; reconnect/status reconcile one saved effect', async t => {
  const f = await fixture(t), { endpoint, secret } = await endpointFixture(t, f), input = f.input();
  const a = await clientFor(t, endpoint, secret), tools = await a.listTools();
  assert.deepEqual(tools.tools.map(t => t.name), ['office.document.read', 'office.sheet.setValues', 'office.doc.insertText', 'office.request.status']);
  const queued = await a.callTool({ name: 'office.sheet.setValues', arguments: argsFor(input) });
  assert.equal(queued.isError, undefined); assert.equal(queued.structuredContent.request.status, 'pending'); assert.equal(f.store.read().documents[0].revision, 1);
  assert.equal((await a.callTool({ name: 'office.request.status', arguments: f.key(input) })).structuredContent.request.status, 'pending');
  const read = await a.callTool({ name: 'office.document.read', arguments: { ...f.scope, expectedRevision: 1, selection: { sheetId: 'second', range: 'A1:B1' } } });
  assert.equal(read.structuredContent.revision, 1);
  await a.close(); const b = await clientFor(t, endpoint, secret);
  assert.equal((await b.callTool({ name: 'office.sheet.setValues', arguments: argsFor(input) })).structuredContent.replayed, true);
  const { permit, lease } = await f.begin(input); let mountedFixtureMutations = 0;
  const after = f.editorSnapshotFixture(input); mountedFixtureMutations++;
  await f.saveWithProposedLeadReceiptFixture(permit, after);
  const completed = await b.callTool({ name: 'office.request.status', arguments: f.key(input) });
  assert.equal(completed.structuredContent.request.status, 'completed'); assert.equal(completed.structuredContent.request.receipt.operationId, input.operationId);
  assert.equal((await f.service.beginApply(f.editor(input, lease))).mayApply, false);
  assert.equal(mountedFixtureMutations, 1); assert.equal(f.store.read().officeAgent.requests.length, 1);
});

test('official SDK rejects unsupported tool/arguments, scope forgery and stale revisions truthfully', async t => {
  const f = await fixture(t, 'doc'), { endpoint, secret } = await endpointFixture(t, f), client = await clientFor(t, endpoint, secret), input = f.input();
  const badInputs = [
    { name: 'eval', arguments: { source: '1+1' } },
    { name: 'office.doc.insertText', arguments: { ...argsFor(input), source: 'js' } },
    { name: 'office.doc.insertText', arguments: { ...argsFor(input), index: '2' } },
    { name: 'office.doc.insertText', arguments: { ...argsFor(input), attemptId: 'wrong' } },
    { name: 'office.doc.insertText', arguments: { ...argsFor(input), expectedRevision: 2 } },
  ];
  for (const call of badInputs) { const result = await client.callTool(call); assert.equal(result.isError, true); assert.ok(result.structuredContent.error.code); }
  const result = await client.callTool({ name: 'office.doc.insertText', arguments: argsFor(input) }); assert.equal(result.structuredContent.request.status, 'pending');
  assert.equal(f.store.read().documents[0].revision, 1);
});

test('mount handler checks loopback Host, Origin and machine-local bearer before dispatch', async t => {
  const f = await fixture(t), { endpoint, secret } = await endpointFixture(t, f);
  const authorized = { Authorization: `Bearer ${secret}`, Accept: 'application/json, text/event-stream' };
  assert.equal((await rawRequest(endpoint)).status, 401);
  assert.equal((await rawRequest(endpoint, { headers: { ...authorized, Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await rawRequest(endpoint, { headers: { ...authorized, Host: 'evil.example' } })).status, 403);
  assert.equal((await rawRequest(endpoint, { headers: { ...authorized, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await rawRequest(endpoint, { headers: { ...authorized, Origin: 'null' } })).status, 403);
  assert.equal((await rawRequest(`${endpoint}?token=${secret}`, { headers: authorized })).status, 400);
  assert.equal((await rawRequest(endpoint, { headers: authorized, body: '[' })).status, 400);
  assert.equal((await rawRequest(endpoint, { headers: authorized, body: '[]' })).status, 400);
  assert.equal((await rawRequest(endpoint, { headers: authorized, method: 'GET' })).status, 405);
  assert.equal((await rawRequest(endpoint, { headers: authorized, body: 'x'.repeat(65537) })).status, 413);
  assert.equal((await rawRequest(endpoint, { headers: { ...authorized, 'Transfer-Encoding': 'chunked' }, body: 'x'.repeat(65537) })).status, 413);
  assert.equal((await rawRequest(endpoint, { headers: { ...authorized, 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal(JSON.stringify(f.store.read()).includes(secret), false);
  const again = await loadOfficeAgentSecret(f.dataDir); assert.equal(again.secret, secret);
  assert.equal(f.store.read().officeAgent?.requests.length ?? 0, 0);
  for (const value of ['https://example.com/mcp', 'http://user:pass@localhost/mcp', 'http://localhost/mcp?token=x', 'http://192.168.0.1/mcp']) assert.throws(() => localEndpoint(value));
});

test('real spawned stdio SDK bridge uses env references, queues and reconnects without effect replay', async t => {
  const f = await fixture(t, 'doc'), { endpoint, secret, secretFile } = await endpointFixture(t, f), input = f.input();
  const config = officeAgentStdioConfig({ endpointEnv: 'FIXTURE_OFFICE_URL', secretFileEnv: 'FIXTURE_OFFICE_SECRET_FILE' });
  assert.ok(!JSON.stringify(config).includes(secret)); assert.ok(!JSON.stringify(config).includes(endpoint));
  assert.throws(() => officeAgentStdioConfig({ endpointEnv: 'a bad name' }));
  const connect = async () => {
    const client = new Client({ name: 'stdio-test-fixture', version: '1' }, { capabilities: {} });
    const transport = new StdioClientTransport({ ...config, env: { ...process.env, FIXTURE_OFFICE_URL: endpoint, FIXTURE_OFFICE_SECRET_FILE: secretFile }, stderr: 'pipe' });
    let stderr = ''; transport.stderr?.on('data', bytes => { stderr += bytes.toString(); });
    await client.connect(transport, { timeout: 10000 }); t.after(() => client.close());
    return { client, stderr: () => stderr };
  };
  const a = await connect(); assert.equal((await a.client.listTools()).tools.length, 4);
  assert.equal((await a.client.callTool({ name: 'office.doc.insertText', arguments: argsFor(input) })).structuredContent.request.status, 'pending');
  await a.client.close(); const b = await connect();
  const result = await b.client.callTool({ name: 'office.doc.insertText', arguments: argsFor(input) });
  assert.equal(result.structuredContent.replayed, true); assert.equal(result.structuredContent.request.status, 'pending');
  assert.equal(f.store.read().officeAgent.requests.length, 1); assert.equal(f.store.read().documents[0].revision, 1);
  assert.ok(!a.stderr().includes(secret)); assert.ok(!b.stderr().includes(secret));
  assert.equal((await readFile(secretFile, 'utf8')).trim(), secret);
});
