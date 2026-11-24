import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { projection, scopeKey, digest } from './contracts.mjs';

// Disposable projection, never a second operational store. No changes to forge.sqlite.
export async function openMemoryIndex(dataDir) {
  const dir=path.join(dataDir,'memory'); await mkdir(dir,{recursive:true});
  const db=new DatabaseSync(path.join(dir,'index.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, scope TEXT NOT NULL, shares TEXT NOT NULL, revision INTEGER NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED,title,content,tokenize='trigram');`);
  let fingerprint;
  const api={
    sync(state, force=false) {
      // A revision alone is insufficient after restoring a snapshot with the same number.
      const signature=digest(state.events.filter(e=>e.type.startsWith('memory.')));
      if(!force && signature===fingerprint) return;
      const {records}=projection(state); db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('DELETE FROM memory_fts; DELETE FROM memories;');
        const row=db.prepare('INSERT INTO memories VALUES(?,?,?,?)'),fts=db.prepare('INSERT INTO memory_fts(id,title,content) VALUES(?,?,?)');
        for(const r of records.values()) { row.run(r.id,scopeKey(r.scope),JSON.stringify(r.shares.map(scopeKey)),r.revision); fts.run(r.id,r.title,r.content); }
        db.exec("INSERT INTO memory_fts(memory_fts,rank) VALUES('secure-delete',1)");
        db.exec('COMMIT'); fingerprint=signature;
      } catch(e) {db.exec('ROLLBACK'); throw e;}
    },
    search(query, target) {
      const key=scopeKey(target), queryText=query.trim();
      // Restrict candidates in SQL before ranking; re-authorize against canonical
      // records in the service. Trigrams handle unsegmented Thai and English.
      const filter='(m.scope=? OR EXISTS (SELECT 1 FROM json_each(m.shares) WHERE value=?))';
      if([...queryText].length<3) return db.prepare(`SELECT m.id,0 AS score FROM memories m JOIN memory_fts f ON f.id=m.id WHERE ${filter} AND (instr(lower(f.title),lower(?))>0 OR instr(lower(f.content),lower(?))>0)`).all(key,key,queryText,queryText);
      const literal='"'+queryText.replaceAll('"','""')+'"';
      return db.prepare(`SELECT m.id,bm25(memory_fts) AS score FROM memory_fts JOIN memories m ON m.id=memory_fts.id WHERE memory_fts MATCH ? AND ${filter} ORDER BY score,m.id`).all(literal,key,key);
    },
    stats:()=>({engine:'SQLite FTS5 trigram',count:db.prepare('SELECT count(*) AS n FROM memories').get().n,derived:true}),
    close:()=>db.close(),
  };
  return api;
}
