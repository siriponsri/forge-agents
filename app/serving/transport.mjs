import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fail } from '../server/domain.mjs';

export async function jsonRequest(url, { signal, timeoutMs = 10000, body, onDispatch } = {}) {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  requestSignal.throwIfAborted(); onDispatch?.();
  const r = await fetch(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: requestSignal,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const reader = r.body?.getReader(); const chunks = []; let size = 0;
  if (reader) try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) fail('RESPONSE_SIZE', 'Inference response exceeds 2 MiB; export large output as an artifact', 502); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const text = Buffer.concat(chunks).toString('utf8'); let result;
  try { result = JSON.parse(text); } catch { result = { text }; }
  if (!r.ok) throw Object.assign(new Error(`LitServe returned HTTP ${r.status}`), { code: 'SERVING_HTTP', statusCode: 502, httpStatus: r.status, response: result, definiteResponse: true });
  return { httpStatus: r.status, result };
}
export async function withMcp(baseURL, timeoutMs, signal, fn) {
  const client = new Client({ name: 'forge-serving', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp/`), { requestInit: { redirect: 'error' },
    // An SSE reconnect must not turn an uncertain call into a new request.
    reconnectionOptions: { maxRetries: 0, maxReconnectionDelay: 0, initialReconnectionDelay: 0, reconnectionDelayGrowFactor: 1 } });
  const abort = () => { void transport.close(); };
  signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
  try { await client.connect(transport, { timeout: timeoutMs, signal }); return await fn(client); }
  finally { signal?.removeEventListener('abort', abort); await client.close().catch(() => {}); }
}
export async function discoverMcp(client, timeoutMs, signal) {
  const tools = []; let cursor, pages = 0;
  do {
    const page = await client.listTools(cursor ? { cursor } : {}, { timeout: timeoutMs, signal });
    tools.push(...page.tools); cursor = page.nextCursor;
    if (tools.length > 256 || ++pages > 16) fail('MCP_TOOL_LIMIT', 'Serving endpoint discovery exceeds 256 tools or 16 pages; select a bounded inference endpoint', 422);
  } while (cursor);
  return tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}
