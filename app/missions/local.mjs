// Deliberately narrow local qualification. Owner reviews exact file bytes and
// node --test arguments. A worktree is file separation, not an OS sandbox.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {fail,fileBytes,hash,relative} from './contracts.mjs';
export function createLocalMissionTools({python='python'}={}){
  const children=new Set(),previews=new Map();let suspended=false;
  async function kill(child){if(child.exitCode!==null)return;child.stdin.end();await new Promise(resolve=>child.once('close',resolve));}
  return {
    async test({workspace,testFiles,maxMs=30000}){
      if(suspended)fail('RESTORING','Local verification is suspended',409);
      // No shell, package script, executable selection or environment injection.
      for(const f of testFiles)await fileBytes(workspace,relative(f));
      if(suspended)fail('RESTORING','Local verification is suspended',409);
      const command={executable:process.execPath,args:['--test','--test-concurrency=1','--',...testFiles],cwd:workspace,maxMs};
      return new Promise((resolve,reject)=>{
        const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE','LANG'])if(process.env[k])env[k]=process.env[k];
        const child=spawn(python,['-I','-u',fileURLToPath(new URL('./runner.py',import.meta.url))],{cwd:workspace,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});children.add(child);
        const chunks=[];let size=0,settled=false;
        const collect=b=>{const room=2*1024*1024-size;if(room>0){chunks.push(b.subarray(0,room));size+=Math.min(room,b.length);}if(b.length>room)child.stdin.end();};
        child.stdout.on('data',collect);child.stderr.on('data',collect);
        child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify(command)+'\n');
        const timer=setTimeout(()=>child.stdin.end(),maxMs+2000);timer.unref?.();
        child.once('error',e=>{clearTimeout(timer);children.delete(child);if(!settled){settled=true;reject(e);}});
        child.once('close',(code,signal)=>{clearTimeout(timer);children.delete(child);if(settled)return;settled=true;const raw=Buffer.concat(chunks).toString('utf8');let result;try{result=JSON.parse(raw);}catch{result={status:'FAILED',error:'Verifier supervisor unavailable or interrupted',log:raw,treeCleaned:false,code,signal};}const log=result.log??'';resolve({...result,status:code===0&&result.treeCleaned&&result.status==='PASSED'?'PASSED':'FAILED',logSha256:hash(Buffer.from(log)),command});});
      });
    },
    async preview({workspace,files,entry}){
      if(suspended)fail('RESTORING','Preview is suspended',409);
      const content=new Map();for(const f of files){const value=await fileBytes(workspace,f.path);if(value.sha256!==f.sha256)fail('INTEGRITY','Preview file changed',409);content.set(f.path,value.bytes);}
      if(suspended)fail('RESTORING','Preview is suspended',409);
      if(!content.has(entry)||! /\.html?$/i.test(entry))fail('PREVIEW_FORMAT','Choose a registered HTML entry');
      const token=randomUUID(),server=createServer((req,res)=>{
        const remote=req.socket.remoteAddress;if(remote!=='127.0.0.1'||req.headers.host!==`127.0.0.1:${server.address().port}`){res.writeHead(403).end();return;}
        let key;try{const url=new URL(req.url,'http://127.0.0.1');key=decodeURIComponent(url.pathname);if(!key.startsWith(`/${token}/`))throw Error();key=key.slice(token.length+2);}catch{res.writeHead(404).end();return;}
        const bytes=content.get(key);if(!bytes||!['GET','HEAD'].includes(req.method)){res.writeHead(404).end();return;}
        const type=/\.html?$/i.test(key)?'text/html; charset=utf-8':/\.js$|\.mjs$/i.test(key)?'text/javascript':/\.css$/i.test(key)?'text/css':/\.png$/i.test(key)?'image/png':'application/octet-stream';
        res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'"});res.end(req.method==='HEAD'?undefined:bytes);
      });
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      if(suspended){await new Promise(resolve=>server.close(resolve));fail('RESTORING','Preview is suspended',409);}
      const id=randomUUID(),url=`http://127.0.0.1:${server.address().port}/${token}/${entry}`;
      const timer=setTimeout(()=>{void this.stopPreview({id});},10*60*1000);timer.unref?.();previews.set(id,{server,timer});return {id,url,expiresAt:new Date(Date.now()+10*60*1000).toISOString(),scope:'Registered immutable file snapshot only; network connections and forms blocked; no server-side application runtime'};
    },
    async stopPreview({id}){const p=previews.get(id);if(!p)return;clearTimeout(p.timer);previews.delete(id);p.server.closeAllConnections();await new Promise(resolve=>p.server.close(resolve));},
    async suspend(){suspended=true;await Promise.all([...children].map(kill));await Promise.all([...previews.keys()].map(id=>this.stopPreview({id})));},
    resume(){suspended=false;},
    async close(){await this.suspend();},
  };
}
