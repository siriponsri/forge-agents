import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function sameOrigin(request, port) {
  const host = String(request.headers.host || '');
  if (!new RegExp(`^(127\\.0\\.0\\.1|localhost)(:${port})?$`, 'i').test(host)) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try { const parsed = new URL(origin); return ['127.0.0.1', 'localhost'].includes(parsed.hostname) && String(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)) === String(port); } catch { return false; }
}
function sendJson(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
function readBody(request, limit = 65536) { return new Promise((resolve, reject) => { let body = ''; request.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > limit) { reject(new Error('request too large')); request.destroy(); } }); request.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('invalid JSON')); } }); request.on('error', reject); }); }

export function createMonitor({ runtime, port = 3915, host = '127.0.0.1', staticRoot = path.join(import.meta.dirname, '..', 'monitor') } = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const clients = new Set();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${host}:${port}`);
    if (!sameOrigin(request, port)) return sendJson(response, 403, { error: 'strict host/origin policy' });
    try {
      if (request.method === 'GET' && url.pathname === '/health') return sendJson(response, 200, { ok: true, service: 'hoh-p9.5-monitor', host, port, control_token_required: true });
      if (request.method === 'GET' && url.pathname === '/api/state') return sendJson(response, 200, runtime.controlState ? runtime.controlState() : runtime.monitorState());
      if (request.method === 'GET' && url.pathname === '/api/projects') return sendJson(response, 200, { projects: [runtime.controlState ? runtime.controlState() : runtime.monitorState()] });
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const lastId = request.headers['last-event-id'];
        const previous = runtime.ledger.after(lastId);
        if (!lastId || previous.length === 0) { const state = runtime.controlState ? runtime.controlState() : runtime.monitorState(); response.write(`id: ${state.last_event_id || '0'}\nevent: StateSnapshot\ndata: ${JSON.stringify(state)}\n\n`); }
        for (const event of previous) response.write(`id: ${event.event_id}\nevent: ${event.type}\ndata: ${JSON.stringify(runtime.toAgUi(event))}\n\n`);
        const client = { response, onEvent: event => { response.write(`id: ${event.event_id}\nevent: ${event.type}\ndata: ${JSON.stringify(runtime.toAgUi(event))}\n\n`); } };
        clients.add(client); runtime.ledger.on('event', client.onEvent);
        const heartbeat = setInterval(() => { try { response.write(`: heartbeat ${Date.now()}\n\n`); } catch { /* closed */ } }, 10000);
        request.on('close', () => { clearInterval(heartbeat); clients.delete(client); runtime.ledger.off('event', client.onEvent); });
        return;
      }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return response.end(fs.readFileSync(path.join(staticRoot, 'index.html'), 'utf8').replace('__CONTROL_TOKEN_VALUE__', token)); }
      if (request.method === 'GET' && url.pathname === '/app.js') { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); return response.end(fs.readFileSync(path.join(staticRoot, 'app.js'))); }
      if (request.method === 'GET' && url.pathname === '/styles.css') { response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' }); return response.end(fs.readFileSync(path.join(staticRoot, 'styles.css'))); }
      if (request.method === 'GET' && url.pathname === '/p95b.css') { response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' }); return response.end(fs.readFileSync(path.join(staticRoot, 'p95b.css'))); }
      if (request.method === 'POST' && url.pathname.startsWith('/api/control/')) {
        if (request.headers['x-hoh-control-token'] !== token) return sendJson(response, 403, { error: 'control token required' });
        const payload = await readBody(request); let result;
        if (url.pathname === '/api/control/pause') result = runtime.pauseSafely(payload.reason || 'OWNER_REQUEST');
        else if (url.pathname === '/api/control/resume') result = runtime.resumeSafely();
        else if (url.pathname === '/api/control/stop-after-current') result = runtime.stopAfterCurrent();
        else if (url.pathname === '/api/control/fallback/allow') result = runtime.allowFallback(payload.route || null);
        else if (url.pathname === '/api/control/fallback/reject') result = runtime.rejectFallback(payload.route || null);
        else if (url.pathname === '/api/control/provider/probe') result = runtime.probeProvider(payload.provider || 'OpenCode Go');
        else return sendJson(response, 404, { error: 'unknown control' });
        return sendJson(response, 200, { ok: true, result });
      }
      sendJson(response, 404, { error: 'not found' });
    } catch (error) { sendJson(response, 400, { error: error.message }); }
  });
  return { server, token, port, host, url: `http://${host}:${port}`, clients, listen: () => new Promise(resolve => server.listen(port, host, resolve)), close: () => new Promise(resolve => server.close(resolve)) };
}
