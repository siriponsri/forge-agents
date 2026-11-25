// node tools/frontend-tools/run-native.mjs <read-only guarded native cache>
// All generated files go into a NEW disposable fixture home. Never writes the
// native source/cache or changes the initial Guarded tool profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore } from '../../app/server/store.mjs';
import { createLocalAuthority } from '../../app/server/authority.mjs';
import { createFrontendToolBroker } from '../../app/frontend-tools/broker.mjs';
import { createFrontendToolsHttpHandler } from '../../app/frontend-tools/http.mjs';

const cache = process.argv[2];
if (!path.isAbsolute(cache ?? '')) throw Error('ABSOLUTE_READ_ONLY_CACHE_REQUIRED');
const home = await mkdtemp(path.join(tmpdir(), 'forge-frontend-native-'));
const opencode = path.join(cache, 'opencode'), bun = path.join(cache, 'bun/bin/bun.exe');
const hookSource = await readFile(new URL('../../app/frontend-tools/opencode-supervised-hook.ts', import.meta.url), 'utf8');
let stagedHook = hookSource;
for (const [specifier, target] of [
  ['effect', pathToFileURL(path.join(opencode, 'packages/core/node_modules/effect/dist/index.js')).href],
  ['./tool.js', pathToFileURL(path.join(opencode, 'packages/core/src/tool.ts')).href],
  ['./forge-frontend/native-tool.mjs', new URL('../../app/frontend-tools/native-tool.mjs', import.meta.url).href],
]) {
  if (stagedHook.split(`from "${specifier}"`).length !== 2) throw Error('NATIVE_HOOK_IMPORT_SEAM_CHANGED');
  stagedHook = stagedHook.replace(`from "${specifier}"`, `from ${JSON.stringify(target)}`);
}
const hookFile = path.join(home, 'forge-frontend-hook.ts'); await writeFile(hookFile, stagedHook);
const nativeFiles = ['packages/core/src/tool.ts', 'packages/core/src/tool/runtime.ts', 'packages/core/src/forge-guard.ts', 'packages/schema/src/tool.ts'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const before = Object.fromEntries(await Promise.all(nativeFiles.map(async file => [file, sha(await readFile(path.join(opencode, file)))])));
const store = await openStore(home), authority = createLocalAuthority();
const owner = authority.owner({ expiresAt: Date.now() + 60000 });
const binding = { projectId: 'project', runId: 'run', attemptId: 'attempt', threadId: 'native-thread-fixture', providerRunId: 'native-run-fixture', nativeSessionId: 'ses_native_fixture', nativeTurnId: 'turn_native_fixture', documentId: 'document', documentRevision: 1 };
await store.transaction(s => {
  s.projects.push({ id: 'project', workspace: home });
  s.documents.push({ id: 'document', projectId: 'project', kind: 'doc', revision: 1 });
  s.runs.push({ id: 'run', projectId: 'project', attemptId: 'attempt', threadId: binding.threadId, providerRunId: binding.providerRunId, status: 'running', revision: 1 });
});
const broker = createFrontendToolBroker({ store, authorizeOwner: authority.goalAuthorize, authorizeNativeBinding: b => JSON.stringify(b) === JSON.stringify(binding) });
await broker.recover();
const grant = broker.bindNativeTurn(binding);
let http, child;
const sockets = new Set();
const server = createServer((req, res) => { http.handler(req, res).then(found => { if (!found) { res.writeHead(404); res.end(); } }); });
server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${server.address().port}/mcp/frontend-tools`;
http = createFrontendToolsHttpHandler({ broker, endpoint, authenticateOwner: () => null });
let stdout = '', stderr = '';
try {
  const env = { SystemRoot: process.env.SystemRoot, TEMP: home, TMP: home, PATH: path.dirname(bun), HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_CACHE_HOME: home, BUN_INSTALL_CACHE_DIR: home, OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_CONFIG_PROJECT_DISABLE: '1', OPENCODE_DISABLE_PROJECT_CONFIG: '1' };
  child = spawn(bun, [fileURLToPath(new URL('./native-fixture.mjs', import.meta.url))], { cwd: home, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = new Promise((resolve, reject) => { child.once('exit', code => resolve(code)); child.once('error', reject); });
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(JSON.stringify({ opencode, endpoint, authorization: grant.authorization, binding, hookFile }) + '\n');
  let pending;
  for (let i = 0; i < 1000; i++) {
    pending = broker.state(bindingScope(), owner).calls.find(c => c.status === 'pending');
    if (pending || child.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 20));
  }
  if (!pending) throw Error('NATIVE_PENDING_NOT_REACHED: ' + stderr);
  assert.equal(pending.native.callId, 'call_native_fixture');
  assert.equal(pending.native.sessionId, binding.nativeSessionId);
  const input = { ...bindingScope(), pendingId: pending.pendingId, operationId: 'owner-native-fixture-result', result: { status: 'ok', documentId: 'document', revision: 1, selection: { start: 0, end: 13, text: 'native result' } } };
  await broker.returnResult(input, owner);
  const timeout = setTimeout(() => child.kill(), 30000);
  const code = await exit; clearTimeout(timeout);
  if (code !== 0) throw Error('NATIVE_FIXTURE_FAILED: ' + stderr);
  const native = JSON.parse(stdout.trim());
  assert.equal(native.nativeModule, 'PASS');
  const receipt = await broker.returnResult(input, owner); assert.equal(receipt.replayed, true);
  const after = Object.fromEntries(await Promise.all(nativeFiles.map(async file => [file, sha(await readFile(path.join(opencode, file)))])));
  assert.deepEqual(after, before);
  const report = { version: 1, observedAt: new Date().toISOString(), scope: 'actual pinned native Tool.Service/raw/hooks/central executor -> actual SDK HTTP -> canonical pending -> authenticated Owner service -> original native executor result; deterministic module fixture only', runtime: { node: process.version, bun: (await readFile(path.join(cache, 'bun/package.json'), 'utf8')).match(/"version":\s*"([^"]+)"/)?.[1] }, ...native, readOnlyNativeSourcesUnchanged: true, nativeSourceSha256: before, fixtureSha256: sha(await readFile(new URL('./native-fixture.mjs', import.meta.url))), brokerSha256: sha(await readFile(new URL('../../app/frontend-tools/broker.mjs', import.meta.url))), hookSourceSha256: sha(hookSource), hookStaging: 'three import-specifier relocations only; no executable code rewritten', sdkVersion: JSON.parse(await readFile(new URL('../../node_modules/@modelcontextprotocol/sdk/package.json', import.meta.url), 'utf8')).version, ownerReceiptReplay: true, canonicalResultReceipts: store.read().receipts.filter(r => r.type === 'frontend-tools.result').length, proof: null, liveT3Attachment: 'NOT_RUN', homeUat: 'NOT_RUN' };
  await writeFile(path.join(home, 'sanitized-evidence.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, evidencePath: path.join(home, 'sanitized-evidence.json') }, null, 2));
} finally {
  if (child && child.exitCode === null) child.kill();
  await http.close(); for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r)); await store.close();
}
function bindingScope() { return { projectId: binding.projectId, runId: binding.runId, attemptId: binding.attemptId }; }
