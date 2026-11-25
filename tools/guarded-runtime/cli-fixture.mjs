// Actual compiled native CLI + deterministic loopback protocol. No external
// model/provider/account request, no inference quality claim, no second loop.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {randomBytes,createHmac} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {buildWindows} from './build-windows.mjs';
import {openConfinedText} from '../../app/guarded-runtime/windows-client.mjs';
import {createBoundedBroker} from '../../app/guarded-runtime/broker.mjs';
import {createProfileAuthority,digest,bytesDigest} from '../../app/guarded-runtime/profile.mjs';
import {openLocalGateway} from '../../app/guarded-runtime/local-gateway.mjs';
import {boundedToolSchemas} from '../../app/guarded-runtime/transport.mjs';
const cache=path.resolve(process.argv[2]),binary=path.join(cache,'opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe');
const buildReport=JSON.parse(await readFile(path.join(cache,'cli-build-report.json'),'utf8')),patchReport=JSON.parse(await readFile(path.join(cache,'patch-report.json'),'utf8'));
if(buildReport.exitCode!==0||buildReport.patchDigest!==digest(patchReport.changes.filter(x=>x.source==='opencode')))throw Error('REFUSE_STALE_OR_FAILED_BUILD');
const root=await mkdtemp(path.join(os.tmpdir(),'forge-guarded-cli-')),runtimeDirectory=path.join(root,'runtime'),home=path.join(root,'home'),workspace=path.join(root,'workspace');
for(const p of [runtimeDirectory,home,path.join(workspace,'allowed')])await mkdir(p,{recursive:true});
await writeFile(path.join(workspace,'allowed/a.txt'),'before');await writeFile(path.join(root,'outside.txt'),'OUTSIDE');
await writeFile(path.join(runtimeDirectory,'AGENTS.md'),'UNAPPROVED_CONTEXT_SENTINEL');await writeFile(path.join(runtimeDirectory,'opencode.json'),JSON.stringify({instructions:[path.join(root,'outside.txt')]}));
const revision=bytesDigest('before');
const scripted=[['shell',{command:`echo BAD > "${path.join(root,'shell-effect.txt')}"`}],['read',{filePath:path.join(root,'outside.txt')}],['write',{filePath:path.join(root,'outside.txt'),content:'BAD'}],['unknown_future',{path:'x'}],['execute',{code:'await tools.shell({command:"echo BAD"})'}],['task',{prompt:'nested task'}],['opencode_worktree_create',{name:'background'}],['alternate_read_text',{path:'outside.txt'}],['forge_guarded_read_text_alias',{path:'outside.txt'}],['forge_guarded_read_text',{path:'../outside.txt'}],['forge_guarded_edit_text',{path:'outside.txt',expectedRevision:revision,text:'BAD'}],['forge_guarded_read_text',{path:'allowed/a.txt'}],['forge_guarded_propose_change',{path:'allowed/a.txt',expectedRevision:revision,text:'after'}],['forge_guarded_edit_text',{path:'allowed/a.txt',expectedRevision:revision,text:'after'}]];
let modelCalls=0,requests=[],nativeSession=null,logs='',child,childDone,gateway,broker;
const model=http.createServer(async(req,res)=>{
  let text='';for await(const b of req)text+=b;const body=JSON.parse(text);requests.push(body);
  const index=modelCalls++,step=scripted[index];
  const delta=step?{role:'assistant',tool_calls:[{index:0,id:'fixture_'+index,type:'function',function:{name:step[0],arguments:JSON.stringify(step[1])}}]}:{role:'assistant',content:'fixture complete'};
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
  for(const x of [{id:'chatcmpl_fixture',object:'chat.completion.chunk',created:1,model:'forge-fixture',choices:[{index:0,delta,finish_reason:null}]},{id:'chatcmpl_fixture',object:'chat.completion.chunk',created:1,model:'forge-fixture',choices:[{index:0,delta:{},finish_reason:step?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:1,total_tokens:11}}])res.write('data: '+JSON.stringify(x)+'\n\n');res.end('data: [DONE]\n\n');
});
await new Promise(r=>model.listen(0,'127.0.0.1',r));
const provider={id:'openai',model:'forge-fixture',compatibility:{streamUsage:true},settings:{baseURL:`http://127.0.0.1:${model.address().port}/v1`,apiKey:'fixture-no-account',transport:'http'}};
const toolManifest=boundedToolSchemas.map(x=>({operation:x.name,rawName:'forge_guarded_'+x.name,serverIdentity:'private-broker',schemaDigest:digest(x.inputSchema)}));
const hash='a'.repeat(64),key=randomBytes(32),binarySha256=bytesDigest(await readFile(binary));
const profile={version:1,projectId:'project',taskId:'task',runId:'run',threadId:'thread',envelopeDigest:hash,identitySnapshot:hash,scope:{paths:['allowed'],capabilities:['read','propose','workspace.write'],maxBytes:65536},route:{providerInstanceId:'fixture',apiProviderId:'openai',providerImplementation:'opencode2-api',accountGeneration:'no-account',modelId:'openai/'+provider.model,options:[{id:'variant',value:'default'}],t3Revision:'59651c1761f6c63e9b6056839067066968e6a406',opencodeRevision:'6f0514052a3c859894ad01bb14cc14dda1e44b96',t3BinarySha256:hash,opencodeBinarySha256:binarySha256},policyGeneration:'1',toolGeneration:'1',manifestDigest:digest(toolManifest),contextDigest:digest({provider,runtimeDirectory,toolManifest}),expiresAt:Date.now()+120000};
const current={profile,runtimeMode:'approval-required',governanceAllowed:true};
const authority=createProfileAuthority({readCurrent:()=>current}),handle=authority.bind(profile);
let tail=Promise.resolve();const withFence=(_run,fn)=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;};
try{
  const build=await buildWindows(path.join(root,'build')),file=await openConfinedText({...build,root:workspace});
  broker=createBoundedBroker({authority,handle,key,file,receiptPath:path.join(root,'receipts.sqlite'),withFence,authorize:()=>true});
  gateway=await openLocalGateway({authority,handle,key,broker,withFence,nativeSessionId:()=>nativeSession});
  const password='fixture-'+randomBytes(16).toString('hex');
  const env={SystemRoot:process.env.SystemRoot,TEMP:root,TMP:root,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:home,XDG_DATA_HOME:home,XDG_CACHE_HOME:home,FORGE_GUARDED_BOOTSTRAP_FD:'3',OPENCODE_PASSWORD:password,OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_DISABLE_MODELS_FETCH:'1',OPENCODE_DISABLE_FILEWATCHER:'1',OPENCODE_DISABLE_FFF:'1'};
  child=spawn(binary,['serve','--hostname','127.0.0.1','--port','0'],{cwd:runtimeDirectory,env,windowsHide:true,stdio:['ignore','pipe','pipe','pipe']});
  childDone=new Promise(resolve=>child.once('close',resolve));
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  child.stdio[3].end(JSON.stringify({version:1,profile,key:key.toString('hex'),brokerUrl:gateway.url,provider,runtimeDirectory,toolManifest}));
  const deadline=Date.now()+20000;let url;
  while(Date.now()<deadline&&!child.exitCode){url=logs.match(/http:\/\/127\.0\.0\.1:[0-9]+/)?.[0];if(url)break;await new Promise(r=>setTimeout(r,100));}
  if(!url)throw Error('CLI_NOT_READY '+logs.slice(-5000));
  async function api(endpoint,body,headers={}){const response=await fetch(url+endpoint,{method:body===undefined?'GET':'POST',headers:{Authorization:'Basic '+Buffer.from('opencode:'+password).toString('base64'),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});const text=await response.text();if(!response.ok)throw Error(`API_${response.status} ${text}`);return text?JSON.parse(text):null;}
  let driver,driverDone;
  if(process.argv[3]==='t3'){
    const file=path.join(cache,'t3/packages/provider-opencode/forge-native-fixture.ts');await copyFile(fileURLToPath(new URL('./t3-native-fixture.ts',import.meta.url)),file);
    driver=spawn(path.join(cache,'node/node.exe'),[file],{cwd:runtimeDirectory,env,windowsHide:true,stdio:['pipe','pipe','pipe','pipe']});
    driverDone=new Promise(resolve=>driver.once('close',resolve));
    const driverTimeout=setTimeout(()=>driver.kill(),60000);driver.once('close',()=>clearTimeout(driverTimeout));
    driver.stderr.on('data',b=>{logs+='T3: '+b});
    driver.stdio[3].end(JSON.stringify({url,password,cwd:runtimeDirectory,profile,nativeEntry:path.join(cache,'t3/apps/server/dist/forge-guarded-host.mjs'),hostBridgePath:fileURLToPath(new URL('../../app/guarded-runtime/t3-host.mjs',import.meta.url))}));
    const lines=createInterface({input:driver.stdout});
    lines.on('line',line=>{try{const event=JSON.parse(line);if(event.kind==='native-session'){nativeSession=event.native??event.thread.nativeThreadRef?.nativeId;driver.stdin.end('mapped\n');}else if(event.kind==='t3-done')logs+='T3_LIFECYCLE_PASS '+JSON.stringify(event.phases)+'\n';else {logs+=line+'\n';if(event.kind==='phase')console.log('T3_PHASE',event.phase);}}catch{logs+=line+'\n';}});
  }else{
    const created=await api('/api/session',{location:{directory:runtimeDirectory},model:{providerID:'openai',id:provider.model},permissions:[{action:'*',resource:'*',effect:'allow'}]});nativeSession=created.data.id;
    await api(`/api/session/${nativeSession}/prompt`,{text:'Run the deterministic engineering protocol fixture.'});
  }
  const end=Date.now()+15000;while(Date.now()<end&&modelCalls<scripted.length+1){await new Promise(r=>setTimeout(r,200));}
  if(driver){const exit=await driverDone;assert.equal(exit,0,logs.slice(-8000));}
  const state=await api(`/api/session/${nativeSession}`);
  const messages=await api(`/api/session/${nativeSession}/message`);
  console.log(JSON.stringify({modelCalls,outcome:state.data.outcome,tools:messages.data.flatMap(x=>x.content??[]).filter(x=>x.type==='tool').map(x=>({name:x.name,status:x.state.status,error:x.state.error?.message})),advertisedTools:requests[0]?.tools?.map(t=>t.function?.name),logs:logs.slice(-1000)}));
  assert.equal(modelCalls,scripted.length+1);assert.equal(JSON.stringify(requests).includes('UNAPPROVED_CONTEXT_SENTINEL'),false);assert.equal(JSON.stringify(requests).includes('OUTSIDE'),false);
  assert.equal(JSON.stringify(requests).includes('guarded-file-broker'),false); // private owner receipt is not model context
  assert.equal(await readFile(path.join(root,'outside.txt'),'utf8'),'OUTSIDE');assert.equal(await readFile(path.join(workspace,'allowed/a.txt'),'utf8'),'after');
  await assert.rejects(readFile(path.join(root,'shell-effect.txt')),{code:'ENOENT'});
  const original=structuredClone(profile),negative=[];
  for(const [name,mutate] of [
    ['account',p=>{p.route.accountGeneration='swapped'}],['provider',p=>{p.route.providerInstanceId='other'}],['model',p=>{p.route.modelId='other'}],['options',p=>{p.route.options={variant:'other'}}],['binary',p=>{p.route.opencodeBinarySha256='b'.repeat(64)}],['policy',p=>{p.policyGeneration='other'}],['manifest',p=>{p.manifestDigest='b'.repeat(64)}],['context',p=>{p.contextDigest='b'.repeat(64)}],['expired',p=>{p.expiresAt=Date.now()-1}],
  ]){
    const altered=structuredClone(original);mutate(altered);current.profile=altered;
    await assert.rejects(api(`/api/session/${nativeSession}/prompt`,{text:'must be denied'}));negative.push(name);current.profile=profile;
  }
  for(const flag of ['stopped','revoked']){current[flag]=true;await assert.rejects(api(`/api/session/${nativeSession}/prompt`,{text:'must be denied'}));negative.push(flag);current[flag]=false;}
  await assert.rejects(api(`/api/session/${nativeSession}/prompt`,{text:'unapproved file input',files:[{uri:'file:///'+path.join(root,'outside.txt').replaceAll('\\','/')}]}));negative.push('file-context');
  const childSession=await api('/api/session',{location:{directory:runtimeDirectory},model:{providerID:'openai',id:provider.model}});
  await assert.rejects(api(`/api/session/${childSession.data.id}/prompt`,{text:'foreign session'}));negative.push('foreign-session');
  assert.equal(modelCalls,scripted.length+1);
  const probeBody={nonce:randomBytes(32).toString('hex'),sessionID:nativeSession};
  const probe=await api('/api/forge/attest',probeBody,{'X-Forge-Probe':createHmac('sha256',key).update(canonicalProbe(probeBody)).digest('hex')});
  assert.equal(probe.result.effects,0);assert.equal(probe.result.negativeCount,17);assert.equal(probe.result.binarySha256,binarySha256);
  const report={version:1,scope:'actual compiled native engineering protocol only; no external provider/account/model quality or product activation',actualCompiledCli:'PASS',binarySha256,requests:modelCalls,negative,advertisedTools:requests[0]?.tools?.map(t=>t.function?.name).sort(),nativeGateNegatives:probe.result.negativeCount,untrustedExecutorEffects:probe.result.effects,proof:null};
  await writeFile(path.join(cache,'cli-fixture-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
  if(child){child.kill();await childDone;}
  if(gateway)await gateway.close();if(broker)await broker.close();model.closeAllConnections();await new Promise(r=>model.close(r));
  await writeFile(path.join(cache,'cli-fixture-last-log.txt'),logs);key.fill(0);await rm(root,{recursive:true,force:true});
}
function canonicalProbe(x){return JSON.stringify(x,Object.keys(x).sort());}
