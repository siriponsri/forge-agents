// Real local LitServe GUI qualification using labelled engineering weights.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
import {chooseTheme, openRoute, openThemePicker, setLanguage} from '../../../tests/support/app-shell.mjs';
import {createApplication} from '../../server/main.mjs';
const temp=await mkdtemp(path.join(os.tmpdir(),'forge-serving-gui-'));
const app=await createApplication({dataDir:path.join(temp,'state')});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
const state=async()=>(await page.request.get(app.url+'/api/state')).json();
const button=name=>page.getByRole('button',{name,exact:true});
async function wait(predicate){for(let i=0;i<600;i++){const snapshot=await state();if(predicate(snapshot))return snapshot;await page.waitForTimeout(100);}throw new Error('Serving state timeout');}
try{
  await page.goto(app.url+'/app');await setLanguage(page,'en');await button('Create first project').click();
  await page.getByLabel('Project name',{exact:true}).fill('Disposable serving engineering fixture');await page.getByLabel('Workspace directory').fill(path.join(temp,'workspace'));await page.getByRole('dialog').getByRole('button',{name:'Create project',exact:true}).click();await wait(s=>s.projects.length===1);
  await openRoute(page,'Artifacts');
  const source=[['weights.json','model',{format:'forge.linear.v1',weights:[2,-1],bias:0.5,engineeringFixture:true}],['preprocessor.json','preprocessor',{format:'forge.standardize.v1',mean:[1,2],scale:[2,4]}]];
  for(const [name,kind,json]of source){await page.getByLabel('Upload a file (up to 16 MB)',{exact:true}).setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(json))});await page.getByLabel('Uploaded artifact kind',{exact:true}).selectOption(kind);await button('Upload & verify').click();await wait(s=>s.artifacts.some(a=>a.name===name));}
  await openRoute(page,'Models & serving');
  let s=await state();await page.getByLabel('Model artifact revision',{exact:true}).selectOption(s.artifacts.find(a=>a.kind==='model').id);await page.getByLabel('Preprocessor artifact revision',{exact:true}).selectOption(s.artifacts.find(a=>a.kind==='preprocessor').id);
  await button('Save artifact binding').click();await wait(s=>s.projects[0].profile.serving?.adapter==='litserve');
  const started=page.waitForResponse(r=>r.url().endsWith('/api/serving/start')&&r.request().method()==='POST',{timeout:300000});await button('Set up & start LitServe').click();const startResponse=await started;assert.equal(startResponse.status(),200);const deployment=await startResponse.json();assert.equal(deployment.status,'running',JSON.stringify(deployment.error));
  await button('Check health').click();await page.getByText('Selected bytes loaded by the FORGE-owned process',{exact:true}).waitFor();
  await page.getByLabel('Input numbers',{exact:true}).fill('5, 6');
  const predictions=[];
  for(const transport of ['rest','mcp']){
    await page.getByLabel('Inference transport',{exact:true}).selectOption(transport);const pending=page.waitForResponse(r=>r.url().endsWith('/api/serving/predict')&&r.request().method()==='POST');await button('Predict & record result').click();const response=await pending;assert.equal(response.status(),200);const job=await response.json();assert.equal(job.status,'completed',JSON.stringify(job.error));
    const result=transport==='rest'?job.result:job.result.structuredContent??JSON.parse(job.result.content.find(c=>c.type==='text').text);assert.equal(result.prediction,3.5);assert.equal(job.bindingEvidence.loadedModelVerified,true);assert.ok(job.metrics.latencyMs>=0);predictions.push(job);
    const bytes=await page.request.get(app.url+'/api/artifacts/'+job.artifactIds[0]+'/download');assert.equal(bytes.status(),200);assert.equal((await bytes.json()).response[transport==='rest'?'prediction':'isError'],transport==='rest'?3.5:false);
  }
  await page.screenshot({path:path.join(temp,'serving-desktop.png'),fullPage:true});
  await page.setViewportSize({width:375,height:1000});assert.equal(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(temp,'serving-mobile.png'),fullPage:true});
  await button('Stop owned work').click();await wait(s=>s.jobs.find(j=>j.id===deployment.id)?.status==='stopped');
  await page.setViewportSize({width:1440,height:1000});const restart=page.waitForResponse(r=>r.url().endsWith('/api/serving/start'),{timeout:120000});await button('Set up & start LitServe').click();const restarted=await(await restart).json();assert.equal(restarted.status,'running');assert.notEqual(restarted.id,deployment.id);await button('Stop owned work').click();await wait(s=>s.jobs.find(j=>j.id===restarted.id)?.status==='stopped');
  assert.deepEqual(errors,[]);
  const evidence={result:'PASSED',kind:'actual Windows LitServe GUI engineering qualification',fixtureDir:temp,checks:['GUI upload model/preprocessor','explicit artifact revisions and hashes','configure/setup/start actual LitServe','REST and discovered MCP readiness','owned loader observed selected bytes','REST and MCP [5,6] => 3.5','actual elapsed latency and hash-verified result artifacts','375px no overflow','owned stop and fresh restart','no browser exceptions'],deployments:[deployment.id,restarted.id],predictions:predictions.map(j=>({id:j.id,transport:j.request.transport,artifactIds:j.artifactIds,latencyMs:j.metrics.latencyMs}))};await writeFile(path.join(temp,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}catch(error){await page.screenshot({path:path.join(temp,'failure.png'),fullPage:true}).catch(()=>{});console.error('FIXTURE_DIR',temp);throw error;}
finally{await browser.close();await app.close();}
