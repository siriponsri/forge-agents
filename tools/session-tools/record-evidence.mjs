import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {bytesDigest} from '../../app/guarded-runtime/profile.mjs';
import {sessionArtifactInventory} from './pipeline.mjs';
const generation=path.resolve(process.argv[2]),inventory=await sessionArtifactInventory(generation),meta=JSON.parse(await readFile(path.join(generation,'generation.json'),'utf8'));
const sha=async file=>bytesDigest(await readFile(file));
const inputs={archives:{t3:await sha(path.join(meta.cache,'t3.tgz')),opencode:await sha(path.join(meta.cache,'opencode.tgz'))},toolchains:{bun:await sha(path.join(meta.cache,'bun/bin/bun.exe')),buildNode:await sha(path.join(meta.cache,'node/node.exe')),hostNode:await sha(process.execPath)},revisions:{t3:'59651c1761f6c63e9b6056839067066968e6a406',opencode:'6f0514052a3c859894ad01bb14cc14dda1e44b96'},mcpSdk:JSON.parse(await readFile(new URL('../../node_modules/@modelcontextprotocol/sdk/package.json',import.meta.url),'utf8')).version};
const noticesFolder=path.join(generation,'session-notices');await mkdir(noticesFolder,{recursive:true});
const notices=[];for(const [name,file]of [['FORGE-LICENSE',fileURLToPath(new URL('../../LICENSE',import.meta.url))],['T3-LICENSE',path.join(generation,'t3/LICENSE')],['OPENCODE-LICENSE',path.join(generation,'opencode/LICENSE')],['NODE-LICENSE',path.join(meta.cache,'node/LICENSE')],['MCP-SDK-LICENSE',fileURLToPath(new URL('../../node_modules/@modelcontextprotocol/sdk/LICENSE',import.meta.url))]]){
  const bytes=await readFile(file),target=path.join(noticesFolder,name+'.txt');await writeFile(target,bytes);notices.push({name,file:target,sha256:bytesDigest(bytes)});
}
const sourceFiles=['app/session-tools/contract.mjs','app/session-tools/native-tool.mjs','app/session-tools/opencode-cli-runtime.ts','app/session-tools/native-gateway.mjs','app/guarded-runtime/profile.mjs','app/guarded-runtime/runtime-host.mjs','app/guarded-runtime/t3-host.mjs','tools/session-tools/patch-generation.mjs','tools/session-tools/build-generation.mjs','tools/session-tools/pipeline.mjs'];
const sourcePins=await Promise.all(sourceFiles.map(async file=>({file,sha256:await sha(fileURLToPath(new URL('../../'+file,import.meta.url)))})));
const fixtures=await Promise.all(process.argv.slice(3).map(async file=>JSON.parse(await readFile(file,'utf8'))));
const report={version:1,observedAt:new Date().toISOString(),scope:'NEW source generation/build inventory and actual parent native protocol fixtures; no production activation',inputs,sourcePins,inventory,frontendPatches:JSON.parse(await readFile(path.join(generation,'frontend-patches.json'),'utf8')),buildReports:await Promise.all(['t3','opencode'].map(async name=>({name,...JSON.parse(await readFile(path.join(generation,name+'-session-build.json'),'utf8'))}))),notices,fixtures,productionProof:null,externalProviderTurns:0,homeUat:'NOT_RUN'};
const output=fileURLToPath(new URL('./native-evidence.json',import.meta.url));await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,generation,opencode:inventory.opencode.sha256,t3:inventory.t3.sha256,fixtures:fixtures.length}));
