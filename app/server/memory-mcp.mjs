import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMemoryMcpServer, MEMORY_TOOLS } from '../memory/mcp.mjs';
import { digest } from '../memory/contracts.mjs';

const TTL = 300000, BODY_LIMIT = 65536, CONCURRENT_LIMIT = 32;
const live = new Set(['starting', 'running', 'waiting']);
const id = { type: 'string', minLength: 1, maxLength: 200 };
const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const base = { projectId: id, runId: id };
// Owner HTTP routes use these exact bodies; caller identity is never in a body.
export const MEMORY_MCP_OWNER_SCHEMAS = Object.freeze({
  issue: schema({ ...base, operationId: id, expectedRevision: { type: 'integer', minimum: 1 }, access: { type: 'string', enum: ['read', 'read-write'], default: 'read' } }, ['projectId', 'runId', 'operationId', 'expectedRevision']),
  state: schema(base),
  revoke: schema({ ...base, sessionId: id, operationId: id, expectedRevision: { type: 'integer', minimum: 1 } }),
});
function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status, statusCode: status }); }
function validate(method, input) {
  const spec = MEMORY_MCP_OWNER_SCHEMAS[method];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !Object.hasOwn(spec.properties, k)) || spec.required.some(k => input[k] === undefined)) fail('MEMORY_MCP_VALIDATION', 'Use the exact Owner operation fields');
  for (const [k, value] of Object.entries(input)) {
    const p = spec.properties[k];
    if (p.type === 'string' && (typeof value !== 'string' || !value.trim() || value.length > (p.maxLength ?? 200) || p.enum && !p.enum.includes(value)) || p.type === 'integer' && (!Number.isSafeInteger(value) || value < p.minimum)) fail('MEMORY_MCP_VALIDATION', 'Invalid Owner operation field');
  }
  return structuredClone(method === 'issue' ? { ...input, access: input.access ?? 'read' } : input);
}
function localEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname === '/') throw new TypeError('Memory MCP needs an exact loopback HTTP endpoint without credentials/query/fragment');
  return url;
}
function canonicalRun(s, input) {
  const project = s.projects.find(p => p.id === input.projectId), run = s.runs.find(r => r.id === input.runId && r.projectId === input.projectId);
  if (!project || !run) fail('MEMORY_MCP_SCOPE', 'Select an existing run in this exact project', 403);
  return { project, run };
}
function binding(s, input) {
  const { project, run } = canonicalRun(s, input), selection = run.selection;
  const connection = s.connections.find(c => c.id === selection?.connectionId && c.projectId === project.id);
  // No alternate Memory entry point around an all-action qualification manifest.
  const guarded = x => x && Object.keys(x).some(k => /^guarded/i.test(k) && x[k] != null);
  const route = [selection?.instanceId, connection?.routeId, connection?.route, connection?.config?.routeId];
  const held = s.events.some(e => /^(?:proactive|research)[.-]/.test(e.type) && (e.runId === run.id || run.operationId !== undefined && (e.runOperationId === run.operationId || e.operationId === run.operationId) || e.type === 'proactive.occurrence' && e.projectId === run.projectId && e.held === true || e.type === 'research.trial' && run.workspaceContext?.workspaceId && e.manifest?.workspaceId === run.workspaceContext.workspaceId));
  if (run.proactiveContext || run.researchContext || guarded(run) || guarded(project.profile) || guarded(selection) || route.some(x => typeof x === 'string' && /guarded/i.test(x)) || held) fail('MEMORY_MCP_QUALIFICATION', 'This run has no qualified Memory MCP action manifest', 403);
  if (!live.has(run.status) || run.stopRequest || run.stopRequested || run.restoreReviewRequired) fail('MEMORY_MCP_RUN_INACTIVE', 'Memory MCP requires a live unstopped attempt', 409);
  for (const key of ['attemptId', 'threadId', 'providerRunId', 't3ProjectId', 'providerInstanceId']) if (typeof run[key] !== 'string' || !run[key]) fail('MEMORY_MCP_BINDING', 'Native attempt binding is not established', 409);
  if (!selection?.model || selection.instanceId !== run.providerInstanceId || !connection || connection.kind !== 'provider' || connection.enabled === false || connection.providerInstanceId !== selection.instanceId || connection.config?.generation !== selection.connectionGeneration) fail('MEMORY_MCP_BINDING', 'Provider account and selected model must match the exact run', 409);
  const selected = run.assistanceContext?.selection ?? project.profile?.provider;
  if (digest(selected ?? null) !== digest(selection)) fail('MEMORY_MCP_BINDING', 'Current selected model differs from this attempt', 409);
  for (const [key, collection] of [['botId', 'bots'], ['taskId', 'tasks'], ['conversationId', 'conversations']]) if (run[key] && !s[collection].some(x => x.id === run[key] && x.projectId === project.id)) fail('MEMORY_MCP_BINDING', 'Run scope identity is no longer present', 409);
  const task = s.tasks.find(t => t.id === run.taskId && t.projectId === project.id);
  if (task && task.botId !== run.botId) fail('MEMORY_MCP_BINDING', 'Task assignment changed', 409);
  return digest({ projectId: project.id, workspace: project.workspace, runId: run.id, attemptId: run.attemptId, threadId: run.threadId, providerRunId: run.providerRunId, t3ProjectId: run.t3ProjectId, providerInstanceId: run.providerInstanceId, selection, botId: run.botId, taskId: run.taskId, conversationId: run.conversationId, account: { generation: connection.config?.generation, routeId: connection.config?.routeId, accountRoute: connection.config?.accountRoute, route: connection.route, environmentId: connection.config?.environmentId } });
}
function reply(res, status, code) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify({ error: { code } }));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let count = 0;
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted); };
    const data = chunk => { count += chunk.length; if (count > BODY_LIMIT) { cleanup(); req.resume(); resolve(null); } else chunks.push(chunk); };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const error = () => { cleanup(); reject(new Error('Body unavailable')); };
    const aborted = () => error();
    const timer = setTimeout(() => { error(); req.destroy(); }, 10000); timer.unref?.();
    req.on('data', data); req.once('end', end); req.once('error', error); req.once('aborted', aborted);
  });
}

// Invoke INSIDE the existing restore transaction with both trusted snapshots.
// Preserve consumed Owner action identities even when restoring a pre-issue backup.
export function mergeMemoryMcpSafety(restored, previous) {
  for (const record of previous.events.filter(e => e.type === 'memory-mcp.session')) {
    const old = restored.events.find(e => e.id === record.id);
    if (old) {
      if (old.type !== record.type || old.tokenHash !== record.tokenHash || old.bindingHash !== record.bindingHash) fail('MEMORY_MCP_RESTORE_CONFLICT', 'Conflicting Memory MCP audit identity', 409);
      const revokedAt = old.revokedAt ?? record.revokedAt;
      Object.assign(old, structuredClone(record), { revokedAt });
    } else restored.events.push(structuredClone(record));
  }
  for (const receipt of previous.receipts.filter(r => r.type?.startsWith('memory-mcp.'))) {
    const old = restored.receipts.find(r => r.operationId === receipt.operationId);
    if (old && (old.fingerprint !== receipt.fingerprint || old.type !== receipt.type)) fail('MEMORY_MCP_RESTORE_CONFLICT', 'Conflicting Memory MCP operation identity', 409);
    if (!old) restored.receipts.push(structuredClone(receipt));
  }
  return restored;
}

// This factory creates no listener, provider turn, configuration write or job.
// All capabilities and raw bearer bytes remain private to this process instance.
export function createRunMemoryMcpGateway({ store, memory, endpoint, authorizeOwner, callerForRun, clock = Date.now }) {
  if (!store?.read || !store?.transaction || !memory || typeof authorizeOwner !== 'function' || typeof callerForRun !== 'function' || typeof clock !== 'function') throw new TypeError('Canonical store, Memory service and private authority callbacks required');
  const url = localEndpoint(endpoint), sessions = new Map(), requests = new Set(), calls = new Set(), ownerWork = new Set();
  let closed = false, generation = 0;
  const now = () => { const value = clock(); if (!Number.isSafeInteger(value)) throw new TypeError('Clock must return integer epoch milliseconds'); return value; };
  function owner(method, input, caller) {
    const identity = authorizeOwner({ action: `memory-mcp.${method}`, projectId: input.projectId, runId: input.runId }, caller);
    if (identity?.then || identity?.kind !== 'human' || identity?.role !== 'owner') fail('MEMORY_MCP_OWNER_REQUIRED', 'Authenticated human Owner authority required', 403);
    if (closed) fail('MEMORY_MCP_CLOSED', 'Memory MCP gateway is closed', 503);
  }
  const recordFor = (s, id) => s.events.find(e => e.type === 'memory-mcp.session' && e.id === id);
  function active(session, s) {
    if (closed || session.generation !== generation || sessions.get(session.id) !== session || now() >= session.expiresAt) return false;
    const record = recordFor(s, session.id);
    if (!record || record.projectId !== session.projectId || record.runId !== session.runId || record.attemptId !== session.attemptId || record.revokedAt !== null || record.bindingHash !== session.bindingHash || record.tokenHash !== session.tokenHash || record.expiresAt !== session.expiresAt || record.access !== session.access) return false;
    try { return binding(s, session) === session.bindingHash; } catch { return false; }
  }
  function check(session) { if (!active(session, store.read())) fail('MEMORY_MCP_LEASE_INACTIVE', 'Memory MCP lease is inactive', 401); }
  function view(record, s) {
    const session = sessions.get(record.id);
    return { sessionId: record.id, projectId: record.projectId, runId: record.runId, attemptId: record.attemptId, access: record.access, issuedAt: record.issuedAt, expiresAt: record.expiresAt, revokedAt: record.revokedAt,
      status: record.revokedAt !== null ? 'REVOKED' : now() >= record.expiresAt ? 'EXPIRED' : !session ? 'INVALIDATED' : active(session, s) ? 'ACTIVE' : 'INACTIVE' };
  }
  function priorOperation(s, input, fingerprint) {
    const prior = s.receipts.find(r => r.operationId === input.operationId);
    if (prior && (prior.fingerprint !== fingerprint || !prior.type?.startsWith('memory-mcp.')) || s.events.some(e => e.operationId === input.operationId)) fail('MEMORY_MCP_OPERATION_REUSE', 'Operation ID belongs to another action', 409);
    return prior;
  }
  function revision(run, input) { if (run.revision !== input.expectedRevision) fail('MEMORY_MCP_REVISION_CONFLICT', 'Run changed; reload before this Owner action', 409); }
  const track = (set, work) => { set.add(work); work.then(() => set.delete(work), () => set.delete(work)); return work; };
  async function issue(raw, caller) {
    const input = validate('issue', raw); owner('issue', input, caller);
    const fingerprint = digest({ method: 'issue', input }), issuedGeneration = generation;
    let session;
    const result = await store.transaction(s => {
      owner('issue', input, caller);
      if (generation !== issuedGeneration) fail('MEMORY_MCP_LEASE_INACTIVE', 'Recovery invalidated this pending action', 409);
      const prior = priorOperation(s, input, fingerprint);
      if (prior) { const record = recordFor(s, prior.sessionId); return { replayed: true, session: record ? view(record, s) : null, credentialStatus: 'NOT_REISSUED', newOwnerActionRequired: true }; }
      const { run } = canonicalRun(s, input); revision(run, input);
      const bindingHash = binding(s, input), issuedAt = now(), secret = randomBytes(32).toString('base64url');
      session = { ...input, id: randomUUID(), attemptId: run.attemptId, bindingHash, secret, tokenHash: digest(secret), issuedAt, expiresAt: issuedAt + TTL, generation };
      session.caller = callerForRun(structuredClone(run), { allowWrite: input.access === 'read-write', active: state => active(session, state) });
      if (!session.caller || typeof session.caller !== 'object' || session.caller.then) fail('MEMORY_MCP_AUTHORITY', 'Private run authority unavailable', 503);
      const record = { id: session.id, type: 'memory-mcp.session', revision: 1, projectId: input.projectId, runId: run.id, attemptId: run.attemptId, bindingHash, tokenHash: session.tokenHash, access: input.access, issuedAt, expiresAt: session.expiresAt, revokedAt: null };
      s.events.push(record);
      s.receipts.push({ type: 'memory-mcp.issue', operationId: input.operationId, fingerprint, projectId: input.projectId, runId: run.id, sessionId: session.id, at: issuedAt });
      return { replayed: false, session: { ...view(record, s), status: 'ACTIVE' } };
    });
    owner('issue', input, caller);
    if (session) {
      if (generation !== issuedGeneration) fail('MEMORY_MCP_LEASE_INACTIVE', 'Recovery invalidated this grant; use a new Owner action', 409);
      sessions.set(session.id, session); check(session);
      // Only this initial authorized Owner response carries the transient bearer.
      return { ...result, transportStatus: 'HTTP_MCP_AVAILABLE', nativeAttachmentStatus: 'NATIVE_ATTACHMENT_NOT_CONFIGURED', configuration: { type: 'http', url: url.href, headers: { Authorization: `Bearer ${session.secret}` } } };
    }
    return result;
  }
  function state(raw, caller) {
    const input = validate('state', raw); owner('state', input, caller);
    const s = store.read(); canonicalRun(s, input);
    return { ...input, transportStatus: 'HTTP_MCP_AVAILABLE', nativeAttachmentStatus: 'NATIVE_ATTACHMENT_NOT_CONFIGURED', nativeAttachmentQualification: 'NOT_RUN', ttlMs: TTL,
      sessions: s.events.filter(e => e.type === 'memory-mcp.session' && e.projectId === input.projectId && e.runId === input.runId).map(e => view(e, s)) };
  }
  async function revoke(raw, caller) {
    const input = validate('revoke', raw); owner('revoke', input, caller);
    const fingerprint = digest({ method: 'revoke', input });
    const result = await store.transaction(s => {
      owner('revoke', input, caller);
      const prior = priorOperation(s, input, fingerprint);
      if (prior) return { replayed: true, sessionId: prior.sessionId, revoked: true };
      const { run } = canonicalRun(s, input); revision(run, input);
      const record = recordFor(s, input.sessionId);
      if (!record || record.projectId !== input.projectId || record.runId !== input.runId) fail('MEMORY_MCP_SCOPE', 'Session does not belong to this run', 403);
      record.revokedAt ??= now(); record.revision++;
      s.receipts.push({ type: 'memory-mcp.revoke', operationId: input.operationId, fingerprint, projectId: input.projectId, runId: input.runId, sessionId: record.id, at: now() });
      return { replayed: false, sessionId: record.id, revoked: true };
    });
    sessions.delete(input.sessionId); return result;
  }
  async function handle(req, res) {
    if ((req.url ?? '').split('?')[0] !== url.pathname) return false;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers.host !== url.host || req.headers.origin !== undefined && req.headers.origin !== url.origin) { reply(res, 403, 'MEMORY_MCP_LOCAL_ONLY'); return true; }
    if (closed) { reply(res, 503, 'MEMORY_MCP_CLOSED'); return true; }
    // Authenticate before consuming bytes, parsing JSON or allocating an SDK server.
    const supplied = req.headers.authorization;
    let session;
    if (typeof supplied === 'string' && /^Bearer [A-Za-z0-9_-]{43}$/.test(supplied)) {
      const actual = Buffer.from(digest(supplied.slice(7)), 'hex');
      for (const candidate of sessions.values()) if (timingSafeEqual(Buffer.from(candidate.tokenHash, 'hex'), actual)) session = candidate;
    }
    if (!session || !active(session, store.read())) { reply(res, 401, 'MEMORY_MCP_AUTH'); return true; }
    if (req.url !== url.pathname) { reply(res, 400, 'MEMORY_MCP_URL'); return true; }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); reply(res, 405, 'METHOD_NOT_ALLOWED'); return true; }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) { reply(res, 415, 'CONTENT_TYPE'); return true; }
    if (Number(req.headers['content-length'] ?? 0) > BODY_LIMIT) { req.resume(); reply(res, 413, 'REQUEST_LIMIT'); return true; }
    if (requests.size >= CONCURRENT_LIMIT) { reply(res, 429, 'MEMORY_MCP_BUSY'); return true; }
    const request = { req, res, server: null }; requests.add(request);
    try {
      const bytes = await readBody(req);
      if (bytes === null) { reply(res, 413, 'REQUEST_LIMIT'); return true; }
      check(session);
      let body; try { body = JSON.parse(bytes.toString('utf8')); } catch { reply(res, 400, 'INVALID_JSON'); return true; }
      if (!body || Array.isArray(body) || typeof body !== 'object') { reply(res, 400, 'INVALID_JSONRPC'); return true; }
      const methods = session.access === 'read-write' ? ['remember', 'recall', 'update', 'list', 'forget'] : ['recall', 'list'];
      const service = Object.fromEntries(['remember', 'recall', 'update', 'list', 'forget'].map(method => [method, async input => {
        check(session);
        if (!methods.includes(method)) fail('MEMORY_MCP_READ_ONLY', 'This session permits recall and list only', 403);
        return track(calls, (async () => { const value = await memory[method](input, session.caller); check(session); return value; })());
      }]));
      const server = createMemoryMcpServer({ service, callerContext: session.caller }); request.server = server;
      server.setRequestHandler(ListToolsRequestSchema, () => { check(session); return { tools: structuredClone(MEMORY_TOOLS.filter(t => methods.includes(t.name.split('.')[1]))) }; });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport); check(session);
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      await transport.handleRequest(req, res, body);
    } catch (error) { if (!res.headersSent) reply(res, error.code === 'MEMORY_MCP_LEASE_INACTIVE' ? 401 : 500, error.code === 'MEMORY_MCP_LEASE_INACTIVE' ? error.code : 'MEMORY_MCP_TRANSPORT'); else if (!res.writableEnded) res.end(); }
    finally { await request.server?.close().catch(() => {}); requests.delete(request); }
    return true;
  }
  return Object.freeze({
    issue: (input, caller) => track(ownerWork, issue(input, caller)), state,
    revoke: (input, caller) => track(ownerWork, revoke(input, caller)), handler: handle,
    // Call synchronously BEFORE restore/dispatch quiescence. Old grants never revive.
    invalidateForRestore() { generation++; sessions.clear(); },
    async close() {
      closed = true; generation++; sessions.clear();
      for (const r of requests) { r.req.destroy(); r.res.destroy(); await r.server?.close().catch(() => {}); }
      await Promise.allSettled([...ownerWork, ...calls]);
    },
  });
}
