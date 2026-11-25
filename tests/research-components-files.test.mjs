import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,link,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {boundedFile} from '../app/research-components/files.mjs';
import {bytesDigest} from '../app/research/contracts.mjs';

test('allocation artifact reader enforces fixed names, byte bounds, content hash and hard-link rejection',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-components-bounded-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const bytes=Buffer.from('[{"key":"alpha","total":1}]');await writeFile(path.join(dir,'output.json'),bytes);
  const read=await boundedFile(dir,'output.json',bytes.length);assert.equal(read.sha256,bytesDigest(bytes));assert.deepEqual(read.bytes,bytes);
  await assert.rejects(boundedFile(dir,'output.json',bytes.length-1),e=>e.code==='RESEARCH_ARTIFACT_LIMIT');
  await assert.rejects(boundedFile(dir,'../output.json',100),e=>e.code==='RESEARCH_PATH');
  await link(path.join(dir,'output.json'),path.join(dir,'linked.json'));await assert.rejects(boundedFile(dir,'output.json',100),e=>e.code==='RESEARCH_ARTIFACT_LIMIT');
});
