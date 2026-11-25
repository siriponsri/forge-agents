import path from 'node:path';
import {open,lstat} from 'node:fs/promises';
import {noLinks} from '../research/files.mjs';
import {bytesDigest,fail} from '../research/contracts.mjs';

// Bound memory even when a provider grows the file after stat. Never accept links.
export async function boundedFile(dir,name,maxBytes){
  if(!['input.json','output.json'].includes(name)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>262144)fail('RESEARCH_PATH','Fixed bounded Research artifact required',409);
  const target=path.join(dir,name);await noLinks(target);const f=await open(target,'r');
  try{
    const before=await f.stat();if(!before.isFile()||before.nlink!==1||before.size>maxBytes)fail('RESEARCH_ARTIFACT_LIMIT','Regular single-link bounded artifact required',409);
    const buffer=Buffer.alloc(maxBytes+1);let length=0;
    while(length<buffer.length){const result=await f.read(buffer,length,buffer.length-length,length);if(!result.bytesRead)break;length+=result.bytesRead;}
    const after=await f.stat();await noLinks(target);const named=await lstat(target);
    if(length>maxBytes||after.size!==before.size||after.ctimeMs!==before.ctimeMs||after.mtimeMs!==before.mtimeMs||after.nlink!==1||named.ino!==after.ino||named.dev!==after.dev||named.size!==after.size||named.ctimeMs!==after.ctimeMs)fail('RESEARCH_ARTIFACT_CHANGED','Artifact changed during bounded read',409);
    const bytes=buffer.subarray(0,length);return {bytes,size:length,sha256:bytesDigest(bytes)};
  }finally{await f.close();}
}
