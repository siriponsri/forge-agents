import { fileURLToPath } from 'node:url';
import { readFile, lstat } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { localEndpoint } from './agent-mcp.mjs';

const envName = value => { if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(value)) throw new Error('Expected an environment variable reference'); return value; };
export function officeAgentStdioConfig({ endpointEnv = 'FORGE_OFFICE_MCP_URL', secretFileEnv = 'FORGE_OFFICE_MCP_SECRET_FILE' } = {}) {
  return { command: process.execPath, args: [fileURLToPath(import.meta.url), '--url-env', envName(endpointEnv), '--secret-file-env', envName(secretFileEnv)] };
}
export async function startOfficeAgentStdioBridge({ endpointEnv, secretFileEnv, env = process.env, transport = new StdioServerTransport() }) {
  const url = localEndpoint(env[envName(endpointEnv)]), secretFile = env[envName(secretFileEnv)];
  const stat = await lstat(secretFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128) throw new Error('Invalid machine-private secret reference');
  const secret = (await readFile(secretFile, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('Invalid machine-private credential');
  const client = new Client({ name: 'forge-office-stdio-bridge', version: '1.0.0' }, { capabilities: {} });
  const http = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${secret}` }, redirect: 'error' } });
  await client.connect(http, { timeout: 10000 });
  const server = new Server({ name: 'forge-office-stdio-bridge', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => client.listTools());
  server.setRequestHandler(CallToolRequestSchema, ({ params }) => client.callTool(params));
  try { await server.connect(transport); } catch (error) { await client.close(); throw error; }
  return { close: async () => { await server.close(); await client.close(); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--url-env' || args[2] !== '--secret-file-env') { process.stderr.write('Office bridge requires environment references only.\n'); process.exitCode = 1; }
  else {
    try {
      const bridge = await startOfficeAgentStdioBridge({ endpointEnv: args[1], secretFileEnv: args[3] });
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => bridge.close().finally(() => process.exit(0)));
      process.stdin.once('end', () => bridge.close().finally(() => process.exit(0)));
    } catch { process.stderr.write('Office bridge unavailable; check local endpoint and private environment references.\n'); process.exitCode = 1; }
  }
}
