import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createMem0Adapter, validateBackendConfig } from '../app/memory/mem0-adapter.mjs';
import { DatabaseSync } from 'node:sqlite';

const python=process.env.FORGE_MEMORY_TEST_PYTHON??path.resolve('app/memory/.qualification-env',process.platform==='win32'?'Scripts/python.exe':'bin/python');
export const mem0Config={backend:'mem0',vectorStore:'qdrant-local-disk',embeddingModel:'fixture-not-a-quality-model',extractionModel:'fixture-no-inference',dimensions:32,ollamaUrl:'http://127.0.0.1:11434'};

test('real Mem0 OSS SDK + Qdrant local disk replace/search/restart/delete/rebuild without LLM or credentials',{skip:!existsSync(python)?'NOT_RUN: optional isolated Python environment absent':false},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-mem0-sdk-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const create=()=>createMem0Adapter({dataDir:dir,config:mem0Config,pythonPath:python,fixtureMode:true});
  let adapter=await create();
  const health=await adapter.health();assert.equal(health.mem0,'2.2.1');assert.equal(health.qdrantClient,'1.20.0');assert.equal(health.inference,'not-run');
  const scope={projectId:'p',kind:'project',id:'p'},other={projectId:'q',kind:'project',id:'q'},share={projectId:'p',kind:'task',id:'task'};
  const records=[{id:'first',revision:1,scope,shares:[share],content:'alpha recall fixture'},{id:'private',revision:1,scope:other,shares:[],content:'alpha private fixture'}];
  assert.equal((await adapter.replace(records)).indexed,2);
  const history=new DatabaseSync(path.join(dir,'history.sqlite'));const tables=history.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();for(const {name}of tables)assert.equal(history.prepare('SELECT count(*) AS n FROM "'+name.replaceAll('"','""')+'"').get().n,0);history.close();
  assert.deepEqual((await adapter.search({query:'alpha recall',scope,limit:10,action:'replace',fixtureMode:false,dataDir:'untrusted-override-must-be-ignored'})).map(x=>x.id),['first']);
  assert.deepEqual((await adapter.search({query:'alpha recall',scope:share,limit:10})).map(x=>x.id),['first']);
  await adapter.close();adapter=await create();
  assert.equal((await adapter.search({query:'alpha recall',scope,limit:10}))[0].revision,1);
  await adapter.replace([{...records[0],revision:2,content:'updated procedure fixture'}]);
  assert.equal((await adapter.search({query:'updated procedure',scope,limit:10}))[0].revision,2);
  await adapter.replace([]);assert.equal((await adapter.search({query:'alpha recall',scope,limit:10})).length,0);
  await adapter.close();adapter=await create();assert.equal((await adapter.search({query:'updated procedure',scope,limit:10})).length,0);
  await adapter.purge();assert.equal(existsSync(path.join(dir,'qdrant')),false);
  await adapter.close();
});

test('optional backend rejects remote services, secrets, arbitrary runtime paths and unsupported storage',()=>{
  for(const patch of [{ollamaUrl:'https://evil.example'},{ollamaUrl:'http://user:pass@127.0.0.1:11434'},{pythonPath:'evil.exe'},{apiKey:'unapproved'},{vectorStore:'qdrant-cloud'},{dimensions:0}])assert.throws(()=>validateBackendConfig({...mem0Config,...patch}));
});
