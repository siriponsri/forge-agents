import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {createApplication} from '../app/server/main.mjs';

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
  await app.close();
  await reader.cancel().catch(()=>{});
  app=await createApplication({dataDir,port});
  assert.equal(app.store.read().settings.theme,'monokai');
  assert.equal((await fetch(app.url+'/api/health')).status,200);
});
