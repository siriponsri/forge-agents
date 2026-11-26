import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../app/server/main.mjs';
import {browserOwner} from './support/browser-owner.mjs';

test('all browser command families reject absent, forged and mismatched sessions before effects', async t => {
  const app=await createApplication({dataDir:await mkdtemp(path.join(os.tmpdir(),'forge-http-owner-'))});
  t.after(()=>app.close());
  const owner=await browserOwner(app.url), other=await browserOwner(app.url);
  const post=(route,body={},headers={})=>fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const before=app.store.read();
  const routes=['/api/command','/api/jobs/start','/api/jobs/x/stop','/api/notebooks/import',
    '/api/serving/configure','/api/serving/start','/api/serving/predict','/api/serving/jobs/x/stop',
    '/api/desktop/setup','/api/desktop/action','/api/desktop/stop','/api/artifacts/upload',
    '/api/artifacts/register','/api/storage/backup','/api/storage/restore','/api/storage/sync',
    '/api/reports/generate','/api/reports/extract-document','/api/conversations/send',
    '/api/runs/start','/api/runs/x/approval','/api/t3/start','/api/office/agent/ack',
    '/api/connections/x/check','/api/providers/check','/api/system/stop'];
  for(const route of routes) for(const headers of [{},{Cookie:owner.Cookie},{'X-Forge-CSRF':owner['X-Forge-CSRF']},
    {...owner,'X-Forge-CSRF':other['X-Forge-CSRF']},{...owner,Origin:'https://attacker.invalid'}]) {
    const response=await post(route,{},headers);
    assert.equal(response.status,403,route);
  }
  assert.deepEqual(app.store.read(),before,'rejected commands have no canonical effects');
  const input={operationId:crypto.randomUUID(),type:'project.create',data:{name:'Owner HTTP fixture',workspace:path.join(app.store.read().settings?.dataDir??os.tmpdir(),'forge-owner-'+crypto.randomUUID())}};
  const created=await post('/api/command',input,owner);
  assert.equal(created.status,200,JSON.stringify(await created.clone().json()));
  const result=await created.json();
  assert.ok(result.entity.id);
  assert.equal((await post('/api/command',input,owner)).status,200,'exact operation replay remains available');
  // A signed relay or run-scoped MCP credential is not replaced by browser auth.
  const relay=await post('/api/relay/bridge',{},owner);
  assert.notEqual(relay.status,200,'browser session does not mint relay authority');
});
