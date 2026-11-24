import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {compileKobApiConfig,normalizeKobEndpoint,kobApiRoute} from '../app/providers/kob-api.mjs';
import {routeById} from '../app/providers/routes.mjs';
import {openStore} from '../app/server/store.mjs';
import {command} from '../app/server/domain.mjs';
import {createProviderService} from '../app/providers/service.mjs';

// Labelled engineering fixtures: invented IDs below are never production defaults.
const input={apiKeyEnv:'FIXTURE_KOB_KEY',models:['fixture/provider-model']};

test('KOB roots, API bases and full chat endpoints normalize without duplicate versions',()=>{
  for(const value of [undefined,'https://www.kob-ai.dev','https://www.kob-ai.dev/','https://www.kob-ai.dev/api/v2/','https://www.kob-ai.dev/api/v2/chat/completions/']){
    const result=normalizeKobEndpoint(value);
    assert.equal(result.baseURL,'https://www.kob-ai.dev/api/v2');
    assert.equal(result.chatURL,'https://www.kob-ai.dev/api/v2/chat/completions');
    assert.deepEqual(result.modelsEndpoints.map(e=>[e.method,e.url]),[
      ['GET','https://www.kob-ai.dev/v1/models'],['POST','https://www.kob-ai.dev/api/models'],['GET','https://www.kob-ai.dev/api/v2/models'],
    ]);
    assert.deepEqual(normalizeKobEndpoint(result.baseURL),result);
  }
  assert.equal(normalizeKobEndpoint('https://kob-ai.dev').baseURL,'https://kob-ai.dev/api/v2');
  assert.equal(normalizeKobEndpoint('https://kob-ai.dev.evil.invalid').baseURL,'https://kob-ai.dev.evil.invalid/v1');
  assert.equal(normalizeKobEndpoint('https://fixture.invalid').chatURL,'https://fixture.invalid/v1/chat/completions');
  assert.equal(normalizeKobEndpoint('https://fixture.invalid/proxy/v1/').chatURL,'https://fixture.invalid/proxy/v1/chat/completions');
  assert.equal(normalizeKobEndpoint('https://fixture.invalid/proxy/api/v2/chat/completions').modelsEndpoints[0].url,'https://fixture.invalid/proxy/v1/models');
  assert.equal(normalizeKobEndpoint('https://fixture.invalid/proxy/chat/completions').baseURL,'https://fixture.invalid/proxy');
  assert.equal(normalizeKobEndpoint('http://127.0.0.1:49201/v1').baseURL,'http://127.0.0.1:49201/v1');
  assert.equal(normalizeKobEndpoint('http://[::1]:49201').baseURL,'http://[::1]:49201/v1');
});

test('unsafe, ambiguous or wrong-family API URLs fail without echoing input',()=>{
  const bad=[null,42,'',' https://fixture.invalid','http://fixture.invalid/v1','ftp://fixture.invalid','file:///secret',
    'https://name:fixture-secret@fixture.invalid/v1','https://@fixture.invalid/v1','https://fixture.invalid/v1?api_key=fixture-secret',
    'https://fixture.invalid/v1#fixture-secret','https://fixture.invalid/v1?','https://fixture.invalid/v1#',
    'https://fixture.invalid/v1/models','https://fixture.invalid/responses','https://fixture.invalid/api/v3',
    'https://fixture.invalid/v1/../v1','https://fixture.invalid//v1','https://fixture.invalid/%76%31',
    'https://fixture.invalid\\v1','https:fixture.invalid/v1'];
  for(const value of bad)assert.throws(()=>normalizeKobEndpoint(value),error=>{
    assert.equal(error.code,'KOB_API_URL');assert.doesNotMatch(error.message,/fixture-secret|name:|fixture.invalid/);return true;
  });
});

test('pure compiler persists only literal models, endpoint and env interpolation; invents no capabilities',()=>{
  const result=compileKobApiConfig(input),config=result.opencodeConfig,provider=config.providers.forge;
  assert.equal(config.update,'disable');
  assert.equal(provider.package,'@opencode/ai/providers/openai-compatible');
  assert.deepEqual(provider.env,['FIXTURE_KOB_KEY']);
  assert.deepEqual(provider.settings,{baseURL:'https://www.kob-ai.dev/api/v2',apiKey:'{env:FIXTURE_KOB_KEY}'});
  assert.deepEqual(provider.models,{'fixture/provider-model':{modelID:'fixture/provider-model',name:'fixture/provider-model'}});
  assert.equal(provider.body,undefined);assert.equal(provider.compatibility,undefined);
  assert.equal(provider.models['fixture/provider-model'].cost,undefined);
  const full=compileKobApiConfig({...input,baseURL:'https://fixture.invalid/v1/chat/completions'});
  assert.equal(full.opencodeConfig.providers.forge.settings.baseURL,'https://fixture.invalid/v1');
});

test('compiler rejects credential values, invalid references and fabricated/model-option configuration',()=>{
  for(const extra of [{apiKey:'fixture-secret'},{token:'fixture-secret'},{headers:{Authorization:'fixture-secret'}},{apiFamily:'responses'},{secretRef:'unimplemented-vault-format'},{options:{effort:'xhigh'}}]){
    assert.throws(()=>compileKobApiConfig({...input,...extra}),{code:'KOB_INPUT'});
  }
  for(const apiKeyEnv of [undefined,'','{env:KEY}','KEY=fixture-secret','KEY\nSECRET','123KEY','KOB KEY'])assert.throws(()=>compileKobApiConfig({...input,apiKeyEnv}),{code:'KOB_SECRET_REFERENCE'});
  for(const models of [undefined,[],[''],[' id'],['id\n'],['{env:SECRET}'],[42],['same','same'],Array.from({length:101},(_,i)=>`fixture-${i}`)])assert.throws(()=>compileKobApiConfig({...input,models}),{code:'KOB_MODELS'});
});

test('KOB descriptor executes default T3-owned OpenCode setup with isolated config and no discovery/inference',async t=>{
  const route=routeById('kob');assert.deepEqual(route,kobApiRoute);assert.equal(route.driver,'opencode');assert.equal(route.mode,'opencode-api');assert.notEqual(route.implemented,false);
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'forge-kob-config-fixture-')),store=await openStore(dataDir),calls=[];
  // Labelled provider-management fixture; no real T3/provider account requests.
  const t3={providers:{rpc:async(tag,payload)=>{calls.push({tag,payload});return {};}}};
  const api=createProviderService({dataDir,store,t3});
  t.after(async()=>{await api.close();await store.close();});
  const project=(await command(store,{operationId:randomUUID(),type:'project.create',data:{name:'KOB setup fixture',workspace:path.join(dataDir,'workspace')}})).entity;
  const connection=await api.configure({operationId:randomUUID(),projectId:project.id,routeId:'kob',...input});
  assert.equal(connection.config.setupStatus,'configured');
  assert.equal(connection.config.routeId,'kob');
  assert.equal(calls.length,1);assert.equal(calls[0].tag,'server.updateSettings');
  const instance=calls[0].payload.providerInstanceMutation.instance;
  assert.equal(instance.driver,'opencode');assert.ok(instance.environment.every(e=>e.value.startsWith(dataDir)));
  const config=JSON.parse(await readFile(path.join(dataDir,'providers',connection.providerInstanceId,'config','opencode','opencode.json'),'utf8'));
  const expected=compileKobApiConfig(input).opencodeConfig;
  // URL serialization may add a terminal slash only for an origin; KOB has a path.
  assert.deepEqual(config,expected);
  assert.doesNotMatch(JSON.stringify(store.read()),/api_key|api_token|Bearer /);
});
