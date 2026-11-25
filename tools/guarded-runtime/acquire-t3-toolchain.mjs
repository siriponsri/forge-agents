import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const cache=path.resolve(process.argv[2]);await mkdir(cache,{recursive:true});
for(const spec of [
  {name:'node',url:'https://nodejs.org/dist/v26.13.1/node-v26.13.1-win-x64.zip',alg:'sha256',hash:'e2edda75bfb089654705cf65a13b58933bfd5f57148e8ebda916f58a2474f1f7',ext:'zip'},
  {name:'pnpm',url:'https://registry.npmjs.org/pnpm/-/pnpm-12.14.0.tgz',alg:'sha512',hash:'wYum2HmT09Fky16JSPMrLAbuhUSH4GzY2GeBNC+z5btGNDZwNHEehoArqpw3vqkGzhkprQjXCITJfYAd8TOJpg==',ext:'tgz'},
  {name:'pnpm-exe',url:'https://registry.npmjs.org/@pnpm/exe.win32-x64/-/exe.win32-x64-12.14.0.tgz',alg:'sha512',hash:'/LSX6mew/sLf08XqcjemuklNKf1K/Ftpgj4//hK/HKzI2dKbmxDB27a/2OaQ5a0O3/3OFzlssXDziZsi+yVBwQ==',ext:'tgz'},
]){
  const file=path.join(cache,spec.name+'.'+spec.ext);let bytes;try{bytes=await readFile(file);}catch{const r=await fetch(spec.url,{signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('TOOLCHAIN_DOWNLOAD');bytes=Buffer.from(await r.arrayBuffer());await writeFile(file,bytes);}
  if(createHash(spec.alg).update(bytes).digest(spec.alg==='sha512'?'base64':'hex')!==spec.hash)throw Error('TOOLCHAIN_HASH');
  const out=path.join(cache,spec.name);await mkdir(out,{recursive:true});
  const result=spec.ext==='zip'?spawnSync('tar',['-xf',file,'-C',out,'--strip-components=1'],{windowsHide:true,encoding:'utf8'}):spawnSync('python',[fileURLToPath(new URL('./extract.py',import.meta.url)),file,out],{windowsHide:true,encoding:'utf8'});
  if(result.status!==0)throw Error(result.stderr);console.log(spec.name,'VERIFIED_EXTRACTED');
}
