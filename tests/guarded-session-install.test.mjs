// Actual retained images and source inputs; no model/provider/account turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createGuardedArtifactService} from '../app/guarded-runtime/install.mjs';
import {fileDigest} from '../app/guarded-runtime/file-digest.mjs';
import {digest} from '../app/guarded-runtime/profile.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const cache=path.join(os.tmpdir(),'forge-frontend-generation-Vmhthl');
const evidence=JSON.parse(await fs.readFile(new URL('../tools/session-tools/native-evidence.json',import.meta.url),'utf8'));
const available=process.platform==='win32'&&await fs.stat(path.join(cache,'session-patches.json')).then(()=>true,()=>false);
const purposes=['guarded-default','supervised-frontend-v1','supervised-orchestrator-v1'];
const owned=new WeakMap();
async function settled(service){for(let i=0;i<2000;i++){const state=await service.state();if(state.status!=='preparing')return state;await new Promise(r=>setTimeout(r,25));}throw Error('TEST_TIMEOUT');}
async function temp(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-session-install-test-'));
  owned.set(t,[]);t.after(async()=>{for(const service of owned.get(t))await service.close();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('forge-session-install-test-'));await fs.rm(root,{recursive:true,force:true,maxRetries:2});});return root;
}
async function install(t,dataDir,approvedCache=cache,factory=createGuardedArtifactService){
  const service=await factory({dataDir,approvedCache});owned.get(t).push(service);
  await service.install({operationId:'session-install-actual-001'});return service;
}
async function derivative(root){
  // Private disposable COPY. Retained generations are never written, renamed or linked.
  const target=path.join(root,'forge-frontend-generation-negative');
  const meta=JSON.parse(await fs.readFile(path.join(cache,'generation.json'),'utf8'));
  const base=JSON.parse(await fs.readFile(path.join(meta.cache,'patch-report.json'),'utf8'));
  const pins=JSON.parse(await fs.readFile(path.join(repo,'app/proactive-native/source-pins.json'),'utf8'));
  const files=new Set(['frontend-patches.json','session-patches.json','opencode-session-build.json','t3-session-build.json','opencode/forge-sessions-cli-build/cli-windows-x64/bin/opencode.exe']);
  files.add('t3/LICENSE');files.add('opencode/LICENSE');
  for(const f of evidence.inventory.t3.files)if(f.name!=='node.exe')files.add('t3/apps/server/dist/'+f.name);
  for(const p of base.changes)files.add(p.source+'/'+p.file);
  for(const source of pins.sources)for(const p of source.files)files.add(source.id+'/'+p.path);
  for(const p of evidence.frontendPatches.changes)files.add(p.tree+'/'+p.file);
  for(const p of evidence.inventory.patches.additions)files.add(p.file);
  for(const f of ['forge-frontend/contract.mjs','forge-frontend/native-tool.mjs','forge-frontend-runtime.ts'])files.add('opencode/packages/core/src/'+f);
  for(const f of evidence.notices)files.add('session-notices/'+path.basename(f.file));
  for(const file of files){await fs.mkdir(path.dirname(path.join(target,file)),{recursive:true});await fs.copyFile(path.join(cache,file),path.join(target,file));}
  await fs.writeFile(path.join(target,'generation.json'),JSON.stringify({...meta,root:target}));return target;
}
test('actual sessions private copy: all45+Node pins, descriptor, notices, replay, reopen, authenticated metadata and image tamper',{skip:!available,timeout:120000},async t=>{
  const root=await temp(t);let service=await install(t,root);assert.equal((await settled(service)).status,'ready');
  const artifact=await service.artifacts();assert.deepEqual(Object.keys(artifact),['t3','opencode','fileBroker']);
  assert.deepEqual(artifact.opencode.purposes,purposes);assert.equal(artifact.opencode.version,'2.4.1-forge-sessions.0');assert.equal(artifact.opencode.proof,null);
  assert.equal(fileDigest(artifact.opencode.path),evidence.inventory.opencode.sha256);
  const actual=artifact.t3.files.map(f=>({name:f.name,sha256:fileDigest(f.path)}));
  assert.deepEqual(actual.sort((a,b)=>a.name.localeCompare(b.name)),evidence.inventory.t3.files.map(({name,sha256})=>({name,sha256})).sort((a,b)=>a.name.localeCompare(b.name)));
  assert.equal(actual.length,46);assert.equal(digest(actual),evidence.inventory.t3.sha256);
  for(const notice of evidence.notices)assert.equal(fileDigest(path.join(path.dirname(artifact.opencode.path),'notices',notice.name==='NODE-LICENSE'?'NODE-BUILD-LICENSE.txt':path.basename(notice.file))),notice.sha256);
  assert.equal(JSON.stringify(await service.state()).includes(root),false);assert.equal((await service.install({operationId:'session-install-actual-001'})).status,'ready');
  await service.close();service=await createGuardedArtifactService({dataDir:root});owned.get(t).push(service);assert.equal((await service.state()).status,'ready');
  await fs.appendFile(artifact.t3.entry,'\n// private tamper');assert.equal(await service.artifacts(),null);assert.equal((await service.state()).error.code,'ARTIFACT_CHANGED');
  await service.close();
  const stateFile=path.join(root,'guarded-artifacts/setup.json'),state=JSON.parse(await fs.readFile(stateFile,'utf8')),job=state.operations[state.current];
  job.status='ready';job.inventory.files.find(f=>f.name==='forge-guarded-host.mjs').sha256=fileDigest(artifact.t3.entry);
  job.inventory.profile=digest([...job.inventory.files,job.inventory.runtime].sort((a,b)=>a.name.localeCompare(b.name)));
  await fs.writeFile(stateFile,JSON.stringify(state));service=await createGuardedArtifactService({dataDir:root});owned.get(t).push(service);
  assert.equal(await service.artifacts(),null);assert.equal((await service.state()).error.code,'ARTIFACT_CHANGED');
});
test('default setup stage fixture selects newest session pipeline with private SDK closure and no environment leakage',{skip:!available,timeout:120000},async t=>{
  // Copies approved outputs to verify command ownership/sequencing only; NOT a fresh build.
  const root=await temp(t),seen=[];
  const meta=JSON.parse(await fs.readFile(path.join(cache,'generation.json'),'utf8'));
  const generation=await derivative(root);let pipeline,baseCache;
  process.env.FORGE_SESSION_INSTALL_SECRET='never-forward-this';t.after(()=>delete process.env.FORGE_SESSION_INSTALL_SECRET);
  const service=await createGuardedArtifactService({dataDir:path.join(root,'data'),commandRunner:async spec=>{
    seen.push(spec.stage);assert.equal(spec.env.FORGE_SESSION_INSTALL_SECRET,undefined);assert.equal(spec.env.NODE_OPTIONS,undefined);assert.equal(spec.timeoutMs,600000);
    if(spec.stage==='verify'){
      baseCache=spec.args[1];pipeline=path.join(path.dirname(baseCache),'pipeline');
      const patches=JSON.parse(await fs.readFile(path.join(meta.cache,'patch-report.json'),'utf8')),pins=JSON.parse(await fs.readFile(path.join(repo,'app/proactive-native/source-pins.json'),'utf8'));
      const manifest=JSON.parse(await fs.readFile(path.join(meta.cache,'artifact-manifest.json'),'utf8'));
      const files=new Set(['t3.tgz','opencode.tgz','bun.tgz','node.zip','pnpm.tgz','pnpm-exe.tgz','patch-report.json','artifact-manifest.json','cli-build-report.json','t3-build-report.json','windows/build.json','windows/ConfinedText.exe','opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe','bun/bin/bun.exe','node/node.exe','node/LICENSE']);
      for(const f of manifest.t3.files)files.add('t3/apps/server/dist/'+f.name);
      for(const p of patches.changes)files.add(p.source+'/'+p.file);
      for(const source of pins.sources)for(const p of source.files)files.add(source.id+'/'+p.path);
      for(const file of files){await fs.mkdir(path.dirname(path.join(baseCache,file)),{recursive:true});await fs.copyFile(path.join(meta.cache,file),path.join(baseCache,file));}
    }
    if(spec.stage==='frontend-dependencies'){
      const lock=JSON.parse(await fs.readFile(path.join(pipeline,'package-lock.json'),'utf8'));assert.equal(lock.packages['node_modules/@modelcontextprotocol/sdk'].version,'1.32.2');assert.ok(Object.keys(lock.packages).length<100);
      await fs.mkdir(path.join(pipeline,'node_modules/@modelcontextprotocol/sdk'),{recursive:true});await fs.copyFile(path.join(cache,'session-notices/MCP-SDK-LICENSE.txt'),path.join(pipeline,'node_modules/@modelcontextprotocol/sdk/LICENSE'));
    }
    if(spec.stage==='session-clone-generation'){
      // The host command result must name a NEW private TEMP generation.
      const target=path.join(spec.env.TEMP,'forge-frontend-generation-fixture');await fs.rename(generation,target);
      await fs.writeFile(path.join(target,'generation.json'),JSON.stringify({...meta,root:target,cache:baseCache}));
      await fs.writeFile(spec.args[2],JSON.stringify({generation:target}));
    }
    if(spec.stage==='session-patch-generation'){
      const target=spec.args[1],patchFile=path.join(target,'session-patches.json'),patches=JSON.parse(await fs.readFile(patchFile,'utf8'));
      for(const family of ['frontend','sessions']){
        const file=path.join(target,'opencode/packages/core/src/forge-'+family+'-runtime.ts');let source=await fs.readFile(file,'utf8');
        source=source.replace(/"[^"\n]+\/node_modules\/@modelcontextprotocol\/sdk\/dist\/esm\/client\/(index|streamableHttp)\.js"/g,(_,name)=>JSON.stringify(path.join(pipeline,'node_modules/@modelcontextprotocol/sdk/dist/esm/client',name+'.js').replaceAll('\\','/')));
        await fs.writeFile(file,source);if(family==='sessions')patches.additions.find(p=>p.file.endsWith('forge-sessions-runtime.ts')).sha256=fileDigest(file);
      }
      await fs.writeFile(patchFile,JSON.stringify(patches));
    }
    return {exitCode:0};
  }});owned.get(t).push(service);
  await service.install({operationId:'session-default-stage-fixture'});const state=await settled(service);assert.equal(state.status,'ready',JSON.stringify(state));
  assert.deepEqual(seen,['sources','toolchain','patch','opencode-dependencies','t3-dependencies','opencode-build','t3-build','broker-build','verify','frontend-dependencies','session-clone-generation','session-frontend-patch','session-patch-generation','session-link-t3-dependencies','session-build-generation']);
  assert.deepEqual((await service.artifacts()).opencode.purposes,purposes);
});
test('older approved base/frontend remain supported for exact prior purposes; forged session metadata fails closed',{skip:!available,timeout:120000},async t=>{
  const root=await temp(t);
  for(const [cacheName,count,version] of [['forge-guarded-timeout30s-20261125',1,'guarded'],['forge-frontend-generation-VD6puQ',2,'frontend']]){
    const dataDir=path.join(root,version);let service=await install(t,dataDir,path.join(os.tmpdir(),cacheName));assert.equal((await settled(service)).status,'ready');
    const artifact=await service.artifacts();assert.deepEqual(artifact.opencode.purposes,purposes.slice(0,count));assert.equal(artifact.opencode.version,'2.4.1-forge-'+version+'.0');
    await service.close();const file=path.join(dataDir,'guarded-artifacts/setup.json'),state=JSON.parse(await fs.readFile(file,'utf8'));state.operations[state.current].inventory.session={version:'2.4.1-forge-sessions.0',patchDigest:digest(evidence.inventory.patches.changes),proof:null};
    await fs.writeFile(file,JSON.stringify(state));service=await createGuardedArtifactService({dataDir});owned.get(t).push(service);assert.equal(await service.artifacts(),null);assert.equal((await service.state()).error.code,'ARTIFACT_CHANGED');
  }
});
test('actual cache negatives: exact session/frontend patch chain, additions, SDK path, report, notice and image pins',{skip:!available,timeout:180000},async t=>{
  const root=await temp(t),source=await derivative(root);
  const mutations=[
    ['session-patches.json',s=>{const p=JSON.parse(s);p.changes[0].after='0'.repeat(64);return JSON.stringify(p);},'SESSION_PATCH_CHANGED'],
    ['frontend-patches.json',s=>{const p=JSON.parse(s);p.changes[0].before='0'.repeat(64);return JSON.stringify(p);},'FRONTEND_PATCH_CHANGED'],
    ['opencode/packages/core/src/forge-bootstrap.ts',s=>s+'\n// tamper','FRONTEND_SOURCE_CHANGED'],
    ['opencode/packages/core/src/forge-sessions/native-tool.mjs',s=>s+'\n// tamper','SESSION_SOURCE_CHANGED'],
    ['opencode/packages/core/src/forge-sessions-runtime.ts',s=>s.replace('/node_modules/@modelcontextprotocol/','/node_modules/other/'),'SESSION_SOURCE_CHANGED'],
    ['t3-session-build.json',s=>JSON.stringify({...JSON.parse(s),exitCode:1}),'FRONTEND_BUILD_REPORT_INVALID'],
    ['session-notices/MCP-SDK-LICENSE.txt',s=>s+'tamper','NOTICE_CHANGED'],
    ['t3/apps/server/dist/forge-guarded-host.mjs',s=>s+'\n// tamper','CACHE_NOT_APPROVED'],
  ];
  for(const [file,mutate,code] of mutations){
    const target=path.join(source,file),original=await fs.readFile(target);await fs.writeFile(target,mutate(original.toString('utf8')));
    try{const service=await install(t,path.join(root,'data-'+code+'-'+mutations.findIndex(x=>x[0]===file)),source);const state=await settled(service);assert.equal(state.status,'failed',file);assert.equal(state.error.code,code,file);assert.equal(await service.artifacts(),null);await service.close();}finally{await fs.writeFile(target,original);}
  }
});
test('pipeline/source drift is rejected before using approved files or dispatching commands',{skip:!available,timeout:120000},async t=>{
  const root=await temp(t),isolated=path.join(root,'isolated-repo');
  const source=await fs.readFile(path.join(repo,'app/guarded-runtime/install.mjs'),'utf8');const pins=JSON.parse(source.match(/const PIPELINE = (\{[\s\S]*?\n\});/)[1]);
  for(const file of [...Object.keys(pins),'app/guarded-runtime/install.mjs','app/guarded-runtime/file-digest.mjs']){await fs.mkdir(path.dirname(path.join(isolated,file)),{recursive:true});await fs.copyFile(path.join(repo,file),path.join(isolated,file));}
  const {createGuardedArtifactService:factory}=await import(pathToFileURL(path.join(isolated,'app/guarded-runtime/install.mjs')).href);
  for(const [i,file] of ['tools/session-tools/pipeline.mjs','app/session-tools/contract.mjs','app/guarded-runtime/profile.mjs'].entries()){
    const target=path.join(isolated,file),original=await fs.readFile(target);await fs.appendFile(target,'\n// drift');
    try{const service=await install(t,path.join(root,'data-'+i),cache,factory);const state=await settled(service);assert.equal(state.error.code,'PIPELINE_CHANGED');await service.close();}finally{await fs.writeFile(target,original);}
  }
});
test('base archive and patch drift cannot be approved by a session generation report',{skip:!available,timeout:120000},async t=>{
  const root=await temp(t),generation=path.join(root,'forge-frontend-generation-base-negative'),base=path.join(root,'base');await fs.mkdir(generation);await fs.mkdir(base);
  const meta=JSON.parse(await fs.readFile(path.join(cache,'generation.json'),'utf8'));
  for(const file of ['t3.tgz','opencode.tgz','bun.tgz','node.zip','pnpm.tgz','pnpm-exe.tgz','patch-report.json'])await fs.copyFile(path.join(meta.cache,file),path.join(base,file));
  await fs.writeFile(path.join(generation,'generation.json'),JSON.stringify({...meta,root:generation,cache:base}));
  await fs.copyFile(path.join(cache,'session-patches.json'),path.join(generation,'session-patches.json'));
  for(const [i,file,code] of [[0,'t3.tgz','SOURCE_ARCHIVE_CHANGED'],[1,'patch-report.json','PATCH_CHANGED']]){
    const target=path.join(base,file),original=await fs.readFile(target);
    if(i===0)await fs.appendFile(target,'tamper');else{const p=JSON.parse(original);p.changes[0].after='0'.repeat(64);await fs.writeFile(target,JSON.stringify(p));}
    try{const service=await install(t,path.join(root,'data-'+i),generation);assert.equal((await settled(service)).error.code,code);await service.close();}finally{await fs.writeFile(target,original);}
  }
});
