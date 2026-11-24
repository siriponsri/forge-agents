import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectReleases,validateManifest} from '../scripts/release-policy.mjs';
const asset={name:'FORGE-Windows.zip',size:123,state:'uploaded',digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/siriponsri/forge-agents/releases/download/v1/FORGE-Windows.zip'};
const release={tag_name:'v1',html_url:'https://github.com/siriponsri/forge-agents/releases/tag/v1',published_at:'2026-11-24T00:00:00Z',assets:[asset]};
test('only qualified public metadata can offer a Windows package',()=>{
  const selected=selectReleases([release]);assert.equal(selected[0].downloads[0].sha256,'a'.repeat(64));
  assert.deepEqual(selectReleases([{...release,draft:true}]),[]);
  for(const changed of [{digest:null},{digest:'md5:bad'},{size:0},{state:'new'},{name:'FORGE-macOS.zip'},{browser_download_url:'http://localhost:3000/api/downloads'},{browser_download_url:'https://evil.example/FORGE-Windows.zip'},{browser_download_url:asset.browser_download_url+'?token=secret'}])assert.equal(selectReleases([{...release,assets:[{...asset,...changed}]}])[0].downloads.length,0);
});
test('checked-in manifests fail closed on unsafe links',()=>{
  const m={schemaVersion:1,repository:'siriponsri/forge-agents',releases:selectReleases([release])};validateManifest(m);m.releases[0].downloads[0].url='javascript:alert(1)';assert.throws(()=>validateManifest(m));
});
