// Actual prepared external source + production FORGE HTTP/MCP/governance.
// The remote server's data is synthetic; no GPU search/account/rental is live.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {createApplication} from '../../app/server/main.mjs';
import {vastMcpConfiguration,VAST_MCP} from '../../app/providers/vast-preset.mjs';

const directory=path.resolve(process.argv[2]??'');
assert.ok(process.argv[2],'Pass the prepared checkout folder (uv sync --locked must be complete).');
assert.equal(execFileSync('git',['-C',directory,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),VAST_MCP.revision);
assert.equal(execFileSync('git',['-C',directory,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const root=await mkdtemp(path.join(os.tmpdir(),'forge-vast-production-'));
const app=await createApplication({dataDir:path.join(root,'data'),machineSecretDir:path.join(root,'vault'),port:0});
try{
  const sessionResponse=await fetch(app.url+'/api/session'),session=await sessionResponse.json(),cookie=sessionResponse.headers.get('set-cookie').split(';')[0];
  const post=async(route,input)=>{const response=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Forge-CSRF':session.csrf},body:JSON.stringify(input)});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  const project=(await post('/api/command',{type:'project.create',operationId:crypto.randomUUID(),data:{name:'Synthetic Vast MCP engineering check',workspace:path.join(root,'workspace')}})).entity;
  const config=vastMcpConfiguration({projectId:project.id,operationId:crypto.randomUUID(),directory});
  const denied=await fetch(app.url+'/api/mcp/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)});assert.equal(denied.status,403);
  const connection=await post('/api/mcp/configure',config),scope={projectId:project.id,connectionId:connection.id};
  assert.ok(app.plugins.check({projectId:project.id,requires:[{capability:'mcp',version:'^1.0.0'}]},app.store.read()).signature);
  const discovered=await post(`/api/mcp/${connection.id}/discover`,scope);assert.equal(discovered.status,'ready',JSON.stringify(discovered));
  assert.deepEqual(discovered.capabilities.map(t=>t.name).sort(),[...VAST_MCP.tools].sort());
  for(const tool of discovered.capabilities)assert.equal(tool.annotations.readOnlyHint,true);
  await post('/api/governance/policy',{...scope,operationId:crypto.randomUUID(),expectedRevision:0,mode:'allowed'});
  const call=async(name,args={})=>{
    const input={...scope,name,arguments:args,operationId:crypto.randomUUID()};
    const event=await post(`/api/mcp/${connection.id}/call`,input);assert.equal(event.status,'completed',JSON.stringify(event));
    const replay=await post(`/api/mcp/${connection.id}/call`,input);assert.equal(replay.id,event.id);
    return event.result.structuredContent??JSON.parse(event.result.content.find(v=>v.type==='text').text);
  };
  const health=await call('health');assert.equal(health.mode,'mock');assert.equal(health.live_search,VAST_MCP.liveSearch);
  const offers=await call('search_gpu_offers',{limit:3,disk_gb:40});assert.equal(offers.source,'synthetic');assert.equal(offers.offers[0].offer_id,'mock-101');
  const estimate=await call('estimate_run_cost',{offer_id:'mock-101',disk_gb:40,hours:2,upload_to_host_gb:1,download_from_host_gb:2});assert.equal(estimate.source,'synthetic');assert.equal(estimate.estimated_total_usd,'0.588000');
  const evidence={version:1,repository:VAST_MCP.repository,revision:VAST_MCP.revision,qualification:'ACTUAL_PRODUCTION_HTTP_SDK_STDIO_WITH_EXTERNAL_SYNTHETIC_SERVER',tools:VAST_MCP.tools,health,firstOffer:offers.offers[0],estimate,unauthenticatedSetupDenied:true,exactCallReplay:true,liveAccountCalls:0,rentals:0,clientRegistrationChanges:0,homeUat:'NOT_RUN'};
  await mkdir(new URL('../../docs/evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../../docs/evidence/vast-mcp-20261125.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({result:'PASS',tools:VAST_MCP.tools,source:'synthetic',liveSearch:health.live_search,rentals:0}));
}finally{await app.close();}
