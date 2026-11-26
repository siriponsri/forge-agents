import {browserOwner} from '../../../tests/support/browser-owner.mjs';
// Actual mounted FORGE GUI + SDK HTTP queue + native drawings + local bundle.
// Run identity is an injected engineering fixture; no LLM/provider is invoked.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
import {chooseTheme, openRoute, openThemePicker, setLanguage, switchProject} from '../../../tests/support/app-shell.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApplication} from '../../server/main.mjs';
const temp=await mkdtemp(path.join(os.tmpdir(),'forge-office-queue-gui-')),dataDir=path.join(temp,'state');
let app=await createApplication({dataDir}),browser,client,page;
const errors=[],checks=[];
async function post(route,input){const r=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',...await browserOwner(app.url)},body:JSON.stringify(input)}),v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v;}
const cmd=(type,projectId,data,record)=>post('/api/command',{type,projectId,data,operationId:crypto.randomUUID(),...(record?{id:record.id,expectedRevision:record.revision}:{})});
const state=async()=>(await fetch(app.url+'/api/state')).json();
async function wait(predicate){for(let n=0;n<120;n++){const s=await state();if(predicate(s))return s;await new Promise(r=>setTimeout(r,100));}throw Error('Office queue state timeout');}
const button=name=>page.getByRole('button',{name,exact:true});
try{
  const project=(await cmd('project.create',undefined,{name:'Disposable Office queue fixture',workspace:path.join(temp,'workspace')})).entity;
  const bot=(await cmd('bot.create',project.id,{name:'Engineering fixture agent'})).entity;
  const task=(await cmd('task.create',project.id,{title:'Bounded native edit qualification',botId:bot.id})).entity;
  const run={id:crypto.randomUUID(),attemptId:crypto.randomUUID(),projectId:project.id,botId:bot.id,taskId:task.id,status:'running',fixture:true};
  await app.store.transaction(s=>s.runs.push(run));
  await cmd('settings.update',undefined,{language:'en',activeProjectId:project.id});
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1500,height:1050}});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.url+'/app');await setLanguage(page,'en');await openRoute(page,'Docs & sheets');
  client=new Client({name:'forge-office-gui-engineering-fixture',version:'1.0.0'});
  const secret=await readFile(path.join(dataDir,'.office-agent-private','mcp-bearer.secret'),'utf8');
  await client.connect(new StreamableHTTPClientTransport(new URL(app.url+'/mcp/office'),{requestInit:{headers:{Authorization:'Bearer '+secret.trim()}}}));
  const records=[];
  for(const kind of ['sheet','doc']){
    await button('+ Create document').click();await page.getByLabel('Document name',{exact:true}).fill('Fixture '+kind);await page.getByLabel('Kind',{exact:true}).selectOption(kind);await button('Create & open').click();
    await page.locator('.univer-container canvas').first().waitFor();
    let s=await wait(s=>s.documents.some(d=>d.name==='Fixture '+kind)),record=s.documents.find(d=>d.name==='Fixture '+kind);
    const scope={projectId:project.id,documentId:record.id,botId:bot.id,taskId:task.id,runId:run.id,attemptId:run.attemptId},operationId=crypto.randomUUID();
    const args={...scope,operationId,expectedRevision:record.revision,...(kind==='sheet'?{sheetId:'sheet1',range:'A1:B1',text:'ไทย\t=1+2'}:{index:0,text:'ไทย / queued edit'})};
    const response=await client.callTool({name:kind==='sheet'?'office.sheet.setValues':'office.doc.insertText',arguments:args});assert.equal(response.isError,undefined);
    const queue=page.getByRole('region',{name:'Agent edit requests',exact:true});
    await queue.getByRole('button',{name:'Review request',exact:true}).click();await queue.getByRole('button',{name:'Apply request & save',exact:true}).click();
    s=await wait(s=>s.officeAgent.requests.find(r=>r.operationId===operationId)?.status==='completed');record=s.documents.find(d=>d.id===record.id);
    assert.equal(record.revision,2);assert.equal(s.receipts.filter(r=>r.operationId===operationId).length,1);
    if(kind==='sheet'){assert.equal(record.snapshot.sheets.sheet1.cellData[0][0].v,'ไทย');assert.equal(record.snapshot.sheets.sheet1.cellData[0][1].f,'=1+2');}
    else assert.equal(record.snapshot.body.dataStream,'ไทย / queued edit\r\n');
    await page.locator('.editor-toolbar').getByRole('button',{name:'Undo',exact:true}).click();await button('Save').click();
    s=await wait(s=>s.documents.find(d=>d.id===record.id).revision===3);
    if(kind==='sheet')assert.ok(!s.documents.find(d=>d.id===record.id).snapshot.sheets.sheet1.cellData[0]?.[0]?.v);
    else assert.equal(s.documents.find(d=>d.id===record.id).snapshot.body.dataStream,'\r\n');
    await page.locator('.editor-toolbar').getByRole('button',{name:'Redo',exact:true}).click();await button('Save').click();await wait(s=>s.documents.find(d=>d.id===record.id).revision===4);
    checks.push(kind+' actual MCP queue -> GUI review/apply -> durable receipt -> native undo/redo');
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=','base64');
    await page.locator('.editor-toolbar input[type=file]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:png});
    await button('Save').click();s=await wait(s=>s.documents.find(d=>d.id===record.id).revision===5);record=s.documents.find(d=>d.id===record.id);
    assert.ok(record.snapshot.resources.some(r=>r.name==='FORGE_IMAGE_ASSETS_V1'));records.push({id:record.id,kind,operationId});
    await page.screenshot({path:path.join(temp,kind+'.png'),fullPage:true});
  }
  await client.close();client=null;
  const current=(await state()).projects.find(p=>p.id===project.id);
  await post('/api/storage/configure',{projectId:project.id,operationId:crypto.randomUUID(),expectedRevision:current.revision,destinations:[{id:'archive',kind:'local',name:'Fixture archive',directory:path.join(temp,'archive')}],routes:[{kinds:['*'],destinationIds:['archive']}],retention:{keepLast:2}});
  const backup=await post('/api/storage/bundles/backup',{projectId:project.id,destinationId:'archive',operationId:crypto.randomUUID()});assert.equal(backup.status,'completed',JSON.stringify(backup.error));
  const revised=(await state()).projects.find(p=>p.id===project.id);
  const restore=await post('/api/storage/bundles/restore',{projectId:project.id,destinationId:'archive',operationId:crypto.randomUUID(),bundleId:backup.bundleId,manifestSha256:backup.manifestSha256,targetDirectory:path.join(temp,'restored'),expectedRevision:revised.revision});assert.equal(restore.status,'completed',JSON.stringify(restore.error));
  let s=await state();const restored=s.documents.filter(d=>d.projectId===restore.restoredProjectId);assert.equal(restored.length,2);
  for(const doc of restored){const manifest=JSON.parse(doc.snapshot.resources.find(r=>r.name==='FORGE_IMAGE_ASSETS_V1').data);for(const a of manifest.assets){assert.equal(a.projectId,restore.restoredProjectId);assert.equal(a.source,'/api/artifacts/'+a.artifactId+'/download');assert.ok(s.artifacts.some(x=>x.id===a.artifactId&&x.projectId===restore.restoredProjectId));}}
  checks.push('full local bundle remaps image manifest IDs/project IDs and native source URLs');
  const port=app.server.address().port;await app.close();app=await createApplication({dataDir,port});
  await page.reload();await openRoute(page,'Docs & sheets');
  for(const item of records){const doc=(await state()).documents.find(d=>d.id===item.id);assert.equal(doc.revision,5);assert.equal((await state()).officeAgent.requests.find(r=>r.operationId===item.operationId).status,'completed');}
  // Reopen restored snapshots in the actual native editor: malformed manifests fail here.
  await switchProject(page,(await state()).projects.find(p=>p.id===restore.restoredProjectId).name);
  for(const doc of restored){await page.getByRole('button',{name:new RegExp('^'+doc.name)}).click();await page.locator('.univer-container canvas').first().waitFor();await page.waitForTimeout(500);assert.equal(await page.getByRole('alert').count(),0);}
  checks.push('service close/reopen retains completion and both restored native image snapshots reopen');
  assert.deepEqual(errors,[]);const evidence={result:'PASSED',fixtureDir:temp,checks,provider:'NOT_RUN; injected run identity',homeUat:'HOME_UAT_NOT_RUN',restoredProjectId:restore.restoredProjectId};await writeFile(path.join(temp,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}catch(e){await page?.screenshot({path:path.join(temp,'failure.png'),fullPage:true}).catch(()=>{});console.error('FIXTURE_DIR',temp);throw e;}
finally{await client?.close().catch(()=>{});await browser?.close();await app.close();}
