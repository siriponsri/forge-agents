import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { digest } from './contracts.mjs';
import { ownerProjection } from './owner-contracts.mjs';

// Same disposable SQLite cache as project memory; distinct derived tables only.
// There is no second canonical DB, duplicate memory content per project or migration.
export async function openOwnerMemoryIndex(dataDir) {
  const root=path.join(dataDir,'memory');await mkdir(root,{recursive:true});
  const db=new DatabaseSync(path.join(root,'index.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS owner_rows(id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS owner_grants(memoryId TEXT NOT NULL,projectId TEXT NOT NULL,sourceRevision INTEGER NOT NULL,PRIMARY KEY(memoryId,projectId));
    CREATE VIRTUAL TABLE IF NOT EXISTS owner_fts USING fts5(id UNINDEXED,title,content,tokenize='trigram');`);
  let signature;
  return {
    sync(state,force=false){
      const hash=digest(state.events.filter(e=>e.type.startsWith('owner-memory.')));if(!force&&hash===signature)return;
      const {records,grants}=ownerProjection(state);db.exec('BEGIN IMMEDIATE');
      try{
        db.exec('DELETE FROM owner_fts; DELETE FROM owner_rows; DELETE FROM owner_grants;');
        const row=db.prepare('INSERT INTO owner_rows VALUES(?,?)'),fts=db.prepare('INSERT INTO owner_fts(id,title,content) VALUES(?,?,?)'),grant=db.prepare('INSERT INTO owner_grants VALUES(?,?,?)');
        for(const r of records.values()){row.run(r.id,r.revision);fts.run(r.id,r.title,r.content);}
        for(const g of grants.values())if(g.status==='active'&&records.get(g.memoryId)?.revision===g.sourceRevision&&digest(records.get(g.memoryId).content)===g.sourceSha256)grant.run(g.memoryId,g.targetProjectId,g.sourceRevision);
        db.exec("INSERT INTO owner_fts(owner_fts,rank) VALUES('secure-delete',1)");db.exec('COMMIT');signature=hash;
      }catch(e){db.exec('ROLLBACK');throw e;}
    },
    search(query,projectId){
      const q=query.trim(),args=[];
      const join=projectId?' JOIN owner_grants g ON g.memoryId=r.id AND g.sourceRevision=r.revision AND g.projectId=?':'';
      if(projectId)args.push(projectId);
      if([...q].length<3)return db.prepare(`SELECT r.id FROM owner_rows r JOIN owner_fts f ON f.id=r.id ${join} WHERE instr(lower(f.title),lower(?))>0 OR instr(lower(f.content),lower(?))>0`).all(...args,q,q).map(r=>r.id);
      return db.prepare(`SELECT r.id FROM owner_fts JOIN owner_rows r ON r.id=owner_fts.id ${join} WHERE owner_fts MATCH ? ORDER BY bm25(owner_fts),r.id`).all(...args,'"'+q.replaceAll('"','""')+'"').map(r=>r.id);
    },
    close:()=>db.close(),
  };
}
