// Explicit heavy engineering run: node tests/guarded-session-install-fresh.mjs
// Real default source pipeline; no provider turn. Retains its NEW private root.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createGuardedArtifactService} from '../app/guarded-runtime/install.mjs';
import {fileDigest} from '../app/guarded-runtime/file-digest.mjs';
import {digest} from '../app/guarded-runtime/profile.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const retained=path.join(os.tmpdir(),'forge-guarded-timeout30s-20261125');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'forge-session-install-fresh-'));
const evidenceFile=path.join(root,'fresh-build-evidence.json'),stages=[];
const capture=path.join(root,'capture-command.mjs');
await fs.writeFile(capture,`import fs from 'node:fs';import {spawn} from 'node:child_process';const spec=JSON.parse(process.argv[2]);const out=fs.openSync(process.argv[3],'w');const p=spawn(spec.command,spec.args,{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:['ignore',out,out]});p.once('error',e=>{fs.writeSync(out,String(e));process.exitCode=1});p.once('close',code=>{fs.closeSync(out);process.exitCode=code??1});`);
const inside=(base,file)=>{const rel=path.relative(base,file);return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const original=JSON.parse(await fs.readFile(path.join(retained,'patch-report.json'),'utf8'));
async function retainedFingerprint(){
  const files=new Set(['t3.tgz','opencode.tgz','bun.tgz','node.zip','pnpm.tgz','pnpm-exe.tgz','patch-report.json','artifact-manifest.json','windows/ConfinedText.exe','opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe']);
  for(const p of original.changes)files.add(p.source+'/'+p.file);
  for(const cache of ['forge-guarded-timeout30s-20261125','forge-frontend-generation-VD6puQ','forge-frontend-generation-Vmhthl']){
    const directory=path.join(os.tmpdir(),cache,'t3/apps/server/dist');
    for(const name of (await fs.readdir(directory)).filter(n=>n.endsWith('.mjs')))files.add(path.relative(retained,path.join(directory,name)));
  }
  files.add('../forge-frontend-generation-VD6puQ/opencode/forge-frontend-cli-build/cli-windows-x64/bin/opencode.exe');
  files.add('../forge-frontend-generation-Vmhthl/opencode/forge-sessions-cli-build/cli-windows-x64/bin/opencode.exe');
  return digest([...files].sort().map(name=>({name,sha256:fileDigest(path.join(retained,name))})));
}
// Reuse dependency stores READ ONLY, copying/remapping only NEW importer links.
// No dependency installer runs against a retained/shared tree.
async function dependencies(tree,target){
  assert.ok(inside(root,target));
  const source=path.join(retained,tree),oldRoots=[source];
  if(tree==='t3')oldRoots.push(path.dirname(path.dirname(await fs.realpath(path.join(source,'node_modules/.pnpm')))));
  function remap(actual){
    for(const old of oldRoots){const rel=path.relative(old,actual);if(inside(old,actual)&&(rel.startsWith('packages'+path.sep)||rel.startsWith('apps'+path.sep)))return path.join(target,rel);}
    return actual;
  }
  async function clone(from,to){
    const stat=await fs.lstat(from);
    if(stat.isSymbolicLink()){await fs.symlink(remap(await fs.realpath(from)),to,'junction');return;}
    if(stat.isDirectory()){
      if(['.bun','.pnpm'].includes(path.basename(from))){await fs.symlink(await fs.realpath(from),to,'junction');return;}
      await fs.mkdir(to,{recursive:true});for(const file of await fs.readdir(from))await clone(path.join(from,file),path.join(to,file));
    }else if(stat.isFile())await fs.copyFile(from,to);
  }
  const importers=[''];for(const group of ['packages','apps'])for(const name of await fs.readdir(path.join(source,group)).catch(()=>[]))importers.push(path.join(group,name));
  for(const importer of importers){
    const from=path.join(source,importer,'node_modules');if(!await fs.lstat(from).then(()=>true,()=>false))continue;
    const manifest=path.join(importer,'package.json');
    assert.equal(await fs.readFile(path.join(source,manifest),'utf8'),await fs.readFile(path.join(target,manifest),'utf8'),'dependency importer manifest differs');
    // pnpm requires a real importer node_modules directory. Materialize that
    // directory even when the retained packaged importer is itself a junction.
    await clone(await fs.realpath(from),path.join(target,importer,'node_modules'));
  }
}
let service,outcome;
const before=await retainedFingerprint();
console.log(JSON.stringify({root,scope:'REAL full default source builds; read-only retained dependency stores; no provider turn'}));
try{
  service=await createGuardedArtifactService({dataDir:root,commandRunner:async(spec,runOwned)=>{
    const entry={stage:spec.stage,startedAt:new Date().toISOString()};stages.push(entry);console.log('START',spec.stage);
    if(spec.stage==='sources'||spec.stage==='toolchain'){
      const cache=spec.args[1];assert.ok(inside(root,cache.startsWith('\\\\?\\')?cache.slice(4):cache));
      for(const name of spec.stage==='sources'?['t3.tgz','opencode.tgz','bun.tgz']:['node.zip','pnpm.tgz','pnpm-exe.tgz'])await fs.copyFile(path.join(retained,name),path.join(cache,name));
    }
    let result;
    if(spec.stage==='opencode-dependencies'||spec.stage==='t3-dependencies'){
      const tree=spec.stage.startsWith('opencode')?'opencode':'t3';const target=tree==='opencode'?spec.cwd:path.join(spec.args[1],'t3');
      await dependencies(tree,target);entry.reusedReadOnlyDependencyStores=true;result={exitCode:0};
    }else result=await runOwned({...spec,command:process.execPath,args:[capture,JSON.stringify({command:spec.command,args:spec.args}),path.join(root,spec.stage+'.log')]});
    entry.exitCode=result.exitCode;entry.finishedAt=new Date().toISOString();console.log('END',spec.stage,result.exitCode);return result;
  }});
  await service.install({operationId:'fresh-source-pipeline-20261126'});
  let state;for(;;){state=await service.state();if(state.status!=='preparing')break;await new Promise(r=>setTimeout(r,1000));}
  assert.equal(state.status,'ready',JSON.stringify(state));const artifacts=await service.artifacts();
  assert.deepEqual(artifacts.opencode.purposes,['guarded-default','supervised-frontend-v1','supervised-orchestrator-v1']);
  const actual=artifacts.t3.files.map(f=>({name:f.name,sha256:fileDigest(f.path)})).sort((a,b)=>a.name.localeCompare(b.name));
  assert.equal(actual.length,46);await service.close();service=await createGuardedArtifactService({dataDir:root});
  assert.equal((await service.state()).status,'ready');assert.equal(fileDigest((await service.artifacts()).opencode.path),fileDigest(artifacts.opencode.path));
  const setup=JSON.parse(await fs.readFile(path.join(root,'guarded-artifacts/setup.json'),'utf8'));const job=setup.operations[setup.current];
  const builds=(await fs.readdir(path.join(root,'guarded-artifacts'))).filter(n=>n.startsWith('build-'));assert.equal(builds.length,1);
  const build=path.join(root,'guarded-artifacts',builds[0]),pipeline=path.join(build,'pipeline');
  const reportDir=(await fs.readdir(build)).find(n=>n.startsWith('session-pipeline-'));
  const {generation}=JSON.parse(await fs.readFile(path.join(build,reportDir,'generation.json'),'utf8'));assert.ok(inside(root,generation));
  const sourceFiles=[];for(const file of ['patch-report.json','cli-build-report.json','t3-build-report.json','windows/build.json'])sourceFiles.push({file:path.join(build,'cache',file),sha256:fileDigest(path.join(build,'cache',file))});
  for(const file of ['frontend-patches.json','session-patches.json','opencode-session-build.json','t3-session-build.json'])sourceFiles.push({file:path.join(generation,file),sha256:fileDigest(path.join(generation,file))});
  outcome={status:'PASS',generation,artifacts,images:{opencodeSha256:fileDigest(artifacts.opencode.path),t3All45AndActualNodeSha256:digest(actual),files:actual,brokerSha256:fileDigest(artifacts.fileBroker.path),currentNodeSha256:fileDigest(process.execPath)},sourceFiles,pipeline,proof:null};
}catch(error){outcome={status:'FAIL',error:{message:error.message,stack:error.stack},proof:null};process.exitCode=1;}
finally{
  await service?.close();const after=await retainedFingerprint();assert.equal(after,before,'retained source/image fingerprint changed');
  await fs.writeFile(evidenceFile,JSON.stringify({version:1,observedAt:new Date().toISOString(),scope:'Fresh extracted upstream sources, real base and session builds, private SDK npm ci, copied installed images/reopen; base dependency store reuse read only with remapped NEW importers',root,stages,retainedFingerprintBefore:before,retainedFingerprintAfter:after,...outcome,externalProviderTurns:0,homeUat:'NOT_RUN'},null,2)+'\n');
  console.log(JSON.stringify({evidenceFile,status:outcome.status,images:outcome.images}));
}
