import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { LIMITS, SCOPE_KEYS, fail } from './contract.mjs';

function reply(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) fail('FRONTEND_CONTENT_TYPE', 415);
  if (Number(req.headers['content-length'] ?? 0) > LIMITS.body) fail('FRONTEND_BODY_LIMIT', 413);
  return new Promise((resolve, reject) => {
    const chunks = []; let count = 0;
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', error); };
    const error = () => { cleanup(); reject(Object.assign(new Error('FRONTEND_BODY'), { code: 'FRONTEND_BODY', statusCode: 400 })); };
    const data = chunk => { count += chunk.length; if (count > LIMITS.body) { cleanup(); req.resume(); reject(Object.assign(new Error('FRONTEND_BODY_LIMIT'), { code: 'FRONTEND_BODY_LIMIT', statusCode: 413 })); } else chunks.push(chunk); };
    const end = () => { cleanup(); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('FRONTEND_JSON'), { code: 'FRONTEND_JSON', statusCode: 400 })); } };
    const timer = setTimeout(() => { error(); req.destroy(); }, 10000); timer.unref?.();
    req.on('data', data); req.once('end', end); req.once('error', error); req.once('aborted', error);
  });
}

// Mount on the EXISTING localhost server before its generic JSON body parser.
// authenticateOwner must use the application's real human session and CSRF
// checks, and return its opaque authority.owner(session) handle. It runs first.
export function createFrontendToolsHttpHandler({ broker, endpoint, authenticateOwner }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.pathname !== '/mcp/frontend-tools' || url.username || url.password || url.search || url.hash || typeof authenticateOwner !== 'function') throw new TypeError('Explicit local endpoint and Owner authenticator required');
  const requests = new Set(), nativeRequests = new Map(); let closed = false;
  const paths = [url.pathname, '/api/frontend-tools/pending', '/api/frontend-tools/result'];
  async function handler(req, res) {
    const path = (req.url ?? '').split('?')[0];
    if (!paths.includes(path)) return false;
    let server, controller, disconnected, requestKey;
    try {
      if (closed) fail('FRONTEND_HTTP_CLOSED', 503);
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers.host !== url.host || req.headers.origin !== undefined && req.headers.origin !== url.origin) fail('FRONTEND_LOCAL_ONLY', 403);
      if (requests.size >= 64) fail('FRONTEND_HTTP_BUSY', 429);
      // Both auth paths precede bytes, JSON parsing, SDK allocation and writes.
      const native = path === url.pathname ? broker.authenticateNative(req.headers.authorization) : undefined;
      const caller = native ? undefined : await authenticateOwner(req, res);
      if (!native && !caller) fail('FRONTEND_OWNER_REQUIRED', 403);
      requests.add(res);
      if (path === '/api/frontend-tools/pending') {
        if (req.method !== 'GET') fail('FRONTEND_METHOD', 405);
        const query = new URL(req.url, url).searchParams;
        if ([...query.keys()].some(k => !SCOPE_KEYS.includes(k)) || [...query.keys()].length !== SCOPE_KEYS.length) fail('FRONTEND_VALIDATION', 400);
        reply(res, 200, broker.state(Object.fromEntries(query), caller)); return true;
      }
      if (req.method !== 'POST' || req.url !== path) fail('FRONTEND_METHOD', 405);
      controller = new AbortController();
      disconnected = () => { if (!res.writableFinished) controller.abort(); };
      res.once('close', disconnected);
      const body = await readBody(req);
      if (!native) { reply(res, 200, await broker.returnResult(body, caller)); return true; }
      // Stateless SDK transports use separate POSTs for cancellation. Route that
      // notification to the original HTTP continuation, scoped to the SAME
      // authenticated native lease. JSON-RPC IDs stay transport identities only.
      const rpcId = value => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);
      if (body?.method === 'notifications/cancelled') {
        if (body.jsonrpc !== '2.0' || body.id !== undefined || !rpcId(body.params?.requestId)) fail('FRONTEND_VALIDATION', 400);
        nativeRequests.get(JSON.stringify([req.headers.authorization, body.params.requestId]))?.abort();
        res.writeHead(202); res.end(); return true;
      }
      if (body?.method === 'tools/call' && rpcId(body.id)) {
        requestKey = JSON.stringify([req.headers.authorization, body.id]);
        if (nativeRequests.has(requestKey)) fail('FRONTEND_RPC_ALREADY_PENDING');
        nativeRequests.set(requestKey, controller);
      }
      // Stateless MCP: a single HTTP tools/call remains pending on its original
      // JSON-RPC ID. No notification, polling replacement call or text turn.
      broker.tools(native);
      server = new Server({ name: 'forge-supervised-frontend', version: '1.0.0' }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: broker.tools(native) }));
      server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
        const signal = AbortSignal.any([controller.signal, extra.signal]);
        return broker.callNative(native, request.params, signal);
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) reply(res, error.statusCode ?? 500, { error: { code: error.code?.startsWith('FRONTEND_') ? error.code : 'FRONTEND_HTTP_ERROR' } });
      else if (!res.writableEnded) res.end();
    } finally {
      if (disconnected) res.off('close', disconnected);
      if (requestKey && nativeRequests.get(requestKey) === controller) nativeRequests.delete(requestKey);
      await server?.close().catch(() => {}); requests.delete(res);
    }
    return true;
  }
  return Object.freeze({ handler, async close() { closed = true; await broker.close(); for (const res of requests) res.destroy(); } });
}
