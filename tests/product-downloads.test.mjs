import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createDownloadService} from '../app/server/downloads.mjs';
import {extractPackage} from '../app/reports/files.mjs';
function entries(bytes){
  const end=bytes.lastIndexOf(Buffer.from('504b0506','hex'));assert.ok(end>=0);
  let at=bytes.readUInt32LE(end+16);const count=bytes.readUInt16LE(end+10),out=[];
  for(let i=0;i<count;i++){assert.equal(bytes.readUInt32LE(at),0x02014b50);const length=bytes.readUInt16LE(at+28);out.push({name:bytes.subarray(at+46,at+46+length).toString('utf8'),mode:bytes.readUInt32LE(at+38)>>>16});at+=46+length+bytes.readUInt16LE(at+30)+bytes.readUInt16LE(at+32);}
  return out;
}
test('platform downloads contain real scoped launchers, source revision and matching SHA256',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-download-engineering-'));
  const s=createDownloadService({sourceRoot:process.cwd(),dataDir:dir});
  const m=await s.metadata();assert.equal(m.status,'alpha');assert.match(m.commit,/^[0-9a-f]{40}$/);assert.equal(m.platforms.length,2);
  for(const p of m.platforms){
    const f=await s.file(p.filename),bytes=await readFile(f.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),p.sha256);assert.equal(bytes.length,p.bytes);
    const list=entries(bytes),names=list.map(e=>e.name);assert.ok(names.includes('FORGE/release-info.json'));assert.ok(names.includes('FORGE/README_FIRST.txt'));assert.ok(names.includes('FORGE/package-lock.json'));assert.ok(names.includes('FORGE/app/launcher.mjs'));
    assert.equal(names.some(n=>/(^|\/)(node_modules|dist|\.git|\.env|auth\.json)(\/|$)/.test(n)),false);
    const suffix=p.id==='windows'?'cmd':'command';assert.ok(names.includes(`FORGE/Start-FORGE.${suffix}`));
    if(p.id==='macos'){assert.equal(p.qualification,'not-run');assert.equal(list.find(e=>e.name==='FORGE/Start-FORGE.command').mode&0o777,0o755);}
  }
  await assert.rejects(s.file('../private.json'),{statusCode:404});
  const windows=await s.file('FORGE-Windows.zip');const extracted=path.join(dir,'installed-copy');await extractPackage(await readFile(windows.path),extracted);
  const installedRoot=path.join(extracted,'FORGE');
  const portable=createDownloadService({sourceRoot:installedRoot,dataDir:path.join(dir,'portable-data')});
  const portableMetadata=await portable.metadata();assert.equal(portableMetadata.commit,m.commit);assert.equal(portableMetadata.platforms.length,2);
  await writeFile(path.join(installedRoot,'app','launcher.mjs'),'changed unqualified source');
  const changed=createDownloadService({sourceRoot:installedRoot,dataDir:path.join(dir,'changed-data')});await assert.rejects(changed.metadata(),{statusCode:409});
});
