// Real React component + real HTTP/SQLite registry, trusted native model fixture.
// This qualifies PluginManager in isolation, not the lead's shared Settings mount.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {fixture} from './plugins-fixture.test.mjs';
import {createPluginService,dispatchPluginRequest} from '../app/plugins/index.mjs';

test('PluginManager browser: configure/enable/health/select/scope/disable/reload and accessible mobile forms',{timeout:60000},async t => {
  const require=createRequire(import.meta.url);
  let chromium,build;
  try {
    ({chromium}=await import('playwright'));
    ({build}=require(createRequire(require.resolve('vite')).resolve('esbuild')));
  } catch(e) { t.skip(`Browser qualification NOT_RUN: ${e.code ?? e.message}`);return; }
  const f=await fixture(t),observed=[];
  const service=createPluginService({store:f.store,adapters:{models:{
    health:async ctx=>{observed.push(ctx);return {status:'ready'};},
    invoke:async()=>{throw new Error('Browser test must never dispatch a provider');},
  }},authorize:()=>false});
  t.after(()=>service.close());
  const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import PluginManager from './Plugins.jsx';
    function App(){const[state,setState]=useState(window.fixtureState),[error,setError]=useState('');return <><p role="alert">{error}</p><PluginManager t={(_th,en)=>en} state={state} projectId={state.projects[0].id} busy={false} run={async fn=>{try{await fn();setState(await(await fetch('/fixture/state')).json());}catch(e){setError(e.message);}}}/></>;}createRoot(document.getElementById('root')).render(<App/>);`;
  const bundle=await build({stdin:{contents:entry,resolveDir:fileURLToPath(new URL('../app/web/src/',import.meta.url)),loader:'jsx'},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});
  const server=createServer(async(req,res)=>{
    try {
      if(req.url==='/api/session'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({csrf:'isolated-component-fixture-only'}));return;}
      if(req.url==='/fixture/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(f.store.read()));return;}
      if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);return;}
      if(req.url.startsWith('/api/plugins/')){
        let body='';for await(const chunk of req)body+=chunk;
        const result=await dispatchPluginRequest(service,req.url.slice('/api/plugins/'.length),JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
      }
      res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:16px sans-serif;margin:16px}select,input,button{max-width:100%;box-sizing:border-box}.panel{border:1px solid #888;padding:12px;margin:12px 0}.field label{display:block}button{margin:4px}small{font-size:12px}</style><div id="root"></div><script>window.fixtureState=${JSON.stringify(f.store.read()).replaceAll('<','\\u003c')}</script><script type="module" src="/bundle.js"></script></html>`);
    }catch(e){res.statusCode=e.statusCode??500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:{code:e.code,message:e.message}}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true,...(process.env.FORGE_TEST_BROWSER?{executablePath:process.env.FORGE_TEST_BROWSER}:{})});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.goto(url);const card=page.getByRole('article',{name:'Models',exact:true});await card.waitFor();
  await card.getByLabel('Provider instance ID from account setup').fill('browser-fixture-instance');
  await card.getByRole('button',{name:'Save configuration',exact:true}).click();
  await assertEventually(page,()=>f.store.read().events.filter(e=>e.type==='plugin.binding').length===1);
  await card.getByRole('button',{name:'Enable in this scope',exact:true}).click();
  await assertEventually(page,()=>f.store.read().events.filter(e=>e.type==='plugin.binding').at(-1)?.enabled===true);
  await card.getByRole('button',{name:'Check actual health',exact:true}).click();
  await card.getByRole('status').filter({hasText:'Health: ready'}).waitFor();assert.equal(observed[0].config.providerInstanceId,'browser-fixture-instance');
  await page.getByText('Check capability selection for this scope',{exact:true}).click();await page.getByRole('checkbox',{name:'models 1.0.0',exact:true}).check();
  await page.getByRole('button',{name:'Check and record selection',exact:true}).click();await page.getByText('Selection recorded. Execution is not approved.',{exact:false}).waitFor();
  assert.equal(f.store.read().events.filter(e=>e.type==='plugin.selection').length,1);assert.equal(f.store.read().events.filter(e=>e.type==='plugin.call').length,0);
  await page.getByLabel('Capability scope',{exact:true}).selectOption('task');await page.getByLabel('Apply to',{exact:true}).selectOption(f.task.id);
  await card.getByRole('button',{name:'Disable in this scope',exact:true}).waitFor();
  await card.getByRole('button',{name:'Disable in this scope',exact:true}).click();await card.getByRole('status').filter({hasText:'CAPABILITY_DISABLED'}).waitFor();
  assert.equal(f.store.read().events.filter(e=>e.type==='plugin.binding').at(-1).scope.id,f.task.id);
  await page.reload();await card.getByLabel('Provider instance ID from account setup').waitFor();assert.equal(await card.getByLabel('Provider instance ID from account setup').inputValue(),'browser-fixture-instance');
  await page.setViewportSize({width:375,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  // Same project, second writer produces a real optimistic-revision conflict.
  const binding=f.store.read().events.filter(e=>e.type==='plugin.binding'&&e.scope.kind==='project').at(-1);
  await service.configure(f.binding({pluginId:'forge.models',expectedRevision:binding.revision,config:{providerInstanceId:'second-writer'}}));
  await card.getByLabel('Provider instance ID from account setup').fill('stale-form');await card.getByRole('button',{name:'Save configuration',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Plugin configuration changed'}).first().waitFor();
  assert.equal(f.store.read().events.filter(e=>e.type==='plugin.binding'&&e.scope.kind==='project').at(-1).config.providerInstanceId,'second-writer');
  assert.deepEqual(errors,[]);t.diagnostic('PASSED: isolated real HTTP/SQLite PluginManager; no live provider/account calls; shared Settings mount remains lead verification.');
});
async function assertEventually(page,predicate){for(let i=0;i<40;i++){if(predicate())return;await page.waitForTimeout(25);}assert.ok(predicate());}
