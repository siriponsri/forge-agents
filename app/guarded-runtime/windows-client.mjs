import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {bytesDigest,fail} from './profile.mjs';

export async function openConfinedText({binary,binarySha256,root,timeoutMs=5000}){
  if(process.platform!=='win32')fail('WINDOWS_REQUIRED');
  if(bytesDigest(await readFile(binary))!==binarySha256)fail('BROKER_BINARY_CHANGED');
  // Absolute host-selected executable/root, never caller/model args. Environment
  // excludes native/provider config and credentials. No shell and no listener.
  const child=spawn(binary,[root],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot}});
  const ended=new Promise(resolve=>child.once('close',resolve));
  let pending,dead=false;
  const lines=createInterface({input:child.stdout});
  function poison(){dead=true;if(pending){pending.reject(Object.assign(Error('BROKER_UNKNOWN'),{code:'BROKER_UNKNOWN'}));pending=undefined;}child.kill();}
  child.on('error',poison);child.on('exit',poison);child.stderr.resume();
  lines.on('line',line=>{
    if(!pending||line.length>300000)return poison();
    const p=pending;pending=undefined;clearTimeout(p.timer);
    try{p.resolve(JSON.parse(line));}catch{p.reject(Object.assign(Error('BROKER_UNKNOWN'),{code:'BROKER_UNKNOWN'}));poison();}
  });
  function next(){
    if(dead||pending)fail('BROKER_UNAVAILABLE');
    return new Promise((resolve,reject)=>{pending={resolve,reject,timer:setTimeout(poison,timeoutMs)};});
  }
  const ready=await next();if(!ready.ready){poison();fail('ROOT_UNSAFE');}
  return Object.freeze({
    async command(request){const response=next();child.stdin.write(JSON.stringify(request)+'\n');const r=await response;if(!r.ok)fail(['REVISION_CHANGED','TEXT_LIMIT','UNSAFE_FILE','PATH_DENIED','TEXT_BINARY','OPEN_DENIED'].includes(r.error)?r.error:'FILE_DENIED');return r.result;},
    async close(){dead=true;child.stdin.end();child.kill();lines.close();if(pending){clearTimeout(pending.timer);pending.reject(Error('BROKER_CLOSED'));pending=undefined;}await ended;},
  });
}
