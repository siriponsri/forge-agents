import { createServer } from 'node:http';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { createFrontendToolsHttpHandler } from './http.mjs';
import { FRONTEND_TOOL, identifier, object } from './contract.mjs';
import { canonical, digest } from '../guarded-runtime/profile.mjs';

const equal = (a, b) => { const x = Buffer.from(a ?? ''), y = Buffer.from(b ?? ''); return x.length === y.length && timingSafeEqual(x, y); };
const synchronous = (fn, ...args) => { const value = fn(...args); if (value?.then) throw Error('FRONTEND_SYNCHRONOUS_AUTHORITY_REQUIRED'); return value; };
// Authenticated private native bootstrap transport. Owns no thread, turn, task,
// model loop or second store. Root supplies actual current authority and observed
// private adapter mapping; an unobserved session/turn cannot acquire a bearer.
export async function openFrontendNativeGateway({ broker, assertCurrent, bindingProvider, authorizePhase, authenticateOwner }) {
  if (![assertCurrent, bindingProvider, authorizePhase, authenticateOwner].every(x => typeof x === 'function')) throw TypeError('Canonical current/phase/binding/Owner callbacks required');
  const key = randomBytes(32), token = key.toString('hex');
  let closed = false, http, grant, bindingHash;
  const current = () => {
    if (closed) throw Error('FRONTEND_GATEWAY_CLOSED');
    const profile = synchronous(assertCurrent);
    if (profile?.purpose !== 'supervised-frontend-v1' || !Number.isSafeInteger(profile.expiresAt) || profile.expiresAt <= Date.now()) throw Error('FRONTEND_CURRENT_AUTHORITY_DENIED');
    return profile;
  };
  const server = createServer(async (req, res) => {
    const reply = (status, value) => { if (res.destroyed || res.writableEnded) return; res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      if (http && await http.handler(req, res)) return;
      // No unauthenticated body read, SDK allocation or canonical mutation.
      if (req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== new URL(url).host || req.headers.origin !== undefined || !equal(req.headers.authorization, 'Bearer ' + token)) return reply(401, { ok: false, error: 'FRONTEND_NATIVE_AUTH' });
      const profile = current();
      if (req.method !== 'POST') return reply(405, { ok: false, error: 'FRONTEND_METHOD' });
      if (!['/mcp', '/fence', '/frontend-binding'].includes(req.url)) return reply(404, { ok: false, error: 'FRONTEND_METHOD' });
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '') || Number(req.headers['content-length'] ?? 0) > 32768) return reply(413, { ok: false, error: 'FRONTEND_FRAME_LIMIT' });
      let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 32768) throw Error('FRONTEND_FRAME_LIMIT'); }
      const body = JSON.parse(raw); current();
      if (req.url === '/mcp') {
        if (body.jsonrpc !== '2.0') throw Error('FRONTEND_PROTOCOL');
        if (body.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
        const result = body.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'forge-frontend', version: '1' } } : body.method === 'tools/list' ? { tools: [FRONTEND_TOOL] } : null;
        if (!result) throw Error('FRONTEND_CATALOG_ONLY');
        return reply(200, { jsonrpc: '2.0', id: body.id, result });
      }
      if (!equal(req.headers['x-forge-mac'], createHmac('sha256', key).update(raw).digest('hex')) || body.profileDigest !== digest(profile)) throw Error('FRONTEND_NATIVE_AUTH');
      if (req.url === '/fence') {
        object(body, ['profileDigest', 'phase', 'sessionID']); identifier(body.phase);
        if (synchronous(authorizePhase, body, profile) !== true) throw Error('FRONTEND_PHASE_DENIED');
        return reply(200, { ok: true, result: { profileDigest: digest(profile) } });
      }
      object(body, ['profileDigest', 'sessionId', 'callId', 'messageId']);
      for (const k of ['sessionId', 'callId', 'messageId']) identifier(body[k]);
      const binding = synchronous(bindingProvider, { sessionId: body.sessionId, callId: body.callId, messageId: body.messageId }, profile);
      if (binding?.identityKind !== 'private-adapter' || binding.nativeSessionId !== body.sessionId || binding.projectId !== profile.projectId || binding.runId !== profile.runId || binding.threadId !== profile.threadId) throw Error('FRONTEND_NATIVE_BINDING');
      // bindNativeTurn repeats canonical mapping/Stop/revision checks under the
      // supplied host callback. Neither this response nor a config flag is proof.
      if (!grant) { grant = broker.bindNativeTurn(binding); bindingHash = digest(binding); }
      if (digest(binding) !== bindingHash) throw Error('FRONTEND_NATIVE_BINDING_CHANGED');
      broker.tools(grant.handle);
      return reply(200, { ok: true, result: { binding, endpoint: url + '/mcp/frontend-tools', authorization: grant.authorization, expiresAt: grant.expiresAt } });
    } catch (e) { if (!res.headersSent) reply(403, { ok: false, error: /^FRONTEND_[A-Z_]+$/.test(e.code ?? e.message) ? e.code ?? e.message : 'FRONTEND_NATIVE_DENIED' }); else res.destroy(); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 5000; server.maxHeadersCount = 24;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  http = createFrontendToolsHttpHandler({ broker, endpoint: url + '/mcp/frontend-tools', authenticateOwner });
  return Object.freeze({
    url,
    // HOST ONLY. Feed to the child through its inherited private pipe; never
    // return in Owner/domain/config/protocol/state or persist in release proof.
    bootstrap() { current(); return { key: token, brokerUrl: url }; },
    async close() { closed = true; key.fill(0); await http.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); },
  });
}
