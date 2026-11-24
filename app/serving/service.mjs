import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { entity, find, fail, changed, now, revision, required, confined } from '../server/domain.mjs';
import { assertBinding, canonical, digest, endpointURL, readLinearBundle, verifyBinding } from './bindings.mjs';
import { discoverMcp, jsonRequest, withMcp } from './transport.mjs';
import { ensureEnvironment, launchLitServe, probeEnvironment } from './runtime.mjs';

const live = j => ['preparing', 'starting', 'running', 'stopping'].includes(j.status);
const summary = e => ({ code: e.code ?? 'SERVING_ERROR', message: e.message, ...(e.httpStatus ? { httpStatus: e.httpStatus } : {}), ...(e.response === undefined ? {} : { response: e.response }) });
const fp = input => digest(canonical(input));
function configFor(state, projectId) {
  const p = find(state, 'projects', required(projectId, 'projectId'));
  const config = p.profile?.serving;
  if (config?.adapter !== 'litserve') fail('SERVING_SETUP_REQUIRED', 'Select LitServe, model and preprocessing artifact revisions in Models and Serving', 409);
  return { p, config };
}
function validateConfig(input) {
  if (input.adapter !== 'litserve' || !['existing', 'local'].includes(input.mode)) fail('SERVING_ADAPTER_UNSUPPORTED', 'Supported serving routes: LitServe existing REST/MCP endpoint, or local JSON linear loader', 422);
  const timeoutMs = input.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) fail('VALIDATION', 'timeoutMs must be 100–120000');
  const config = { adapter: 'litserve', mode: input.mode, binding: input.binding, timeoutMs, mcpTool: input.mcpTool ?? (input.mode === 'local' ? 'forge_predict' : null) };
  if (config.mcpTool !== null && (typeof config.mcpTool !== 'string' || !config.mcpTool.length)) fail('VALIDATION', 'Choose a tool name from MCP discovery');
  if (input.mode === 'existing') config.endpoint = endpointURL(input.endpoint);
  else {
    config.port = input.port ?? 0;
    if (!Number.isSafeInteger(config.port) || config.port < 0 || config.port > 65535 || (config.port > 0 && config.port < 1024)) fail('VALIDATION', 'Local port must be 0 (automatic) or 1024–65535');
    config.loader = 'forge.linear.v1';
  }
  return config;
}
async function freePort(port) {
  const listener = net.createServer();
  return new Promise((resolve, reject) => {
    listener.once('error', e => reject(Object.assign(new Error('Selected serving port is occupied; choose Automatic or another port'), { code: 'SERVING_PORT', statusCode: 409, cause: e })));
    listener.listen({ host: '127.0.0.1', port, exclusive: true }, () => { const actual = listener.address().port; listener.close(e => e ? reject(e) : resolve(actual)); });
  });
}

/** The lead mounts HTTP/GUI routes. No external resource or global Python is provisioned here. */
export function createServingService({ dataDir, store, connections, artifacts }) {
  const controls = new Map(), tasks = new Set(); let closed = false;
  // Persisted PIDs are observations, never ownership. Recovery never kills/restarts them.
  const recovered = store.transaction(s => {
    for (const j of s.jobs.filter(j => j.kind?.startsWith('serving.') && live(j))) {
      j.status = 'unknown'; j.readiness = 'reconcile'; j.error = { code: 'OWNERSHIP_LOST', message: 'FORGE restarted; inspect the recorded endpoint/process and partial outputs. Do not repeat an uncertain inference automatically.' }; changed(j);
      const r = s.runs.find(r => r.id === j.runId); if (r) { r.status = 'unknown'; changed(r); }
      s.events.push(entity({ type: 'serving.recovered', jobId: j.id, runId: j.runId, status: j.status }, j.projectId));
    }
  });
  const track = promise => { tasks.add(promise); promise.finally(() => tasks.delete(promise)).catch(() => {}); return promise; };
  const ready = async () => { await recovered; if (closed) fail('SERVING_SHUTDOWN', 'Serving service is shutting down', 409); };
  async function update(id, patch) {
    return store.transaction(s => {
      const j = find(s, 'jobs', id); Object.assign(j, patch); changed(j);
      const r = find(s, 'runs', j.runId); Object.assign(r, { status: j.status, ...(patch.finishedAt ? { finishedAt: patch.finishedAt } : {}) }); changed(r);
      s.events.push(entity({ type: 'serving.status', jobId: j.id, runId: j.runId, status: j.status, readiness: j.readiness, error: j.error }, j.projectId));
      return j;
    });
  }
  async function reserve(kind, input, binding, config) {
    return store.transaction(s => {
      const fingerprint = fp(input), previous = s.jobs.find(j => j.operationId === input.operationId);
      if (previous) { if (previous.kind !== kind || previous.fingerprint !== fingerprint) fail('OPERATION_REUSE', 'Serving operation ID reused with different input', 409); return { ...previous, replayed: true }; }
      if (s.receipts.some(r => r.operationId === input.operationId)) fail('OPERATION_REUSE', 'Operation ID already belongs to another command', 409);
      required(input.operationId, 'operationId');
      const { p, config: current } = configFor(s, input.projectId);
      if (canonical(config) !== canonical(current)) fail('REVISION_CONFLICT', 'Serving profile changed; inspect the current selection', 409);
      assertBinding(s, p.id, binding);
      if (kind === 'serving.deployment' && s.jobs.some(j => j.kind === kind && j.projectId === p.id && (live(j) || j.status === 'unknown'))) fail('SERVING_RECONCILE', 'An active or uncertain deployment exists. Stop owned work or inspect the recorded endpoint before a new attempt.', 409);
      const run = entity({ kind, status: 'preparing', profileRevision: p.revision, profile: structuredClone(p.profile), binding }, p.id);
      const j = entity({ kind, operationId: input.operationId, fingerprint, runId: run.id, attemptId: randomUUID(),
        deploymentId: kind === 'serving.deployment' ? randomUUID() : input.deploymentId ?? null,
        status: 'preparing', profileRevision: p.revision, config: structuredClone(config), binding,
        owned: false, logs: '', artifactIds: [], metrics: {}, request: kind === 'serving.inference' ? { transport: input.transport ?? 'rest', payload: input.payload } : undefined }, p.id);
      run.jobId = j.id; s.runs.push(run); s.jobs.push(j);
      s.events.push(entity({ type: 'serving.reserved', jobId: j.id, runId: run.id, binding, profileRevision: p.revision }, p.id)); return j;
    });
  }
  function prior(input, kind) {
    required(input.operationId, 'operationId'); required(input.projectId, 'projectId');
    const previous = store.read().jobs.find(j => j.operationId === input.operationId);
    if (previous && (previous.kind !== kind || previous.fingerprint !== fp(input))) fail('OPERATION_REUSE', 'Serving operation ID reused with different input', 409);
    return previous ? { ...previous, replayed: true } : null;
  }
  function target(projectId, config, deploymentId) {
    let job;
    if (deploymentId) {
      job = store.read().jobs.find(j => j.projectId === projectId && j.kind === 'serving.deployment' && (j.id === deploymentId || j.deploymentId === deploymentId));
      if (!job) fail('NOT_FOUND', 'Deployment not found in this project', 404);
    } else job = store.read().jobs.filter(j => j.kind === 'serving.deployment' && j.projectId === projectId && live(j)).at(-1);
    if (job && canonical(job.config) !== canonical(config)) fail('REVISION_CONFLICT', 'Deployment uses a different serving profile; stop it before using the new selection', 409);
    if (job && job.status !== 'running') fail('SERVING_RECONCILE', 'Deployment is not ready. Inspect its recorded lifecycle and endpoint first.', 409);
    if (config.mode === 'local' && (!job || !controls.get(job.id)?.handle?.alive)) fail('SERVING_NOT_RUNNING', 'Start the selected local model before inference', 409);
    return { job, endpoint: job?.endpoint ?? config.endpoint };
  }
  async function observeLocal(job, endpoint, signal) {
    const observation = (await jsonRequest(`${endpoint}/forge/evidence`, { timeoutMs: job.config.timeoutMs, signal })).result;
    if (observation.instanceId !== job.observedBinding?.instanceId || observation.deploymentId !== job.deploymentId ||
        !['model', 'preprocessor'].every(k => observation.binding?.[k]?.sha256 === job.binding[k].sha256)) fail('SERVING_IDENTITY', 'Endpoint identity no longer matches the owned deployment and selected artifacts', 409);
    return { ...observation, loadedModelVerified: true, observedAt: now() };
  }
  async function reconcileBeforeStart(input) {
    if (!input.reconcileJobId) return;
    const j = find(store.read(), 'jobs', input.reconcileJobId, input.projectId);
    if (j.kind !== 'serving.deployment' || !['unknown', 'interrupted', 'detached'].includes(j.status)) fail('SERVING_RECONCILE', 'Select an uncertain deployment record to reconcile', 409);
    if (j.config.mode === 'existing') {
      // Attaching again does not stop or recreate a remote service. Retain its
      // resource state rather than claiming that a detached endpoint stopped.
      const observation = await probeEndpoint(j.endpoint ?? j.config.endpoint, j.config);
      await update(j.id, { status: 'detached', owned: false, resourceState: observation, finishedAt: now() }); return;
    }
    if (!j.endpoint?.startsWith('http://127.0.0.1:')) fail('SERVING_RECONCILE', 'No recorded local endpoint to reconcile; inspect startup logs and the old resource before retrying', 409);
    const address = new URL(j.endpoint);
    const state = await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port: Number(address.port) });
      socket.setTimeout(2000);
      socket.once('connect', () => { socket.destroy(); resolve('reachable-unowned'); });
      socket.once('timeout', () => { socket.destroy(); resolve('unknown'); });
      socket.once('error', e => resolve(e.code === 'ECONNREFUSED' ? 'endpoint-offline' : 'unknown'));
    });
    await update(j.id, { resourceState: { status: state, checkedAt: now() }, ...(state === 'endpoint-offline' ? { status: 'interrupted', readiness: 'offline', finishedAt: now() } : {}) });
    if (state !== 'endpoint-offline') fail('SERVING_RECONCILE', 'Old endpoint remains reachable or uncertain and ownership was lost. Inspect that resource; persisted PIDs cannot authorize Stop.', 409);
  }
  async function probeEndpoint(endpoint, config, signal) {
    const started = performance.now();
    const health = await jsonRequest(`${endpoint}/health`, { timeoutMs: config.timeoutMs, signal });
    let mcp;
    try { const tools = await withMcp(endpoint, config.timeoutMs, signal, c => discoverMcp(c, config.timeoutMs, signal)); mcp = { status: 'ready', tools, selectedTool: config.mcpTool, selectedToolAvailable: tools.some(t => t.name === config.mcpTool) }; }
    catch (e) { mcp = { status: 'error', error: summary(e), tools: [] }; }
    return { status: 'ready', endpoint, rest: health, mcp, latencyMs: performance.now() - started, checkedAt: now() };
  }
  async function configure(input) {
    await ready(); const fingerprint = fp(input);
    const previous = store.read().receipts.find(r => r.operationId === input.operationId);
    if (previous) { if (previous.fingerprint !== fingerprint) fail('OPERATION_REUSE', 'Configuration operation reused', 409); return previous.result; }
    required(input.operationId, 'operationId');
    const config = validateConfig(input), binding = await verifyBinding(store, input.projectId, config.binding);
    config.binding = binding;
    return store.transaction(s => {
      const prior = s.receipts.find(r => r.operationId === input.operationId);
      if (prior) { if (prior.fingerprint !== fingerprint) fail('OPERATION_REUSE', 'Configuration operation reused', 409); return prior.result; }
      if (s.jobs.some(j => j.operationId === input.operationId)) fail('OPERATION_REUSE', 'Operation already belongs to a job', 409);
      const p = find(s, 'projects', input.projectId); revision(p, input.expectedRevision); assertBinding(s, p.id, binding);
      // Serving changes do not replace compute/storage/provider settings.
      p.profile = { ...p.profile, serving: config }; changed(p);
      const result = { projectId: p.id, revision: p.revision, config, bindingEvidence: { kind: 'declared-binding', loadedModelVerified: false } };
      s.receipts.push({ operationId: input.operationId, fingerprint, result });
      s.events.push(entity({ type: 'serving.configured', binding, profileRevision: p.revision }, p.id)); return result;
    });
  }
  async function health(projectId) {
    await ready();
    const { config } = configFor(store.read(), projectId); let result;
    try {
      const binding = await verifyBinding(store, projectId, config.binding), { job, endpoint } = target(projectId, config);
      result = { ...await probeEndpoint(endpoint, config), binding, deploymentId: job?.deploymentId ?? null,
        bindingEvidence: config.mode === 'local' ? await observeLocal(job, endpoint) : { kind: 'declared-binding', loadedModelVerified: false } };
    } catch (e) { result = { status: 'error', error: summary(e), checkedAt: now() }; }
    if (config.mode === 'local') result.dependencies = await probeEnvironment();
    await store.transaction(s => { s.events.push(entity({ type: 'serving.health', observation: result }, projectId)); });
    return result;
  }
  function start(input) { return track(startImpl(input)); }
  async function startImpl(input) {
    await ready(); const previous = prior(input, 'serving.deployment'); if (previous) return previous;
    const { config } = configFor(store.read(), input.projectId), binding = await verifyBinding(store, input.projectId, config.binding);
    await reconcileBeforeStart(input);
    const j = await reserve('serving.deployment', input, binding, config); if (j.replayed) return j;
    const controller = new AbortController(), control = { controller }; controls.set(j.id, control);
    if (closed) controller.abort();
    const log = text => store.transaction(s => { const job = find(s, 'jobs', j.id); job.logs = (job.logs + text).slice(-100000); changed(job); }).catch(() => {});
    try {
      let endpoint = config.endpoint, observedBinding = { kind: 'declared-binding', loadedModelVerified: false };
      if (config.mode === 'local') {
        const bundle = await readLinearBundle(binding);
        const environment = await ensureEnvironment({ installDependencies: input.installDependencies === true, pythonExecutable: input.pythonExecutable, signal: controller.signal, onLog: log });
        controller.signal.throwIfAborted();
        const port = await freePort(config.port), dir = path.join(dataDir, 'serving', 'deployments', j.id);
        await mkdir(dir, { recursive: true });
        const manifest = { port, ownerPid: process.pid, instanceId: randomUUID(), deploymentId: j.deploymentId, binding, evidencePath: path.join(dir, 'loaded.json') };
        for (const key of ['model', 'preprocessor']) {
          const bytes = await readFile(binding[key].path);
          if (digest(bytes) !== binding[key].sha256) fail('INTEGRITY', 'Artifact changed during deployment preparation', 409);
          manifest[`${key}Path`] = path.join(dir, `${key}.json`); await writeFile(manifest[`${key}Path`], bytes, { flag: 'wx' });
        }
        await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx' });
        endpoint = `http://127.0.0.1:${port}`;
        await update(j.id, { status: 'starting', endpoint, environment, engineeringFixture: bundle.engineeringFixture, features: bundle.features });
        controller.signal.throwIfAborted();
        control.handle = launchLitServe(path.join(dir, 'manifest.json'), dir, log);
        await update(j.id, { pid: control.handle.child.pid ?? null, owned: true });
        let observation; const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
          controller.signal.throwIfAborted();
          if (!control.handle.alive) fail('SERVING_PROCESS_EXIT', 'LitServe exited during startup; inspect job logs and package compatibility', 409);
          try {
            await jsonRequest(`${endpoint}/health`, { timeoutMs: 1000, signal: controller.signal });
            observation = (await jsonRequest(`${endpoint}/forge/evidence`, { timeoutMs: 1000, signal: controller.signal })).result;
            if (observation.instanceId === manifest.instanceId && observation.deploymentId === j.deploymentId &&
              ['model', 'preprocessor'].every(k => observation.binding[k].sha256 === binding[k].sha256)) break;
            observation = null;
          } catch { controller.signal.throwIfAborted(); }
          await pause(150, undefined, { signal: controller.signal });
        }
        if (!observation) fail('SERVING_START_TIMEOUT', 'LitServe did not establish health and loaded-artifact evidence within 60 seconds. Inspect the job logs.', 409);
        observedBinding = { ...observation, loadedModelVerified: true, observedAt: now() };
      }
      controller.signal.throwIfAborted();
      const health = await probeEndpoint(endpoint, config, controller.signal);
      if (config.mode === 'local' && (!health.mcp.selectedToolAvailable || health.mcp.status !== 'ready')) fail('SERVING_MCP', 'Local LitServe REST started but MCP discovery failed; inspect dependency versions and job logs', 409);
      controller.signal.throwIfAborted();
      await update(j.id, { status: 'running', readiness: 'ready', endpoint, observedBinding, health, startedAt: now() });
      if (control.handle) void control.handle.finished.then(async exit => {
        const current = store.read().jobs.find(x => x.id === j.id);
        if (current?.status === 'running') await update(j.id, { status: 'failed', readiness: 'offline', exit, finishedAt: now(), error: { code: 'SERVING_PROCESS_EXIT', message: 'Owned LitServe process exited. Review logs before a new attempt.' } });
      }).catch(() => {});
      return find(store.read(), 'jobs', j.id);
    } catch (e) {
      await control.handle?.terminate();
      return update(j.id, { status: controller.signal.aborted ? 'stopped' : 'failed', readiness: 'offline', error: summary(e), finishedAt: now() });
    } finally { if (!control.handle?.alive) controls.delete(j.id); }
  }
  function predict(input) { return track(predictImpl(input)); }
  async function predictImpl(input) {
    await ready(); const previous = prior(input, 'serving.inference'); if (previous) return previous;
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload) || Buffer.byteLength(canonical(input.payload)) > 256 * 1024) fail('VALIDATION', 'Prediction payload must be a JSON object up to 256 KiB');
    const transport = input.transport ?? 'rest'; if (!['rest', 'mcp'].includes(transport)) fail('VALIDATION', 'Choose rest or mcp');
    const { config } = configFor(store.read(), input.projectId), binding = await verifyBinding(store, input.projectId, config.binding);
    const { job: deployment, endpoint } = target(input.projectId, config, input.deploymentId);
    const j = await reserve('serving.inference', input, binding, config); if (j.replayed) return j;
    const controller = new AbortController(); controls.set(j.id, { controller }); if (closed) controller.abort();
    let dispatched = false, response, knownResponse = false, latencyMs; const started = performance.now();
    try {
      await update(j.id, { status: 'running', deploymentId: deployment?.deploymentId ?? null, endpoint, startedAt: now() });
      // A source/profile change between validation and reservation must never dispatch stale work.
      await verifyBinding(store, input.projectId, binding);
      if (canonical(configFor(store.read(), input.projectId).config) !== canonical(config)) fail('REVISION_CONFLICT', 'Serving selection changed before inference', 409);
      const observedBinding = config.mode === 'local' ? await observeLocal(deployment, endpoint, controller.signal) : { kind: 'declared-binding', loadedModelVerified: false };
      if (transport === 'rest') { const r = await jsonRequest(`${endpoint}/predict`, { body: input.payload, timeoutMs: config.timeoutMs, signal: controller.signal, onDispatch: () => { dispatched = true; } }); response = r.result; knownResponse = true; }
      else {
        if (!config.mcpTool) fail('MCP_TOOL_REQUIRED', 'Run Health to discover tools, then choose the inference tool in Models and Serving', 409);
        response = await withMcp(endpoint, config.timeoutMs, controller.signal, async client => {
          const tools = await discoverMcp(client, config.timeoutMs, controller.signal);
          if (!tools.some(t => t.name === config.mcpTool)) fail('MCP_TOOL_NOT_FOUND', 'Selected inference tool was not returned by current tools/list', 409);
          controller.signal.throwIfAborted(); dispatched = true;
          return client.callTool({ name: config.mcpTool, arguments: input.payload }, undefined, { timeout: config.timeoutMs, signal: controller.signal });
        });
        knownResponse = true;
      }
      latencyMs = performance.now() - started;
      const output = { schemaVersion: 1, jobId: j.id, runId: j.runId, deploymentId: deployment?.deploymentId ?? null,
        binding, bindingEvidence: observedBinding,
        engineeringFixture: deployment?.engineeringFixture ?? false, transport, request: input.payload, response, latencyMs, observedAt: now() };
      const project = find(store.read(), 'projects', input.projectId);
      const folder = path.join(project.workspace, '.forge', 'serving', 'results'); await mkdir(folder, { recursive: true });
      const file = await confined(project.workspace, path.join(folder, `${j.id}.json`), { existing: false });
      const bytes = Buffer.from(JSON.stringify(output, null, 2)); await writeFile(file, bytes, { flag: 'wx' });
      const artifact = entity({ name: `${j.id}.json`, kind: 'inference-result', path: file, sha256: digest(bytes), bytes: bytes.length, status: 'verified',
        source: { jobId: j.id, runId: j.runId, deploymentId: output.deploymentId, binding, profileRevision: j.profileRevision }, locations: [{ kind: 'local', path: file, verifiedAt: now() }] }, input.projectId);
      await store.transaction(s => { s.artifacts.push(artifact); });
      return update(j.id, { status: transport === 'mcp' && response.isError ? 'failed' : 'completed', result: response, artifactIds: [artifact.id],
        bindingEvidence: output.bindingEvidence, metrics: { latencyMs, observedAt: output.observedAt }, finishedAt: now(),
        ...(transport === 'mcp' && response.isError ? { error: { code: 'MCP_TOOL_ERROR', message: 'Inference tool returned isError; inspect the recorded result' } } : {}) });
    } catch (e) {
      return update(j.id, { status: (dispatched && !knownResponse && !e.definiteResponse) ? 'unknown' : 'failed', error: summary(e),
        ...(response === undefined ? {} : { result: response }),
        metrics: { latencyMs: latencyMs ?? performance.now() - started, observedAt: now() }, finishedAt: now(),
        reconciliation: dispatched && !knownResponse && !e.definiteResponse ? 'Request may have executed. Reusing operationId returns this record; inspect endpoint logs before a new operation.' : undefined });
    } finally { controls.delete(j.id); }
  }
  async function stop(id) {
    await ready(); const j = find(store.read(), 'jobs', id), control = controls.get(id);
    if (!j.kind?.startsWith('serving.')) fail('NOT_FOUND', 'Serving job not found', 404);
    if (!control || (j.kind === 'serving.deployment' && j.config.mode !== 'local')) fail('NO_OWNED_PROCESS', 'No owned serving process. Existing endpoints and persisted PIDs are never stopped by this service; inspect their resource state.', 409);
    await update(id, { status: 'stopping' }); control.controller.abort();
    if (control.handle) { await control.handle.terminate(); controls.delete(id); return update(id, { status: 'stopped', readiness: 'offline', finishedAt: now() }); }
    // Inference cancellation stops the client wait; the request may have reached the server.
    return find(store.read(), 'jobs', id);
  }
  async function detach(id){
    await ready();const job=find(store.read(),'jobs',id);
    if(job.kind!=='serving.deployment'||job.config.mode!=='existing')fail('SERVING_DETACH','Only an existing remote endpoint can be detached; stop owned local work instead',409);
    // This changes the attachment record only. No remote stop/kill is dispatched.
    return update(id,{status:'detached',readiness:'detached',owned:false,finishedAt:now()});
  }
  async function shutdown() {
    if (closed) return; closed = true; await recovered;
    for (const control of controls.values()) control.controller.abort();
    for (const [id, control] of controls) if (control.handle) await update(id, { status: 'stopping' });
    await Promise.allSettled([...controls.values()].map(c => c.handle?.terminate()));
    await Promise.allSettled([...tasks]);
    for (const [id, control] of controls) if (control.handle) await update(id, { status: 'stopped', readiness: 'offline', finishedAt: now() });
    controls.clear();
  }
  return { configure, health, predict, start, stop, detach, shutdown };
}
