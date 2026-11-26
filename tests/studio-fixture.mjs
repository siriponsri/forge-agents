// Disposable HTTP/SQLite fixture for Studio UI verification. No provider, job,
// credential, training or research execution. Never uses the user's app port.
import {mkdtemp, rm, realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {createApplication} from '../app/server/main.mjs';

export async function studioFixture({port=0,serve=true}={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-studio-ui-'));
  const app=await createApplication({dataDir:path.join(dir,'state'),machineSecretDir:path.join(dir,'machine')});
  const session=await fetch(app.url+'/api/session'),cookie=session.headers.get('set-cookie').split(';')[0],csrf=(await session.json()).csrf;
  const post=async(route,body)=>{
    const r=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Forge-CSRF':csrf},body:JSON.stringify(body)}),data=await r.json();
    if(!r.ok)throw Object.assign(new Error(data.error.message),data.error);return data;
  };
  const project=(await post('/api/command',{type:'project.create',operationId:crypto.randomUUID(),data:{name:'Studio — ข้อมูลทดสอบชั่วคราว',workspace:path.join(dir,'workspace'),description:'Disposable engineering fixture. No real data.'}})).entity;
  const root=fileURLToPath(new URL('..',import.meta.url)),dependencies=await realpath(path.join(root,'node_modules'));
  const vite=serve?await createServer({configFile:false,root:path.join(root,'app/web'),cacheDir:path.join(dir,'vite-cache'),server:{host:'127.0.0.1',port,strictPort:!!port,fs:{allow:[root,dependencies]},proxy:{'/api':{target:app.url,changeOrigin:false}}},logLevel:'warn'}):null;
  await vite?.listen();
  return {app,dir,project,post,url:vite?.resolvedUrls.local[0]??app.url,async close(){await vite?.close();await app.close();await rm(dir,{recursive:true,force:true});}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const f=await studioFixture({port:Number(process.env.STUDIO_TEST_PORT??54329)});
  console.log(JSON.stringify({url:f.url,dir:f.dir,projectId:f.project.id}));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>f.close().then(()=>process.exit(0)));
}
