import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SCOPE_KEYS, object } from './agent-contract.mjs';

const identifier = { type: 'string', minLength: 1, maxLength: 256 };
const scopeProperties = Object.fromEntries(SCOPE_KEYS.map(k => [k, identifier]));
const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const scoped = { ...scopeProperties, expectedRevision: { type: 'integer', minimum: 1 } };
export const OFFICE_AGENT_TOOLS = Object.freeze([
  { name: 'office.document.read', description: 'Read a bounded saved selection at an explicit document revision. Unsaved mounted-editor work is excluded.', inputSchema: schema({ ...scoped, selection: { oneOf: [schema({ sheetId: identifier, range: { type: 'string', maxLength: 30 } }), schema({ index: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: 10000 } })] } }), annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'office.sheet.setValues', description: 'Queue a bounded tab-separated sheet edit for the same mounted editor review/undo/save path. A pending/review result is NOT an applied edit. Reuse operationId on delivery uncertainty; query office.request.status for durable completion.', inputSchema: schema({ ...scoped, operationId: identifier, sheetId: identifier, range: { type: 'string', maxLength: 30 }, text: { type: 'string', maxLength: 10000 } }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'office.doc.insertText', description: 'Queue one paragraph insertion at a zero-based offset for mounted-editor review/undo/save. Only a verified document.save receipt establishes completion; retry delivery with the same operationId.', inputSchema: schema({ ...scoped, operationId: identifier, index: { type: 'integer', minimum: 0 }, text: { type: 'string', minLength: 1, maxLength: 10000 } }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'office.request.status', description: 'Reconcile a previously queued edit with the real durable save receipt. Never re-executes the edit. Returns pending, review, applying, uncertain, completed, conflict or rejected.', inputSchema: schema({ ...scopeProperties, operationId: identifier }), annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
]);
const output = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
export function createOfficeAgentMcpServer({ service }) {
  const server = new Server({ name: 'forge-office-agent', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: 'Edits are durable requests, not direct mutations. Only the FORGE mounted editor can review/apply/save them. Do not report completion while request.status is pending/review/applying/uncertain. No generic T3 frontend-tool-result is supported.' });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: structuredClone(OFFICE_AGENT_TOOLS) }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const tool = OFFICE_AGENT_TOOLS.find(t => t.name === params.name);
      if (!tool) return { ...output({ error: { code: 'UNKNOWN_TOOL', message: 'Unsupported office tool' } }), isError: true };
      const args = object(params.arguments, Object.keys(tool.inputSchema.properties));
      if (tool.inputSchema.required.some(k => args[k] === undefined)) throw Object.assign(new Error('Explicit scope and typed operation arguments are required'), { code: 'VALIDATION' });
      if (params.name === 'office.document.read') return output(await service.readDocument(args));
      if (params.name === 'office.request.status') return output(await service.status(args));
      const { sheetId, range, text, index, ...input } = args;
      return output(await service.requestEdit({ ...input, edit: params.name === 'office.sheet.setValues' ? { kind: 'sheet.setValues', sheetId, range, text } : { kind: 'doc.insertText', index, text } }));
    } catch (error) {
      // No raw request, credential, file path or internal stack is returned/logged.
      const known = typeof error.code === 'string' && !error.code.startsWith('ERR_');
      return { ...output({ error: { code: known ? error.code : 'OFFICE_INTERNAL', message: known ? error.message : 'Office request failed; reconcile status before retrying' } }), isError: true };
    }
  });
  return server;
}

// This credential is machine private, not a connection/domain record. The parent
// data directory must retain the current Windows user's ACL (POSIX mode alone is
// not an ACL restriction on Windows). Never include .office-agent-private in backup.
export async function loadOfficeAgentSecret(dataDir) {
  if (!path.isAbsolute(dataDir ?? '')) throw new TypeError('An absolute machine-private dataDir is required');
  await mkdir(dataDir, { recursive: true });
  const root = await realpath(dataDir), privateDir = path.join(root, '.office-agent-private');
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  if ((await lstat(privateDir)).isSymbolicLink() || await realpath(privateDir) !== privateDir) throw new Error('Machine-private credential directory must not be a link');
  const secretFile = path.join(privateDir, 'mcp-bearer.secret');
  let handle;
  try { handle = await open(secretFile, 'wx', 0o600); await handle.writeFile(randomBytes(32).toString('base64url')); await handle.sync(); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  finally { await handle?.close(); }
  if (!(await lstat(secretFile)).isFile() || (await lstat(secretFile)).isSymbolicLink()) throw new Error('Invalid machine-private credential file');
  const secret = (await readFile(secretFile, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('Invalid machine-private credential; preserve file and recover explicitly');
  return { secret, secretFile };
}
export function localEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Office MCP endpoint must be an explicit loopback HTTP URL without credentials/query/fragment');
  return url;
}
function matches(secret, supplied) {
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(supplied ?? '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function reply(res, status, code) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify({ error: { code } })); }
function boundedBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0;
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted); };
    const data = chunk => {
      bytes += chunk.length;
      if (bytes > 65536) { cleanup(); req.resume(); resolve(null); }
      else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const error = cause => { cleanup(); reject(cause); };
    const aborted = () => error(new Error('Request aborted'));
    req.on('data', data); req.once('end', end); req.once('error', error); req.once('aborted', aborted);
  });
}

// Mount BEFORE the ordinary JSON router: this function consumes the raw body.
// No server/listener, provider turn or endpoint is started by importing it.
export async function createOfficeAgentMcpHandler({ service, dataDir, endpoint, secret: suppliedSecret }) {
  const url = localEndpoint(endpoint), secret = suppliedSecret ?? (await loadOfficeAgentSecret(dataDir)).secret;
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('A machine-local 256-bit bearer is required');
  const active = new Set();
  const handler = async (req, res) => {
    if ((req.url ?? '').split('?')[0] !== url.pathname) return false;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers.host !== url.host || (req.headers.origin !== undefined && req.headers.origin !== url.origin)) { reply(res, 403, 'OFFICE_LOCAL_ONLY'); return true; }
    if (!matches(secret, req.headers.authorization)) { reply(res, 401, 'OFFICE_AUTH'); return true; }
    if (req.url !== url.pathname) { reply(res, 400, 'OFFICE_URL'); return true; }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); reply(res, 405, 'METHOD_NOT_ALLOWED'); return true; }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) { reply(res, 415, 'CONTENT_TYPE'); return true; }
    if (Number(req.headers['content-length'] ?? 0) > 65536) { req.resume(); reply(res, 413, 'REQUEST_LIMIT'); return true; }
    if (active.size >= 32) { reply(res, 429, 'OFFICE_BUSY'); return true; }
    const server = createOfficeAgentMcpServer({ service }); active.add(server);
    let timeout;
    try {
      // Bounded raw body, including chunked requests. No JSON-RPC batch dispatch.
      timeout = setTimeout(() => req.destroy(), 10000); timeout.unref?.();
      const bytes = await boundedBody(req);
      if (bytes === null) { reply(res, 413, 'REQUEST_LIMIT'); return true; }
      clearTimeout(timeout);
      let body; try { body = JSON.parse(bytes.toString('utf8')); } catch { reply(res, 400, 'INVALID_JSON'); return true; }
      if (!body || Array.isArray(body) || typeof body !== 'object') { reply(res, 400, 'INVALID_JSONRPC'); return true; }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      res.setHeader('Cache-Control', 'no-store');
      await transport.handleRequest(req, res, body);
    } catch { if (!res.headersSent) reply(res, 500, 'OFFICE_TRANSPORT'); else res.end(); }
    finally { clearTimeout(timeout); await server.close().catch(() => {}); active.delete(server); }
    return true;
  };
  handler.close = () => Promise.allSettled([...active].map(server => server.close()));
  return handler;
}
