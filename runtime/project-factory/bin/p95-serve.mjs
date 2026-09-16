import path from 'node:path';
import { P95Runtime } from '../src/p95-runtime.mjs';
import { createMonitor } from '../src/p95-monitor.mjs';

const workspace = path.resolve(import.meta.dirname, '..', '..', '..');
const runtime = new P95Runtime({
  projectId: 'p95-dashboard-preview',
  projectRoot: path.join(workspace, 'sandbox', 'p9.5-dashboard-preview'),
  inputRoot: path.join(workspace, 'inputs', 'Model_Intelligence')
});
runtime.startProject();
runtime.tasks.forEach(task => { runtime.queueTask(task); runtime.routeFor(task); });
const monitor = createMonitor({ runtime, port: 3935 });
await monitor.listen();
console.log(`P9.5 dashboard: ${monitor.url}`);
process.on('SIGINT', async () => { await monitor.close(); process.exit(0); });
process.on('SIGTERM', async () => { await monitor.close(); process.exit(0); });
