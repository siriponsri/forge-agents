import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSessionDiagnostics} from '../app/guarded-runtime/native-diagnostics.mjs';
const event={stage:'before-result-for',errorCode:'NON_JSON',errorName:'Error'};
const log=value=>'FORGE_SESSION_DIAGNOSTIC '+JSON.stringify(value)+'\n';
test('private native diagnostics accept chunked classifications and reject raw/private or malformed output',()=>{
  const collector=createNativeSessionDiagnostics(),text=log(event);
  collector.push(text.slice(0,20));collector.push(Buffer.from(text.slice(20)));
  for(const value of [{...event,message:'private fixture value'},{...event,errorCode:'PRIVATE_VALUE'},{...event,stage:'unknown'},{...event,errorName:'PrivateName'},null])collector.push(log(value));
  collector.push('ordinary stderr with private fixture value\n');collector.push('FORGE_SESSION_DIAGNOSTIC {invalid}\n');
  assert.deepEqual(collector.snapshot(),[event]);assert.ok(!JSON.stringify(collector.snapshot()).includes('private'));
});
test('oversized lines and incomplete records never leak; bounded ring is independently copied',()=>{
  const collector=createNativeSessionDiagnostics();collector.push('x'.repeat(10000));collector.push(log(event));assert.deepEqual(collector.snapshot(),[]);
  collector.push(log(event));for(let n=0;n<20;n++)collector.push(log({...event,errorCode:-32603}));
  assert.equal(collector.snapshot().length,16);const snapshot=collector.snapshot();snapshot[0].stage='mutated';assert.equal(collector.snapshot()[0].stage,event.stage);
  collector.push(log(event).slice(0,-1));assert.equal(collector.snapshot().at(-1).errorCode,-32603);
});
