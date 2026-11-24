import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { openStore } from './store.mjs';
import { command, find, fail } from './domain.mjs';
import { createJobService } from './jobs.mjs';
import { createT3Service } from './t3.mjs';
import { createConnectionService, integrationCatalog } from './connections.mjs';
import { createArtifactService } from './artifacts.mjs';
import { createControlService } from './control.mjs';
import { protocolEvents } from './agui.mjs';
import { createCatalogService } from './catalog.mjs';
import { createGitStorageService } from './git-storage.mjs';
import {defaultDataDir} from './paths.mjs';
import {createDownloadService} from './downloads.mjs';
export {defaultDataDir};
const root=fileURLToPath(new URL('../../',import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
async function body(req){let size=0;const parts=[];for await(const b of req){size+=b.length;if(size>24*1024*1024)fail('SIZE','Request exceeds 24 MB',413);parts.push(b);}try{return JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{fail('JSON','Invalid JSON request');}}
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
export async function createApplication({dataDir=defaultDataDir(),port=0}={}){
  await mkdir(dataDir,{recursive:true});const store=await openStore(dataDir);
  const jobs=createJobService({store,dataDir}),t3=createT3Service({store,dataDir}),connections=createConnectionService({store});
  const artifacts=createArtifactService({store,dataDir}),control=createControlService({store,connections});
  const catalog=createCatalogService({load:()=>t3.catalog()});
  const gitStorage=createGitStorageService({store});
  const downloads=createDownloadService({sourceRoot:root,dataDir});
  await jobs.recover();
  let reports;try{const mod=await import('../reports/service.mjs');reports=await mod.createReportService({store,dataDir});}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
  let commit='unknown';try{commit=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();}catch{try{commit=JSON.parse(await readFile(path.join(root,'release-info.json'),'utf8')).commit.slice(0,7);}catch{}}
  const clients=new Set();let closed=false;
  const app={store,t3,jobs,connections,reports,server:null,url:null,async close(){
    if(closed)return;closed=true;
    // Stop accepting reconnects before closing SSE; browser retries must not keep
    // an application shutdown alive. Close only this server's HTTP connections.
    const stopped=new Promise(resolve=>app.server.close(resolve));
    for(const client of clients)client.end();
    app.server.closeAllConnections();
    await jobs.shutdown();await t3.shutdown();await connections.close();await reports?.shutdown?.();
    await stopped;await store.close();
  }};
  const server=http.createServer(async(req,res)=>{
    try{
      const host=req.headers.host??'';if(!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host))fail('HOST','Loopback Host required',403);
      if(req.headers.origin && req.headers.origin!==`http://${host}`)fail('ORIGIN','Cross-origin requests are blocked',403);
      const url=new URL(req.url,`http://${host}`),p=url.pathname,method=req.method;
      if(method==='OPTIONS')return json(res,{error:{code:'ORIGIN',message:'CORS is disabled'}},403);
      if(method==='GET'&&p==='/api/health')return json(res,{status:'ready',product:'FORGE',version:manifest.version,commit,dataPath:dataDir,t3:t3.health(),reports:reports?await reports.health():{status:'implementation_pending'},implementation:'IMPLEMENTATION_INCOMPLETE'});
      if(method==='GET'&&p==='/api/state')return json(res,store.read());
      if(method==='GET'&&p==='/api/integrations')return json(res,integrationCatalog);
      if(method==='GET'&&p==='/api/downloads')return json(res,await downloads.metadata());
      if(method==='GET'&&p.startsWith('/downloads/')){const file=await downloads.file(p.slice('/downloads/'.length));res.writeHead(200,{'Content-Type':file.contentType,'Content-Disposition':`attachment; filename="${file.filename}"`,'X-Content-Type-Options':'nosniff'});createReadStream(file.path).pipe(res);return;}
      if(method==='GET'&&p==='/api/events'){
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});clients.add(res);
        const send=()=>res.write(`data: ${JSON.stringify({type:'state.changed',revision:store.read().revision})}\n\n`);send();const off=store.subscribe(send),timer=setInterval(()=>res.write(': heartbeat\n\n'),15000);
        req.on('close',()=>{clients.delete(res);off();clearInterval(timer);});return;
      }
      if(method==='GET'&&/^\/api\/runs\/[^/]+\/events$/.test(p)){const id=p.split('/')[3];find(store.read(),'runs',id);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});for(const event of protocolEvents(store.read(),id))res.write(`data: ${JSON.stringify(event)}\n\n`);return res.end();}
      if(method==='GET'&&p==='/api/t3/status')return json(res,t3.health());
      if(method==='GET'&&p==='/api/t3/catalog')return json(res,catalog.read());
      if(method==='GET'&&p==='/api/reports/health')return json(res,reports?await reports.health():{status:'implementation_pending'});
      if(method==='GET'&&/^\/api\/reports\/jobs\/[^/]+$/.test(p))return json(res,await reports.getJob(p.split('/')[4]));
      if(method==='GET'&&/^\/api\/jobs\/[^/]+$/.test(p))return json(res,find(store.read(),'jobs',p.split('/')[3]));
      if(method==='GET'&&/^\/api\/artifacts\/[^/]+\/download$/.test(p)){
        const id=p.split('/')[3];const artifact=find(store.read(),'artifacts',id);
        const ownedReport=artifact.jobId&&store.read().jobs.some(j=>j.id===artifact.jobId&&j.owner==='reports');
        const file=ownedReport&&reports?await reports.download(id):await artifacts.download(id);
        res.writeHead(200,{'Content-Type':file.contentType,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'X-Content-Type-Options':'nosniff'});createReadStream(file.path).pipe(res);return;
      }
      if(method==='POST'){
        if(!req.headers['content-type']?.startsWith('application/json'))fail('CONTENT_TYPE','Use application/json',415);const input=await body(req);let value;
        if(p==='/api/command')value=await command(store,input);
        else if(p==='/api/jobs/start')value=await jobs.start(input);
        else if(p==='/api/notebooks/import')value=await jobs.importNotebook(input);
        else if(/^\/api\/jobs\/[^/]+\/stop$/.test(p))value=await jobs.stop(p.split('/')[3]);
        else if(p==='/api/t3/start')value=await t3.start();
        else if(p==='/api/t3/catalog')value=await catalog.refresh();
        else if(p==='/api/runs/start')value=await t3.startRun(input);
        else if(/^\/api\/runs\/[^/]+\/reconcile$/.test(p))value=await t3.reconcile(p.split('/')[3]);
        else if(/^\/api\/runs\/[^/]+\/stop$/.test(p))value=await t3.stop(p.split('/')[3]);
        else if(/^\/api\/connections\/[^/]+\/check$/.test(p))value=await connections.check(p.split('/')[3]);
        else if(/^\/api\/mcp\/[^/]+\/discover$/.test(p))value=await connections.discover(p.split('/')[3]);
        else if(/^\/api\/mcp\/[^/]+\/call$/.test(p))value=await connections.call(p.split('/')[3],input);
        else if(p==='/api/artifacts/register')value=await artifacts.register(input);
        else if(p==='/api/storage/backup')value=await artifacts.backup();
        else if(p==='/api/storage/restore')value=await artifacts.restore(input);
        else if(p==='/api/storage/git')value=await gitStorage.run(input);
        else if(p==='/api/desktop/acquire')value=await control.acquire(input);
        else if(p==='/api/desktop/action')value=await control.action(input);
        else if(p==='/api/desktop/stop')value=await control.stop(input);
        else if(p==='/api/skills/select')value=await control.select(input);
        else if(p==='/api/reports/configure'&&reports)value=await reports.configure(input);
        else if(p==='/api/reports/generate'&&reports)value=await reports.generate(input);
        else if(p==='/api/reports/pdf-operation'&&reports)value=await reports.pdfOperation(input);
        else if(/^\/api\/reports\/jobs\/[^/]+\/stop$/.test(p)&&reports)value=await reports.stop(p.split('/')[4]);
        else if(p==='/api/system/stop'){json(res,{status:'stopping'});setTimeout(()=>app.close().then(()=>{if(process.argv[1]===fileURLToPath(import.meta.url))process.exit(0);}),100);return;}
        else fail('NOT_FOUND','API operation not found',404);
        return json(res,value??{status:'ok'});
      }
      if(p.startsWith('/api/'))fail('NOT_FOUND','API route not found',404);
      const dir=path.join(root,'app','web','dist'),requested=path.resolve(dir,`.${decodeURIComponent(p)}`),relative=path.relative(dir,requested);
      if(relative.startsWith('..')||path.isAbsolute(relative))fail('PATH','Invalid asset path',403);
      let file=['/welcome','/welcome/'].includes(p)?path.join(dir,'welcome.html'):requested;try{if(!(await stat(file)).isFile())file=path.join(dir,'index.html');}catch{file=path.join(dir,'index.html');}
      const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(bytes);
    }catch(e){if(res.headersSent){res.end();return;}json(res,{error:{code:e.code??'INTERNAL',message:e.message,details:e.details}},e.statusCode??(e.code==='ENOENT'?404:500));}
  });
  app.server=server;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});app.url=`http://127.0.0.1:${server.address().port}`;return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const app=await createApplication({port:Number(process.env.FORGE_PORT??4317)});console.log(`FORGE_READY ${app.url}`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
