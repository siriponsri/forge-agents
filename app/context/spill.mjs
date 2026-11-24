import path from 'node:path';
import {mkdir,realpath,lstat,open,unlink,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fail,hash,integer,LIMITS} from './contracts.mjs';

// No user paths or filenames enter this storage. Each capability has its own
// random filename, so deleting one scope cannot break another scope's evidence.
export async function createSpillStorage(dataDir,limits=LIMITS){
  await mkdir(dataDir,{recursive:true});const dataRoot=await realpath(dataDir);
  const root=path.join(dataRoot,'context-spill');await mkdir(root,{recursive:true});
  async function checkRoot(){const st=await lstat(root);if(st.isSymbolicLink()||await realpath(root)!==root)fail('CONTEXT_PATH','Spill directory was redirected',403);}
  await checkRoot();
  function file(handle){if(typeof handle!=='string'||!/^ctx_[a-f0-9]{48}$/.test(handle))fail('CONTEXT_HANDLE','Invalid retrieval handle',404);return path.join(root,`${handle}.bin`);}
  async function verified(record){
    await checkRoot();const name=file(record.handle);const st=await lstat(name).catch(()=>null);
    if(!st||st.isSymbolicLink()||!st.isFile()||st.size!==record.bytes||st.nlink!==1||await realpath(name)!==name)fail('CONTEXT_INTEGRITY','Missing or changed spill evidence',409);
    const fd=await open(name,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try{const fst=await fd.stat();if(fst.size!==st.size||fst.ino!==st.ino||fst.dev!==st.dev||fst.nlink!==1)fail('CONTEXT_INTEGRITY','Spill changed while opening',409);const bytes=await fd.readFile();if(bytes.length!==record.bytes||hash(bytes)!==record.sha256)fail('CONTEXT_INTEGRITY','Spill hash mismatch',409);return bytes;}finally{await fd.close();}
  }
  return {
    async write(text){await checkRoot();const bytes=Buffer.from(text,'utf8');integer(bytes.length,'spill bytes',1,limits.maxSpillBytes);const handle=`ctx_${randomBytes(24).toString('hex')}`,fd=await open(file(handle),'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}return {handle,bytes:bytes.length,sha256:hash(bytes),encoding:'utf-8'};},
    async read(record,{offset=0,limit=limits.maxPageBytes}={}){integer(offset,'offset',0,record.bytes);integer(limit,'limit',4,limits.maxPageBytes);if(Math.ceil(record.bytes/(limit-3))>limits.maxPages)fail('CONTEXT_LIMIT','Page size would exceed the Unicode-safe page count limit');const bytes=await verified(record);
      // Offsets are UTF-8 byte boundaries and pages never split a code point.
      if(offset<bytes.length&&(bytes[offset]&0xc0)===0x80)fail('CONTEXT_PAGE','Offset splits a UTF-8 code point');let end=Math.min(bytes.length,offset+limit);while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;
      return {text:bytes.subarray(offset,end).toString('utf8'),offset,nextOffset:end<bytes.length?end:null,pageBytes:end-offset,totalBytes:bytes.length,sha256:record.sha256,hashVerified:true,trust:'untrusted-data',executable:false};},
    async remove(handle){await checkRoot();await unlink(file(handle)).catch(e=>{if(e.code!=='ENOENT')throw e;});},
    async reconcile(liveHandles){await checkRoot();for(const entry of await readdir(root)){if(/^ctx_[a-f0-9]{48}\.bin$/.test(entry)&&!liveHandles.has(entry.slice(0,-4)))await unlink(path.join(root,entry));}},
  };
}
