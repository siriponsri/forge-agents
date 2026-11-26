// Actual authenticated HTTP + disposable SQLite. Never touches an existing app.
import test from 'node:test';
import assert from 'node:assert/strict';
import {studioFixture} from './studio-fixture.mjs';
import {frontier,settle} from '../app/studio/question-tree.mjs';
import {briefDecisions,draftBrief,missionDefinitionFrom,STUDIO_PRESET_ID} from '../app/studio/brief.mjs';

test('Studio HTTP preserves owner scope, canonical revisions and one-effect recovery without execution',async t=>{
  const f=await studioFixture({serve:false});t.after(()=>f.close());
  const {project,post,app}=f,input=extra=>({projectId:project.id,operationId:crypto.randomUUID(),...extra});
  const unauth=await fetch(app.url+'/api/playbooks/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id})});
  assert.equal(unauth.status,403);assert.equal((await unauth.json()).error.code,'BROWSER_SESSION_REQUIRED');
  let decisions={};for(let qs=frontier(decisions,null,'Predict sales CSV');qs.length;qs=frontier(decisions,null,'Predict sales CSV'))for(const q of qs)decisions[q.id]=settle(q,{accept:true});
  const brief=draftBrief({prompt:'Predict sales CSV',decisions,lang:'en'}),saved=briefDecisions(decisions,'en');
  const create=input({presetId:STUDIO_PRESET_ID,title:'Disposable Studio plan',brief,decisions:saved});
  const w=await post('/api/playbooks/create',create);
  assert.deepEqual(await post('/api/playbooks/create',create),w,'lost create response replays same workflow');
  const revised=await post('/api/playbooks/revise',input({workflowId:w.id,expectedRevision:w.revision,title:w.title,brief:{...brief,risksDecisions:brief.risksDecisions+'\nNo uploads.'},decisions:saved}));
  await assert.rejects(post('/api/playbooks/revise',input({workflowId:w.id,expectedRevision:w.revision,title:w.title,brief,decisions:saved})),{code:'REVISION_CONFLICT'});
  let snapshot=await post('/api/playbooks/state',{projectId:project.id}),b=snapshot.briefs.find(b=>b.id===revised.briefId);
  const materialize=input({workflowId:w.id,expectedRevision:revised.revision,definition:missionDefinitionFrom({title:b.title,brief:b.brief,decisions:b.decisions,workflowId:w.id,lang:'en'})});
  await assert.rejects(post('/api/playbooks/materialize',{...materialize,operationId:crypto.randomUUID(),definition:{...materialize.definition,objective:'Changed after review'}}),{code:'BRIEF_MISMATCH'});
  const created=await post('/api/playbooks/materialize',materialize);
  assert.deepEqual(await post('/api/playbooks/materialize',materialize),created,'lost materialize response replays same mission');
  snapshot=await post('/api/playbooks/state',{projectId:project.id});
  assert.equal(snapshot.workflows.length,1);assert.equal(snapshot.materializations.length,1);
  const s=app.store.read(),m=s.events.find(e=>e.id===created.missionId);
  assert.equal(m.status,'draft');assert.equal(s.plans.find(p=>p.id===created.planId).approved,false);
  assert.equal(s.tasks.length,4);assert.equal(s.runs.length,0);assert.equal(s.jobs.length,0);
  assert.ok(m.definition.constraints.includes('No uploads.'));
  const other=(await post('/api/command',{type:'project.create',operationId:crypto.randomUUID(),data:{name:'Other fixture',workspace:f.dir+'/other'}})).entity;
  assert.deepEqual((await post('/api/playbooks/state',{projectId:other.id})).workflows,[]);
  await assert.rejects(post('/api/playbooks/revise',{...input({workflowId:w.id,expectedRevision:revised.revision,title:w.title,brief,decisions:saved}),projectId:other.id}),e=>['NOT_FOUND','PROJECT_SCOPE'].includes(e.code));
});
