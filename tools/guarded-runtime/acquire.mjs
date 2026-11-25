// Explicit engineering acquisition, never called by the product or a model tool.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const cache=path.resolve(process.argv[2]??path.join(os.tmpdir(),'forge-guarded-build'));
await mkdir(cache,{recursive:true});
const sums=[];
for(const [name,url,expected] of [
  ['opencode','https://codeload.github.com/anomalyco/opencode/tar.gz/6f0514052a3c859894ad01bb14cc14dda1e44b96','2e6432bb7c27b03b5bffa170360f6b95210213520ba43c1c7f82fd1d9e2f6f28'],
  ['t3','https://codeload.github.com/pingdotgg/t3code/tar.gz/59651c1761f6c63e9b6056839067066968e6a406','6828739be5126583b945e7173e7caef5acaa7ae57ffe566d9db9f65b5ab94ca2'],
  ['bun','https://registry.npmjs.org/@oven/bun-windows-x64/-/bun-windows-x64-1.4.4.tgz','2fa598bc6c8d20440929f9c18b6363c15323274dc0fc5031e33ea209e687121c'],
]) {
  const file=path.join(cache,`${name}.tgz`);
  let bytes;try{bytes=await readFile(file);}catch {
    const res=await fetch(url,{signal:AbortSignal.timeout(120000)});
    if(!res.ok)throw Error(`ACQUIRE_${name}_${res.status}`);
    bytes=Buffer.from(await res.arrayBuffer());await writeFile(file,bytes);
  }
  if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error(`ARCHIVE_HASH_${name}`);
  const dest=path.join(cache,name);await mkdir(dest,{recursive:true});
  const r=spawnSync('python',[new URL('./extract.py',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'),file,dest],{stdio:'inherit',windowsHide:true});
  if(r.status!==0)throw Error(`EXTRACT_${name}`);
  sums.push({name,url,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(path.join(cache,'acquisition.json'),JSON.stringify(sums,null,2)+'\n');
console.log(JSON.stringify({cache,sums}));
