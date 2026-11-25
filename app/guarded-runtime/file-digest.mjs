import {openSync,readSync,fstatSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Rehash actual installed bytes on every authority check without allocating an
// executable-sized Buffer for every nested native phase. No digest cache.
export function fileDigest(file){
  const fd=openSync(file,'r');
  try{
    const before=fstatSync(fd),hash=createHash('sha256'),chunk=Buffer.allocUnsafe(1024*1024);
    if(!before.isFile())throw Object.assign(Error('RUNTIME_ARTIFACT_CHANGED'),{code:'RUNTIME_ARTIFACT_CHANGED'});
    let count=0,read;
    while((read=readSync(fd,chunk,0,chunk.length,null))!==0){count+=read;hash.update(chunk.subarray(0,read));}
    const after=fstatSync(fd);
    if(count!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||after.ino!==before.ino)throw Object.assign(Error('RUNTIME_ARTIFACT_CHANGED'),{code:'RUNTIME_ARTIFACT_CHANGED'});
    return hash.digest('hex');
  }finally{closeSync(fd);}
}
