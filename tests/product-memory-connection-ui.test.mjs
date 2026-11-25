import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApplication} from '../app/server/main.mjs';
import {entity} from '../app/server/domain.mjs';
import {createNativeUsageBridge} from '../app/budgets/native-usage.mjs';
import {createProtocolController} from '../app/protocol/controller.mjs';

test('built Memory UI issues scoped access, copies only on request and revokes real SDK access',{timeout:45000},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-memory-connection-ui-')),app=await createApplication({dataDir:dir});t.after(()=>app.close());
  const selection={instanceId:'FIXTURE_NO_PROVIDER',model:'no-inference',options:[],connectionId:crypto.randomUUID(),connectionGeneration:1};
  const p=entity({name:'Memory connection fixture',workspace:path.join(dir,'workspace'),profile:{provider:selection}}),bot=entity({name:'Fixture bot'},p.id),task=entity({title:'Scoped memory fixture',botId:bot.id},p.id);
  const run=entity({attemptId:crypto.randomUUID(),operationId:crypto.randomUUID(),status:'running',taskId:task.id,botId:bot.id,threadId:crypto.randomUUID(),providerRunId:crypto.randomUUID(),t3ProjectId:crypto.randomUUID(),providerInstanceId:selection.instanceId,selection},p.id);
  await app.store.transaction(s=>{s.projects.push(p);s.bots.push(bot);s.tasks.push(task);s.runs.push(run);s.connections.push({...entity({kind:'provider',providerInstanceId:selection.instanceId,enabled:true,config:{generation:1,routeId:'fixture-no-provider-call'}},p.id),id:selection.connectionId});});
  // Pinned native counter sample, explicitly injected; no provider/model call.
  // Memory, Budget receipt/ledger, session/CSRF and both production UIs are real.
  const ref=nativeId=>({driver:'codex',nativeId,strength:'strong'}),providerInstanceId=selection.instanceId,model=selection.model;
  const projection={thread:{id:run.threadId,projectId:run.t3ProjectId,providerInstanceId},runs:[{id:run.providerRunId,threadId:run.threadId,status:'running',providerInstanceId,modelSelection:{instanceId:providerInstanceId,model},activeAttemptId:'native-attempt'}],
    attempts:[{id:'native-attempt',runId:run.providerRunId,attemptOrdinal:1,rootNodeId:'root',providerInstanceId,providerThreadId:'provider-thread',providerTurnId:'turn',nativeThreadId:'session',status:'completed'}],
    providerThreads:[{id:'provider-thread',driver:'codex',providerInstanceId,appThreadId:run.threadId,nativeThreadRef:ref('session')}],providerTurns:[{id:'turn',providerThreadId:'provider-thread',nodeId:'root',runAttemptId:'native-attempt',ordinal:1,status:'completed',nativeTurnRef:ref('native-turn'),nativeThreadRef:ref('session'),model,turnTokenUsage:{usageScope:'main_agent',usageStatus:'complete',inputTokens:10,outputTokens:4,hasSubagents:false,models:[model],otherUsage:{inputTokens:0,outputTokens:0}}}]};
  const accounting=createNativeUsageBridge({store:app.store,budgets:app.budgets}),protocol=createProtocolController({store:app.store,call:async()=>{throw Error('No native effects in counter fixture');},openFeed:async()=>({projection:async()=>structuredClone(projection),close(){}}),onNativeUsage:i=>accounting.feed(i)});t.after(()=>protocol.close());await protocol.reconcile(run.id);
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('forge.language','en'));
  await page.goto(app.url,{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Workspace overview',exact:true}).waitFor();
  const search=page.getByRole('searchbox',{name:'Find a tool',exact:true});await search.fill('Memory Studio');await page.getByRole('navigation').getByRole('button',{name:'Memory Studio',exact:true}).click();await search.press('Escape');
  const section=page.locator('section').filter({has:page.getByRole('heading',{name:'Connect memory to a run',exact:true})});
  await section.getByLabel('Run for memory connection',{exact:true}).selectOption(run.id);await section.getByLabel('Connection memory access',{exact:true}).selectOption('read-write');
  await section.getByRole('button',{name:'Create five-minute connection',exact:true}).click();await section.getByRole('button',{name:'Copy MCP configuration',exact:true}).waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('Bearer '));
  await section.getByRole('button',{name:'Copy MCP configuration',exact:true}).click();const config=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));assert.ok(/^Bearer /.test(config.headers.Authorization));
  assert.ok(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('Bearer '));
  const client=new Client({name:'memory-ui-sdk-fixture',version:'1'},{capabilities:{}});t.after(()=>client.close());await client.connect(new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers}}));assert.equal((await client.listTools()).tools.length,5);
  await section.getByRole('button',{name:'Revoke',exact:true}).click();await section.getByText('Access revoked.',{exact:true}).waitFor();assert.equal(await section.getByRole('button',{name:'Copy MCP configuration',exact:true}).count(),0);await assert.rejects(client.listTools());
  for(const width of [1440,375]){await page.setViewportSize({width,height:1000});await section.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(dir,`memory-connection-${width}.png`)});}
  await page.getByLabel('Language',{exact:true}).selectOption('th');await page.getByRole('heading',{name:'เชื่อมความจำกับงานที่กำลังทำ',exact:true}).waitFor();assert.deepEqual(errors,[]);
  await page.setViewportSize({width:1440,height:1000});await page.getByLabel('Language',{exact:true}).selectOption('en');await search.fill('Usage & budgets');await page.getByRole('navigation').getByRole('button',{name:'Usage & budgets',exact:true}).click();await search.press('Escape');
  const counters=page.locator('section').filter({has:page.getByRole('heading',{name:'Measured native tokens',exact:true})});await counters.waitFor();assert.equal(await counters.getByRole('cell',{name:'14',exact:true}).count(),2);assert.ok((await counters.innerText()).includes('monetary cost'));
  await page.setViewportSize({width:375,height:1000});await counters.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(dir,'native-usage-375.png')});assert.deepEqual(errors,[]);
  projection.providerTurns[0].turnTokenUsage.inputTokens=9;await protocol.reconcile(run.id);
  await page.getByRole('button',{name:'Refresh report',exact:true}).click();await page.getByRole('status').filter({hasText:'Latest native counters are unavailable.'}).waitFor();
  assert.equal(await counters.getByRole('cell',{name:'14',exact:true}).count(),0);assert.equal(await counters.getByRole('cell',{name:'Unknown',exact:true}).count(),2);
  assert.equal(app.store.read().runs.find(r=>r.id===run.id).nativeUsage.status,'unavailable');assert.equal(app.store.read().events.filter(e=>e.type==='budget.observation').length,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(dir,'native-usage-unavailable-375.png')});assert.deepEqual(errors,[]);
});
