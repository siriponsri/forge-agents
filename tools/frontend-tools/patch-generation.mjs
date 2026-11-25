// Apply ONLY to a new generation made by clone-generation.mjs. All preimages
// are checked against the retained cache and recorded; installed/cache untouched.
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const generation = path.resolve(process.argv[2]), meta = JSON.parse(await readFile(path.join(generation, 'generation.json'), 'utf8'));
if (meta.root !== generation || !path.basename(generation).startsWith('forge-frontend-generation-') || generation === meta.cache) throw Error('NEW_GENERATION_REQUIRED');
const changes = [], sha = b => createHash('sha256').update(b).digest('hex');
let previous; try { previous = JSON.parse(await readFile(path.join(generation, 'frontend-patches.json'), 'utf8')); } catch {}
async function edit(tree, file, transforms) {
  const target = path.join(generation, tree, file);
  if (!(await realpath(target)).startsWith(generation + path.sep)) throw Error('PATCH_OUTSIDE_NEW_GENERATION');
  const current = (await readFile(target, 'utf8')).replace(/\r\n/g, '\n');
  const original = (await readFile(path.join(meta.cache, tree, file), 'utf8')).replace(/\r\n/g, '\n');
  if (current !== original && sha(current) !== previous?.changes.find(x => x.tree === tree && x.file === file)?.after) throw Error('GENERATION_SOURCE_CHANGED');
  let after = original;
  for (const [from, to] of transforms) { if (after.split(from).length !== 2) throw Error('PATCH_SEAM_CHANGED: ' + file + ': ' + from.slice(0, 70)); after = after.replace(from, to); }
  await writeFile(target, after); changes.push({ tree, file, before: sha(original), after: sha(after) });
}
const boot = 'packages/core/src/forge-bootstrap.ts';
await edit('opencode', boot, [
  ['  return {model:{providerID:b.provider.id,model:b.provider.model}', '  if(frontendProfile()) return {model:{providerID:b.provider.id,model:b.provider.model},providers:{[b.provider.id]:{name:"FORGE supervised frontend",package:"@opencode/ai/providers/openai/chat",compatibility:b.provider.compatibility,settings:b.provider.settings,models:{[b.provider.model]:{name:b.provider.model,type:"chat",limit:{context:16000,output:4000},capabilities:{tools:true,input:["text"],output:["text"]}}}}},permissions:[{action:"*",resource:"*",effect:"deny"},{action:"forge_frontend_selection_read",resource:"*",effect:"allow"}],mcp:{servers:{forge_frontend:{type:"remote",url:b.brokerUrl+"/mcp",oauth:false,codemode:false,protocol:"legacy",headers:{Authorization:"Bearer "+b.key}}}}}\n  return {model:{providerID:b.provider.id,model:b.provider.model}'],
  ['export function acceptsMcp(discovered:any){const b=current();return', 'export const frontendProfile=()=>current().profile.purpose==="supervised-frontend-v1"\nexport function frontendBinding(ctx:any){if(!frontendProfile())throw Error("FRONTEND_PROFILE_REQUIRED");return call("/frontend-binding",{profileDigest:hash(current().profile),sessionId:ctx.sessionID,callId:ctx.id,messageId:ctx.messageID})}\nexport function acceptsMcp(discovered:any){const b=current();if(frontendProfile())return discovered.server==="forge_frontend"&&discovered.name==="selection_read"&&b.toolManifest.some((x:any)=>x.operation===discovered.name&&x.rawName==="forge_frontend_selection_read"&&x.schemaDigest===hash(discovered.inputSchema));return'],
]);
await edit('opencode', 'packages/core/src/forge-guard.ts', [
  ['import { Effect } from "effect"', 'import { Effect } from "effect"\nimport { frontendTool } from "./forge-frontend-runtime.js"\nimport { frontendProfile } from "./forge-bootstrap.js"'],
  ['rawName!=="forge_guarded_"+operation', 'rawName!==(frontendProfile()?"forge_frontend_":"forge_guarded_")+operation'],
  ['export function trustedMcp(info:any,discovered:any){', 'export function trustedMcp(info:any,discovered:any){\n  if(hasBootstrap()&&frontendProfile()&&acceptsMcp(discovered)){const tool=frontendTool(info,discovered);if(tool){authenticated.set(tool.execute,discovered.name);return tool}}'],
]);
const base = new URL('../../app/frontend-tools/', import.meta.url);
const folder = path.join(generation, 'opencode/packages/core/src/forge-frontend'); await mkdir(folder, { recursive: true });
for (const name of ['contract.mjs', 'native-tool.mjs']) await writeFile(path.join(folder, name), await readFile(new URL(name, base)));
let runtime = await readFile(new URL('opencode-cli-runtime.ts', base), 'utf8');
runtime = runtime.replace('FORGE_MCP_SDK_CLIENT', fileURLToPath(new URL('../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js', import.meta.url)).replaceAll('\\', '/')).replace('FORGE_MCP_SDK_TRANSPORT', fileURLToPath(new URL('../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js', import.meta.url)).replaceAll('\\', '/'));
await writeFile(path.join(generation, 'opencode/packages/core/src/forge-frontend-runtime.ts'), runtime);
await edit('t3', 'packages/provider-core/src/server/forgeGuard.ts', [
  ['let host: Host | undefined', 'export function sessionToolNames(policy:{forgeGuard?:unknown}){const guarded=["forge_guarded_read_text","forge_guarded_propose_change","forge_guarded_edit_text"];const active=currentHost() as any;if(!active?.toolNames)return guarded;const handle=policy?.forgeGuard;if(!handle||typeof handle!=="object"||!profiles.has(handle))throw Error("FORGE_PRIVATE_TOOL_PROFILE_REQUIRED");const names=active.toolNames(handle);if(names===undefined)return guarded;if(JSON.stringify(names)!==JSON.stringify(["forge_frontend_selection_read"]))throw Error("FORGE_PRIVATE_TOOL_PROFILE_REQUIRED");return names}\nlet host: Host | undefined'],
]);
await edit('t3', 'packages/provider-opencode/src/server/v2/adapter.ts', [
  ['import { assertProfile }', 'import { assertProfile, sessionToolNames }'],
  ['"runtimeMode" | "interactionMode"\n>;', '"runtimeMode" | "interactionMode" | "forgeGuard"\n>;'],
  ['...["read_text", "propose_change", "edit_text"].map(name => rule(`forge_guarded_${name}`, "allow"))', '...sessionToolNames(policy).map((name:string) => rule(name, "allow"))'],
]);
await writeFile(path.join(generation, 'frontend-patches.json'), JSON.stringify({ version: 1, changes, nativeSourcesAdded: ['forge-frontend-runtime.ts', 'forge-frontend/contract.mjs', 'forge-frontend/native-tool.mjs'], proof: null }, null, 2));
console.log(JSON.stringify({ generation, patches: changes.length, proof: null }));
