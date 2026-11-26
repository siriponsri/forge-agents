import {readFile,mkdtemp,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {bytesDigest,digest} from '../../app/guarded-runtime/profile.mjs';

export async function sessionArtifactInventory(root){
  root=path.resolve(root);const meta=JSON.parse(await readFile(path.join(root,'generation.json'),'utf8'));
  if(meta.root!==root||!path.basename(root).startsWith('forge-frontend-generation-'))throw Error('NEW_GENERATION_REQUIRED');
  const directory=path.join(root,'t3/apps/server/dist');
  const files=await Promise.all((await readdir(directory)).filter(n=>n.endsWith('.mjs')).sort().map(async name=>({name,path:path.join(directory,name),sha256:bytesDigest(await readFile(path.join(directory,name)))})));
  files.push({name:'node.exe',path:process.execPath,sha256:bytesDigest(await readFile(process.execPath))});
  const binary=path.join(root,'opencode/forge-sessions-cli-build/cli-windows-x64/bin/opencode.exe');
  return {version:1,purposes:['guarded-default','supervised-frontend-v1','supervised-orchestrator-v1'],generation:root,t3:{entry:path.join(directory,'forge-guarded-host.mjs'),files,sha256:digest(files.map(({name,sha256})=>({name,sha256})).sort((a,b)=>a.name.localeCompare(b.name)))},opencode:{path:binary,sha256:bytesDigest(await readFile(binary)),version:'2.4.1-forge-sessions.0'},patches:JSON.parse(await readFile(path.join(root,'session-patches.json'),'utf8')),proof:null};
}
// Existing installer command owner supplies inherited cancellation/JobObject.
// No global install, activation, runtime proof or fixture is part of this hook.
export async function runSessionPipeline({preparedCache,buildDirectory,runCommand,environment,signal,onProgress=()=>{}}){
  if(!path.isAbsolute(preparedCache??'')||!path.isAbsolute(buildDirectory??'')||typeof runCommand!=='function'||!environment)throw Error('PRIVATE_SETUP_JOB_RUNNER_REQUIRED');
  const reports=await mkdtemp(path.join(buildDirectory,'session-pipeline-')),generationFile=path.join(reports,'generation.json');
  async function run(family,stage,args){
    signal?.throwIfAborted();onProgress('session-'+stage);
    const file=fileURLToPath(new URL('../'+family+'/'+stage+'.mjs',import.meta.url));
    const result=await runCommand({stage:'session-'+stage,command:process.execPath,args:[file,...args],cwd:buildDirectory,env:environment,timeoutMs:600000});
    signal?.throwIfAborted();if(result?.exitCode!==0)throw Object.assign(Error('SESSION_BUILD_STAGE_FAILED'),{stage});
  }
  await run('frontend-tools','clone-generation',[preparedCache,generationFile]);
  const {generation}=JSON.parse(await readFile(generationFile,'utf8'));
  if(!path.isAbsolute(generation)||!path.basename(generation).startsWith('forge-frontend-generation-'))throw Error('NEW_GENERATION_REQUIRED');
  await run('frontend-tools','patch-generation',[generation]);
  await run('session-tools','patch-generation',[generation]);
  await run('frontend-tools','link-t3-dependencies',[generation]);
  await run('session-tools','build-generation',[generation]);
  return sessionArtifactInventory(generation);
}
