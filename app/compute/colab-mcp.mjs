import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { entity, find, changed, revision } from '../server/domain.mjs';

// Google managed API, NOT googlecolab/colab-mcp's browser bridge. Source pins,
// unsupported contracts and the integration boundary are in worker-colab-mcp.md.
export const COLAB_MCP_ENDPOINT = 'https://colaboratory.googleapis.com/mcp';
const terminal = new Set(['completed', 'failed', 'stopped']);
const requiredTools = {
  get_runtime: ['name'], list_runtimes: [], list_sessions: ['parent'],
  create_session: ['parent', 'sessionId'], delete_session: ['name'],
  execute_code: ['session', 'executionId', 'code'],
};
const stamp = () => new Date().toISOString();
const sha = x => createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex');
const fail = (code, message, statusCode = 409) => { throw Object.assign(new Error(message), { code, statusCode }); };
const string = (x, label, re = /^[^\x00-\x1f]{1,256}$/) => {
  if (typeof x !== 'string' || !re.test(x)) fail('COLAB_CONFIG', `Invalid ${label}`, 400);
  return x;
};
const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function validateColabMcpConfig(raw) {
  const allowed = ['kind', 'name', 'runtimeName', 'authEnv', 'authVaultRef', 'quotaProject', 'environmentRevision', 'timeoutMs'];
  if (!raw || Array.isArray(raw) || Object.keys(raw).some(k => !allowed.includes(k))) fail('COLAB_CONFIG', 'Use documented fields and machine secret references only', 400);
  const c = structuredClone(raw);
  if (c.kind !== 'colab-mcp') fail('COLAB_CONFIG', 'Expected colab-mcp', 400);
  string(c.runtimeName, 'existing runtime name', /^runtimes\/[A-Za-z0-9_-]{1,128}$/);
  if (!!c.authEnv === !!c.authVaultRef) fail('COLAB_CONFIG', 'Select exactly one machine bearer reference', 400);
  if (c.authEnv) string(c.authEnv, 'environment reference', envName);
  if (c.authVaultRef) string(c.authVaultRef, 'vault reference', /^[A-Za-z0-9_.:/-]{1,200}$/);
  if (c.quotaProject) string(c.quotaProject, 'quota project', /^[a-z][a-z0-9-]{4,61}[a-z0-9]$|^[0-9]{6,20}$/);
  for (const k of ['name', 'environmentRevision']) if (c[k] !== undefined) string(c[k], k);
  c.timeoutMs ??= 15000;
  if (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 50 || c.timeoutMs > 120000) fail('COLAB_CONFIG', 'timeoutMs must be 50..120000', 400);
  return c;
}
const sourceOf = n => typeof n.code === 'string' ? n.code : (n.cells ?? []).filter(c => c.cell_type === 'code').map(c => Array.isArray(c.source) ? c.source.join('') : c.source ?? '').join('\n\n');
function notebookOf(n) {
  const cells = n.cells?.length && sourceOf({ cells: n.cells }) === sourceOf(n) ? structuredClone(n.cells) : [{ cell_type: 'code', source: sourceOf(n) }];
  return { nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' } }, cells: cells.map(c => ({ ...c, metadata: c.metadata ?? {}, ...(c.cell_type === 'code' ? { outputs: [], execution_count: null } : {}) })) };
}
function select(s, input) {
  const project = find(s, 'projects', input.projectId);
  let choice = project.profile?.compute ?? {};
  if (input.phaseId) { find(s, 'phases', input.phaseId, project.id); choice = project.profile?.phaseOverrides?.[input.phaseId]?.compute ?? choice; }
  const notebook = input.notebookId ? find(s, 'notebooks', input.notebookId, project.id) : null;
  if (notebook?.compute?.connectionId || notebook?.compute?.targetId || notebook?.compute?.kind) choice = notebook.compute;
  const target = find(s, 'connections', input.targetId ?? choice.connectionId ?? choice.targetId, project.id);
  if (target.kind !== 'compute' || target.enabled === false) fail('COLAB_TARGET', 'Select an enabled compute connection');
  return { project, notebook, target, config: validateColabMcpConfig(target.config) };
}
function findOwned(s, input) {
  find(s, 'projects', input.projectId);
  const j = find(s, 'jobs', input.jobId, input.projectId);
  if (j.computeAttempt?.kind !== 'colab-mcp') fail('COLAB_SCOPE', 'Expected a Colab MCP attempt');
  return j;
}
const identityOf = j => ({ projectId: j.projectId, jobId: j.id, sourceSha256: j.source.sha256, session: j.remote.session, executionId: j.remote.executionId });
// Atomic runtime receipt is separate from Google's executionId: after terminal
// delivery Google permits that ID to execute AGAIN. Reconciliation never calls
// execute_code, creates a session, or retries a mutation.
function executionCode(j) {
  const payload = Buffer.from(JSON.stringify({ identity: identityOf(j), code: j.code, root: j.remote.workspace, limit: j.limitSeconds })).toString('base64');
  return `import base64 as _fb, json as _fj\nexec(compile(${JSON.stringify(`
import os, sys, json, base64, traceback, contextlib, signal
p = json.loads(base64.b64decode('${payload}'))
root = p['root']
os.makedirs(root, exist_ok=True)
receipt = os.path.join(root, '.forge-receipt.json')
def save(status, **extra):
    value = dict(p['identity'], status=status, **extra)
    temp = receipt + '.tmp'
    with open(temp, 'w', encoding='utf-8') as f:
        json.dump(value, f); f.flush(); os.fsync(f.fileno())
    os.replace(temp, receipt)
try:
    os.mkdir(os.path.join(root, '.forge-claimed'))
except FileExistsError:
    print('FORGE: existing attempt; inspect receipt, never execute twice')
else:
    save('running')
    class Tee:
        def __init__(self, file, original): self.file, self.original = file, original
        def write(self, value): self.file.write(value); self.file.flush(); return self.original.write(value)
        def flush(self): self.file.flush(); self.original.flush()
    def deadline(*args): raise TimeoutError('FORGE execution deadline exceeded')
    oldcwd = os.getcwd()
    alarm_supported = hasattr(signal, 'SIGALRM')
    oldhandler = signal.signal(signal.SIGALRM, deadline) if alarm_supported else None
    try:
        os.chdir(root)
        if alarm_supported: signal.alarm(p['limit'])
        with open(os.path.join(root, '.forge-log.txt'), 'a', encoding='utf-8', buffering=1) as log:
            with contextlib.redirect_stdout(Tee(log, sys.stdout)), contextlib.redirect_stderr(Tee(log, sys.stderr)):
                try:
                    exec(compile(p['code'], '<forge-notebook>', 'exec'), {'__name__': '__main__'})
                except BaseException as e:
                    traceback.print_exc()
                    save('failed', errorType=type(e).__name__, timedOut=isinstance(e, TimeoutError))
                else:
                    save('completed')
    finally:
        if alarm_supported:
            signal.alarm(0); signal.signal(signal.SIGALRM, oldhandler)
        os.chdir(oldcwd)
`)}, '<forge-supervisor>', 'exec'))`;
}

export function createColabMcpAdapter({ store, dataDir, machineEnv = process.env, resolveBearer, resolveEnvironment, admit,
  // Only engineering fixtures may replace the endpoint; never persisted/configurable in the GUI.
  fixtureEndpoint, maxArtifactBytes = 128 * 1024 * 1024,
} = {}) {
  let endpoint = COLAB_MCP_ENDPOINT, closed = false;
  if (fixtureEndpoint) {
    const u = new URL(fixtureEndpoint);
    if (u.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash) fail('COLAB_CONFIG', 'Fixture endpoint must be loopback HTTP');
    endpoint = u.href;
  }
  const secrets = new Set(), clients = new Set(), workers = new Map(), timers = new Map();
  const configScopes=new WeakMap();
  const owned=(s,input)=>{const j=findOwned(s,input);configScopes.set(j.configSnapshot,j.projectId);return j;};
  const redact = value => { let s = String(value ?? ''); for (const v of secrets) if (v) s = s.split(v).join('[REDACTED]'); return s.replace(/((?:Bearer|token|password|api[_-]?key)\s*[:= ]\s*)[^\s"'<>]+/gi, '$1[REDACTED]'); };
  const patch = (id, values) => store.transaction(s => { const j = find(s, 'jobs', id); const next = { ...values }; if (terminal.has(j.status) && next.status && !terminal.has(next.status)) delete next.status; Object.assign(j, next); changed(j); return j; });
  const safeError = e => ({ errorCode: typeof e.code === 'string' && /^COLAB_|^CREDENTIAL_REQUIRED$/.test(e.code) ? e.code : [401, 403].includes(e.code) ? 'COLAB_AUTH' : 'COLAB_UNCERTAIN', lastError: 'Colab request failed; check machine authentication, API enablement and the recorded runtime. Remote outcome requires reconciliation.' });
  async function bearer(c) {
    let token;
    try { const projectId=configScopes.get(c);token = c.authEnv ? resolveEnvironment?await resolveEnvironment({projectId,name:c.authEnv}):machineEnv[c.authEnv] : await resolveBearer?.({ vaultRef: c.authVaultRef,projectId }); } catch { fail('CREDENTIAL_REQUIRED', 'Machine vault bearer could not be resolved'); }
    if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) fail('CREDENTIAL_REQUIRED', 'Configure the selected machine bearer reference');
    secrets.add(token); return token;
  }
  async function open(c) {
    if (closed) fail('COLAB_CLOSED', 'Adapter is closed');
    const client = new Client({ name: 'forge-colab-compute', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      fetch: async (url, init = {}) => {
        const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${await bearer(c)}`);
        if (c.quotaProject) headers.set('x-goog-user-project', c.quotaProject);
        return fetch(url, { ...init, headers, redirect: 'error' });
      }, reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    });
    // SDK 1.32.2 sends notifications/cancelled on request timeout. Google says
    // that interrupts whatever the session currently runs. Only explicit Stop
    // closes our dedicated session; timeout/shutdown merely detach observation.
    const send = transport.send.bind(transport);
    transport.send = (message, options) => message.method === 'notifications/cancelled' ? Promise.resolve() : send(message, options);
    clients.add(client);
    const close = async () => { clients.delete(client); await client.close().catch(() => {}); };
    try {
      await client.connect(transport, { timeout: c.timeoutMs });
      const tools = new Map(), cursors = new Set(); let cursor;
      for (let page = 0; page < 100; page++) {
        const list = await client.listTools(cursor ? { cursor } : {}, { timeout: c.timeoutMs });
        for (const t of list.tools) { if (tools.has(t.name)) fail('COLAB_SCHEMA', 'Duplicate discovered tool'); tools.set(t.name, t); }
        cursor = list.nextCursor; if (!cursor) break;
        if (page === 99 || cursors.has(cursor)) fail('COLAB_SCHEMA', 'Discovery pagination did not terminate'); cursors.add(cursor);
      }
      const validator = new AjvJsonSchemaValidator();
      for (const [name, fields] of Object.entries(requiredTools)) {
        const tool = tools.get(name);
        if (!tool || tool.inputSchema?.type !== 'object' || fields.some(k => !tool.inputSchema.properties?.[k])) fail('COLAB_CAPABILITY', `Required documented tool/schema missing: ${name}`);
      }
      const probeSession = `${c.runtimeName}/sessions/forge-schema-check`;
      const probes = { get_runtime: { name: c.runtimeName }, list_runtimes: {}, list_sessions: { parent: c.runtimeName }, create_session: { parent: c.runtimeName, sessionId: 'forge-schema-check' }, delete_session: { name: probeSession }, execute_code: { session: probeSession, executionId: randomUUID(), code: 'pass' } };
      for (const [name, args] of Object.entries(probes)) if (!validator.getValidator(tools.get(name).inputSchema)(args).valid) fail('COLAB_CAPABILITY', `Discovered schema is incompatible with documented ${name}`);
      return { close, tools, server: client.getServerVersion(), async call(name, args, timeout = c.timeoutMs) {
        if (!Object.hasOwn(requiredTools, name)) fail('COLAB_POLICY', 'Runtime provisioning and generic MCP calls are unavailable');
        const valid = validator.getValidator(tools.get(name).inputSchema)(args);
        if (!valid.valid) fail('COLAB_SCHEMA', 'Arguments do not match the discovered official schema');
        const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
        if (result.isError) fail('COLAB_REMOTE', 'Colab tool reported an error; outcome requires reconciliation');
        // Documented Google structured_content maps to MCP structuredContent.
        // Text blocks are never interpreted as provider identity or success.
        if (!result.structuredContent || typeof result.structuredContent !== 'object') fail('COLAB_SCHEMA', 'Missing structured tool result');
        return result.structuredContent;
      } };
    } catch (e) { await close(); throw e; }
  }
  async function withClient(c, fn) { const x = await open(c); try { return await fn(x); } finally { await x.close(); } }
  function checkRuntime(c, value) {
    if (value.name !== c.runtimeName) fail('COLAB_IDENTITY', 'Observed runtime differs from the owner-selected runtime');
    return { runtimeName: value.name, runtimeSpec: { variant: value.runtimeSpec?.variant ?? null, accelerator: value.runtimeSpec?.accelerator ?? null, shape: value.runtimeSpec?.shape ?? null }, version: value.version ?? null };
  }
  async function runtime(c) { return withClient(c, async x => { const v = await x.call('get_runtime', { name: c.runtimeName }); checkRuntime(c, v); return v; }); }
  function proxyInfo(v) {
    const info = v.connectionInfo; let u;
    try { u = new URL(info.url); } catch { fail('COLAB_PROXY', 'Runtime did not supply a usable file connection'); }
    const fixture = fixtureEndpoint && u.origin === new URL(fixtureEndpoint).origin;
    if ((!fixture && (u.protocol !== 'https:' || !u.hostname.endsWith('.googleusercontent.com'))) || u.username || u.password || u.search || u.hash || typeof info.token !== 'string' || !info.token || /[\r\n]/.test(info.token) || !Number.isFinite(Date.parse(info.expireTime))) fail('COLAB_PROXY', 'Unsupported or credential-bearing runtime file URL');
    secrets.add(info.token);
    return { url: u.href.replace(/\/$/, ''), token: info.token };
  }
  async function proxy(c, route, { method = 'GET', body, range, allowMissing = false, limit = maxArtifactBytes } = {}) {
    // Refresh via get_runtime for every transfer; one read-only refresh on 404
    // distinguishes expired proxy credentials from a missing file as far as possible.
    for (let attempt = 0; attempt < 2; attempt++) {
      const info = proxyInfo(await runtime(c));
      const headers = { 'X-Colab-Runtime-Proxy-Token': info.token };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (range) headers.Range = range;
      const response = await fetch(info.url + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(c.timeoutMs) });
      if (response.status === 404 && attempt === 0 && method === 'GET') { await response.body?.cancel(); continue; }
      if (response.status === 404 && allowMissing && method === 'GET') { await response.body?.cancel(); return null; }
      if (!response.ok) { await response.body?.cancel(); fail([401, 403].includes(response.status) ? 'COLAB_AUTH' : 'COLAB_FILE_HTTP', 'Runtime file request failed; response omitted'); }
      const chunks = []; let length = 0;
      for await (const chunk of response.body ?? []) { length += chunk.length; if (length > limit) fail('COLAB_FILE_LIMIT', 'File exceeds configured transfer limit'); chunks.push(chunk); }
      return Buffer.concat(chunks);
    }
  }
  const remotePath = p => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  function artifactPath(j, relativePath) {
    string(relativePath, 'relative artifact path', /^[^\x00-\x1f\\]{1,500}$/);
    if (relativePath.startsWith('/') || relativePath.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.forge-'))) fail('COLAB_PATH', 'Choose a confined attempt-relative file path');
    return `${j.remote.workspace}/${relativePath}`;
  }
  async function readReceipt(j) {
    const data = await proxy(j.configSnapshot, '/files/' + remotePath(`${j.remote.workspace}/.forge-receipt.json`), { allowMissing: true, limit: 65536 });
    if (!data) return null;
    let r; try { r = JSON.parse(data); } catch { fail('COLAB_RECEIPT', 'Runtime receipt is invalid'); }
    if (Object.entries(identityOf(j)).some(([k, v]) => r[k] !== v) || !['running', 'completed', 'failed'].includes(r.status)) fail('COLAB_RECEIPT', 'Receipt source, project or execution identity differs');
    return r;
  }
  function arm(j) {
    if (closed || terminal.has(j.status) || j.stopRequested || timers.has(j.id)) return;
    const timer = setTimeout(() => { timers.delete(j.id); api.stop({ projectId: j.projectId, jobId: j.id }).catch(() => {}); }, Math.max(1, Date.parse(j.deadlineAt) - Date.now()));
    timer.unref(); timers.set(j.id, timer);
  }
  async function refresh(j) {
    if (terminal.has(j.status)) return j;
    try {
      const r = await readReceipt(j);
      const log = r ? await proxy(j.configSnapshot, '/files/' + remotePath(`${j.remote.workspace}/.forge-log.txt`), { allowMissing: true, range: 'bytes=-200000', limit: 200000 }) : null;
      let status = r?.status ?? 'unknown';
      if (j.stopRequested) {
        const sessions = await withClient(j.configSnapshot, x => x.call('list_sessions', { parent: j.remote.runtimeName }));
        if (!Array.isArray(sessions.sessions)) fail('COLAB_SCHEMA', 'Missing session list');
        status = terminal.has(r?.status) ? r.status : !sessions.sessions.some(s => s.name === j.remote.session) ? j.sessionClosedAt ? 'stopped' : 'unknown' : r ? 'stopping' : 'unknown';
      }
      if (terminal.has(status)) { clearTimeout(timers.get(j.id)); timers.delete(j.id); }
      return patch(j.id, { status, ...(log ? { logs: redact(log.toString('utf8')).slice(-200000) } : {}), lastObservationAt: stamp(), ...(r ? { remoteObservation: { status: r.status, timedOut: r.timedOut === true, errorType: redact(r.errorType).slice(0,100) } } : {}), ...(terminal.has(status) ? { finishedAt: stamp() } : {}) });
    } catch (e) { return patch(j.id, { status: 'unknown', ...safeError(e), lastObservationAt: stamp() }); }
  }
  async function dispatch(j) {
    configScopes.set(j.configSnapshot,j.projectId);
    let started = false;
    try {
      const dir = path.join(dataDir, 'compute', j.id); await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'source.ipynb'), JSON.stringify(j.sourceNotebook), { flag: 'wx' });
      await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ ...identityOf(j), config: j.configSnapshot, configRevision: j.configRevision, remote: j.remote }), { flag: 'wx' });
      await withClient(j.configSnapshot, async x => {
        const observed = checkRuntime(j.configSnapshot, await x.call('get_runtime', { name: j.remote.runtimeName }));
        await patch(j.id, { environment: { ...observed, observedAt: stamp(), configuredRevision: j.configSnapshot.environmentRevision ?? null } });
        if (owned(store.read(), { projectId: j.projectId, jobId: j.id }).stopRequested || closed) { await patch(j.id, { dispatchStage: 'no-execution', status: 'stopped' }); return; }
        const listed = await x.call('list_sessions', { parent: j.remote.runtimeName });
        if (!Array.isArray(listed.sessions) || listed.sessions.some(s => s.name === j.remote.session)) fail('COLAB_SESSION_COLLISION', 'Dedicated session identity is already occupied');
        admit?.(store.read(),{projectId:j.projectId,notebookId:j.notebookId,operationId:j.operationId},{jobId:j.id});
        await patch(j.id, { dispatchStage: 'creating-session' }); started = true;
        const session = await x.call('create_session', { parent: j.remote.runtimeName, sessionId: j.remote.sessionId });
        if (session.name !== j.remote.session) fail('COLAB_IDENTITY', 'Created session differs from durable reserved identity');
        await patch(j.id, { dispatchStage: 'session-created', sessionOwned: true });
        if (owned(store.read(), { projectId: j.projectId, jobId: j.id }).stopRequested || closed) {
          await patch(j.id, { dispatchStage: 'no-execution' });
          if (!closed) await api.stop({ projectId: j.projectId, jobId: j.id });
          return;
        }
        await patch(j.id, { status: 'submitted', dispatchStage: 'executing', submittedAt: stamp() });
        arm(owned(store.read(), { projectId: j.projectId, jobId: j.id }));
        const result = await x.call('execute_code', { session: j.remote.session, executionId: j.remote.executionId, code: executionCode(j) }, 620000);
        if (result.session !== j.remote.session || result.executionId !== j.remote.executionId) fail('COLAB_IDENTITY', 'Execution result identity differs');
        // The runtime receipt, not an empty stdout or HTTP 200, proves source completion.
        await patch(j.id, { dispatchStage: 'returned', resultObservation: { executionCount: Number.isInteger(result.executionCount) ? result.executionCount : null, outputTruncated: result.outputTruncated === true }, logs: redact(`${result.stdout ?? ''}${result.stderr ?? ''}`).slice(-200000) });
        await refresh(owned(store.read(), { projectId: j.projectId, jobId: j.id }));
        const current = owned(store.read(), { projectId: j.projectId, jobId: j.id });
        if (terminal.has(current.status) && !current.sessionClosedAt) {
          try { await x.call('delete_session', { name: j.remote.session }); await patch(j.id, { sessionClosedAt: stamp() }); }
          catch { await patch(j.id, { sessionCleanup: 'unconfirmed; explicit Stop can close this owned session' }); }
        }
      });
    } catch (e) { const current = owned(store.read(), { projectId: j.projectId, jobId: j.id }); if (!terminal.has(current.status)) await patch(j.id, { status: started ? 'unknown' : current.stopRequested ? 'stopped' : 'failed', ...safeError(e) }); }
  }
  const api = {
    async configure(input) {
      const config = validateColabMcpConfig(input.config);
      return store.transaction(s => {
        const p = find(s, 'projects', input.projectId); if (input.phaseId) find(s, 'phases', input.phaseId, p.id);
        let t;
        if (input.targetId) { t = find(s, 'connections', input.targetId, p.id); if (t.kind !== 'compute') fail('COLAB_SCOPE', 'Expected compute connection'); revision(t, input.expectedRevision); t.config = config; t.name = config.name ?? 'Colab MCP'; changed(t); }
        else { t = entity({ kind: 'compute', name: config.name ?? 'Colab MCP', config }, p.id); s.connections.push(t); }
        if (input.select) { p.profile ??= {}; const choice = { kind: 'colab-mcp', connectionId: t.id }; if (input.phaseId) { p.profile.phaseOverrides ??= {}; p.profile.phaseOverrides[input.phaseId] = { ...p.profile.phaseOverrides[input.phaseId], compute: choice }; } else p.profile.compute = choice; changed(p); }
        return t;
      });
    },
    async health(input) {
      const { config, target } = select(store.read(), input);configScopes.set(config,input.projectId); let result;
      try { result = await withClient(config, async x => ({ status: 'observed', verified: true, execution: true, executionVerified: false, runtime: checkRuntime(config, await x.call('get_runtime', { name: config.runtimeName })), requiredTools: Object.keys(requiredTools), schemaSha256: sha(Object.fromEntries([...x.tools].filter(([n]) => Object.hasOwn(requiredTools,n)).map(([n,t]) => [n,t.inputSchema]))), resume: false, provisioning: false, authentication: 'selected bearer accepted; principal email not exposed by this API', quotaProject: config.quotaProject ?? null })); }
      catch (e) { result = { status: 'error', verified: false, execution: false, ...safeError(e) }; }
      result.checkedAt = stamp();
      await store.transaction(s => { const t = find(s, 'connections', target.id, input.projectId); if (t.revision === target.revision) { t.health = result; changed(t); } }); return result;
    },
    async start(input) {
      string(input.operationId, 'operationId');
      if (closed) fail('COLAB_CLOSED', 'Adapter is closed');
      const fingerprint = sha({ projectId: input.projectId, notebookId: input.notebookId, targetId: input.targetId ?? null, phaseId: input.phaseId ?? null, mode: input.mode ?? 'restart', previousJobId: input.previousJobId ?? null, checkpointArtifactId: input.checkpointArtifactId ?? null });
      const job = await store.transaction(s => {
        const prev = s.jobs.find(j => j.operationId === input.operationId);
        if (prev) { if (prev.computeFingerprint !== fingerprint || prev.computeAttempt?.kind !== 'colab-mcp') fail('OPERATION_REUSE', 'Operation reused with different inputs'); find(s, 'projects', input.projectId); return { ...prev, replayed: true }; }
        if (['receipts', 'runs', 'events'].some(k => s[k].some(r => r.operationId === input.operationId))) fail('OPERATION_REUSE', 'Operation belongs to other work');
        const { project: p, notebook: n, target: t, config: c } = select(s, input);
        if (!n || (n.language && n.language !== 'python')) fail('COLAB_LANGUAGE', 'Select a Python notebook');
        if ((input.mode ?? 'restart') !== 'restart' || input.checkpointArtifactId) fail('RESUME_UNSUPPORTED', 'Kernel reconnect is not application checkpoint restoration; use an explicit fresh restart');
        if (input.previousJobId) { const prev = owned(s, { projectId: p.id, jobId: input.previousJobId }); if (prev.notebookId !== n.id || !terminal.has(prev.status)) fail('COLAB_PREVIOUS', 'Previous notebook attempt must be terminal in this project'); }
        if (s.jobs.some(j => j.computeAttempt && !terminal.has(j.status) && (j.projectId === p.id || j.configSnapshot?.runtimeName === c.runtimeName))) fail('WORKSPACE_BUSY', 'Reconcile or stop the active/uncertain workspace or selected runtime execution');
        admit?.(s,input);
        const code = sourceOf(n); if (!code.trim() || Buffer.byteLength(code) > 1000000) fail('COLAB_SOURCE', 'Use nonempty Python source up to 1 MB');
        const id = randomUUID(), sessionId = `forge-${randomUUID()}`;
        const limitSeconds = Math.min(86400, Math.max(1, Math.floor(Number(p.profile?.limits?.jobSeconds) || 120)));
        const j = entity({ kind: 'compute-notebook', operationId: input.operationId, computeFingerprint: fingerprint, notebookId: n.id, phaseId: input.phaseId ?? null, computeAttempt: { kind: 'colab-mcp', targetId: t.id, targetRevision: t.revision }, sourceRevision: n.revision, source: { notebookId: n.id, revision: n.revision, sha256: sha(code) }, code, sourceNotebook: notebookOf(n), configSnapshot: c, configRevision: sha(c), profileRevision: p.revision, workspace: p.workspace, environment: { qualification: 'not-yet-observed' }, remote: { runtimeName: c.runtimeName, sessionId, session: `${c.runtimeName}/sessions/${sessionId}`, executionId: randomUUID(), workspace: `/content/forge/${sha(p.id).slice(0,24)}/${id}` }, sessionOwned: false, dispatchStage: 'reserved', status: 'submitting', logs: '', mode: 'restart', previousJobId: input.previousJobId ?? null, artifactRefs: [], checkpointRefs: [], limitSeconds, startedAt: stamp(), deadlineAt: new Date(Date.now() + limitSeconds * 1000).toISOString() }, p.id);
        j.id = id; s.jobs.push(j); return j;
      });
      if (!job.replayed) {
        const work = Promise.resolve().then(() => dispatch(job)).finally(async () => { try { await patch(job.id, { dispatchFinishedAt: stamp() }); } finally { workers.delete(job.id); } }).catch(() => { /* A failed durable store remains uncertain; never redispatch in memory. */ });
        workers.set(job.id, work);
      }
      delete job.replayed; return job;
    },
    async status(input) { return refresh(owned(store.read(), input)); },
    async logs(input) { const j = await api.status(input); return { jobId: j.id, status: j.status, logs: j.logs, observedAt: j.lastObservationAt ?? null, source: j.source }; },
    async reconcile(input = {}) {
      if (input.jobId) return api.status(input);
      if (input.projectId) find(store.read(), 'projects', input.projectId);
      const jobs = store.read().jobs.filter(j => j.computeAttempt?.kind === 'colab-mcp' && (!input.projectId || j.projectId === input.projectId) && !terminal.has(j.status));
      const result = []; for (const j of jobs) result.push(await refresh(j)); return result;
    },
    async stop(input) {
      let j = owned(store.read(), input);
      if (terminal.has(j.status) && (!j.sessionOwned || j.sessionClosedAt)) return j;
      await patch(j.id, { stopRequested: true, ...(!terminal.has(j.status) ? { status: 'stopping' } : {}) });
      if (!j.sessionOwned) {
        if (j.dispatchStage === 'reserved') return patch(j.id, { status: 'stopped', finishedAt: stamp() });
        // Before create_session we proved this random persisted name was absent.
        // A lost create response may be reconciled to that exact reservation;
        // names from the owner's other notebooks are never candidates.
        if (j.dispatchStage === 'creating-session') {
          try {
            const listed = await withClient(j.configSnapshot, x => x.call('list_sessions', { parent: j.remote.runtimeName }));
            if (listed.sessions?.some(s => s.name === j.remote.session)) j = await patch(j.id, { sessionOwned: true });
          } catch { /* Unknown is deliberately not acknowledgement of Stop. */ }
        }
        if (!j.sessionOwned) return patch(j.id, { status: 'unknown', lastError: 'Session creation outcome is unknown. Reconcile the reserved session; no unowned session will be closed.' });
      }
      try {
        if (['session-created', 'executing'].includes(j.dispatchStage) && !terminal.has(j.status)) {
          // execute_code creates a missing session. Deleting before the server
          // has begun the request could let a delayed request recreate it.
          // Observe our running receipt first; otherwise Stop remains unknown.
          if (!await readReceipt(j)) return patch(j.id, { status: 'unknown', lastError: 'Execution dispatch has no runtime receipt yet. Stop is pending; reconcile before closing the session.' });
        }
        await withClient(j.configSnapshot, x => x.call('delete_session', { name: j.remote.session }));
        await patch(j.id, { sessionClosedAt: stamp() });
        return terminal.has(j.status) ? owned(store.read(), input) : refresh(owned(store.read(), input));
      } catch (e) { return patch(j.id, { ...(!terminal.has(j.status) ? { status: 'unknown' } : {}), ...safeError(e) }); }
    },
    async exportNotebook(input) {
      const j = owned(store.read(), input), n = structuredClone(j.sourceNotebook);
      n.metadata.forge = identityOf(j); const content = JSON.stringify(n, null, 2);
      return { name: `forge-${j.id}.ipynb`, content, sha256: sha(content), evidenceScope: 'immutable source; outputs are separate runtime observations' };
    },
    async uploadArtifact(input) { return transfer(input, 'upload'); },
    async downloadArtifact(input) { return transfer(input, 'download'); },
    async reconcileTransfer(input) {
      find(store.read(), 'projects', input.projectId);
      const r = store.read().receipts.find(r => r.operationId === input.operationId && r.projectId === input.projectId && r.kind === 'colab-transfer');
      if (!r) fail('NOT_FOUND', 'Transfer not found in this project', 404);
      if (r.status === 'completed' || r.action !== 'upload') return r;
      const j = owned(store.read(), { projectId: input.projectId, jobId: r.jobId }); let values;
      try {
        const bytes = await proxy(j.configSnapshot, '/files/' + remotePath(r.remotePath));
        if (sha(bytes) !== r.expectedSha256) fail('COLAB_FILE_HASH', 'Remote bytes still differ from selected SHA-256');
        values = { status: 'completed', sha256: sha(bytes), bytes: bytes.length, verifiedAt: stamp(), provenance: identityOf(j) };
      } catch (e) { values = { status: 'unknown', ...safeError(e) }; }
      return store.transaction(s => { const current = s.receipts.find(x => x.operationId === r.operationId); Object.assign(current, values); return current; });
    },
    async shutdown() {
      closed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear();
      await Promise.allSettled([...clients].map(c => c.close()));
      await Promise.allSettled([...workers.values()]); secrets.clear();
    },
  };
  async function transfer(input, action) {
    const j = owned(store.read(), input); string(input.operationId, 'operationId');
    const destination = artifactPath(j, input.relativePath);
    let bytes;
    if (action === 'upload') {
      if (!Buffer.isBuffer(input.bytes) && !(input.bytes instanceof Uint8Array)) fail('COLAB_FILE', 'Upload file bytes through the host boundary');
      bytes = Buffer.from(input.bytes);
      if (bytes.length > maxArtifactBytes || !/^[a-f0-9]{64}$/.test(input.sha256 ?? '') || sha(bytes) !== input.sha256) fail('COLAB_FILE_HASH', 'Upload size or expected SHA-256 does not match');
    }
    if (action === 'download' && !/^[a-f0-9]{64}$/.test(input.sha256 ?? '')) fail('COLAB_FILE_HASH', 'Select an expected SHA-256 for verified download');
    const fingerprint = sha({ projectId: j.projectId, jobId: j.id, action, destination, sha256: input.sha256 });
    const receipt = await store.transaction(s => {
      const prior = s.receipts.find(r => r.operationId === input.operationId);
      if (prior) { if (prior.fingerprint !== fingerprint) fail('OPERATION_REUSE', 'Transfer operation reused'); return { ...prior, replayed: true }; }
      if (['jobs','events','runs'].some(k => s[k].some(r => r.operationId === input.operationId))) fail('OPERATION_REUSE', 'Operation belongs to other work');
      const r = { operationId: input.operationId, kind: 'colab-transfer', projectId: j.projectId, jobId: j.id, fingerprint, action, remotePath: destination, expectedSha256: input.sha256, status: 'submitting', createdAt: stamp() }; s.receipts.push(r); return r;
    });
    if (receipt.replayed) { delete receipt.replayed; return receipt; }
    let result;
    try {
      if (action === 'upload') {
        if (!j.sessionOwned) fail('COLAB_SESSION', 'Run the attempt before uploading to its workspace');
        // Parents outside the attempt root are never created or overwritten.
        let parent = j.remote.workspace;
        for (const part of input.relativePath.split('/').slice(0,-1)) { parent += '/' + part; await proxy(j.configSnapshot, '/api/contents/' + remotePath(parent), { method: 'PUT', body: { type: 'directory' }, limit: 1000000 }); }
        const chunkSize = 8 * 1024 * 1024, count = Math.max(1, Math.ceil(bytes.length / chunkSize));
        for (let i = 0; i < count; i++) await proxy(j.configSnapshot, '/api/contents/' + remotePath(destination), { method: 'PUT', body: { type: 'file', format: 'base64', content: bytes.subarray(i * chunkSize, (i + 1) * chunkSize).toString('base64'), ...(count > 1 ? { chunk: i === count - 1 ? -1 : i + 1 } : {}) }, limit: 1000000 });
      }
      const observed = await proxy(j.configSnapshot, '/files/' + remotePath(destination));
      if (sha(observed) !== input.sha256) fail('COLAB_FILE_HASH', 'Remote bytes differ from the selected SHA-256');
      let localPath;
      if (action === 'download') { const dir = path.join(dataDir, 'compute', j.id, 'artifacts'); await mkdir(dir, { recursive: true }); localPath = path.join(dir, `${randomUUID()}.bin`); await writeFile(localPath, observed, { flag: 'wx' }); }
      result = { status: 'completed', sha256: sha(observed), bytes: observed.length, ...(localPath ? { localPath } : {}), verifiedAt: stamp(), provenance: identityOf(j) };
    } catch (e) { result = { status: action === 'upload' ? 'unknown' : 'failed', ...safeError(e) }; }
    return store.transaction(s => { const r = s.receipts.find(r => r.operationId === input.operationId); Object.assign(r, result); return r; });
  }
  return api;
}
