// Production mounts + actual SDK stdio effect. No model, login or cloud calls.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {chooseTheme, openRoute, openThemePicker, setLanguage} from '../../../tests/support/app-shell.mjs';
import {createApplication} from '../../server/main.mjs';
const temp=await mkdtemp(path.join(os.tmpdir(),'forge-controls-integrated-')),app=await createApplication({dataDir:path.join(temp,'state')});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
const button=name=>page.getByRole('button',{name,exact:true}),state=()=>app.store.read();
async function wait(predicate){for(let n=0;n<120;n++){const s=state();if(predicate(s))return s;await page.waitForTimeout(100);}throw Error('Integrated control state timeout');}
async function post(route,data,status=200){const r=await page.request.post(app.url+route,{data});const v=await r.json();assert.equal(r.status(),status,JSON.stringify(v));return v;}
const cmd=(type,projectId,data)=>post('/api/command',{type,projectId,data,operationId:crypto.randomUUID()});
try{
  const project=(await cmd('project.create',undefined,{name:'Disposable integrated controls',workspace:path.join(temp,'workspace')})).entity;
  const sdk=p=>pathToFileURL(path.resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/'+p)).href,ledger=path.join(temp,'effects.jsonl'),executable=path.join(temp,'mcp.mjs');
  await writeFile(executable,`import {appendFile} from 'node:fs/promises';import {Server} from ${JSON.stringify(sdk('server/index.js'))};import {StdioServerTransport} from ${JSON.stringify(sdk('server/stdio.js'))};import {ListToolsRequestSchema,CallToolRequestSchema} from ${JSON.stringify(sdk('types.js'))};const server=new Server({name:'actual-SDK-engineering-fixture',version:'1'},{capabilities:{tools:{}}});server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'record',description:'Disposable local effect',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}]}));server.setRequestHandler(CallToolRequestSchema,async request=>{await appendFile(${JSON.stringify(ledger)},JSON.stringify(request.params)+'\\n');return {content:[{type:'text',text:'Recorded'}]};});await server.connect(new StdioServerTransport());`);
  const connection=await post('/api/mcp/configure',{projectId:project.id,operationId:crypto.randomUUID(),name:'Actual SDK fixture',route:'stdio',command:process.execPath,args:[executable]});
  // A payload claiming to be human cannot create an approval without browser session/CSRF.
  await post('/api/governance/policy',{projectId:project.id,connectionId:connection.id,operationId:crypto.randomUUID(),expectedRevision:0,mode:'allowed',tools:{},actor:{kind:'human',id:'forged'}},403);
  assert.equal(state().events.filter(e=>e.type==='governance.policy').length,0);
  await page.goto(app.url+'/app');await setLanguage(page,'en');
  await openRoute(page,'Settings');await button('Providers & models').click();await page.getByRole('heading',{name:'Project accounts & models',exact:true}).waitFor();
  await button('MCP tools').click();await button('Discover actual tools').click();await wait(s=>s.connections.find(c=>c.id===connection.id).lastCheck?.status==='ready');
  await page.getByLabel('Connection policy ceiling',{exact:true}).selectOption('ask');await button('Save policy for this connection').click();await wait(s=>s.events.some(e=>e.type==='governance.policy'&&e.mode==='ask'));
  await page.getByLabel('Discovered tool',{exact:true}).selectOption('record');await page.getByLabel('value *',{exact:true}).fill('ไทย / exact approved operation');await button('Run this exact operation').click();
  const s=await wait(s=>s.events.some(e=>e.type==='mcp.call'&&e.status==='completed')),call=s.events.find(e=>e.type==='mcp.call');
  assert.equal(s.events.filter(e=>e.type==='governance.tool-approval'&&e.status==='consumed').length,1);
  await post('/api/mcp/call',{projectId:project.id,connectionId:connection.id,operationId:call.operationId,name:'record',arguments:{value:'ไทย / exact approved operation'}});
  assert.equal((await readFile(ledger,'utf8')).trim().split('\n').length,1);
  await button('Plugins').click();await page.getByRole('article',{name:'Models',exact:true}).waitFor();
  await openRoute(page,'Strategies & skills');await page.getByRole('heading',{level:1}).waitFor();
  await page.getByRole('button',{name:'Skills & verification loop',exact:true}).click();await page.getByRole('heading',{level:1}).waitFor();
  for(const width of [320,375,768]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),true);}
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(temp,'controls-mobile.png'),fullPage:true});
  const evidence={result:'PASSED',fixtureDir:temp,checks:['actual production Settings provider/MCP/Plugin Manager mounts','actual production Assistance/Adaptive mounts','server-created session/CSRF rejects forged human payload','actual SDK stdio tool discovery and filesystem effect','Ask exact GUI request/decision/call with one consumed authorization','same operation replay returns durable result without a second effect','320/375/768 no overflow','no browser exceptions'],liveProvider:'NOT_RUN',homeUat:'HOME_UAT_NOT_RUN'};await writeFile(path.join(temp,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}catch(e){await page.screenshot({path:path.join(temp,'failure.png'),fullPage:true}).catch(()=>{});console.error('FIXTURE_DIR',temp);throw e;}
finally{await browser.close();await app.close();}
