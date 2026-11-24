import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export const collections = ['projects','bots','conversations','plans','phases','tasks','runs','artifacts','documents','reports','connections','notebooks','jobs','desktopTargets','skills','receipts','events'];
export function emptyState() {
  return {schemaVersion:1,revision:0,...Object.fromEntries(collections.map(k=>[k,[]])),settings:{language:'th'}};
}
export function validateState(s) {
  if(s?.schemaVersion!==1 || !Number.isSafeInteger(s.revision) || collections.some(k=>!Array.isArray(s[k]))) throw new Error('Unsupported or corrupt FORGE snapshot; retain backup and use recovery.');
  for(const key of collections) if(new Set(s[key].map(x=>x.id ?? x.operationId)).size!==s[key].length) throw new Error(`Duplicate identities: ${key}`);
  return s;
}
export async function openStore(dataDir) {
  await mkdir(dataDir,{recursive:true});
  const db=new DatabaseSync(path.join(dataDir,'forge.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS domain (id INTEGER PRIMARY KEY CHECK(id=1), snapshot TEXT NOT NULL);');
  db.prepare('INSERT OR IGNORE INTO domain VALUES(1,?)').run(JSON.stringify(emptyState()));
  const emitter=new EventEmitter(); let pending=Promise.resolve();
  const store={
    read:()=>structuredClone(validateState(JSON.parse(db.prepare('SELECT snapshot FROM domain WHERE id=1').get().snapshot))),
    transaction(fn){
      const task=pending.then(async()=>{
        db.exec('BEGIN IMMEDIATE');
        try {
          const state=store.read(); const value=await fn(state);
          validateState(state); state.revision++;
          db.prepare('UPDATE domain SET snapshot=? WHERE id=1').run(JSON.stringify(state)); db.exec('COMMIT');
          store.emit(); return structuredClone(value);
        } catch(e){db.exec('ROLLBACK');throw e;}
      });
      pending=task.catch(()=>{}); return task;
    },
    emit(){emitter.emit('change');},
    subscribe(fn){emitter.on('change',fn);return()=>emitter.off('change',fn);},
    async close(){await pending;db.close();},
  };
  store.read(); return store;
}
