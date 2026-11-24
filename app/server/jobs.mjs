import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { entity, find, fail, now, changed } from './domain.mjs';

export function createJobService({store,dataDir}){
  const processes=new Map();
  return {
    async recover(){await store.transaction(s=>{for(const j of s.jobs)if(j.kind==='notebook'&&['queued','running','stopping'].includes(j.status)){j.status='interrupted';j.error='FORGE restarted; Python process ownership was lost. Inspect outputs before a new attempt.';changed(j);}});},
    async start(input){
      const job=await store.transaction(s=>{
        const previous=s.jobs.find(j=>j.operationId===input.operationId);
        if(previous){if(previous.projectId!==input.projectId||previous.notebookId!==input.notebookId)fail('OPERATION_REUSE','Job operation reused',409);return {...previous,replayed:true};}
        if(!input.operationId)fail('VALIDATION','operationId required');
        const p=find(s,'projects',input.projectId); const n=find(s,'notebooks',input.notebookId,p.id);
        if((n.compute?.kind??p.profile.compute?.kind??'local')!=='local')fail('COMPUTE_UNIMPLEMENTED','This compute adapter is not implemented for notebook execution',501);
        if(s.jobs.some(j=>j.projectId===p.id&&['queued','running','stopping'].includes(j.status)))fail('WORKSPACE_BUSY','A job already owns this workspace',409);
        const j=entity({kind:'notebook',operationId:input.operationId,notebookId:n.id,sourceRevision:n.revision,code:n.code??(n.cells??[]).filter(c=>c.cell_type==='code').map(c=>Array.isArray(c.source)?c.source.join(''):c.source).join('\n'),status:'queued',logs:'',workspace:p.workspace,profileRevision:p.revision},p.id);s.jobs.push(j);return j;
      });
      if(job.replayed)return job;
      const dir=path.join(dataDir,'jobs',job.id);await mkdir(dir,{recursive:true});
      const script=path.join(dir,'notebook.py');await writeFile(script,job.code??'','utf8');
      const child=spawn(process.env.FORGE_PYTHON??'python',['-u',script],{cwd:job.workspace,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
      processes.set(job.id,child);
      const update=(fn)=>store.transaction(s=>{const j=find(s,'jobs',job.id);fn(j);changed(j);}).catch(()=>{});
      await update(j=>{j.status='running';j.pid=child.pid;j.startedAt=now();});
      const append=b=>update(j=>{j.logs=(j.logs+b.toString('utf8')).slice(-200000);});
      child.stdout.on('data',append);child.stderr.on('data',append);
      let done=false;
      const finish=(status,error,exitCode)=>{if(done)return;done=true;processes.delete(job.id);update(j=>{j.status=status;j.error=error;j.exitCode=exitCode;j.finishedAt=now();});};
      child.on('error',e=>finish('failed',`Python could not start: ${e.message}. Install Python and retry.`,null));
      child.on('exit',(code,signal)=>finish(store.read().jobs.find(j=>j.id===job.id)?.status==='stopping'?'stopped':code===0?'completed':'failed',code===0?null:`Python exited (${code??signal})`,code));
      return store.read().jobs.find(j=>j.id===job.id);
    },
    async stop(id){
      const child=processes.get(id);if(!child)fail('NO_OWNED_PROCESS','No owned process; reconcile interrupted work before retry',409);
      await store.transaction(s=>{const j=find(s,'jobs',id);j.status='stopping';changed(j);});child.kill('SIGTERM');return find(store.read(),'jobs',id);
    },
    async shutdown(){for(const [id,child]of processes){child.kill('SIGTERM');await store.transaction(s=>{const j=find(s,'jobs',id);j.status='interrupted';j.error='Application shutdown; review partial outputs.';changed(j);});}processes.clear();},
    async importNotebook(input){const p=find(store.read(),'projects',input.projectId);const {confined}=await import('./domain.mjs');const file=await confined(p.workspace,input.path);const raw=JSON.parse(await readFile(file,'utf8'));if(raw.nbformat!==4)fail('FORMAT','Only notebook v4 is supported');return {name:path.basename(file),language:'python',cells:raw.cells,code:raw.cells.filter(c=>c.cell_type==='code').map(c=>c.source.join('')).join('\n\n')};},
  };
}
