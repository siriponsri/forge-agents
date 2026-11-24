import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openStore } from '../app/server/store.mjs';
import { command } from '../app/server/domain.mjs';
import { createArtifactService } from '../app/server/artifacts.mjs';
import { createServingService } from '../app/serving/service.mjs';
import { probeEnvironment } from '../app/serving/runtime.mjs';

test('real LitServe selected weights, REST/MCP parity, stop, restart and health evidence', { timeout: 180000 }, async t => {
  const dependencies = await probeEnvironment();
  if (!dependencies.ready) { if (process.env.FORGE_SERVING_REQUIRE_LIVE === '1') assert.fail(dependencies.detail); t.skip(dependencies.message); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'forge-serving-live-'));
  const store = await openStore(path.join(dir, 'data')), artifacts = createArtifactService({ store, dataDir: dir });
  const serving = createServingService({ dataDir: path.join(dir, 'data'), store, artifacts });
  t.after(async () => { await serving.shutdown(); await store.close(); await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });
  const p = (await command(store, { operationId: randomUUID(), type: 'project.create', data: { name: 'Disposable serving engineering fixture', workspace: path.join(dir, 'workspace') } })).entity;
  await writeFile(path.join(p.workspace, 'weights.json'), JSON.stringify({ format: 'forge.linear.v1', weights: [2, -1], bias: 0.5, engineeringFixture: true }));
  await writeFile(path.join(p.workspace, 'preprocessor.json'), JSON.stringify({ format: 'forge.standardize.v1', mean: [1, 2], scale: [2, 4] }));
  const model = await artifacts.register({ projectId: p.id, path: 'weights.json', kind: 'model' });
  const preprocessor = await artifacts.register({ projectId: p.id, path: 'preprocessor.json', kind: 'preprocessor' });
  const configured = await serving.configure({ operationId: randomUUID(), projectId: p.id, expectedRevision: p.revision, adapter: 'litserve', mode: 'local', binding: { model: { artifactId: model.id, revision: model.revision }, preprocessor: { artifactId: preprocessor.id, revision: preprocessor.revision } } });
  assert.equal(configured.bindingEvidence.loadedModelVerified, false);
  const input = { operationId: randomUUID(), projectId: p.id };
  const deployment = await serving.start(input);
  assert.equal(deployment.status, 'running', JSON.stringify(deployment.error) + '\n' + deployment.logs);
  assert.equal(deployment.observedBinding.loadedModelVerified, true);
  assert.equal(deployment.observedBinding.binding.model.sha256, model.sha256);
  assert.equal(deployment.engineeringFixture, true);
  assert.equal((await serving.start(input)).id, deployment.id);
  const health = await serving.health(p.id);
  assert.equal(health.status, 'ready', JSON.stringify(health));
  assert.equal(health.mcp.tools.some(t => t.name === 'forge_predict'), true);
  const request = { operationId: randomUUID(), projectId: p.id, deploymentId: deployment.id, payload: { inputs: [5, 6] } };
  const rest = await serving.predict(request);
  assert.equal(rest.status, 'completed', JSON.stringify(rest.error));
  assert.equal(rest.result.prediction, 3.5);
  assert.equal(rest.result.forgeEvidence.binding.model.sha256, model.sha256);
  assert.equal((await serving.predict(request)).id, rest.id);
  // LitServe's discovered schema wraps the REST body in the handler's request argument.
  assert.deepEqual(health.mcp.tools.find(t => t.name === 'forge_predict').inputSchema.required, ['request']);
  const mcp = await serving.predict({ ...request, operationId: randomUUID(), transport: 'mcp', payload: { request: request.payload } });
  assert.equal(mcp.status, 'completed', JSON.stringify(mcp.error) + JSON.stringify(mcp.result));
  const mcpOutput = mcp.result.structuredContent ?? JSON.parse(mcp.result.content.find(c => c.type === 'text').text);
  assert.equal(mcpOutput.prediction, 3.5);
  assert.equal(mcpOutput.forgeEvidence.binding.preprocessor.sha256, preprocessor.sha256);
  assert.ok(rest.metrics.latencyMs >= 0);
  const resultArtifact = store.read().artifacts.find(a => a.id === rest.artifactIds[0]);
  assert.equal(resultArtifact.source.runId, rest.runId);
  assert.equal(JSON.parse(await readFile((await artifacts.download(resultArtifact.id)).path, 'utf8')).response.prediction, 3.5);
  const invalid = await serving.predict({ ...request, operationId: randomUUID(), payload: { inputs: [5] } });
  assert.equal(invalid.status, 'failed');
  assert.equal((await serving.stop(deployment.id)).status, 'stopped');
  await assert.rejects(fetch(deployment.endpoint + '/health', { signal: AbortSignal.timeout(2000) }));
  const restarted = await serving.start({ operationId: randomUUID(), projectId: p.id });
  assert.equal(restarted.status, 'running', restarted.logs);
  assert.notEqual(restarted.deploymentId, deployment.deploymentId);
  await serving.stop(restarted.id);

  // Stop is effective during startup, before a ready endpoint exists.
  const cancellingInput = { operationId: randomUUID(), projectId: p.id };
  const cancelling = serving.start(cancellingInput); let preparing;
  for (let n = 0; n < 100; n++) {
    preparing = store.read().jobs.find(j => j.operationId === cancellingInput.operationId);
    if (preparing?.status === 'starting') break;
    await new Promise(r => setTimeout(r, 20));
  }
  await serving.stop(preparing.id);
  assert.equal((await cancelling).status, 'stopped');
  await serving.shutdown();

  // A hard Node-owner crash signals the private owner wait handle. The real Python
  // server and inference workers must disappear without killing unrelated PIDs.
  const program = `import {openStore} from ${JSON.stringify(new URL('../app/server/store.mjs', import.meta.url).href)};
    import {createServingService} from ${JSON.stringify(new URL('../app/serving/service.mjs', import.meta.url).href)};
    const store=await openStore(${JSON.stringify(path.join(dir, 'data'))});
    const service=createServingService({store,dataDir:${JSON.stringify(path.join(dir, 'data'))}});
    const job=await service.start(${JSON.stringify({ operationId: randomUUID(), projectId: p.id })});
    console.log(JSON.stringify(job));`;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { if (owner.exitCode === null) owner.kill(); });
  const orphan = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timeout = setTimeout(() => reject(new Error('Owner fixture did not start: ' + errors)), 70000);
    owner.stderr.on('data', b => { errors += b; });
    owner.stdout.on('data', b => { output += b; const line = output.split('\n').find(x => x.startsWith('{')); if (line) { clearTimeout(timeout); resolve(JSON.parse(line)); } });
    owner.once('error', reject);
    owner.once('exit', code => { if (!output) { clearTimeout(timeout); reject(new Error('Owner fixture exit ' + code + errors)); } });
  });
  assert.equal(orphan.status, 'running', orphan.logs);
  const ownerExit = once(owner, 'exit'); owner.kill(); await ownerExit;
  let endpointStopped = false;
  for (let n = 0; n < 100; n++) {
    try { await fetch(orphan.endpoint + '/health', { signal: AbortSignal.timeout(300) }); }
    catch { endpointStopped = true; break; }
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(endpointStopped, true, 'owned LitServe must not remain after Node owner crash');
  const recovered = createServingService({ dataDir: path.join(dir, 'data'), store, artifacts });
  t.after(() => recovered.shutdown());
  const afterCrash = await recovered.start({ operationId: randomUUID(), projectId: p.id, reconcileJobId: orphan.id });
  assert.equal(afterCrash.status, 'running', afterCrash.logs);
  assert.equal(store.read().jobs.find(j => j.id === orphan.id).status, 'interrupted');
  await recovered.stop(afterCrash.id);
});
