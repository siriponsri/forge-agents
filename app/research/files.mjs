import path from 'node:path';
import {mkdir,lstat,realpath,open,rename} from 'node:fs/promises';
import {fail,bytesDigest} from './contracts.mjs';
export async function noLinks(target){
  let p=path.resolve(target);while(true){try{const s=await lstat(p);if(s.isSymbolicLink())fail('RESEARCH_PATH','Linked research paths are prohibited',403);}catch(e){if(e.code!=='ENOENT')throw e;}const parent=path.dirname(p);if(parent===p)break;p=parent;}
}
export async function trialDirectory(dataDir,id,{create=false}={}){
  if(!/^[a-f0-9-]{36}$/.test(id))fail('RESEARCH_PATH','Invalid trial identity',403);
  const root=path.resolve(dataDir,'research','trials'),target=path.join(root,id);await noLinks(target);
  if(create)await mkdir(target,{recursive:true,mode:0o700});
  await noLinks(target);if(await realpath(target)!==target)fail('RESEARCH_PATH','Research directory changed',403);return target;
}
export async function writeFixed(dir,name,bytes,{exclusive=false}={}){
  if(!/^[a-z0-9.-]+$/.test(name))fail('RESEARCH_PATH','Fixed artifact basename required',403);
  const target=path.join(dir,name);await noLinks(target);
  if(exclusive){const f=await open(target,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}return;}
  const temp=path.join(dir,`${name}.pending`);await noLinks(temp);const f=await open(temp,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}await rename(temp,target);
}
export async function readFixed(dir,name,maxBytes){
  if(!/^[a-z0-9.-]+$/.test(name))fail('RESEARCH_PATH','Fixed artifact basename required',403);
  const target=path.join(dir,name);await noLinks(target);const f=await open(target,'r');try{const s=await f.stat();if(!s.isFile()||s.nlink!==1||s.size>maxBytes)fail('RESEARCH_ARTIFACT_LIMIT','Artifact is linked, non-regular or over limit',409);const bytes=await f.readFile();if(bytes.length>maxBytes)fail('RESEARCH_ARTIFACT_LIMIT','Artifact grew over limit',409);return {bytes,sha256:bytesDigest(bytes),size:bytes.length};}finally{await f.close();}
}
