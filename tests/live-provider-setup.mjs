// Actual pinned isolated T3 runtime setup RPC. No model turn or account login.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {createApplication} from '../app/server/main.mjs';
import {command} from '../app/server/domain.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'forge-t3-setup-live-')),app=await createApplication({dataDir:path.join(dir,'state')});
let closed=false;
try{
  const config=await app.t3.providers.rpc('server.getConfig',{});assert.ok(config&&typeof config==='object');
  const project=(await command(app.store,{type:'project.create',operationId:crypto.randomUUID(),data:{name:'Disposable setup qualification',workspace:path.join(dir,'workspace')}})).entity;
  const actual=await app.t3.providers.ensureProject(project.id);assert.ok(actual.id);
  const configured=await app.providers.configure({projectId:project.id,operationId:crypto.randomUUID(),routeId:'codex-local',name:'Fresh setup contract qualification'});
  assert.equal(configured.config.setupStatus,'configured',JSON.stringify(configured.setupError));
  const check=await app.providers.check({projectId:project.id,connectionId:configured.id});
  const native=await app.t3.providers.catalog({providerInstanceId:configured.providerInstanceId,cwd:project.workspace});
  assert.equal(native.providerInstanceId,configured.providerInstanceId);assert.ok(Array.isArray(native.models));assert.equal(typeof native.catalogComplete,'boolean');assert.equal(typeof native.fetchedAt,'number');
  await app.close();closed=true;
  const sessions=JSON.parse(execFileSync(process.execPath,['app/vendor/t3/bin/t3.mjs','auth','session','list','--base-dir',path.join(dir,'state','t3'),'--json'],{encoding:'utf8',windowsHide:true}));
  assert.equal(sessions.length,0);
  const evidence={result:'PASSED',fixtureDir:dir,source:'T3 0.1.11 / 59651c1761f6c63e9b6056839067066968e6a406',checks:['actual providers:manage/orchestration:read ticket + Effect RPC','actual project registration','actual isolated Codex provider instance configuration','actual native refresh/readiness','actual full native model-catalog contract (unauthenticated fixture, no completeness claim)','all issued auth sessions revoked'],readiness:check.status,nativeCatalog:{modelCount:native.models.length,catalogComplete:native.catalogComplete,reasons:native.completenessReasons,checkedAt:native.checkedAt,source:native.source},providerTurns:0,accountLogin:'NOT_RUN',homeUat:'HOME_UAT_NOT_RUN'};
  await writeFile(path.join(dir,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{if(!closed)await app.close();}
