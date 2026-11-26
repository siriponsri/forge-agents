import test from 'node:test';
import assert from 'node:assert/strict';
import {frontier,settle,reopenDecision,decisionsFromBrief,taskSpecFrom} from '../app/studio/question-tree.mjs';
import {briefDecisions,draftBrief,missionDefinitionFrom,planningConstraints} from '../app/studio/brief.mjs';
import {definition} from '../app/missions/contracts.mjs';

function answers(prompt,overrides={}){
  let d={};for(let round=0;round<12;round++){
    const qs=frontier(d,null,prompt);if(!qs.length)return d;
    for(const q of qs)d[q.id]=settle(q,overrides[q.id]??{accept:true});
  }throw new Error('Unbounded interview');
}
test('custom task answers converge, remain editable, and survive canonical serialization',()=>{
  const d=answers('Unusual task',{task_type:{text:'A custom research planning task'}});
  assert.equal(d.success_metric.value,'review_required');
  assert.equal(frontier(d,null,'Unusual task').length,0);
  const resumed=decisionsFromBrief(briefDecisions(d));
  assert.equal(resumed.task_type.text,'A custom research planning task');
  assert.deepEqual(reopenDecision(resumed,'task_type'),{});
});
test('changing upstream decisions drops dependent metrics and privacy assumptions',()=>{
  const d=answers('Predict price from CSV',{compute_target:{value:'cloud_gpu'}});
  assert.equal(d.data_upload.value,'no_upload');
  const changed=reopenDecision(d,'compute_target');
  assert.ok(!changed.budget&&!changed.data_upload&&!changed.compute_target);
  assert.equal(changed.task_type.value,'regression');
  assert.deepEqual(reopenDecision(d,'task_type'),{});
});
test('planning Mission retains all reviewed sections and refuses truncating constraints',()=>{
  const d=answers('Predict price from CSV');
  const brief=draftBrief({prompt:'Predict price from CSV',decisions:d,lang:'en'});
  brief.risksDecisions+='\nOWNER REQUIREMENT: never send personal data';
  const m=definition(missionDefinitionFrom({title:'Planning only',brief,decisions:briefDecisions(d,'en'),workflowId:'abc123456',lang:'en'}));
  for(const key of ['acceptance','interfacesDependencies','risksDecisions'])assert.ok(m.constraints.includes(brief[key]));
  assert.equal(m.inputs,brief.inputsScope);assert.equal(m.objective,brief.objective);
  assert.match(m.constraints,/Planning only.*Do not train/);assert.match(m.outputs[1].acceptance,/Do not train/);
  assert.ok(m.outputs.every(o=>o.path.endsWith('-plan.json')));
  assert.throws(()=>planningConstraints({...brief,risksDecisions:'x'.repeat(4000)}),{code:'STUDIO_CONSTRAINTS_SIZE'});
  assert.doesNotMatch(brief.interfacesDependencies,/no spending$|at no cost|free GPU/);
  assert.equal(taskSpecFrom(d).taskType,'regression');
});
