import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './workspaces-fixture.test.mjs';
import {git,gitText} from '../app/workspaces/git.mjs';
import {contextFor} from '../app/workspaces/contracts.mjs';
import {createWorkspaceService,validateWorkspaceContext,resolveWorkspaceForRun,dispatchWorkspaceRequest,assertWorkspaceRestoreAvailable,mergeWorkspaceSafety} from '../app/workspaces/index.mjs';
import {entity,changed} from '../app/server/domain.mjs';

test('two actual engineering worktrees run concurrently and checked merge preserves original dirty work',async t=>{
  const f=await fixture(t);await f.configure();
  await writeFile(path.join(f.repo,'owner-draft.txt'),'Owner untracked work\n');await writeFile(path.join(f.repo,'shared.mjs'),'Owner staged work\n');await git(f.repo,['add','shared.mjs']);const originalIndex=await gitText(f.repo,['write-tree']);await writeFile(path.join(f.repo,'shared.mjs'),'Owner dirty tracked work\n');
  const original=await gitText(f.repo,['rev-parse','HEAD']);let a=await f.create(0),b=await f.create(1);
  assert.notEqual(a.worktreePath,b.worktreePath);assert.notEqual(a.branch,b.branch);assert.equal(a.baseSha,original);
  [a,b]=await Promise.all([f.call('start',a),f.call('start',b)]);assert.equal(a.status,'running');assert.equal(b.status,'running');assert.equal(f.starts,2);
  await f.edit(a,{'alpha.mjs':'export const twice = n => n * 2;\n','alpha.test.mjs':"import {test} from 'node:test'; import assert from 'node:assert/strict'; import {twice} from './alpha.mjs'; test('actual alpha change',()=>assert.equal(twice(21),42));\n"});
  await f.edit(b,{'beta.mjs':"export const greeting = name => `Hello ${name}`;\n",'beta.test.mjs':"import {test} from 'node:test'; import assert from 'node:assert/strict'; import {greeting} from './beta.mjs'; test('actual beta change',()=>assert.equal(greeting('Owner'),'Hello Owner'));\n"});
  await assert.rejects(readFile(path.join(a.worktreePath,'beta.mjs')),{code:'ENOENT'});await assert.rejects(readFile(path.join(b.worktreePath,'alpha.mjs')),{code:'ENOENT'});
  a=await f.finish(a);b=await f.finish(b);a=await f.approve(a);b=await f.approve(b);
  let qa=await f.enqueue(a),qb=await f.enqueue(b);qa=await f.prepare(qa);assert.equal(qa.status,'awaiting-owner');qa=await f.merge(qa);assert.equal(qa.status,'integrated');
  qb=await f.prepare(qb);assert.equal(qb.targetHead,qa.integratedHead);assert.equal(qb.combinedCheck.status,'passed');assert.match(qb.combinedCheck.checks[1].stdout,/actual alpha change/);assert.match(qb.combinedCheck.checks[1].stdout,/actual beta change/);qb=await f.merge(qb);
  assert.equal(qb.status,'integrated');assert.match(await readFile(path.join(qb.worktreePath,'alpha.mjs'),'utf8'),/twice/);assert.match(await readFile(path.join(qb.worktreePath,'beta.mjs'),'utf8'),/greeting/);
  assert.equal(await gitText(f.repo,['branch','--show-current']),'owner-branch');assert.equal(await gitText(f.repo,['rev-parse','HEAD']),original);assert.equal(await gitText(f.repo,['write-tree']),originalIndex);assert.equal(await readFile(path.join(f.repo,'owner-draft.txt'),'utf8'),'Owner untracked work\n');assert.equal(await readFile(path.join(f.repo,'shared.mjs'),'utf8'),'Owner dirty tracked work\n');
  t.diagnostic(`REAL_GIT_SQLITE_ENGINEERING_FIXTURE ${JSON.stringify({fixture:'INJECTED_T3_NOT_LIVE',dir:f.dir,base:original,alpha:a.checkedHead,beta:b.checkedHead,combined:qb.integratedHead,checks:qb.combinedCheck.status})}`);
});

test('idempotent creation/start, immutable input replay and unknown-before-dispatch survive restart without replay',async t=>{
  const f=await fixture(t);await f.configure();const input=f.input({taskId:f.tasks[0].id,expectedTaskRevision:1});const w=await f.service.create(input,f.owner);
  assert.equal((await f.service.create(input,f.owner)).id,w.id);await assert.rejects(f.service.create({...input,taskId:f.tasks[1].id},f.owner),{code:'OPERATION_REUSE'});
  f.control.loseBefore=true;const start=f.input({workspaceId:w.id,expectedRevision:w.revision});const unknown=await f.service.start(start,f.owner);assert.equal(unknown.status,'unknown');
  await f.service.start(start,f.owner);assert.equal(f.starts,1);await f.restart();assert.equal(f.w(w).status,'unknown');await f.call('reconcile',w);assert.equal(f.starts,1);await assert.rejects(f.call('start',w),{code:'REPLAY_FORBIDDEN'});
  const stopped=await f.call('stop',w);assert.equal(stopped.status,'unknown');assert.equal(f.stops,0);
});

test('lost accepted response is reconciled to exact durable T3 attempt and Stop affects only that run',async t=>{
  const f=await fixture(t);await f.configure();let a=await f.create(),b=await f.create(1);f.control.loseAfter=true;a=await f.call('start',a);assert.equal(a.status,'unknown');f.control.loseAfter=false;b=await f.call('start',b);
  await f.restart();a=await f.call('reconcile',a);assert.equal(a.status,'running');assert.ok(a.runId);a=await f.call('stop',a);assert.equal(a.status,'stopped');assert.equal(f.stops,1);
  assert.equal(f.store.read().runs.find(r=>r.id===b.runId).status,'running');assert.equal(f.starts,2);
});

test('unknown Stop remains occupied until an actual terminal observation',async t=>{
  const f=await fixture(t);await f.configure({maxConcurrent:1});let a=await f.create(),b=await f.create(1);a=await f.call('start',a);f.control.stopUnknown=true;a=await f.call('stop',a);assert.equal(a.status,'unknown');
  await assert.rejects(f.call('start',b),{code:'WORKSPACE_CAPACITY'});a=await f.call('reconcile',a);assert.equal(a.status,'stopping');assert.equal(f.starts,1);assert.equal(f.stops,1);
  await f.store.transaction(s=>{s.runs.find(r=>r.id===a.runId).status='interrupted';});a=await f.call('reconcile',a);assert.equal(a.status,'stopped');b=await f.call('start',b);assert.equal(b.status,'running');
});

test('overlapping same paths are actually separate and merge conflicts retain both candidates and original source',async t=>{
  const f=await fixture(t);await f.configure();let a=await f.call('start',await f.create()),b=await f.call('start',await f.create(1));
  const ah=await f.edit(a,{'shared.mjs':'export const value = 1;\n'}),bh=await f.edit(b,{'shared.mjs':'export const value = 2;\n'});
  assert.match(await readFile(path.join(a.worktreePath,'shared.mjs'),'utf8'),/= 1/);assert.match(await readFile(path.join(b.worktreePath,'shared.mjs'),'utf8'),/= 2/);
  a=await f.approve(await f.finish(a));b=await f.approve(await f.finish(b));let qa=await f.enqueue(a),qb=await f.enqueue(b);qa=await f.merge(await f.prepare(qa));qb=await f.prepare(qb);
  assert.equal(qb.status,'conflict');assert.deepEqual(qb.conflicts,['shared.mjs']);assert.match(await readFile(path.join(qb.worktreePath,'shared.mjs'),'utf8'),/<<<<<<< /);assert.equal(await gitText(a.worktreePath,['rev-parse','HEAD']),ah);assert.equal(await gitText(b.worktreePath,['rev-parse','HEAD']),bh);assert.equal(await gitText(f.repo,['show','HEAD:shared.mjs']),'export const value = 0;');
  await assert.rejects(f.qcall('integrate',qb,{targetHead:qb.targetHead,head:qb.candidateHead}),{code:'MERGE_CONFLICT'});
  // Explicit Owner resolution is made only in the retained integration checkout.
  await writeFile(path.join(qb.worktreePath,'shared.mjs'),'export const value = 3;\n');await git(qb.worktreePath,['add','shared.mjs']);qb=await f.qcall('checkIntegration',qb);assert.equal(qb.error,null);qb=await f.merge(qb);assert.equal(qb.status,'integrated');assert.equal(await gitText(f.repo,['branch','--show-current']),'owner-branch');
});

test('canonical dependencies, revisions, mixed controller and ordinary overlapping execution cannot be bypassed',async t=>{
  const f=await fixture(t);await f.configure();
  await f.store.transaction(s=>{s.tasks.find(x=>x.id===f.tasks[1].id).dependsOn=[f.tasks[0].id];});await assert.rejects(f.create(1),{code:'DEPENDENCY'});
  let a=await f.create();await f.store.transaction(s=>{s.tasks.find(x=>x.id===a.taskId).description='Changed canonical work';});await assert.rejects(f.call('start',a),{code:'REVISION_CONFLICT'});assert.equal(f.starts,0);
  let b=await f.create(2);await f.store.transaction(s=>{s.events.push(entity({type:'assistance.loop',status:'active'},f.p.id));});await assert.rejects(f.call('start',b),{code:'WORKSPACE_CONTROLLER_CONFLICT'});
  await f.store.transaction(s=>{s.events.find(x=>x.type==='assistance.loop').status='stopped';s.runs.push(entity({taskId:f.tasks[0].id,status:'unknown'},f.p.id));});await assert.rejects(f.call('start',b),{code:'WORKSPACE_BUSY'});
});

test('context exactness, path registration, capability gate, Owner auth and strict HTTP allowlist fail closed',async t=>{
  const f=await fixture(t);await assert.rejects(f.service.configure(f.input({expectedRevision:0,maxConcurrent:2,providerLimit:2,checks:['diff']}),{}),{code:'OWNER_REQUIRED'});await f.configure();let a=await f.create();
  f.t3.workspaceContextVersion=undefined;await assert.rejects(f.call('start',a),{code:'WORKSPACE_INTEGRATION_REQUIRED'});f.t3.workspaceContextVersion=1;
  a=await f.call('start',a);const input={projectId:f.p.id,taskId:a.taskId,operationId:a.runOperationId,workspaceContext:contextFor(a)};
  assert.deepEqual(validateWorkspaceContext(f.store.read(),input),contextFor(a));assert.throws(()=>validateWorkspaceContext(f.store.read(),{...input,workspaceContext:{...contextFor(a),path:f.repo}}),{code:'WORKSPACE_CONTEXT'});
  assert.throws(()=>validateWorkspaceContext(f.store.read(),{...input,goalContext:{version:1}}),{code:'WORKSPACE_CONTROLLER_CONFLICT'});
  await f.store.transaction(s=>{s.events.find(x=>x.id===a.id).worktreePath=f.repo;});await assert.rejects(resolveWorkspaceForRun({store:f.store,input,dataDir:f.dataDir}),{code:'PATH_SCOPE'});
  await assert.rejects(dispatchWorkspaceRequest(f.service,'close',{projectId:f.p.id},f.owner),{code:'NOT_FOUND'});await assert.rejects(dispatchWorkspaceRequest(f.service,'state',{projectId:f.p.id},f.owner),{code:'METHOD'});
  await assert.rejects(dispatchWorkspaceRequest(f.service,'state',{projectId:f.p.id,actor:'Owner'},f.owner,{httpMethod:'GET'}),{code:'VALIDATION'});assert.equal((await dispatchWorkspaceRequest(f.service,'state',{projectId:f.p.id},f.owner,{httpMethod:'GET'})).projectId,f.p.id);
});

test('stale source heads, dirty checkouts and changed reviewed candidates never enter an unchecked merge',async t=>{
  const f=await fixture(t);await f.configure();let a=await f.call('start',await f.create());await writeFile(path.join(a.worktreePath,'draft.txt'),'Not committed');a=await f.finish(a);await assert.rejects(f.call('check',a),{code:'COMMIT_REQUIRED'});
  await f.edit(a,{'draft.txt':'Actual committed output\n'});a=await f.approve(a);let q=await f.enqueue(a);await f.edit(a,{'later.txt':'Unreviewed additional change\n'});await assert.rejects(f.prepare(q),{code:'HEAD_CHANGED'});assert.equal(f.w(q).status,'queued');
  const b=await f.create(1);await writeFile(path.join(f.repo,'owner-commit.txt'),'New original head');await git(f.repo,['add','owner-commit.txt']);await git(f.repo,['commit','-m','Owner changed original head']);await assert.rejects(f.call('start',b),{code:'STALE_SOURCE'});
});

test('failed actual Node tests cannot receive Owner review or integration approval',async t=>{
  const f=await fixture(t);await f.configure();let a=await f.call('start',await f.create());await f.edit(a,{'broken.test.mjs':"import {test} from 'node:test'; test('actual failing test',()=>{throw new Error('Broken engineering output')});\n"});a=await f.call('check',await f.finish(a));
  const check=f.store.read().events.find(x=>x.id===a.checkId);assert.equal(check.status,'failed');assert.match(check.checks[1].stdout,/Broken engineering output/);await assert.rejects(f.call('review',a,{head:a.checkedHead}),{code:'CHECKS_REQUIRED'});
});

test('Stop invalidates a pending admission without waiting for the provider request',async t=>{
  const f=await fixture(t);await f.configure();let a=await f.create(),entered,release;const before=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.control.before=async()=>{entered();await gate;};
  const starting=f.call('start',a);await before;a=f.w(a);assert.equal(a.status,'admitting');const stopped=await f.call('stop',a);assert.equal(stopped.stopRequested,true);assert.equal(stopped.status,'unknown');release();a=await starting;assert.equal(a.status,'unknown');assert.equal(f.store.read().runs.length,0);assert.equal(f.starts,1);await assert.rejects(f.call('start',a),{code:'REPLAY_FORBIDDEN'});
});

test('creation reconciliation proves the existing worktree instead of replaying Git creation; linked ancestors rejected',async t=>{
  const f=await fixture(t);await f.configure();let a=await f.create();await f.store.transaction(s=>{s.events.find(e=>e.id===a.id).status='creating';});await f.restart();assert.equal(f.w(a).status,'creation-unknown');a=await f.call('reconcile',a);assert.equal(a.status,'ready');assert.equal((await gitText(f.repo,['worktree','list','--porcelain'])).split('branch refs/heads/'+a.branch).length,2);
  const other=await fixture(t);await other.configure();const outside=path.join(other.dir,'outside');await mkdir(outside);await symlink(outside,path.join(other.dataDir,'parallel-workspaces'),'junction');await assert.rejects(other.create(),{code:'PATH_SCOPE'});assert.equal(await gitText(other.repo,['branch','--show-current']),'owner-branch');
});

test('exact combined-tree approval and durable merge reconciliation survive a lost commit acknowledgement',async t=>{
  const f=await fixture(t);await f.configure();let a=await f.call('start',await f.create());await f.edit(a,{'output.txt':'Real checked engineering output\n'});a=await f.approve(await f.finish(a));let q=await f.prepare(await f.enqueue(a));
  await assert.rejects(f.qcall('approveIntegration',q,{targetHead:'0'.repeat(40),head:q.candidateHead}),{code:'INTEGRATION_REVIEW_REQUIRED'});
  q=await f.qcall('approveIntegration',q,{targetHead:q.targetHead,head:q.candidateHead});
  await git(q.worktreePath,['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','--no-gpg-sign','-m','Simulated committed merge acknowledgement loss']);
  await f.store.transaction(s=>{s.events.find(e=>e.id===q.id).status='committing';});await f.restart();assert.equal(f.w(q).status,'unknown');q=await f.qcall('reconcileIntegration',q);assert.equal(q.status,'integrated');assert.equal(f.starts,1);assert.equal(await gitText(f.repo,['rev-parse','HEAD']),a.baseSha);
});

test('Owner capacity policies are monotonic and stale settings cannot overwrite a newer revision',async t=>{
  const f=await fixture(t);assert.equal((await f.configure()).revision,1);assert.equal((await f.configure({maxConcurrent:3})).revision,2);assert.equal((await f.configure({maxConcurrent:4})).revision,3);
  await assert.rejects(f.configure({expectedRevision:1}),{code:'REVISION_CONFLICT'});const state=await f.service.state({projectId:f.p.id},f.owner);assert.equal(state.policy.maxConcurrent,4);assert.equal(state.capabilities.osSandbox,false);
});

test('a T3 adapter dropping exact workspace ownership is retained as unknown and cannot be reviewed',async t=>{
  const f=await fixture(t);await f.configure();f.control.ignoreContext=true;let a=await f.call('start',await f.create());assert.equal(a.status,'unknown');assert.match(a.error,/exact workspace/);await assert.rejects(f.call('reconcile',a),{code:'RUN_SCOPE'});assert.equal(f.starts,1);assert.equal(f.stops,0);
});

test('a canonical task edit after execution invalidates historical acceptance rather than approving stale work',async t=>{
  const f=await fixture(t);await f.configure();let a=await f.call('start',await f.create());await f.edit(a,{'result.txt':'Committed previous requirement\n'});a=await f.finish(a);
  await f.store.transaction(s=>{const task=s.tasks.find(x=>x.id===a.taskId);task.description='Owner revised expected output';changed(task);});await assert.rejects(f.call('check',a),{code:'REVISION_CONFLICT'});
});

test('provider ceilings count ordinary runs in unrelated projects and machine storage cannot nest inside source',async t=>{
  const f=await fixture(t);await f.configure({providerLimit:1});const a=await f.create();
  const otherRoot=path.join(f.dir,'unrelated-project');await mkdir(otherRoot);await f.store.transaction(s=>{const p=entity({name:'Other project',workspace:otherRoot});s.projects.push(p);s.runs.push(entity({providerInstanceId:f.p.profile.provider.instanceId,status:'running'},p.id));});
  await assert.rejects(f.call('start',a),{code:'PROVIDER_CAPACITY'});assert.equal(f.starts,0);
  const nested=createWorkspaceService({store:f.store,dataDir:path.join(f.repo.toLowerCase(),'.managed-state'),t3:f.t3,authorize:()=>true});
  await assert.rejects(nested.create(f.input({taskId:f.tasks[1].id,expectedTaskRevision:1}),f.owner),{code:'PATH_SCOPE'});await nested.close();
});

test('metadata restore fences admission gaps and preserves accepted operation/run identities against old backup replay',async t=>{
  const f=await fixture(t);await f.configure();let a=await f.create();const backup=f.store.read();a=await f.call('start',a);
  assert.throws(()=>assertWorkspaceRestoreAvailable(f.store.read()),{code:'RESTORE_BUSY'});
  const gap=structuredClone(backup);gap.events.find(e=>e.id===a.id).status='admitting';assert.throws(()=>assertWorkspaceRestoreAvailable(gap),{code:'RESTORE_BUSY'});
  const current=f.store.read(),restored=mergeWorkspaceSafety(structuredClone(backup),current);
  assert.equal(restored.runs[0].id,a.runId);assert.equal(restored.events.find(e=>e.id===a.id).runOperationId,a.runOperationId);
  await f.store.transaction(s=>{Object.assign(s,restored,{revision:s.revision});});await f.restart();a=await f.call('reconcile',a);assert.equal(a.status,'running');await assert.rejects(f.call('start',a),{code:'REPLAY_FORBIDDEN'});assert.equal(f.starts,1);
  const historicalOnly=mergeWorkspaceSafety(structuredClone(backup),{...backup,events:[],receipts:[],runs:[]});assert.equal(historicalOnly.events.find(e=>e.id===a.id).status,'restored');
});
