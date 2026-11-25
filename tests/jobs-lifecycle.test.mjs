import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { openStore } from '../app/server/store.mjs';
import { entity } from '../app/server/domain.mjs';
import { createJobService } from '../app/server/jobs.mjs';
import { createComputeService } from '../app/compute/index.mjs';

const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,predicate=Boolean){for(let i=0;i<250;i++){const v=await fn();if(predicate(v))return v;await pause(25);}throw new Error('Timed out observing disposable local Python fixture');}
async function setup(t,code="print('actual local Python')",options={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-jobs-fixture-')),workspace=path.join(dir,'workspace');await mkdir(workspace);const store=await openStore(dir);let p,n;
  await store.transaction(s=>{p=entity({name:'Disposable lifecycle fixture',workspace,profile:{compute:{kind:'local'},limits:{jobSeconds:5}}});n=entity({name:'Harmless Python',code},p.id);s.projects.push(p);s.notebooks.push(n);});
  const jobs=createJobService({store,dataDir:dir,...options});t.after(async()=>{await jobs.shutdown();await store.close();await rm(dir,{recursive:true,force:true});});
  const input=()=>({projectId:p.id,notebookId:n.id,operationId:randomUUID()});
  const done=id=>until(()=>store.read().jobs.find(j=>j.id===id),j=>['completed','failed','stopped','interrupted'].includes(j.status));
  return {dir,workspace,store,p,n,jobs,input,done};
}
test('real Python normal/failure output, files, immutable replay and concurrent duplicate execute exactly once',async t=>{
  const x=await setup(t,"from pathlib import Path\np=Path('effects.txt')\np.write_text(p.read_text()+'x' if p.exists() else 'x')\nprint('real stdout')\nimport sys\nprint('real stderr', file=sys.stderr)");const input=x.input();
  const [a,b]=await Promise.all([x.jobs.start(input),x.jobs.start(input)]);assert.equal(a.id,b.id);const done=await x.done(a.id);assert.equal(done.status,'completed',done.error);assert.equal(done.treeCleaned,true);assert.match(done.logs,/real stdout/);assert.match(done.logs,/real stderr/);assert.equal(await readFile(path.join(x.workspace,'effects.txt'),'utf8'),'x');
  await x.store.transaction(s=>{s.notebooks[0].code="raise ValueError('real failure')";s.notebooks[0].revision++;});assert.equal((await x.jobs.start(input)).id,a.id);assert.equal(x.store.read().jobs.length,1);
  await assert.rejects(x.jobs.start({...input,phaseId:'changed'}),{code:'OPERATION_REUSE'});const failed=await x.jobs.start(x.input());assert.equal((await x.done(failed.id)).status,'failed');assert.match((await x.done(failed.id)).logs,/real failure/);
});
test('real Stop and timeout drain child and grandchild tree; shutdown awaits logs/persistence',async t=>{
  const x=await setup(t,"import subprocess,sys,time\nfrom pathlib import Path\np=subprocess.Popen([sys.executable,'-u','-c',\"import time;from pathlib import Path;Path('grandchild-ready').write_text('ready');time.sleep(1.5);Path('escaped-effect').write_text('bad');time.sleep(30)\"])\nprint('child started',flush=True)\nPath('child-ready').write_text(str(p.pid))\ntime.sleep(30)");
  const j=await x.jobs.start(x.input());await until(()=>readFile(path.join(x.workspace,'grandchild-ready'),'utf8').catch(()=>null));const stopped=await x.jobs.stop(j.id);assert.equal(stopped.status,'stopped');assert.equal(stopped.treeCleaned,true);assert.match(stopped.logs,/child started/);await pause(1650);assert.equal(await readFile(path.join(x.workspace,'escaped-effect'),'utf8').catch(()=>null),null);
  await x.store.transaction(s=>{s.projects[0].profile.limits.jobSeconds=1;s.notebooks[0].code="import time\nprint('before deadline',flush=True)\ntime.sleep(30)";});const timed=await x.jobs.start(x.input()),finished=await x.done(timed.id);assert.equal(finished.status,'stopped');assert.equal(finished.timedOut,true);assert.match(finished.logs,/before deadline/);
  const next=await x.jobs.start(x.input());await x.jobs.shutdown();assert.equal(x.store.read().jobs.find(j=>j.id===next.id).status,'stopped');
});
test('normal parent completion also cleans descendants; terminal completion cannot be overwritten by Stop',async t=>{
  const x=await setup(t,"import subprocess,sys,time\nfrom pathlib import Path\nsubprocess.Popen([sys.executable,'-c',\"import time;from pathlib import Path;Path('ready').write_text('yes');time.sleep(1);Path('left-running').write_text('bad');time.sleep(30)\"])\nwhile not Path('ready').exists(): time.sleep(.01)\nprint('parent finished normally')");
  const j=await x.jobs.start(x.input()),done=await x.done(j.id);assert.equal(done.status,'completed',done.error);assert.equal((await x.jobs.stop(j.id)).status,'completed');await pause(1100);assert.equal(await readFile(path.join(x.workspace,'left-running')).catch(()=>null),null);
});
test('stop during reservation/setup prevents source; unknown writers block but serving/report jobs do not',async t=>{
  const x=await setup(t,"from pathlib import Path\nPath('must-not-run').write_text('bad')");const pending=x.jobs.start(x.input());const reserved=await until(()=>x.store.read().jobs[0]);await x.jobs.stop(reserved.id);await pending;assert.equal((await x.done(reserved.id)).status,'stopped');assert.equal(await readFile(path.join(x.workspace,'must-not-run')).catch(()=>null),null);
  await x.store.transaction(s=>{s.jobs.push(entity({kind:'serving.deployment',status:'running',taskId:'linked-task'},x.p.id),entity({kind:'report-render',status:'running',taskId:'linked-task'},x.p.id));});const allowed=await x.jobs.start(x.input());assert.equal((await x.done(allowed.id)).status,'completed');
  await x.store.transaction(s=>s.jobs.push(entity({kind:'compute-notebook',status:'unknown'},x.p.id)));await assert.rejects(x.jobs.start(x.input()),{code:'WORKSPACE_BUSY'});
});
test('trusted local phase override validates revisions/kind; browser resolution refused; synchronous admission',async t=>{
  let calls=0;const x=await setup(t,undefined,{admit:(s,input)=>{calls++;assert.equal(input.projectId,x.p.id);}});let target;
  await x.store.transaction(s=>{s.projects[0].profile.compute={kind:'jupyter'};target=entity({kind:'compute',config:{kind:'local'}},x.p.id);s.connections.push(target);});
  const trusted={kind:'local',projectRevision:1,notebookRevision:1,targetId:target.id,targetRevision:1};
  await assert.rejects(x.jobs.start({...x.input(),resolvedCompute:trusted}),{code:'COMPUTE_SCOPE'});
  await assert.rejects(x.jobs.start(x.input(),{resolvedCompute:{...trusted,projectRevision:99}}),{code:'REVISION_CONFLICT'});
  const j=await x.jobs.start(x.input(),{resolvedCompute:trusted});assert.equal((await x.done(j.id)).status,'completed');assert.equal(calls,1);
  const denied=createJobService({store:x.store,dataDir:x.dir,admit:()=>false});await assert.rejects(denied.start(x.input(),{resolvedCompute:trusted}),{code:'ADMISSION_DENIED'});await denied.shutdown();
});
test('compute private facade creates one local record under remote project default',async t=>{
  const x=await setup(t);const localJobs={start:({resolvedCompute,...input})=>x.jobs.start(input,{resolvedCompute}),stop:id=>x.jobs.stop(id)};const compute=createComputeService({store:x.store,dataDir:x.dir,localJobs});t.after(()=>compute.shutdown());
  await compute.configure({projectId:x.p.id,config:{kind:'colab-browser'},select:true});const target=await compute.configure({projectId:x.p.id,config:{kind:'local'}});
  const job=await compute.start({...x.input(),targetId:target.id});assert.equal((await x.done(job.id)).status,'completed');assert.equal(x.store.read().jobs.length,1);assert.equal((await compute.start({projectId:x.p.id,notebookId:x.n.id,operationId:job.operationId,targetId:target.id})).id,job.id);
});
test('spawn errors are captured before listeners could be missed; restart never signals persisted stale PID',async t=>{
  const before=process.env.FORGE_PYTHON;process.env.FORGE_PYTHON='FORGE-definitely-missing-python-fixture';t.after(()=>{if(before===undefined)delete process.env.FORGE_PYTHON;else process.env.FORGE_PYTHON=before;});const x=await setup(t),j=await x.jobs.start(x.input());const failed=await x.done(j.id);assert.equal(failed.status,'failed');assert.match(failed.error,/could not start/);
  await x.store.transaction(s=>s.jobs.push(entity({kind:'notebook',status:'running',pid:process.pid},x.p.id)));await x.jobs.recover();const recovered=x.store.read().jobs.at(-1);assert.equal(recovered.status,'interrupted');assert.equal(recovered.pid,null);assert.match(recovered.error,/No persisted PID was signalled/);assert.ok(process.pid>0);
});
test('unexpected Node owner hard crash stops owned Python tree; reopen is truthful and never reexecutes',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-jobs-crash-fixture-'));t.after(()=>rm(dir,{recursive:true,force:true}));const jobsUrl=pathToFileURL(path.resolve('app/server/jobs.mjs')).href,storeUrl=pathToFileURL(path.resolve('app/server/store.mjs')).href;
  const ownerScript=path.join(dir,'owner.mjs');await writeFile(ownerScript,`import {openStore} from ${JSON.stringify(storeUrl)};import {createJobService} from ${JSON.stringify(jobsUrl)};const dir=process.argv[2],s=await openStore(dir);await s.transaction(s=>{s.projects.push({id:'p',revision:1,workspace:dir,profile:{limits:{jobSeconds:30}}});s.notebooks.push({id:'n',revision:1,projectId:'p',code:${JSON.stringify("import subprocess,sys,time\nfrom pathlib import Path\nPath('executions').write_text('once')\nsubprocess.Popen([sys.executable,'-c',\"import time;from pathlib import Path;Path('tree-ready').write_text('yes');time.sleep(1.5);Path('post-crash').write_text('bad');time.sleep(30)\"])\ntime.sleep(30)")}});});const j=createJobService({store:s,dataDir:dir});await j.start({projectId:'p',notebookId:'n',operationId:'crash-op'});setInterval(()=>{},1000);`);
  const owner=spawn(process.execPath,[ownerScript,dir],{windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';owner.stderr.on('data',b=>errors+=b);const closed=new Promise(r=>owner.once('close',r));t.after(()=>{if(owner.exitCode===null)owner.kill('SIGKILL');});
  await until(()=>readFile(path.join(dir,'tree-ready'),'utf8').catch(()=>null));owner.kill('SIGKILL');await closed;
  // Windows may terminate the supervisor too on a hard owner kill. A missing
  // receipt must stay interrupted; no completion receipt is required here.
  await pause(1800);assert.equal(await readFile(path.join(dir,'post-crash')).catch(()=>null),null,errors);
  const s=await openStore(dir),jobs=createJobService({store:s,dataDir:dir});await jobs.recover();assert.equal(s.read().jobs[0].status,'interrupted');assert.equal((await jobs.start({projectId:'p',notebookId:'n',operationId:'crash-op'})).id,s.read().jobs[0].id);assert.equal(await readFile(path.join(dir,'executions'),'utf8'),'once');await jobs.shutdown();await s.close();
});

test('explicit local reconciliation consumes only matching source-bound cleanup proof without running again',async t=>{
  const x=await setup(t,"from pathlib import Path\np=Path('once.txt')\np.write_text(p.read_text()+'x' if p.exists() else 'x')\nprint('verified local recovery')"),input=x.input(),job=await x.jobs.start(input);assert.equal((await x.done(job.id)).status,'completed');await x.jobs.shutdown();
  const fresh=createJobService({store:x.store,dataDir:x.dir}),dir=path.join(x.dir,'jobs',job.id),receiptPath=path.join(dir,'receipt.json'),receipt=await readFile(receiptPath,'utf8'),script=await readFile(path.join(dir,'notebook.py'),'utf8');
  t.after(()=>fresh.shutdown());
  await x.store.transaction(s=>{const j=s.jobs[0];j.status='running';j.treeCleaned=false;j.pid=process.pid;});await fresh.recover();assert.equal(x.store.read().jobs[0].status,'interrupted');
  await writeFile(receiptPath,JSON.stringify({...JSON.parse(receipt),jobId:crypto.randomUUID()}));let recovered=await fresh.reconcile({projectId:x.p.id,jobId:job.id});assert.equal(recovered.status,'interrupted');assert.equal(recovered.recovery.status,'unverified');
  await writeFile(receiptPath,receipt);await writeFile(path.join(dir,'notebook.py'),'print("tampered snapshot")');recovered=await fresh.reconcile({projectId:x.p.id,jobId:job.id});assert.equal(recovered.recovery.status,'unverified');assert.equal(x.store.read().jobs[0].status,'interrupted');
  await writeFile(path.join(dir,'notebook.py'),script);recovered=await fresh.reconcile({projectId:x.p.id,jobId:job.id});assert.equal(recovered.status,'completed');assert.equal(recovered.treeCleaned,true);assert.equal(recovered.recovery.status,'verified-cleanup');assert.equal(recovered.recovery.redispatched,0);assert.match(recovered.logs,/verified local recovery/);
  assert.equal((await fresh.start(input)).id,job.id);assert.equal(await readFile(path.join(x.workspace,'once.txt'),'utf8'),'x');
  await assert.rejects(fresh.reconcile({projectId:x.p.id,jobId:job.id,receipt:{treeCleaned:true}}),{code:'COMPUTE_SCOPE'});
});

test('missing legacy cleanup proof remains interrupted and still blocks another local writer',async t=>{
  const x=await setup(t);let old;await x.store.transaction(s=>{old=entity({kind:'notebook',status:'running',operationId:'legacy-without-proof',workspace:x.workspace,source:{sha256:'0'.repeat(64)}},x.p.id);s.jobs.push(old);});await x.jobs.recover();
  const result=await x.jobs.reconcile({projectId:x.p.id,jobId:old.id});assert.equal(result.status,'interrupted');assert.equal(result.recovery.code,'CLEANUP_RECEIPT_UNVERIFIED');assert.equal(x.store.read().jobs[0].status,'interrupted');
  await assert.rejects(x.jobs.start(x.input()),{code:'WORKSPACE_BUSY'});await assert.rejects(x.jobs.reconcile({projectId:crypto.randomUUID(),jobId:old.id}),{code:'NOT_FOUND'});
});
