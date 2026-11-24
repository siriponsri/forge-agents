// Labelled browser CONTRACT HARNESS. This is not the mounted FORGE application
// or live-provider/OAuth qualification. Actual SQLite, provider configuration,
// catalog/selection, governance and SDK stdio MCP services run below. Only T3
// management/catalog and OAuth HTTP responses are deterministic fixture seams.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, transformWithEsbuild } from 'vite';
import { chromium } from 'playwright';
import { openStore } from '../../server/store.mjs';
import { createProviderService } from '../../providers/service.mjs';
import { createGovernanceService } from '../../governance/service.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'forge-provider-gui-contract-'));
const store = await openStore(path.join(temp, 'state')), governance = createGovernanceService({ store });
await store.transaction(s => s.projects.push(...['project-a', 'project-b'].map(id => ({ id, revision: 1, name: `Disposable ${id}`, profile: {} }))));
const instances = [], requests = [], rpcCalls = [];
let catalogFails = false, signinPhase = 'awaiting-authorization', oauthState = 'not-configured', staleDecision = false;
const t3 = {
  providers: { async rpc(tag, input) {
    rpcCalls.push({ tag, input });
    if (tag === 'server.updateSettings') { instances.push({ ...input.providerInstanceMutation.instance, providerInstanceId: input.providerInstanceMutation.instanceId }); return {}; }
    if (tag === 'server.refreshProviders') return { providers: instances.map(p => ({ instanceId: p.providerInstanceId, driver: p.driver, installed: true, enabled: true, auth: { status: 'fixture-account' }, status: 'ready', version: '2.0.0', setup: { canInstall: true, canAuthenticate: true } })) };
    if (tag === 'provider.auth.start' && input.methodId === 'native') return { phase: 'waiting', flowId: 'fixture-native', interaction: { type: 'terminal' } };
    if (tag.startsWith('provider.auth.')) return { phase: signinPhase, flowId: 'fixture-signin', methods: [{ id: 'device', name: 'Fixture device flow', type: 'deviceCode' }, { id: 'native', name: 'Fixture terminal flow', type: 'terminal' }], interaction: { type: 'deviceCode', id: 'fixture-interaction', url: 'https://example.invalid/fixture-signin', userCode: 'FIXTURE-ONLY', requiresConsent: true, acceptsCallback: true } };
    if (tag === 'provider.install.start') return { phase: 'installing', operationId: 'fixture-install' };
    if (tag.startsWith('provider.install.')) return { phase: 'cancelled', operationId: 'fixture-install' };
    throw new Error('Unexpected fixture RPC: ' + tag);
  } },
  async catalog() {
    if (catalogFails) throw Object.assign(new Error('Fixture catalog unavailable'), { code: 'FIXTURE_CATALOG_ERROR' });
    return { providers: instances.map(p => ({ providerInstanceId: p.providerInstanceId, driverKind: p.driver, models: [
      { id: 'fixture-model-exact', options: [{ id: 'effort', values: ['low', 'xhigh'] }, { id: 'fixture-boolean', values: [false, true] }] },
      { id: 'fixture-second-model', options: [] },
    ] })) };
  },
};
const providers = createProviderService({ dataDir: path.join(temp, 'providers'), store, t3, authorizeTool: governance.authorizeTool });
const sdk = part => pathToFileURL(path.resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/' + part)).href;
const ledger = path.join(temp, 'effects.jsonl'), executable = path.join(temp, 'mcp-fixture.mjs');
await writeFile(executable, `
import {appendFile} from 'node:fs/promises';
import {Server} from ${JSON.stringify(sdk('server/index.js'))};
import {StdioServerTransport} from ${JSON.stringify(sdk('server/stdio.js'))};
import {ListToolsRequestSchema,CallToolRequestSchema} from ${JSON.stringify(sdk('types.js'))};
const server=new Server({name:'labelled-GUI-contract-fixture',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:['record','slow'].map(name=>({name,description:'Local engineering fixture only',inputSchema:{type:'object',properties:{value:{type:'string',description:'Exact fixture text'},count:{type:'integer',minimum:1},enabled:{type:'boolean'}},required:['value'],additionalProperties:false}}))}));
server.setRequestHandler(CallToolRequestSchema,async request=>{await appendFile(${JSON.stringify(ledger)},JSON.stringify(request.params)+'\\n');if(request.params.name==='slow')await new Promise(resolve=>setTimeout(resolve,8000));return {content:[{type:'text',text:'Fixture effect recorded once'}]};});
await server.connect(new StdioServerTransport());
`);
const entry = `
import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
import ProviderSetup from '/src/ProviderSetup.jsx';import McpConnections from '/src/McpConnections.jsx';import '/src/style.css';
function Harness(){const[state,setState]=useState(null),[projectId,setProject]=useState('project-a'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[lang,setLang]=useState('en');
const refresh=()=>fetch('/api/state').then(r=>r.json()).then(setState);useEffect(()=>{refresh();const timer=setInterval(refresh,100);return()=>clearInterval(timer);},[]);
const run=async fn=>{setBusy(true);setError('');try{const result=await fn();await refresh();return result;}catch(e){setError(e.message);return null;}finally{setBusy(false);}};
const props={state,projectId,run,busy,t:(th,en)=>lang==='th'?th:en};return <main><h1>Engineering contract harness</h1><p>Not a live provider qualification or mounted product test</p><label>Harness project<select aria-label="Harness project" value={projectId} onChange={e=>setProject(e.target.value)}><option>project-a</option><option>project-b</option></select></label><label>Harness language<select aria-label="Harness language" value={lang}onChange={e=>setLang(e.target.value)}><option>en</option><option>th</option></select></label>{error&&<p role="alert">{error}</p>}{state&&<><ProviderSetup {...props}/><McpConnections {...props}/></>}</main>}
createRoot(document.getElementById('root')).render(<Harness/>);`;
const server = await createServer({ root: path.resolve('app/web'), configFile: false, server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'labelled-provider-contract-harness',
  resolveId(id) { if (id === '/__provider_contract.jsx') return '\0forge-provider-contract'; },
  async load(id) { if (id === '\0forge-provider-contract') return (await transformWithEsbuild(entry, 'harness.jsx', { loader: 'jsx' })).code; },
  configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1'), p = url.pathname;
    if (p === '/__provider_contract') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Provider contract harness</title><div id="root"></div><script type="module" src="/__provider_contract.jsx"></script></html>'); }
    if (!p.startsWith('/api/')) return next();
    try {
      let body; if (req.method === 'POST') { const parts = []; for await (const part of req) parts.push(part); body = JSON.parse(Buffer.concat(parts).toString() || '{}'); }
      requests.push({ method: req.method, path: p, body });
      let result;
      if (p === '/api/state') result = store.read();
      else if (p === '/api/providers/routes') result = [...providers.routes(), { id: 'future-kob-api', brand: 'KOB fixture descriptor', mode: 'opencode-api', baseURL: 'https://example.invalid/v1', apiFamily: 'responses', implemented: true }];
      else if (p.startsWith('/api/providers/')) result = await providers[p.split('/').at(-1)](body);
      else if (p === '/api/governance/policy') result = req.method === 'GET' ? governance.policy(Object.fromEntries(url.searchParams)) : await governance.configurePolicy({ ...body, actor: { kind: 'human', id: 'trusted-fixture-http-session' } });
      else if (p === '/api/governance/tool/request') result = await governance.requestTool(body);
      else if (p === '/api/governance/tool/decide') {
        if (staleDecision) { const a = store.read().events.find(e => e.id === body.approvalId), policy = governance.policy({ projectId: a.projectId, connectionId: a.connectionId }); await governance.configurePolicy({ projectId: a.projectId, connectionId: a.connectionId, operationId: crypto.randomUUID(), expectedRevision: policy.revision, mode: 'off', actor: { kind: 'human', id: 'fixture-concurrent-user' } }); }
        result = await governance.decideTool({ ...body, actor: { kind: 'human', id: 'trusted-fixture-http-session' } });
      }
      else if (p === '/api/mcp/oauth/status') result = { status: oauthState, auth: { kind: 'oauth', status: oauthState }, live: 'NOT_RUN' };
      else if (p === '/api/mcp/oauth/begin') { oauthState = 'awaiting-authorization'; result = { status: oauthState, authorizationUrl: 'https://example.invalid/fixture-authorize?state=transient-fixture-only', live: 'NOT_RUN' }; }
      else if (p === '/api/mcp/oauth/disconnect') { oauthState = 'disconnected'; result = { status: oauthState, live: 'NOT_RUN' }; }
      else if (p.startsWith('/api/mcp/')) result = await providers.mcp[p.split('/').at(-1)](body);
      else if (p === '/api/t3/start') result = { url: 'http://127.0.0.1:12345/fixture-native-settings' };
      else throw Object.assign(new Error('Unmounted harness endpoint'), { statusCode: 404 });
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
    } catch (error) { res.statusCode = error.statusCode ?? 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: { code: error.code, message: error.message } })); }
  }); },
}] });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000); const errors = []; page.on('pageerror', e => errors.push(e.message));
// No external request is allowed, even when checking the reviewed OAuth link.
await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
const button = name => page.getByRole('button', { name, exact: true });
const field = name => page.getByLabel(name, { exact: true });
async function click(name, endpoint) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === 'POST');
  await button(name).click(); const value = await response; assert.equal(value.status(), 200, await value.text()); return value.json();
}
const effects = async () => (await readFile(ledger, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
const waitState = async predicate => { for (let i = 0; i < 150; i++) { const s = store.read(); if (predicate(s)) return s; await page.waitForTimeout(40); } throw new Error('Fixture state timeout'); };
const checks = [];
try {
  await page.goto(origin + '/__provider_contract');
  await field('Add provider route').selectOption('future-kob-api');
  assert.equal(await field('Exact API base URL').inputValue(), 'https://example.invalid/v1'); checks.push('dynamic route descriptor, including future KOB API shape');
  await field('Add provider route').selectOption('custom-api');
  await field('Account label').fill('Disposable API fixture'); await field('API key environment reference').fill('FIXTURE_KEY_REF');
  await field('Exact API base URL').fill('https://example.invalid/v1'); await field('API protocol').selectOption('responses'); await field('Upstream model IDs (one per line)').fill('fixture-model-exact');
  const provider = await click('Add FORGE account', '/api/providers/configure');
  assert.equal(provider.projectId, 'project-a');
  const config = requests.find(r => r.path === '/api/providers/configure').body;
  assert.equal(config.apiKeyEnv, 'FIXTURE_KEY_REF'); assert.equal(config.apiFamily, 'responses'); assert.deepEqual(config.models, ['fixture-model-exact']);
  await click('Check runtime & account', '/api/providers/check'); await click('Refresh actual catalog', '/api/providers/refresh');
  await field('Observed model ID').selectOption('fixture-model-exact'); await field('effort').selectOption(JSON.stringify('xhigh')); await field('fixture-boolean').selectOption('false');
  await click('Use model for project', '/api/providers/select');
  assert.deepEqual(store.read().projects[0].profile.provider.options, [{ id: 'effort', value: 'xhigh' }, { id: 'fixture-boolean', value: false }]);
  checks.push('real provider configure/check/catalog/select modules with labelled T3 RPC/catalog fixtures; exact option types');
  catalogFails = true; await click('Refresh actual catalog', '/api/providers/refresh'); assert.equal(await field('Observed model ID').inputValue(), 'fixture-model-exact'); assert.equal(await button('Use model for project').isDisabled(), true); catalogFails = false;
  await click('Refresh actual catalog', '/api/providers/refresh'); checks.push('catalog failure retains actual last list and blocks selection');
  await page.getByText('Install & sign in', { exact: true }).click();
  await click('Begin sign-in', '/api/providers/setup'); await page.getByText('FIXTURE-ONLY', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Open sign-in page', exact: true }).getAttribute('href'), 'https://example.invalid/fixture-signin');
  await click('Accept browser consent', '/api/providers/setup');
  await field('Provider callback URL (transient)').fill('http://localhost/fixture-callback'); await click('Submit callback once', '/api/providers/setup');
  await field('Runtime sign-in method').selectOption('native'); await click('Begin sign-in', '/api/providers/setup');
  await page.getByText(/This method requires the native terminal/).waitFor();
  await click('Prepare FORGE T3 setup', '/api/t3/start'); assert.match(await page.getByRole('link', { name: 'Open FORGE T3, then Settings', exact: true }).getAttribute('href'), /^http:\/\/127\.0\.0\.1:/);
  await click('Install runtime', '/api/providers/setup'); await click('Cancel installation', '/api/providers/setup'); assert.equal(await button('Cancel installation').isDisabled(), true);
  checks.push('transient device-code/consent/callback, truthful native fallback and one-dispatch cancellation');
  await page.getByText('Add MCP server', { exact: true }).click();
  await field('MCP connection label').fill('Disposable stdio fixture'); await field('MCP transport').selectOption('stdio');
  await field('Installed MCP executable').fill(process.execPath); await field('MCP literal arguments (one per line)').fill(executable);
  const mcp = await click('Save MCP server', '/api/mcp/configure');
  await click('Discover actual tools', '/api/mcp/discover'); await field('Discovered tool').selectOption('record');
  await field('value *').fill('reviewed exact fixture value'); await field('count').fill('2'); await field('enabled').selectOption('false');
  assert.equal(await button('Run this exact operation').isDisabled(), true);
  await field('Connection policy ceiling').selectOption('ask'); await click('Save policy for this connection', '/api/governance/policy');
  const callResult = await click('Run this exact operation', '/api/mcp/call'); assert.equal(callResult.status, 'completed');
  const exactRequest = requests.find(r => r.path === '/api/governance/tool/request').body, exactCall = requests.find(r => r.path === '/api/mcp/call').body;
  assert.deepEqual(exactCall, exactRequest); assert.deepEqual(exactCall.arguments, { value: 'reviewed exact fixture value', count: 2, enabled: false });
  assert.equal(requests.filter(r => r.path === '/api/governance/tool/decide').length, 1); assert.equal((await effects()).length, 1);
  for (const record of requests.filter(r => r.path.startsWith('/api/governance/'))) assert.equal(Object.hasOwn(record.body ?? {}, 'actor'), false);
  checks.push('actual SDK stdio schema discovery; default Off; exact Ask request/one human decision/same operation call; one real filesystem effect');
  await field('Discovered tool').selectOption('slow'); await field('value *').fill('uncertain fixture effect');
  const pendingCall = page.waitForResponse(r => r.url().endsWith('/api/mcp/call'));
  await button('Run this exact operation').click(); await button('Stop waiting once').waitFor(); await click('Stop waiting once', '/api/mcp/stop');
  const stoppedCall = await (await pendingCall).json(); assert.equal(stoppedCall.status, 'unknown'); assert.equal((await effects()).length, 2);
  await page.reload(); await field('Discovered tool').selectOption('slow'); assert.equal(await button('Run this exact operation').isDisabled(), true);
  assert.equal(requests.filter(r => r.path === '/api/mcp/stop').length, 1); assert.equal(requests.filter(r => r.path === '/api/mcp/call').length, 2);
  checks.push('Stop while HTTP call waits; one cancellation; unknown outcome persists across browser reload without replay');
  // Revision invalidation is checked without treating home UAT as evidence.
  await click('Disable connection', '/api/mcp/enable'); await click('Enable connection', '/api/mcp/enable'); await click('Discover actual tools', '/api/mcp/discover');
  assert.equal(await button('Run this exact operation').isDisabled(), true);
  checks.push('disable/re-enable and rediscovery invalidate execution until explicit reviewed policy configuration');
  await field('Harness project').selectOption('project-b');
  await page.getByText('No provider connections in this project yet.', { exact: true }).waitFor(); await page.getByText('No MCP connections in this project yet.', { exact: true }).waitFor();
  await page.getByText('Add MCP server', { exact: true }).click();
  await field('MCP connection label').fill('Allowed and stale decision fixture'); await field('MCP transport').selectOption('stdio');
  await field('Installed MCP executable').fill(process.execPath); await field('MCP literal arguments (one per line)').fill(executable);
  const second = await click('Save MCP server', '/api/mcp/configure'); await click('Discover actual tools', '/api/mcp/discover');
  await field('Connection policy ceiling').selectOption('allowed'); await click('Save policy for this connection', '/api/governance/policy');
  await field('Discovered tool').selectOption('record'); await field('value *').fill('Allowed exact operation');
  const decisionsBefore = requests.filter(r => r.path === '/api/governance/tool/decide').length;
  assert.equal((await click('Run this exact operation', '/api/mcp/call')).status, 'completed');
  assert.equal(requests.filter(r => r.path === '/api/governance/tool/decide').length, decisionsBefore);
  assert.equal((await effects()).length, 3);
  await field('Connection policy ceiling').selectOption('ask'); await click('Save policy for this connection', '/api/governance/policy');
  staleDecision = true; await field('value *').fill('Must not dispatch after stale approval');
  const staleResponse = page.waitForResponse(r => r.url().endsWith('/api/governance/tool/decide'));
  await button('Run this exact operation').click(); await staleResponse;
  await waitState(s => s.events.some(e => e.type === 'governance.tool-approval' && e.connectionId === second.id && e.status === 'stale'));
  assert.equal((await effects()).length, 3); assert.equal(requests.filter(r => r.path === '/api/mcp/call').length, 3); staleDecision = false;
  checks.push('Allowed dispatch uses server policy without redundant decision; concurrent policy change invalidates Ask and prevents dispatch');
  await field('MCP connection label').fill('OAuth response-only fixture'); await field('MCP transport').selectOption('http'); await field('MCP endpoint URL').fill('https://example.invalid/mcp'); await click('Save MCP server', '/api/mcp/configure');
  await page.getByText('OAuth account connection', { exact: true }).click(); await click('Connect OAuth', '/api/mcp/oauth/begin');
  assert.equal(await page.getByRole('link', { name: 'Open reviewed authorization page', exact: true }).getAttribute('href'), 'https://example.invalid/fixture-authorize?state=transient-fixture-only');
  assert.equal((await browser.contexts()[0].pages()).length, 1); oauthState = 'connected'; await page.getByText('Machine credentials are connected. Remote tool qualification is separate.', { exact: true }).waitFor();
  await click('Disconnect OAuth', '/api/mcp/oauth/disconnect'); assert.equal(requests.filter(r => r.path === '/api/mcp/oauth/disconnect').length, 1);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  checks.push('project isolation; OAuth RESPONSE FIXTURE only: explicit reviewed link, bounded status GET, disconnect, no localStorage');
  await field('Harness project').selectOption('project-a'); await field('Configured provider account').waitFor();
  for (const width of [320, 375, 414, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); assert.equal(await page.locator('html').evaluate(e => e.scrollWidth <= innerWidth), true, `Overflow at ${width}px`); }
  await field('Harness language').selectOption('th'); await page.getByRole('heading', { name: 'บัญชีและโมเดลของโครงการ', exact: true }).waitFor();
  await field('Harness language').selectOption('en'); await field('Configured provider account').focus(); assert.notEqual(await field('Configured provider account').evaluate(e => getComputedStyle(e).outlineStyle), 'none');
  assert.deepEqual(errors, []); checks.push('TH/EN, labelled native controls, keyboard focus, widths 320/375/414/768/1440 without document overflow');
  const serialized = JSON.stringify(store.read()); assert.equal(serialized.includes('FIXTURE-ONLY'), false); assert.equal(serialized.includes('fixture-callback'), false); assert.equal(serialized.includes('fixture-authorize'), false);
  const evidence = { result: 'PASSED', kind: 'labelled GUI contract harness with real SQLite/provider/governance/SDK-stdio services', mountedApplication: 'NOT_RUN: lead HTTP/Settings integration absent in worker base', externalProviderAndOAuthQualification: 'NOT_RUN', homeUAT: 'NOT_RUN', checks, fixtureDir: temp };
  await writeFile(path.join(temp, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
} catch (e) { await page.screenshot({ path: path.join(temp, 'failure.png'), fullPage: true }).catch(() => {}); console.error('HARNESS_FIXTURE_DIR', temp); throw e; }
finally { await browser.close(); await server.close(); await providers.close(); await store.close(); }
