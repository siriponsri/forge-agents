import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, open, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Preflight must run before importing any third-party application dependency.
import { defaultDataDir } from './server/paths.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=defaultDataDir();
const receiptPath=path.join(dir,'instance.json');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function health(url){try{const r=await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(1000)});const j=await r.json();return j.product==='FORGE'&&j.dataPath===dir?j:null;}catch{return null;}}
async function running(){try{const r=JSON.parse(await readFile(receiptPath));if(await health(r.url))return r;}catch{}return null;}
async function stop(){const r=await running();if(!r){console.log('FORGE is not running. Saved projects remain in '+dir);return;}const sessionResponse=await fetch(`${r.url}/api/session`);const session=await sessionResponse.json();const cookie=sessionResponse.headers.get('set-cookie')?.split(';')[0];if(!sessionResponse.ok||!cookie||!session.csrf)throw new Error('Could not authenticate local shutdown');const response=await fetch(`${r.url}/api/system/stop`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Forge-CSRF':session.csrf},body:'{}'});if(!response.ok)throw new Error('FORGE could not stop. Inspect '+path.join(dir,'service.log'));for(let i=0;i<80;i++){if(!await health(r.url)){console.log('FORGE stopped.');return;}await delay(250);}throw new Error('Shutdown still pending; inspect logs. No unrelated process was terminated.');}
function runNpm(args){return new Promise((resolve,reject)=>{const c=spawn(process.platform==='win32'?'npm.cmd':'npm',args,{cwd:root,stdio:'inherit',shell:process.platform==='win32',windowsHide:true});c.once('error',reject);c.once('exit',code=>code===0?resolve():reject(new Error(`Dependency/build step failed (${code}); inspect the message above and retry Start-FORGE.`)));});}
async function fingerprint(){const h=createHash('sha256');async function visit(folder){for(const entry of(await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(['dist','node_modules'].includes(entry.name))continue;const f=path.join(folder,entry.name);if(entry.isDirectory())await visit(f);else{h.update(path.relative(root,f));h.update(await readFile(f));}}}await visit(path.join(root,'app','web'));h.update(await readFile(path.join(root,'package-lock.json')));return h.digest('hex');}
async function start(){
  const version=process.versions.node.split('.').map(Number);if(version[0]<24 || (version[0]===24&&version[1]<13))throw new Error('Install Node.js 24.13 or newer from https://nodejs.org and retry.');
  await mkdir(dir,{recursive:true});let existing=await running();if(existing){console.log('FORGE already ready: '+existing.url);openBrowser(existing.url);return;}
  if(!existsSync(path.join(root,'node_modules','vite'))){console.log('Installing pinned FORGE dependencies…');await runNpm(['ci']);}
  const fingerprintValue=await fingerprint(),stamp=path.join(dir,'build.json');let built;try{built=JSON.parse(await readFile(stamp));}catch{}
  if(!existsSync(path.join(root,'app','web','dist','index.html'))||built?.fingerprint!==fingerprintValue){console.log('Building FORGE…');await runNpm(['run','build']);await writeFile(stamp,JSON.stringify({fingerprint:fingerprintValue}));}
  let port=Number(process.env.FORGE_PORT??4317);
  const net=await import('node:net');
  async function free(p){return new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.listen(p,'127.0.0.1',()=>s.close(()=>resolve(true)));});}
  if(!await free(port)){console.log(`Port ${port} belongs to another process; choosing another loopback port.`);const {availablePort}=await import('./server/t3.mjs');port=await availablePort();}
  const log=await open(path.join(dir,'service.log'),'a');
  const c=spawn(process.execPath,[path.join(root,'app','server','main.mjs')],{cwd:root,detached:true,windowsHide:true,env:{...process.env,FORGE_PORT:String(port),FORGE_DATA_DIR:dir},stdio:['ignore',log.fd,log.fd]});c.unref();await log.close();
  const url=`http://127.0.0.1:${port}`;
  for(let n=0;n<120;n++){if(await health(url)){await writeFile(receiptPath,JSON.stringify({url,pid:c.pid,startedAt:new Date().toISOString()}));console.log('FORGE ready: '+url);console.log('Stop: Stop-FORGE.cmd | Data and logs: '+dir);openBrowser(url);return;}await delay(250);}
  throw new Error('FORGE did not become ready. Read '+path.join(dir,'service.log')+' and retry.');
}
function openBrowser(url){if(process.env.FORGE_NO_BROWSER==='1')return;const command=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';const c=spawn(command,[url],{stdio:'ignore',windowsHide:true});c.on('error',()=>console.log('Open this address in your browser: '+url));c.unref();}
try{const action=process.argv[2]??'start';if(action==='stop')await stop();else if(action==='restart'){await stop();await start();}else if(action==='start')await start();else throw new Error('Use start, stop or restart.');}catch(e){console.error('FORGE: '+e.message);process.exitCode=1;}
