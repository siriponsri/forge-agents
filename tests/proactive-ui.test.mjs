import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import Module from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

test('TH/EN no-code component compiles and renders labelled fields without dispatching during render',async()=>{
  const filename=path.resolve('tests/proactive-ui-virtual.cjs');
  const bundle=await build({entryPoints:['app/web/src/ProactiveWorkflows.jsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'}});
  const compiled=new Module(filename);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));compiled._compile(bundle.outputFiles[0].text,filename);
  const Component=compiled.exports.default;let calls=0;
  for(const language of ['th','en']){
    const html=renderToStaticMarkup(React.createElement(Component,{t:(th,en)=>language==='th'?th:en,state:{tasks:[],plans:[],connections:[]},projectId:'fixture-project',run:()=>{calls++;},busy:false}));
    assert.match(html,/<form/);assert.match(html,/<label for=/);assert.match(html,/type="datetime-local"/);
    assert.ok(html.includes(language==='th'?'งานเชิงรุก':'Proactive workflows'));assert.equal(calls,0);
  }
  const src=await readFile('app/web/src/ProactiveWorkflows.jsx','utf8');
  for(const action of ['approve','enable','pause','revoke','reconcile','resolve'])assert.ok(src.includes(`act('${action}'`));
  assert.match(src,/key=\{props.projectId\}/);assert.match(src,/scopeEnforcement|Paths are not a sandbox/);
  assert.doesNotMatch(src,/approved:\s*true|actor:\s*\{/);
});
