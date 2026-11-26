// Run AFTER the existing frontend patch on a NEW cloned prepared generation.
// Never mutates pinned input trees, toolchains, dependencies or installed images.
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(process.argv[2]),meta=JSON.parse(await readFile(path.join(root,'generation.json'),'utf8'));
if(root!==meta.root||root===meta.cache||!path.basename(root).startsWith('forge-frontend-generation-'))throw Error('NEW_GENERATION_REQUIRED');
const frontend=JSON.parse(await readFile(path.join(root,'frontend-patches.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex'),changes=[],additions=[];
async function edit(tree,file,transforms){
  const target=path.join(root,tree,file);if(!(await realpath(target)).startsWith(root+path.sep))throw Error('SOURCE_OUTSIDE_GENERATION');
  const before=(await readFile(target,'utf8')).replace(/\r\n/g,'\n');
  if(sha(before)!==frontend.changes.find(x=>x.tree===tree&&x.file===file)?.after)throw Error('FRONTEND_PREIMAGE_CHANGED: '+file);
  let after=before;for(const [from,to]of transforms){if(after.split(from).length!==2)throw Error('SESSION_PATCH_SEAM: '+file+': '+from.slice(0,80));after=after.replace(from,to);}
  await writeFile(target,after);changes.push({tree,file,before:sha(before),after:sha(after)});
}
await edit('opencode','packages/core/src/forge-bootstrap.ts',[
  ['  if(frontendProfile()) return','  if(sessionProfile()) return {model:{providerID:b.provider.id,model:b.provider.model},providers:{[b.provider.id]:{name:"FORGE supervised Orchestrator",package:"@opencode/ai/providers/openai/chat",compatibility:b.provider.compatibility,settings:b.provider.settings,models:{[b.provider.model]:{name:b.provider.model,type:"chat",limit:{context:16000,output:4000},capabilities:{tools:true,input:["text"],output:["text"]}}}}},permissions:[{action:"*",resource:"*",effect:"deny"},...["session_children","session_prompt"].map(name=>({action:"forge_sessions_"+name,resource:"*",effect:"allow"}))],mcp:{servers:{forge_sessions:{type:"remote",url:b.brokerUrl+"/mcp",oauth:false,codemode:false,protocol:"legacy",headers:{Authorization:"Bearer "+b.key}}}}}\n  if(frontendProfile()) return'],
  ['export const frontendProfile=', 'export const sessionProfile=()=>current().profile.purpose==="supervised-orchestrator-v1"\nexport function sessionBinding(ctx:any){if(!sessionProfile())throw Error("SESSION_PROFILE_REQUIRED");return call("/session-binding",{profileDigest:hash(current().profile),sessionId:ctx.sessionID,callId:ctx.id,messageId:ctx.messageID})}\nexport const frontendProfile='],
  ['if(frontendProfile())return discovered.server', 'if(sessionProfile())return discovered.server==="forge_sessions"&&["session_children","session_prompt"].includes(discovered.name)&&b.toolManifest.some((x:any)=>x.operation===discovered.name&&x.rawName==="forge_sessions_"+discovered.name&&x.schemaDigest===hash(discovered.inputSchema));if(frontendProfile())return discovered.server'],
]);
await edit('opencode','packages/core/src/forge-guard.ts',[
  ['import { frontendProfile }','import { sessionTool } from "./forge-sessions-runtime.js"\nimport { sessionProfile } from "./forge-bootstrap.js"\nimport { frontendProfile }'],
  ['(frontendProfile()?"forge_frontend_":"forge_guarded_")','(sessionProfile()?"forge_sessions_":frontendProfile()?"forge_frontend_":"forge_guarded_")'],
  ['export function trustedMcp(info:any,discovered:any){','export function trustedMcp(info:any,discovered:any){\n  if(hasBootstrap()&&sessionProfile()&&acceptsMcp(discovered)){const tool=sessionTool(info,discovered);if(tool){authenticated.set(tool.execute,discovered.name);return tool}}'],
]);
await edit('t3','packages/provider-core/src/server/forgeGuard.ts',[
  ['if(JSON.stringify(names)!==JSON.stringify(["forge_frontend_selection_read"]))','if(JSON.stringify(names)!==JSON.stringify(["forge_frontend_selection_read"])&&JSON.stringify(names)!==JSON.stringify(["forge_sessions_session_children","forge_sessions_session_prompt"]))'],
]);
const base=new URL('../../app/session-tools/',import.meta.url),folder=path.join(root,'opencode/packages/core/src/forge-sessions');await mkdir(folder,{recursive:true});
async function add(file,bytes){await writeFile(file,bytes);additions.push({file:path.relative(root,file).replaceAll('\\','/'),sha256:sha(bytes)});}
for(const name of ['contract.mjs','native-tool.mjs']){
  let source=await readFile(new URL(name,base),'utf8');if(name==='contract.mjs')source=source.replace("'../guarded-runtime/profile.mjs'","'./profile.mjs'");await add(path.join(folder,name),source);
}
await add(path.join(folder,'profile.mjs'),await readFile(new URL('../../app/guarded-runtime/profile.mjs',import.meta.url)));
let runtime=await readFile(new URL('opencode-cli-runtime.ts',base),'utf8');
runtime=runtime.replace('FORGE_MCP_SDK_CLIENT',fileURLToPath(new URL('../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js',import.meta.url)).replaceAll('\\','/')).replace('FORGE_MCP_SDK_TRANSPORT',fileURLToPath(new URL('../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js',import.meta.url)).replaceAll('\\','/'));
await add(path.join(root,'opencode/packages/core/src/forge-sessions-runtime.ts'),runtime);
await writeFile(path.join(root,'session-patches.json'),JSON.stringify({version:1,purpose:'supervised-orchestrator-v1',changes,additions,proof:null},null,2));
console.log(JSON.stringify({generation:root,patches:changes.length,additions:additions.length,proof:null}));
