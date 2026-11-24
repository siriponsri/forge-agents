#!/usr/bin/env node
import path from 'node:path';
import { openStore } from '../server/store.mjs';
import { createDesktopService } from './index.mjs';
import { createGuestAgent } from './guest-server.mjs';

// Executed inside a separately provisioned Windows guest's interactive user session.
// No credential values or endpoint URLs with embedded credentials are printed.
if (process.argv.includes('--help')) {
  console.log('FORGE guest agent: set FORGE_GUEST_DATA_DIR (absolute machine-local folder), FORGE_GUEST_TOKEN (32+ characters), FORGE_GUEST_AGENT_ID, optional FORGE_GUEST_PORT (default 47831), FORGE_GUEST_KIND (windows default, or browser). Connect via an authenticated loopback tunnel. No VM is provisioned.');
} else {
  const dataDir = process.env.FORGE_GUEST_DATA_DIR;
  if (!dataDir || !path.isAbsolute(dataDir)) throw new Error('FORGE_GUEST_DATA_DIR must be an absolute machine-local directory');
  const token = process.env.FORGE_GUEST_TOKEN, agentId = process.env.FORGE_GUEST_AGENT_ID;
  if (!token || token.length < 32 || !agentId) throw new Error('Set machine-local guest token and stable agent ID before starting');
  const kind = process.env.FORGE_GUEST_KIND ?? 'windows';
  if (!['windows', 'browser'].includes(kind)) throw new Error('Guest exports only Windows or an owned browser');
  const port = Number(process.env.FORGE_GUEST_PORT ?? 47831);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Guest port must be 1024..65535');
  const store = await openStore(dataDir), service = createDesktopService({ dataDir, store });
  const projectId = 'guest-agent', targetId = 'guest-desktop';
  await store.transaction(s => { if (!s.projects.some(p => p.id === projectId)) s.projects.push({ id: projectId, name: 'Guest target', workspace: dataDir }); });
  await service.setup({ projectId, targetId, name: 'Guest interactive desktop', kind, config: {} });
  const agent = await createGuestAgent({ service, projectId, targetId, agentId, token, port });
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await agent.close(); await store.close(); process.exit(0); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  console.log(`FORGE guest agent ready on loopback port ${port}; protocol forge-desktop/1; no live VM qualification is implied.`);
}
