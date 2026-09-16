import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const value = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const targetRoot = path.resolve(value('--target-root', path.join(import.meta.dirname, 'installed')));
const port = Number(value('--port', '3935'));
const smokeMs = Number(value('--smoke-ms', '0'));
const runtimeRoot = path.join(targetRoot, 'project-factory-runtime-p9.5');
const stateRoot = path.join(targetRoot, 'state', 'launcher');
const projectRoot = path.join(targetRoot, 'sandbox', 'launch-project');
const inputRoot = path.join(targetRoot, 'machine-inputs', 'Model_Intelligence');
fs.mkdirSync(stateRoot, { recursive: true });
fs.mkdirSync(projectRoot, { recursive: true });
fs.mkdirSync(inputRoot, { recursive: true });

const { P95Runtime } = await import(pathToFileURL(path.join(runtimeRoot, 'src', 'p95-runtime.mjs')).href);
const { createMonitor } = await import(pathToFileURL(path.join(runtimeRoot, 'src', 'p95-monitor.mjs')).href);
const runtime = new P95Runtime({ projectId: 'forge-portable', projectRoot, stateRoot, inputRoot });
runtime.startProject();
const monitor = createMonitor({ runtime, port });
await monitor.listen();

const receipt = {
  schema_version: '1.0.0',
  status: 'READY',
  listener: monitor.url,
  loopback_only: String(monitor.url).includes('127.0.0.1'),
  pid: process.pid,
  target_root: targetRoot.replaceAll('\\', '/'),
  model_backed_calls: 0
};
console.log(JSON.stringify(receipt));

let closed = false;
const close = async () => {
  if (closed) return;
  closed = true;
  monitor.server.closeAllConnections?.();
  await monitor.close();
};
process.on('SIGINT', async () => { await close(); process.exit(0); });
process.on('SIGTERM', async () => { await close(); process.exit(0); });
if (smokeMs > 0) {
  await new Promise(resolve => setTimeout(resolve, smokeMs));
  await close();
}
