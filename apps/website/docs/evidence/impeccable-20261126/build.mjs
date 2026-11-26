// From apps/website. Reuses installed modules; all Vite caches are worker-private.
import {build} from 'vite';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const cacheDir=tmpdir()+'/forge-website-impeccable-37426';
await build({cacheDir,configLoader:'runner'});
const target=new URL('./static-temporary.mjs',import.meta.url);
const source=(await readFile('scripts/static.mjs','utf8'))
  .replace("'./release-policy.mjs'","'../../../scripts/release-policy.mjs'")
  .replace("createServer({server:",`createServer({cacheDir:${JSON.stringify(cacheDir)},configLoader:'runner',server:`);
await writeFile(target,source);
try{await import(target.href)}finally{await unlink(target)}
console.log('Private Vite cache: '+cacheDir);
