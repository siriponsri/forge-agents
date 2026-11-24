import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { entity, find, fail, confined, now } from './domain.mjs';
import { validateState } from './store.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createArtifactService({store,dataDir}){
  return {
    async register(input){
      const p=find(store.read(),'projects',input.projectId);const file=await confined(p.workspace,input.path);const info=await stat(file);
      if(!info.isFile())fail('FORMAT','Select a file');if(info.size>512*1024*1024)fail('SIZE','Current local verification limit is 512 MB');
      const bytes=await readFile(file),sha256=hash(bytes);
      return store.transaction(s=>{const prior=s.artifacts.find(a=>a.projectId===p.id&&a.path===file&&a.sha256===sha256);if(prior)return prior;const a=entity({name:path.basename(file),path:file,kind:input.kind??'file',sha256,bytes:bytes.length,source:input.source??null,status:'verified',locations:[{kind:'local',path:file,verifiedAt:now()}]},p.id);s.artifacts.push(a);return a;});
    },
    async download(id){
      const a=find(store.read(),'artifacts',id);const p=find(store.read(),'projects',a.projectId);
      const file=await confined(p.workspace,a.path);const bytes=await readFile(file);if(hash(bytes)!==a.sha256)fail('INTEGRITY','Artifact bytes changed since verification; register a new revision',409);
      return {path:file,filename:a.name,contentType:a.name.endsWith('.pdf')?'application/pdf':a.name.endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/octet-stream'};
    },
    async backup(){
      const snapshot=store.read();const bytes=Buffer.from(JSON.stringify(snapshot));const dir=path.join(dataDir,'backups');await mkdir(dir,{recursive:true});
      const id=crypto.randomUUID(),file=path.join(dir,`${id}.json`);await writeFile(file,bytes,{flag:'wx'});const sha256=hash(bytes);await writeFile(`${file}.sha256`,sha256,{flag:'wx'});return {id,path:file,sha256,bytes:bytes.length,scope:'Domain metadata and native snapshots only. Artifact bytes, machine engine config, provider state and credentials excluded.'};
    },
    async restore({id,expectedRevision}){
      if(!/^[0-9a-f-]{36}$/.test(id))fail('VALIDATION','Choose a local backup ID');
      const file=path.join(dataDir,'backups',`${id}.json`),bytes=await readFile(file);if(hash(bytes)!==(await readFile(`${file}.sha256`,'utf8')).trim())fail('INTEGRITY','Backup checksum mismatch',409);
      const restored=validateState(JSON.parse(bytes));const safety=await this.backup();
      return store.transaction(s=>{if(s.revision!==expectedRevision)fail('REVISION_CONFLICT','Data changed before restore. Reload and retry.',409);const revision=s.revision;Object.assign(s,restored,{revision});for(const r of s.runs)if(['running','submitting'].includes(r.status))r.status='unknown';for(const j of s.jobs)if(['queued','running','rendering','preparing','validating'].includes(j.status))j.status='interrupted';return {status:'restored',safetyBackup:safety,scope:'Metadata only; verify all external bindings and artifact locations.'};});
    },
  };
}
