import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fault, text } from './common.mjs';

/** A separately installed interactive guest agent, intended behind a local SSH tunnel.
 * The listener is loopback-only. Authentication is checked before any body is processed.
 * One pinned target is exported; callers cannot choose host processes, scripts or projects.
 */
export async function createGuestAgent({ service, projectId, targetId, agentId, token, port = 0 }) {
  text(agentId, 'agentId'); if (typeof token !== 'string' || token.length < 32 || token.length > 512) throw fault('AUTH_REQUIRED', 'Guest agent needs a 32..512 character machine-local secret');
  const expected = Buffer.from(`Bearer ${token}`);
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
    function reply(status, value) { res.writeHead(status); res.end(JSON.stringify(value)); }
    const actual = Buffer.from(req.headers.authorization ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { reply(401, { error: { code: 'AUTH_REQUIRED' } }); req.resume(); return; }
    if (req.method !== 'POST') { reply(405, { error: { code: 'METHOD' } }); return; }
    try {
      let length = 0; const chunks = [];
      for await (const chunk of req) { length += chunk.length; if (length > 65536) throw fault('LIMIT', 'Request too large', 413); chunks.push(chunk); }
      let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fault('VALIDATION', 'JSON body required'); }
      if (input.agentId !== agentId || input.targetId !== targetId) throw fault('TARGET_IDENTITY', 'Select the configured agent and target', 409);
      const args = { ...input, projectId, targetId }; let result;
      switch (req.url) {
        case '/v1/health': result = await service.health(args); break;
        case '/v1/windows': result = await service.listWindows(args); break;
        case '/v1/acquire': result = await service.acquire(args); break;
        case '/v1/action': result = await service.action(args); break;
        case '/v1/stop': result = await service.stop({ ...args, takeover: false }); break;
        case '/v1/screenshot': {
          const image = await service.screenshot(args); result = { base64: (await readFile(image.path)).toString('base64') }; break;
        }
        default: throw fault('NOT_FOUND', 'Unknown protocol method', 404);
      }
      reply(200, { protocol: 'forge-desktop/1', agentId, targetId, result });
    } catch (e) { if (!res.headersSent) reply(e.statusCode ?? 500, { error: { code: e.code ?? 'AGENT_FAILURE' } }); }
  });
  server.requestTimeout = 40000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { endpoint: `http://127.0.0.1:${server.address().port}`, async close() { await service.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
