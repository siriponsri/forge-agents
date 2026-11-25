import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {createApplication} from '../app/server/main.mjs';
import {createDriveAuth} from '../app/storage/auth.mjs';
import {createArtifactService} from '../app/server/artifacts.mjs';

test('shutdown closes active SSE and incomplete HTTP sockets, then reopens durable state', {timeout:10000}, async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'forge-shutdown-'));
  let app=await createApplication({dataDir});t.after(()=>app.close());
  await app.store.transaction(s=>{s.settings.theme='monokai';});
  const stream=await fetch(app.url+'/api/events');
  const reader=stream.body.getReader();await reader.read();
  const port=Number(new URL(app.url).port);
  const socket=net.connect(port,'127.0.0.1');
  socket.on('error',()=>{});t.after(()=>socket.destroy());
  await new Promise(resolve=>socket.once('connect',resolve));
  // A preconnected browser socket with no complete request is not an SSE client.
  socket.write('GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\n');
  await Promise.all([app.close(),app.close()]);
  await reader.cancel().catch(()=>{});
  app=await createApplication({dataDir,port});
  assert.equal(app.store.read().settings.theme,'monokai');
  assert.equal((await fetch(app.url+'/api/health')).status,200);
});

test('shutdown drains an admitted real OAuth exchange before it closes services',{timeout:15000},async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'forge-shutdown-oauth-')),app=await createApplication({dataDir});t.after(()=>app.close());
  let release,entered,shutdownReturned=false,writes=0,wroteAfterShutdown=false;
  const held=new Promise(r=>{release=r;}),inside=new Promise(r=>{entered=r;});
  const auth=createDriveAuth({vault:{set:async()=>{writes++;wroteAfterShutdown=shutdownReturned;}},fetchImpl:async()=>{entered();await held;return new Response(JSON.stringify({access_token:'INJECTED_NOT_LIVE',refresh_token:'INJECTED_NOT_LIVE'}),{status:200,headers:{'Content-Type':'application/json'}});}});
  app.storage.finishDriveAuth=input=>auth.finish(input);
  const flow=await auth.begin({clientId:'injected.apps.googleusercontent.com',redirectUri:app.url+'/api/storage/drive/auth/callback'});
  const callback=fetch(app.url+'/api/storage/drive/auth/callback?'+new URLSearchParams({state:flow.state,code:'INJECTED_NO_ACCOUNT'})).catch(()=>null);await inside;
  const closing=app.close().then(()=>{shutdownReturned=true;});
  try{await new Promise(r=>setTimeout(r,60));assert.equal(shutdownReturned,false);assert.equal(writes,0);}finally{release();}
  await Promise.all([closing,callback]);assert.equal(writes,1);assert.equal(wroteAfterShutdown,false);assert.equal(shutdownReturned,true);
});

test('shutdown also drains an admitted metadata restore without waiting on its own lease',{timeout:15000},async t=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'forge-shutdown-restore-')),app=await createApplication({dataDir});t.after(()=>app.close());
  const session=await fetch(app.url+'/api/session'),{csrf}=await session.json(),cookie=session.headers.get('set-cookie').split(';')[0],backup=await createArtifactService({store:app.store,dataDir}).backup();
  let release,entered,shutdownReturned=false,recovered=false;
  const held=new Promise(r=>{release=r;}),inside=new Promise(r=>{entered=r;}),original=app.memory.afterRestore;
  app.memory.afterRestore=async()=>{entered();await held;const result=await original();recovered=true;return result;};
  const restoring=fetch(app.url+'/api/storage/restore',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Forge-CSRF':csrf},body:JSON.stringify({id:backup.id,expectedRevision:app.store.read().revision})}).catch(()=>null);await inside;
  const closing=app.close().then(()=>{shutdownReturned=true;});
  try{await new Promise(r=>setTimeout(r,60));assert.equal(shutdownReturned,false);assert.equal(recovered,false);}finally{release();}
  await Promise.all([closing,restoring]);assert.equal(recovered,true);assert.equal(shutdownReturned,true);
});
