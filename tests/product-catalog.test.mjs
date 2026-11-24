import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogService } from '../app/server/catalog.mjs';
test('slow/failed refresh retains last-known actual models and fresh source identity',async()=>{
  let mode='good',release;
  const catalog=createCatalogService({timeoutMs:15,load:async()=>{if(mode==='failed')throw new Error('Provider unavailable');if(mode==='slow')await new Promise(r=>release=r);return {providerInstanceId:'fixture-provider',models:[{id:'fixture-model'}]};}});
  assert.equal(catalog.read().catalog,null);const first=await catalog.refresh();assert.equal(first.catalog.models[0].id,'fixture-model');assert.equal(first.stale,false);
  mode='failed';const failed=await catalog.refresh();assert.match(failed.error,/Provider unavailable/);assert.equal(failed.catalog.models[0].id,'fixture-model');
  mode='slow';const slow=await catalog.refresh();assert.equal(slow.refreshing,true);assert.match(slow.error,/pending/);assert.equal(slow.catalog.models[0].id,'fixture-model');release();await new Promise(r=>setTimeout(r,0));assert.equal(catalog.read().refreshing,false);assert.equal(catalog.read().error,null);
});
