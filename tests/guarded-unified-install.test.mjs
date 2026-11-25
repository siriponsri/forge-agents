import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGuardedArtifactService,frontendDependencyLock} from '../app/guarded-runtime/install.mjs';
import {fileDigest} from '../app/guarded-runtime/file-digest.mjs';
import {digest} from '../app/guarded-runtime/profile.mjs';
const cache=process.env.FORGE_GUARDED_TEST_CACHE??path.join(os.tmpdir(),'forge-frontend-generation-VD6puQ');
const available=process.platform==='win32'&&await fs.stat(path.join(cache,'generation.json')).then(()=>true,()=>false);
test('minimal SDK build closure preserves pinned versions, integrity and all required dependencies',async()=>{
  const original=JSON.parse(await fs.readFile(new URL('../package-lock.json',import.meta.url),'utf8')),before=digest(original),{manifest,lock}=frontendDependencyLock(original);
  assert.deepEqual(manifest.dependencies,{'@modelcontextprotocol/sdk':'1.32.2'});assert.ok(Object.keys(lock.packages).length<100);assert.equal(digest(original),before);
  assert.equal(lock.packages['node_modules/@modelcontextprotocol/sdk'].version,'1.32.2');assert.equal(lock.packages['node_modules/react'],undefined);
  for(const [key,p] of Object.entries(lock.packages))if(key){assert.equal(p.integrity,original.packages[key].integrity);assert.equal(p.version,original.packages[key].version);}
  original.packages['node_modules/@modelcontextprotocol/sdk'].version='1.0.0';assert.throws(()=>frontendDependencyLock(original),{code:'SDK_LOCK_CHANGED'});
});
test('approved unified copy verifies matched sources/images, MIT notices, reopen and private tamper',{skip:!available,timeout:120000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-unified-install-'));let service;
  t.after(async()=>{await service?.close();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('forge-unified-install-'));await fs.rm(root,{recursive:true,force:true});});
  service=await createGuardedArtifactService({dataDir:root,approvedCache:cache});await service.install({operationId:'unified-actual-copy-001'});
  let state;for(let i=0;i<1000;i++){state=await service.state();if(state.status!=='preparing')break;await new Promise(r=>setTimeout(r,25));}
  assert.equal(state.status,'ready',JSON.stringify(state));const artifact=await service.artifacts();
  assert.equal(fileDigest(artifact.opencode.path),'edde02f4107862e229cbe5436fde8b3a28d94195dd6fba85e9f716acaf6cf934');
  assert.equal(digest(artifact.t3.files.map(f=>({name:f.name,sha256:fileDigest(f.path)})).sort((a,b)=>a.name.localeCompare(b.name))),'715c5c8657db3f2910b031e740f9391f04649914569a8c2a0da155d5f73179a5');
  const notices=path.join(path.dirname(artifact.opencode.path),'notices');for(const name of ['FORGE','T3','OPENCODE','NODE','MCP-SDK'])assert.ok((await fs.readFile(path.join(notices,name+'-LICENSE.txt'),'utf8')).length>100);
  assert.equal(JSON.stringify(state).includes(root),false);await service.close();service=await createGuardedArtifactService({dataDir:root,approvedCache:cache});assert.equal((await service.state()).status,'ready');
  await fs.appendFile(artifact.t3.entry,'\n// private tamper\n');assert.equal(await service.artifacts(),null);assert.equal((await service.state()).error.code,'ARTIFACT_CHANGED');
});
