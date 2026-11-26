// Real approved native cache checks + explicitly labelled build execution fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createGuardedArtifactService} from '../app/guarded-runtime/install.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url)),cache=process.env.FORGE_GUARDED_TEST_CACHE??path.join(os.tmpdir(),'forge-guarded-timeout30s-20261125');
const available=process.platform==='win32'&&await fs.stat(path.join(cache,'artifact-manifest.json')).then(()=>true,()=>false);
const owned=new WeakMap();
async function temp(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'forge-guarded-install-test-'));owned.set(t,[]);t.after(async()=>{for(const s of owned.get(t))await s.close();assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('forge-guarded-install-test-'));await fs.rm(dir,{recursive:true,force:true,maxRetries:2,retryDelay:50});});return dir;}
async function service(t,opts){const s=await createGuardedArtifactService(opts);owned.get(t).push(s);return s;}
async function settled(s){for(let i=0;i<400;i++){const state=await s.state();if(state.status!=='preparing')return state;await new Promise(r=>setTimeout(r,25));}throw Error('TEST_TIMEOUT');}
async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('TEST_TIMEOUT');}
const exists=file=>fs.stat(file).then(()=>true,()=>false);
async function fixtureOutput(dest){
  // This copies known native outputs to exercise stage sequencing, NOT a fresh build.
  const manifest=JSON.parse(await fs.readFile(path.join(cache,'artifact-manifest.json'))),patches=JSON.parse(await fs.readFile(path.join(cache,'patch-report.json'))),pins=JSON.parse(await fs.readFile(path.join(repo,'app/proactive-native/source-pins.json')));
  const files=new Set(['t3.tgz','opencode.tgz','bun.tgz','node.zip','pnpm.tgz','pnpm-exe.tgz','patch-report.json','artifact-manifest.json','cli-build-report.json','t3-build-report.json','windows/build.json','windows/ConfinedText.exe','opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe']);
  for(const f of manifest.t3.files)files.add('t3/apps/server/dist/'+f.name);
  for(const p of patches.changes)files.add(p.source+'/'+p.file);
  for(const source of pins.sources)for(const p of source.files)files.add(source.id+'/'+p.path);
  for(const name of files){const target=path.join(dest,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(cache,name),target);}
}

test('reject editable workspaces and linked private roots before setup',{skip:!available},async t=>{
  await assert.rejects(createGuardedArtifactService({dataDir:repo}),/PRIVATE_WORKSPACE_OVERLAP/);
  const dir=await temp(t),target=path.join(dir,'target'),link=path.join(dir,'linked');await fs.mkdir(target);await fs.symlink(target,link,'junction');
  await assert.rejects(createGuardedArtifactService({dataDir:link}),/PRIVATE_LINK_DENIED/);
});

test('actual approved native private copy, exact descriptor, replay, restart and tamper',{skip:!available},async t=>{
  const dataDir=await temp(t);let s=await service(t,{dataDir,approvedCache:cache});
  assert.equal((await s.state()).status,'missing');
  await assert.rejects(createGuardedArtifactService({dataDir,approvedCache:cache}),/SETUP_OWNER_BUSY/);
  await assert.rejects(s.install({operationId:'actual-cache-0001',path:cache}),/SETUP_OPERATION_REQUIRED/);
  const start=performance.now(),accepted=await s.install({operationId:'actual-cache-0001'});assert.equal(accepted.status,'preparing');assert.ok(performance.now()-start<1000);
  assert.equal((await settled(s)).status,'ready');const descriptor=await s.artifacts();
  assert.equal(descriptor.t3.files.length,46);assert.equal(descriptor.t3.files.find(f=>f.name==='node.exe').path,process.execPath);assert.ok(descriptor.t3.entry.startsWith(dataDir));
  assert.equal(descriptor.fileBroker.sha256,'0c8a796db59f0829ac4b28b97be774523210f5ff99b7e6139e3fc442e8d2e08d');
  const publicState=await s.state();assert.equal(publicState.checkRequired,true);assert.ok(!JSON.stringify(publicState).includes(dataDir));assert.equal(publicState.proof,undefined);
  assert.equal((await s.install({operationId:'actual-cache-0001'})).status,'ready');assert.equal((await s.artifacts()).t3.entry,descriptor.t3.entry);
  await s.close();s=await service(t,{dataDir,approvedCache:cache});assert.equal((await s.state()).status,'ready');assert.equal((await s.artifacts()).t3.entry,descriptor.t3.entry);
  await fs.appendFile(descriptor.t3.entry,'\n// tamper\n');assert.equal(await s.artifacts(),null);assert.equal((await s.state()).error.code,'ARTIFACT_CHANGED');
  assert.equal((await s.install({operationId:'actual-cache-0001'})).status,'failed');
});

// The complete default stage/environment/output fixture now lives in
// guarded-session-install.test.mjs. The old nine-stage fixture stopped before
// the mandatory SDK/session derivative and could no longer produce ready.

test('build execution fixture: nonzero stage never produces ready or leaks logs',{skip:!available},async t=>{
  const dataDir=await temp(t),s=await service(t,{dataDir,commandRunner:async()=>({exitCode:1,stdout:'secret private path',stderr:'credential=hidden'})});
  await s.install({operationId:'fixture-failure-001'});const result=await settled(s);assert.equal(result.status,'failed');assert.equal(result.error.code,'BUILD_STAGE_FAILED');assert.equal(await s.artifacts(),null);assert.ok(!JSON.stringify(result).includes('secret'));
});

test('missing prerequisite names its setup action and executes no build',{skip:!available},async t=>{
  const dataDir=await temp(t);let dispatched=0;const s=await service(t,{dataDir,pythonPath:path.join(dataDir,'missing-python.exe'),commandRunner:async()=>{dispatched++;return {exitCode:0};}});
  await s.install({operationId:'missing-python-001'});const result=await settled(s);assert.equal(result.status,'failed');assert.equal(result.error.code,'PYTHON_REQUIRED');assert.equal(result.error.action,'install-python-3');assert.equal(dispatched,0);assert.equal(await s.artifacts(),null);
});

test('a self-declared cache manifest cannot approve altered native bytes',{skip:!available},async t=>{
  const dataDir=await temp(t),fake=path.join(dataDir,'untrusted-cache');await fixtureOutput(fake);
  const exe=path.join(fake,'opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe'),manifestPath=path.join(fake,'artifact-manifest.json');
  await fs.appendFile(exe,'altered');const manifest=JSON.parse(await fs.readFile(manifestPath));manifest.opencode.sha256=createHash('sha256').update(await fs.readFile(exe)).digest('hex');await fs.writeFile(manifestPath,JSON.stringify(manifest));
  const s=await service(t,{dataDir,approvedCache:fake});await s.install({operationId:'untrusted-cache-001'});const result=await settled(s);assert.equal(result.status,'failed');assert.equal(result.error.code,'CACHE_NOT_APPROVED');assert.equal(await s.artifacts(),null);
});

test('actual Windows owned job kills the exact child tree on cancel and drains close',{skip:!available},async t=>{
  const dataDir=await temp(t),parent=path.join(dataDir,'parent'),child=path.join(dataDir,'child'),tick=path.join(dataDir,'tick');
  const childScript=`require('node:fs').writeFileSync(${JSON.stringify(child)},'started');setInterval(()=>require('node:fs').appendFileSync(${JSON.stringify(tick)},'.'),50);`;
  const parentScript=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(parent)},'started');setInterval(()=>{},1000);`;
  let count=0;const s=await service(t,{dataDir,commandRunner:async(spec,runOwned)=>{count++;return runOwned({...spec,command:process.execPath,args:['-e',parentScript]});}});
  await s.install({operationId:'owned-cancel-0001'});await until(()=>exists(child));await assert.rejects(s.cancel({operationId:'wrong-operation-001'}),/SETUP_OPERATION_MISMATCH/);
  await s.cancel({operationId:'owned-cancel-0001'});assert.equal((await s.state()).status,'cancelled');assert.equal(await s.artifacts(),null);assert.equal(count,1);
  const before=await fs.readFile(tick,'utf8').catch(()=> '');await new Promise(r=>setTimeout(r,200));assert.equal(await fs.readFile(tick,'utf8').catch(()=> ''),before);
  await s.install({operationId:'owned-cancel-0001'});assert.equal(count,1);
  await s.install({operationId:'owned-close-0002'});await until(async()=>count===2);await s.close();assert.equal((await s.state()).status,'cancelled');
});

test('actual app crash leaves interrupted setup explicit; restart and exact replay never dispatch',{skip:!available},async t=>{
  const dataDir=await temp(t),marker=path.join(dataDir,'started');
  const script=`import {createGuardedArtifactService} from ${JSON.stringify(pathToFileURL(path.join(repo,'app/guarded-runtime/install.mjs')).href)};import fs from 'node:fs/promises';const s=await createGuardedArtifactService({dataDir:${JSON.stringify(dataDir)},commandRunner:async()=>{await fs.writeFile(${JSON.stringify(marker)},'started');return new Promise(()=>{});}});await s.install({operationId:'interrupted-0001'});`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:'ignore',windowsHide:true});t.after(()=>child.kill());const exit=new Promise(resolve=>child.once('close',resolve));
  await until(()=>exists(marker));child.kill();await exit;
  // The helper observes stdin EOF and releases its live exclusive lock.
  await new Promise(r=>setTimeout(r,150));let dispatched=0;
  const s=await service(t,{dataDir,commandRunner:async()=>{dispatched++;return {exitCode:1};}});
  const state=await s.state();assert.equal(state.status,'failed');assert.equal(state.recovery,'reconcile-required');assert.equal(state.error.code,'INSTALL_INTERRUPTED');
  assert.equal((await s.install({operationId:'interrupted-0001'})).status,'failed');assert.equal(dispatched,0);assert.equal(await s.artifacts(),null);
});
