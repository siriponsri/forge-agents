import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { entity, find, fail, confined, now } from './domain.mjs';
import { validateState } from './store.mjs';
import {mergeMemoryTombstones} from '../memory/index.mjs';
import {mergeOwnerMemorySafety} from '../memory/owner.mjs';
import {assertWorkspaceRestoreAvailable,mergeWorkspaceSafety} from '../workspaces/recovery.mjs';
import {mergeBudgetSafety,assertBudgetLedger} from '../budgets/index.mjs';
import {mergeProactiveSafety} from '../proactive/recovery.mjs';
import {assertResearchRestoreAvailable,mergeResearchSafety} from '../research/context.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createArtifactService({store,dataDir}){
  return {
    async upload({operationId,projectId,name,kind='file',base64}){
      const p=find(store.read(),'projects',projectId);
      if(typeof operationId!=='string'||!operationId||operationId.length>200||typeof kind!=='string'||kind.length>80||typeof name!=='string'||!name.trim()||name.length>180||/[\\/\x00-\x1f]/.test(name))fail('VALIDATION','Choose a file with a valid name and operation ID');
      if(typeof base64!=='string'||base64.length>22369624||!base64.length)fail('SIZE','Upload a nonempty file up to 16 MB');
      const bytes=Buffer.from(base64,'base64');
      if(bytes.length>16*1024*1024||bytes.toString('base64')!==base64)fail('FORMAT','Invalid base64 file content or file exceeds 16 MB');
      if(kind==='figure'){
        if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))kind='png';
        else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)kind='jpg';
        else fail('FORMAT','Report figures require PNG or JPEG image bytes');
      }
      const sha256=hash(bytes),fingerprint=hash(Buffer.from(JSON.stringify({projectId,name,kind,sha256})));
      const prior=store.read().receipts.find(r=>r.operationId===operationId);
      if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Upload ID was used for different content',409);return prior.result;}
      const base=await confined(p.workspace,'.forge',{existing:false});await mkdir(base,{recursive:true});await confined(p.workspace,'.forge');
      const dir=await confined(p.workspace,'.forge/uploads',{existing:false});await mkdir(dir,{recursive:true});await confined(p.workspace,'.forge/uploads');
      const safe=name.replace(/[^\p{L}\p{N}._-]/gu,'_').replace(/^\.+/,'_'),relative=path.join('.forge','uploads',sha256+'-'+safe);
      const file=await confined(p.workspace,relative,{existing:false});
      try{await writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(hash(await readFile(file))!==sha256)fail('INTEGRITY','Uploaded artifact location changed',409);}
      return store.transaction(s=>{
        const replay=s.receipts.find(r=>r.operationId===operationId);if(replay){if(replay.fingerprint!==fingerprint)fail('OPERATION_REUSE','Upload ID was used for different content',409);return replay.result;}
        let artifact=s.artifacts.find(a=>a.projectId===projectId&&a.path===file&&a.sha256===sha256);
        if(!artifact){artifact=entity({name,path:file,kind,sha256,bytes:bytes.length,status:'verified',source:{kind:'browser-upload'},locations:[{kind:'local',path:file,verifiedAt:now()}]},projectId);s.artifacts.push(artifact);}
        s.receipts.push({operationId,fingerprint,result:artifact});return artifact;
      });
    },
    async register(input){
      const p=find(store.read(),'projects',input.projectId);const file=await confined(p.workspace,input.path);const info=await stat(file);
      if(!info.isFile())fail('FORMAT','Select a file');if(info.size>512*1024*1024)fail('SIZE','Current local verification limit is 512 MB');
      const bytes=await readFile(file),sha256=hash(bytes);
      return store.transaction(s=>{const prior=s.artifacts.find(a=>a.projectId===p.id&&a.path===file&&a.sha256===sha256);if(prior)return prior;const a=entity({name:path.basename(file),path:file,kind:input.kind??'file',sha256,bytes:bytes.length,source:input.source??null,status:'verified',locations:[{kind:'local',path:file,verifiedAt:now()}]},p.id);s.artifacts.push(a);return a;});
    },
    async download(id){
      const a=find(store.read(),'artifacts',id);const p=find(store.read(),'projects',a.projectId);
      const file=await confined(p.workspace,a.path);const bytes=await readFile(file);if(hash(bytes)!==a.sha256)fail('INTEGRITY','Artifact bytes changed since verification; register a new revision',409);
      const extension=path.extname(a.name).toLowerCase();
      return {path:file,filename:a.name,contentType:({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})[extension]??'application/octet-stream'};
    },
    async backup(){
      const snapshot=store.read();const bytes=Buffer.from(JSON.stringify(snapshot));const dir=path.join(dataDir,'backups');await mkdir(dir,{recursive:true});
      const id=crypto.randomUUID(),file=path.join(dir,`${id}.json`);await writeFile(file,bytes,{flag:'wx'});const sha256=hash(bytes);await writeFile(`${file}.sha256`,sha256,{flag:'wx'});return {id,path:file,sha256,bytes:bytes.length,scope:'Domain metadata and native snapshots only. Artifact bytes, machine engine config, provider state and credentials excluded.'};
    },
    async restore({id,expectedRevision}){
      assertWorkspaceRestoreAvailable(store.read());
      assertResearchRestoreAvailable(store.read());
      if(!/^[0-9a-f-]{36}$/.test(id))fail('VALIDATION','Choose a local backup ID');
      const file=path.join(dataDir,'backups',`${id}.json`),bytes=await readFile(file);if(hash(bytes)!==(await readFile(`${file}.sha256`,'utf8')).trim())fail('INTEGRITY','Backup checksum mismatch',409);
      const restored=validateState(JSON.parse(bytes));const safety=await this.backup();
      // Memory deletion and explicit Owner sharing are current authority, not
      // configuration that an older backup can silently reinstate.
      return store.transaction(s=>{
        if(s.revision!==expectedRevision)fail('REVISION_CONFLICT','Data changed before restore. Reload and retry.',409);
        assertWorkspaceRestoreAvailable(s);assertResearchRestoreAvailable(s);const revision=s.revision;
        mergeMemoryTombstones(restored,s);mergeOwnerMemorySafety(restored,s);mergeWorkspaceSafety(restored,s);mergeBudgetSafety(restored,s);mergeProactiveSafety(restored,s);Object.assign(restored,mergeResearchSafety(restored,s));assertBudgetLedger(restored);
        restored.relay=structuredClone(s.relay);Object.assign(s,restored,{revision});
        for(const r of s.runs)if(['running','submitting'].includes(r.status))r.status='unknown';
        for(const j of s.jobs)if(['queued','running','rendering','preparing','validating'].includes(j.status))j.status='interrupted';
        return {status:'restored',safetyBackup:safety,scope:'Metadata only; verify all external bindings and artifact locations. Current mobile approval/delivery history, workspace/budget/proactive/research effect identities and Owner memory authority are preserved.'};
      });
    },
  };
}
