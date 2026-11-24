import path from 'node:path';
import { lstat, readdir, realpath, rm } from 'node:fs/promises';

// Static managed cache paths only. Never removes the authority store, env, index
// file or host root. No Python, adapter factory, embedding or model invocation.
export async function purgeMem0Data(dataDir) {
  let root;try{root=await realpath(dataDir);}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const name of ['qdrant','history.sqlite','history.sqlite-wal','history.sqlite-shm','mem0-private']){
    const target=path.resolve(root,name),relative=path.relative(root,target);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Unsafe memory cache path');
    try{
      const stat=await lstat(target),resolved=await realpath(target),within=path.relative(root,resolved);
      if(!stat.isSymbolicLink()&&(within.startsWith('..')||path.isAbsolute(within)))throw new Error('Derived cache escaped its dedicated root');
      await rm(target,{recursive:stat.isDirectory()&&!stat.isSymbolicLink(),force:true});
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
}
export async function purgeAllMemoryVectorCaches(dataDir) {
  const root=path.join(dataDir,'memory');let children;
  try{children=await readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  let purged=0;
  for(const child of children)if(/^[a-f0-9]{64}$/.test(child.name)&&child.isDirectory()&&!child.isSymbolicLink()){
    const target=path.resolve(root,child.name),resolvedRoot=await realpath(root),resolved=await realpath(target),relative=path.relative(resolvedRoot,resolved);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Unsafe managed memory directory');
    await purgeMem0Data(target);purged++;
  }
  return purged;
}
