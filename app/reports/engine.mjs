import { join, basename, isAbsolute } from 'node:path';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { digestFile, fault, sha256 } from './files.mjs';
import { RELEASES } from './releases.mjs';

export const REQUIRED = {
  wordcraft: ['new_document', 'execute', 'type_text', 'insert_table', 'save_document', 'open_document', 'inspect_document', 'get_text', 'list_commands'],
  pdfcraft: ['doc_open', 'doc_save', 'doc_inspect', 'render_preview', 'page_rotate', 'text_extract'],
};
export function resultData(result) {
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.filter(x => x.type === 'text').map(x => x.text).join('\n');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}
export async function verifyEngine(engine, config) {
  if (!config?.path) throw fault('ENGINE_NOT_INSTALLED', `Install the qualified ${engine} package from report engine Settings.`, 503);
  const pin = RELEASES[engine];
  if (!isAbsolute(config.path) || basename(config.path).toLowerCase() !== `${engine}-cli.exe`) throw fault('ENGINE_PATH', `Choose the actual ${engine}-cli.exe, not a shell or script.`, 422);
  if (process.platform !== 'win32') throw fault('ENGINE_PLATFORM', 'This qualified engine profile supports Windows x64 only.', 503);
  const digest = await digestFile(config.path).catch(() => { throw fault('ENGINE_NOT_INSTALLED', `${engine} file is missing. Rediscover or install its qualified package.`, 503); });
  if (digest !== pin.executableSha256) throw fault('ENGINE_CHECKSUM', `${engine} executable differs from the qualified release. Install the pinned unmodified package.`, 422);
  return { ...pin, path: config.path, binarySha256: digest };
}
export async function openSession({ engine, config, root, signal, onSession = () => {}, onLog = () => {} }) {
  const identity = await verifyEngine(engine, config);
  signal?.throwIfAborted();
  const transport = new StdioClientTransport({ command: identity.path,
    args: ['mcp', '--automation-read-root', root, '--automation-write-root', root], cwd: root, stderr: 'pipe',
    maxBufferSize: 64 * 1024 * 1024,
  });
  transport.stderr?.on('data', b => onLog(b.toString('utf8').slice(0, 4000)));
  const client = new Client({ name: 'FORGE-report-service', version: '1.0.0' });
  const validators = new Map();
  const validator = new AjvJsonSchemaValidator();
  let closing;
  const session = {
    engine, identity, tools: [], commands: [], pid: null,
    async close() {
      return closing ??= (async () => {
        const pid = transport.pid;
        await client.close();
        await new Promise(resolve => setImmediate(resolve));
        let alive = false;
        if (pid) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code !== 'ESRCH'; } }
        return { confirmed: !alive };
      })();
    },
    async call(name, args = {}, raw = false) {
      signal?.throwIfAborted();
      const validate = validators.get(name);
      if (!validate) throw fault('ENGINE_CAPABILITY', `${engine} does not expose ${name}.`, 503);
      const valid = validate(args);
      if (!valid.valid) throw fault('ENGINE_SCHEMA', `${name}: ${valid.errorMessage}`, 422);
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000, signal });
      if (result.isError) throw fault('ENGINE_FAILURE', `${engine}/${name}: ${JSON.stringify(resultData(result)).slice(0, 4000)}`, 422);
      return raw ? result : resultData(result);
    },
    async execute(command, params = {}, doc) {
      if (!session.commands.some(c => c.id === command)) throw fault('ENGINE_CAPABILITY', `Missing WordCraft command ${command}.`, 503);
      return session.call('execute', { command, params, ...(doc === undefined ? {} : { doc }) });
    },
  };
  onSession(session); // Owner registers the actual handle before connect can fail or be stopped.
  const abort = () => { session.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await client.connect(transport, { timeout: 20000 });
    session.pid = transport.pid;
    const version = client.getServerVersion();
    if (version?.name !== engine || version.version !== identity.version) throw fault('ENGINE_VERSION', `Expected ${engine} ${identity.version}, found ${JSON.stringify(version)}.`, 422);
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 20000 });
      session.tools.push(...page.tools); cursor = page.nextCursor;
    } while (cursor);
    for (const tool of session.tools) validators.set(tool.name, validator.getValidator(tool.inputSchema));
    for (const name of REQUIRED[engine]) if (!validators.has(name)) throw fault('ENGINE_CAPABILITY', `${engine} is missing ${name}.`, 503);
    if (engine === 'wordcraft') session.commands = await session.call('list_commands');
    session.identity = { ...identity, server: version, schemaSha256: sha256(Buffer.from(JSON.stringify(session.tools))) };
    return session;
  } catch (e) { await session.close(); throw e; }
  finally { signal?.removeEventListener('abort', abort); }
}

export async function probeEngine(engine, config, base) {
  await stat(base);
  const root = await mkdtemp(join(base, 'probe-'));
  let session;
  try {
    session = await openSession({ engine, config, root });
    const fonts = engine === 'wordcraft' ? await session.execute('font.list', { all: true }) : undefined;
    return { status: 'ready', ready: true, identity: session.identity,
      tools: session.tools.map(t => ({ name: t.name, inputSchema: t.inputSchema })), fonts,
      progress: 'indeterminate', cancellation: 'owned-process-only' };
  } catch (e) { return { status: e.code === 'ENGINE_NOT_INSTALLED' ? 'not_installed' : 'incompatible', ready: false,
    error: { code: e.code ?? 'ENGINE_FAILURE', message: e.message }, recovery: `Use Settings → Report engines → Install/Discover ${engine}.` }; }
  finally { await session?.close(); await rm(root, { recursive: true, force: true }); }
}
