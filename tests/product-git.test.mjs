import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../app/server/store.mjs';
import { command } from '../app/server/domain.mjs';
import { createGitStorageService } from '../app/server/git-storage.mjs';
test('output Git commits only selected paths and pushes only explicitly configured destination',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-git-engineering-')),workspace=path.join(dir,'output repo'),remote=path.join(dir,'fixture-remote.git');await mkdir(workspace);const git=(args,cwd=workspace)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
  git(['init']);git(['config','user.name','FORGE engineering fixture']);git(['config','user.email','fixture@example.invalid']);git(['init','--bare',remote],dir);git(['remote','add','fixture',remote]);
  const store=await openStore(path.join(dir,'state'));const project=(await command(store,{operationId:crypto.randomUUID(),type:'project.create',data:{name:'Disposable Git fixture',workspace,profile:{storage:{git:{remote:'fixture',branch:'fixture'}}}}})).entity;
  await writeFile(path.join(workspace,'chosen.txt'),'selected evidence');await writeFile(path.join(workspace,'unrelated.txt'),'unrelated preserved');
  const service=createGitStorageService({store});const operationId=crypto.randomUUID();const commit=await service.run({projectId:project.id,operationId,action:'commit',message:'Fixture commit',paths:['chosen.txt']});assert.equal(commit.status,'completed',commit.error);
  assert.match((await service.run({projectId:project.id,action:'status'})).status,/unrelated.txt/);assert.equal(git(['ls-files']).trim(),'chosen.txt');
  assert.equal((await service.run({projectId:project.id,operationId,action:'commit',message:'Fixture commit',paths:['chosen.txt']})).replayed,true);
  const push=await service.run({projectId:project.id,operationId:crypto.randomUUID(),action:'push'});assert.equal(push.status,'completed',push.error);assert.match(git(['--git-dir',remote,'show-ref','refs/heads/fixture'],dir),/refs\/heads\/fixture/);await store.close();
});
