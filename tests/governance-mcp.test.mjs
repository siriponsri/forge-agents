import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openStore } from '../app/server/store.mjs';
import { createMcpService } from '../app/providers/mcp.mjs';
import { createGovernanceService } from '../app/governance/service.mjs';

// Disposable local engineering fixture. This is a real SDK stdio server and a
// real filesystem effect ledger, not qualification of a live remote account.
const sdk = part => pathToFileURL(path.resolve(`node_modules/@modelcontextprotocol/sdk/dist/esm/${part}`)).href;
const actor = { kind: 'human', id: 'local-fixture-user' };
async function harness(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-governance-MCP-effect-')), ledger = path.join(dir, 'effects.jsonl');
  let store = await openStore(dir), governance = createGovernanceService({ store }), mcp = createMcpService({ store, authorizeTool: governance.authorizeTool, timeoutMs: 1500 });
  const script = `
    import { appendFile } from 'node:fs/promises';
    import { Server } from ${JSON.stringify(sdk('server/index.js'))};
    import { StdioServerTransport } from ${JSON.stringify(sdk('server/stdio.js'))};
    import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(sdk('types.js'))};
    const server = new Server({name:'labelled-governance-effect-fixture',version:'1.0.0'}, {capabilities:{tools:{}}});
    server.setRequestHandler(ListToolsRequestSchema, async()=>({tools:['write','uncertain'].map(name=>({name,inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}))}));
    server.setRequestHandler(CallToolRequestSchema, async request=>{
      await appendFile(${JSON.stringify(ledger)},JSON.stringify(request.params)+'\\n');
      if(request.params.name==='uncertain')await new Promise(resolve=>setTimeout(resolve,5000));
      return {content:[{type:'text',text:'fixture effect recorded'}]};
    });
    await server.connect(new StdioServerTransport());
  `.replace(/\r?\n/g, ' ');
  await store.transaction(s => s.projects.push({ id: 'fixture-project' }));
  const c = await mcp.configure({ operationId: 'setup', projectId: 'fixture-project', route: 'stdio', command: process.execPath, args: ['--input-type=module', '-e', script] });
  const scope = { projectId: 'fixture-project', connectionId: c.id };
  assert.equal((await mcp.discover(scope)).status, 'ready');
  await governance.configurePolicy({ ...scope, operationId: 'policy', expectedRevision: 0, mode: 'ask', actor });
  t.after(async () => { await mcp.close(); await store.close(); await rm(dir, { recursive: true, force: true }); });
  return {
    scope, get mcp() { return mcp; }, get governance() { return governance; }, get store() { return store; },
    async effects() { return (await readFile(ledger, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; })).trim().split('\n').filter(Boolean).map(JSON.parse); },
    async reopen() { await mcp.close(); await store.close(); store = await openStore(dir); governance = createGovernanceService({ store }); mcp = createMcpService({ store, authorizeTool: governance.authorizeTool, timeoutMs: 1500 }); },
  };
}
async function approve(h, input) {
  const a = await h.governance.requestTool(input);
  return h.governance.decideTool({ projectId: input.projectId, operationId: `decision-${input.operationId}`, approvalId: a.id, expectedRevision: a.revision, decision: 'approved', actor });
}

test('real MCP boundary asks before effects, accepts exact GUI Run approval once and cannot duplicate effects on concurrency/reload', async t => {
  const h = await harness(t), input = { ...h.scope, operationId: 'effect-once', name: 'write', arguments: { value: 'reviewed concrete fixture value' } };
  await assert.rejects(h.mcp.call(input), { code: 'TOOL_DENIED' });
  assert.equal((await h.effects()).length, 0);
  await approve(h, input);
  const calls = await Promise.allSettled([h.mcp.call(input), h.mcp.call(input)]);
  const successes = calls.filter(r => r.status === 'fulfilled'); assert.ok(successes.length >= 1);
  assert.equal(successes[0].value.status, 'completed');
  assert.equal((await h.effects()).length, 1);
  assert.equal((await h.mcp.call(input)).id, successes[0].value.id);
  await h.reopen();
  assert.equal((await h.mcp.call(input)).id, successes[0].value.id);
  assert.equal((await h.effects()).length, 1);
  await assert.rejects(h.mcp.call({ ...input, arguments: { value: 'changed after approval' } }), { code: 'OPERATION_REUSE' });
  assert.equal(h.store.read().events.filter(e => e.type === 'mcp.call').length, 1);
});

test('real remote fixture effect followed by response uncertainty stays unknown and is never redispatched on restart', async t => {
  const h = await harness(t), input = { ...h.scope, operationId: 'response-lost', name: 'uncertain', arguments: { value: 'effect before timeout' } };
  await approve(h, input);
  const result = await h.mcp.call(input);
  assert.equal(result.status, 'unknown'); assert.equal((await h.effects()).length, 1);
  assert.equal((await h.mcp.call(input)).id, result.id);
  await h.reopen(); await h.mcp.recover(); await h.governance.recover();
  assert.equal((await h.mcp.call(input)).status, 'unknown');
  assert.equal((await h.effects()).length, 1);
  assert.equal(await h.governance.authorizeTool(input), false);
});
