import test from 'node:test';
import assert from 'node:assert/strict';
import { checkText } from '../app/reports/render.mjs';
test('native paragraph metadata does not interrupt multiline text or satisfy missing content',()=>{
  const inspection={blocks:[{text:'สวัสดี น้ำ',style:'Normal',type:'paragraph'},{text:'Second paragraph',style:'Normal',type:'paragraph'}]};
  assert.doesNotThrow(()=>checkText(inspection,['สวัสดี น้ำ\nSecond paragraph'],'WordCraft'));
  assert.throws(()=>checkText(inspection,['Normal'],'WordCraft'),{code:'OUTPUT_CONTENT'});
  assert.throws(()=>checkText(inspection,['Absent paragraph'],'WordCraft'),{code:'OUTPUT_CONTENT'});
});
