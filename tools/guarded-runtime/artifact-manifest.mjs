// Inventory ONLY. It never installs, activates or qualifies a packaged runtime.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,bytesDigest} from '../../app/guarded-runtime/profile.mjs';
const cache=path.resolve(process.argv[2]),runtimeNode=path.resolve(process.argv[3]??process.execPath),dist=path.join(cache,'t3/apps/server/dist');
const patches=JSON.parse(await readFile(path.join(cache,'patch-report.json'),'utf8'));
for(const [report,source] of [['cli-build-report.json','opencode'],['t3-build-report.json','t3']]){
  const value=JSON.parse(await readFile(path.join(cache,report),'utf8'));
  if(value.exitCode!==0||value.patchDigest!==digest(patches.changes.filter(x=>x.source===source)))throw Error('REFUSE_STALE_OR_FAILED_BUILD');
}
const hash=async file=>bytesDigest(await readFile(file));
const t3=[];
for(const name of (await readdir(dist)).filter(x=>x.endsWith('.mjs')).sort())t3.push({name,sha256:await hash(path.join(dist,name))});
const runtime={name:'node.exe',sha256:await hash(runtimeNode)};
const licenses=[];for(const name of ['T3-LICENSE.txt','OPENCODE-LICENSE.txt'])licenses.push({name,sha256:await hash(fileURLToPath(new URL('../../app/guarded-runtime/native/'+name,import.meta.url)))});
const result={version:1,purpose:'artifact-checksum-inventory',proof:null,automaticExecutionQualified:false,t3:{revision:'59651c1761f6c63e9b6056839067066968e6a406',entry:'forge-guarded-host.mjs',files:t3,runtimeNode:runtime,profileSha256:digest([...t3,runtime].sort((a,b)=>a.name.localeCompare(b.name)))},opencode:{revision:'6f0514052a3c859894ad01bb14cc14dda1e44b96',version:'2.4.1-forge-guarded.0',file:'opencode.exe',sha256:await hash(path.join(cache,'opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe'))},fileBroker:{file:'ConfinedText.exe',...(JSON.parse(await readFile(path.join(cache,'windows/build.json'),'utf8')))},licenses,patches:patches.changes};
const output=path.join(cache,'artifact-manifest.json');await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output,t3ProfileSha256:result.t3.profileSha256,opencodeSha256:result.opencode.sha256,fileBrokerSha256:result.fileBroker.binarySha256,proof:null}));
