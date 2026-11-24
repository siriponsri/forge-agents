import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { entity, find, fail, now, changed, revision } from './domain.mjs';

const active = new Set(['queued','submitting','submitted','starting','running','stopping','unknown','interrupted','awaiting-owner']);
const terminal = new Set(['completed','failed','stopped']);
const writers = new Set(['notebook','compute-notebook','task','chat','task-run','chat-run']);
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const codeOf = n => n.code ?? (n.cells ?? []).filter(c => c.cell_type === 'code').map(c => Array.isArray(c.source) ? c.source.join('') : c.source ?? '').join('\n\n');
const runner = fileURLToPath(new URL('../jobs/runner.py', import.meta.url));
async function tail(file) {
  let handle;
  try { handle=await open(file,'r'); const size=(await handle.stat()).size, b=Buffer.alloc(Math.min(size,200000)); await handle.read(b,0,b.length,Math.max(0,size-b.length)); return b.toString('utf8'); }
  catch(e) { if(e.code==='ENOENT') return ''; throw e; } finally { await handle?.close(); }
}

// Private process owner. The HTTP compute facade moves its trusted selection
// into the second argument; browser body fields cannot choose local ownership.
export function createJobService({store,dataDir,admit}) {
  const processes=new Map(), starts=new Map(), writes=new Set();
  let closing=false, persistenceError;
  const persist=fn=>{const p=store.transaction(fn); writes.add(p); p.then(()=>writes.delete(p),()=>writes.delete(p)); return p;};
  const update=(id,fn)=>{const p=persist(s=>{const j=find(s,'jobs',id);fn(j);changed(j);return j;});p.catch(e=>{persistenceError=e;});return p;};
  const current=id=>find(store.read(),'jobs',id);
  async function execute(input,trusted,fingerprint) {
    const job=await persist(s=>{
      const old=s.jobs.find(j=>j.operationId===input.operationId);
      if(old){if(old.localFingerprint!==fingerprint)fail('OPERATION_REUSE','Job operation reused with different inputs',409);return {...old,replayed:true};}
      if(s.receipts?.some(r=>r.operationId===input.operationId))fail('OPERATION_REUSE','Operation belongs to another action',409);
      if(closing)fail('JOBS_CLOSED','Local jobs are shutting down',409);
      const p=find(s,'projects',input.projectId), n=find(s,'notebooks',input.notebookId,p.id);
      if(n.language&&n.language!=='python')fail('NOTEBOOK_LANGUAGE','Local execution supports Python notebooks');
      if(trusted){
        if(trusted.kind!=='local')fail('COMPUTE_SCOPE','Local owner requires a local compute selection',409);
        revision(p,trusted.projectRevision);revision(n,trusted.notebookRevision);
        if(trusted.targetId){const target=find(s,'connections',trusted.targetId,p.id);revision(target,trusted.targetRevision);if(target.kind!=='compute'||target.config?.kind!=='local')fail('COMPUTE_SCOPE','Resolved target is not local compute',409);}
        else if(trusted.targetRevision!=null)fail('COMPUTE_SCOPE','Target revision requires a target',409);
      }else if((n.compute?.kind??p.profile?.compute?.kind??'local')!=='local'||n.compute?.connectionId||p.profile?.compute?.connectionId)fail('COMPUTE_SETUP','Start through compute selection before local dispatch',409);
      if(input.phaseId)find(s,'phases',input.phaseId,p.id);
      if((input.mode&&input.mode!=='restart')||input.checkpointArtifactId)fail('RESUME_UNSUPPORTED','Local execution supports fresh restart, not checkpoint resume',409);
      if(input.previousJobId){const prev=find(s,'jobs',input.previousJobId,p.id);if(prev.notebookId!==n.id||!terminal.has(prev.status))fail('RESTART_SCOPE','Previous attempt must be terminal and belong to this notebook',409);}
      const busy=j=>j.projectId===p.id&&active.has(j.status);
      if(s.jobs.some(j=>busy(j)&&writers.has(j.kind))||s.runs.some(j=>busy(j)&&(!j.kind||writers.has(j.kind))))fail('WORKSPACE_BUSY','A task, chat or notebook writer owns this workspace',409);
      const admission=admit?.(s,input);if(admission?.then)fail('ADMISSION_CONTRACT','admit must be synchronous');if(admission===false)fail('ADMISSION_DENIED','Local notebook admission refused',403);
      const limitSeconds=p.profile?.limits?.jobSeconds??120;if(!Number.isInteger(limitSeconds)||limitSeconds<1||limitSeconds>86400)fail('VALIDATION','jobSeconds must be 1..86400');
      const code=codeOf(n), j=entity({kind:'notebook',operationId:input.operationId,localFingerprint:fingerprint,notebookId:n.id,phaseId:input.phaseId??null,sourceRevision:n.revision,source:{notebookId:n.id,revision:n.revision,sha256:hash(code)},code,status:'queued',logs:'',workspace:p.workspace,profileRevision:p.revision,limitSeconds,mode:'restart',previousJobId:input.previousJobId??null,computeAttempt:{kind:'local',targetId:trusted?.targetId??null,targetRevision:trusted?.targetRevision??null},artifactRefs:[],checkpointRefs:[]},p.id);s.jobs.push(j);return j;
    });
    if(job.replayed)return job;
    let resolveDone;const control={child:null,done:new Promise(r=>{resolveDone=r;}),stopRequested:false};processes.set(job.id,control);
    const dir=path.resolve(dataDir,'jobs',job.id),logPath=path.join(dir,'output.log'),receiptPath=path.join(dir,'receipt.json');
    try {
      await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'notebook.py'),job.code,'utf8');
      await writeFile(path.join(dir,'manifest.json'),JSON.stringify({jobId:job.id,ownerPid:process.pid,script:path.join(dir,'notebook.py'),workspace:job.workspace,logPath,receiptPath,limitSeconds:job.limitSeconds}),{flag:'wx'});
      if(control.stopRequested||current(job.id).stopRequested||closing)return await update(job.id,j=>{j.status='stopped';j.finishedAt=now();j.stopRequested=true;});
      const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA'].includes(k)));
      const child=spawn(process.env.FORGE_PYTHON??'python',['-u',runner,path.join(dir,'manifest.json')],{cwd:job.workspace,env,windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});control.child=child;
      // All listeners precede persistence. close follows drained wrapper stdio;
      // the supervisor writes its receipt only after the owned tree is drained.
      let spawnError,diagnostic='',finalizing=false,logTimer,logBusy=false;
      child.on('error',e=>{spawnError=e;});child.stdin.on('error',()=>{});
      const diagnosticChunk=b=>{diagnostic=(diagnostic+b.toString()).slice(-8000);};child.stdout.on('data',diagnosticChunk);child.stderr.on('data',diagnosticChunk);
      const completion=new Promise((resolve,reject)=>child.once('close',async code=>{
        finalizing=true;clearInterval(logTimer);
        try {
          await control.logTask;
          let receipt;try{receipt=JSON.parse(await readFile(receiptPath,'utf8'));}catch{}
          const logs=await tail(logPath),valid=receipt?.jobId===job.id&&receipt.treeCleaned===true&&terminal.has(receipt.status);
          resolve(await update(job.id,j=>{
            j.logs=logs;j.finishedAt=now();j.pid=null;j.supervisorExitCode=code;
            if(valid){j.status=receipt.status;j.exitCode=receipt.exitCode;j.treeCleaned=true;j.timedOut=receipt.reason==='timeout';j.error=receipt.error??(j.timedOut?'Local job reached its time limit':null);j.evidenceScope=receipt.ownership;}
            else{j.status=spawnError?'failed':'interrupted';j.error=spawnError?`Python could not start: ${spawnError.message}. Configure FORGE_PYTHON or install Python.`:`Supervisor ended without a verified cleanup receipt. Inspect partial outputs before restarting. ${diagnostic}`;j.treeCleaned=false;}
          }));
        }catch(e){reject(e);}
      }));completion.catch(()=>{});control.completion=completion;
      logTimer=setInterval(()=>{if(logBusy||finalizing)return;logBusy=true;control.logTask=(async()=>{try{const logs=await tail(logPath);if(!finalizing&&logs!==current(job.id).logs)await update(job.id,j=>{j.logs=logs;});}catch(e){persistenceError=e;}finally{logBusy=false;}})();},150);logTimer.unref();
      await update(job.id,j=>{if(!terminal.has(j.status)&&j.status!=='interrupted'){j.status=j.stopRequested?'stopping':'running';j.pid=child.pid??null;j.startedAt=now();j.deadlineAt=new Date(Date.now()+job.limitSeconds*1000).toISOString();}});
      child.stdin.write(control.stopRequested||current(job.id).stopRequested||closing?'stop\n':'start\n');
      if(control.stopRequested||closing)child.stdin.end();return current(job.id);
    }catch(e){
      if(control.child){control.child.stdin.end();await control.completion?.catch(()=>{});}
      await update(job.id,j=>{if(!terminal.has(j.status)){j.status='failed';j.error=e.message;j.finishedAt=now();}});return current(job.id);
    }finally{
      if(control.completion)control.completion.finally(()=>{processes.delete(job.id);resolveDone();}).catch(()=>{});
      else{processes.delete(job.id);resolveDone();}
    }
  }
  return {
    async recover(){await persist(s=>{for(const j of s.jobs)if(j.kind==='notebook'&&active.has(j.status)&&!processes.has(j.id)){j.status='interrupted';j.error='FORGE restarted; execution was not reattached. No persisted PID was signalled. Inspect partial outputs before a fresh restart.';j.pid=null;changed(j);}});},
    start(input,{resolvedCompute}={}){
      if(input.resolvedCompute!==undefined)return Promise.reject(Object.assign(new Error('resolvedCompute is host-only; use the private second argument'),{code:'COMPUTE_SCOPE',statusCode:403}));
      if(typeof input.operationId!=='string'||!input.operationId.trim())return Promise.reject(Object.assign(new Error('operationId required'),{code:'VALIDATION',statusCode:400}));
      const fingerprint=hash({projectId:input.projectId,notebookId:input.notebookId,phaseId:input.phaseId??null,targetId:input.targetId??null,mode:input.mode??'restart',previousJobId:input.previousJobId??null,checkpointArtifactId:input.checkpointArtifactId??null});
      const pending=starts.get(input.operationId);if(pending){if(pending.fingerprint!==fingerprint)return Promise.reject(Object.assign(new Error('Operation reused with different inputs'),{code:'OPERATION_REUSE',statusCode:409}));return pending.promise;}
      const promise=execute(input,resolvedCompute,fingerprint);starts.set(input.operationId,{fingerprint,promise});promise.finally(()=>starts.delete(input.operationId)).catch(()=>{});return promise;
    },
    async stop(input){
      const id=typeof input==='string'?input:input.jobId,j=find(store.read(),'jobs',id,typeof input==='string'?undefined:input.projectId);
      if(j.kind!=='notebook')fail('COMPUTE_SCOPE','Not a local notebook job',409);if(terminal.has(j.status))return j;
      let c=processes.get(id);const pending=starts.get(j.operationId);
      if(!c&&!(j.status==='queued'&&pending))fail('NO_OWNED_PROCESS','No live owned supervisor; inspect/reconcile interrupted work',409);
      if(c)c.stopRequested=true;await update(id,j=>{if(!terminal.has(j.status)){j.stopRequested=true;j.status='stopping';}});
      if(!c&&pending){await pending.promise;c=processes.get(id);}
      if(c?.child&&!c.child.stdin.writableEnded)c.child.stdin.end('stop\n');if(c){await c.done;if(persistenceError)throw persistenceError;}return current(id);
    },
    async shutdown(){closing=true;for(const c of processes.values()){c.stopRequested=true;c.child?.stdin.end('stop\n');}await Promise.allSettled([...starts.values()].map(x=>x.promise));await Promise.all([...processes.values()].map(c=>c.done));while(writes.size)await Promise.allSettled([...writes]);if(persistenceError)throw persistenceError;},
    async importNotebook(input){const p=find(store.read(),'projects',input.projectId),{confined}=await import('./domain.mjs'),file=await confined(p.workspace,input.path),raw=JSON.parse(await readFile(file,'utf8'));if(raw.nbformat!==4||!Array.isArray(raw.cells))fail('FORMAT','Only notebook v4 is supported');return {name:path.basename(file),language:'python',cells:raw.cells,code:codeOf({cells:raw.cells})};},
  };
}
