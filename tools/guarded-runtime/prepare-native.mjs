// Prepare only explicitly selected, isolated source trees. Never installed tools.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditUpstream} from '../../app/proactive-native/audit-upstream.mjs';
import {bytesDigest} from '../../app/guarded-runtime/profile.mjs';

export async function prepareNative({t3,opencode}){
  await auditUpstream({t3,opencode});
  const changes=[],pending=[];
  async function edit(root,file,transforms){
    const target=path.join(root,file),before=(await readFile(target,'utf8')).replace(/\r\n/g,'\n');let after=before;
    for(const [from,to] of transforms){if(after.split(from).length!==2)throw Error('PATCH_PREIMAGE: '+file);after=after.replace(from,to);}
    pending.push([target,after]);changes.push({source:root===t3?'t3':'opencode',file,before:bytesDigest(before),after:bytesDigest(after)});
  }
  async function add(root,target,source){
    const src=fileURLToPath(new URL('../../app/guarded-runtime/native/'+source,import.meta.url)),bytes=await readFile(src);pending.push([path.join(root,target),bytes]);changes.push({source:root===t3?'t3':'opencode',file:target,before:null,after:bytesDigest(bytes)});
  }
  await add(opencode,'packages/core/src/forge-guard.ts','opencode-guard.ts');
  await edit(opencode,'packages/core/src/tool/runtime.ts',[
    ['const formatEffectIssues =','import { assertTool } from "../forge-guard.js"\n\nconst formatEffectIssues ='],
    ['    const overrides = codemodeOverrides(tool, context.codemode === true)','    yield* assertTool("executor", effectiveName(tool), effectiveName(tool), tool, context)\n    const overrides = codemodeOverrides(tool, context.codemode === true)'],
  ]);
  await edit(opencode,'packages/core/src/tool.ts',[
    ['export * as Tool from','import { assertTool } from "./forge-guard.js"\n\nexport * as Tool from'],
    ['          const codeModeEnabled = codeModeAvailable(rules)','          const codeModeEnabled = false // FORGE derivative: no Code Mode or background executor'],
    ['            if (hidden?.has(name)) continue','            if (hidden?.has(name)) continue\n            if (Result.isFailure(yield* assertTool("discovery", name, name, tool, undefined).pipe(Effect.result))) continue'],
    ['      const event = yield* beforeExecute(name, tool, input, context)','      yield* assertTool("raw-nested", name, name, tool, context)\n      const event = yield* beforeExecute(name, tool, input, context)'],
    ['      return yield* executeTool(selected, event.tool, event.input, context)','      yield* assertTool("resolved-nested", name, event.tool, selected, context)\n      return yield* executeTool(selected, event.tool, event.input, context)'],
    ['              const event = yield* beforeExecute(input.call.name, initial, input.call.input, context)','              yield* assertTool("raw", input.call.name, initialName, initial, context)\n              const event = yield* beforeExecute(input.call.name, initial, input.call.input, context)'],
    ['              const name = requested?.name ?? event.tool','              const name = requested?.name ?? event.tool\n              yield* assertTool("resolved", input.call.name, name, direct.get(name), context)'],
    ['        if (whollyDisabled("execute", input.permissions)) {','        yield* assertTool("check", "execute", "execute", undefined, input.context)\n        if (whollyDisabled("execute", input.permissions)) {'],
  ]);
  // Block BEFORE the plugin's first discovery/read/watch/config expansion. This
  // does not assert complete context confinement; prompt itself refuses below.
  for(const name of ['instruction','agent'])await edit(opencode,`packages/core/src/config/plugin/${name}.ts`,[
    ['import { define }','import { denyContext } from "../../forge-guard.js"\nimport { define }'],
    ['  effect: Effect.fn(function* (ctx) {','  effect: Effect.fn(function* (ctx) {\n    yield* denyContext()'],
  ]);
  await edit(opencode,'packages/core/src/session/prompt.ts',[
    ['export * as SessionPrompt from','import { denyContext } from "../forge-guard.js"\n\nexport * as SessionPrompt from'],
    ['  input: Input\n}) {','  input: Input\n}) {\n  yield* denyContext()'],
  ]);
  await add(t3,'packages/provider-core/src/server/forgeGuard.ts','t3-guard.ts');
  // Internal source import is intentional: package export map is lead-owned.
  const core='../../../../provider-core/src/server/forgeGuard.ts';
  await edit(t3,'packages/provider-core/src/server/ProviderAdapter.ts',[
    ['  sandboxPolicy: Schema.optional(Schema.Unknown),','  sandboxPolicy: Schema.optional(Schema.Unknown),\n  forgeGuard: Schema.optional(Schema.Unknown),'],
  ]);
  await edit(t3,'apps/server/src/orchestration-v2/RuntimePolicy.ts',[
    ['import * as Context','import { resolveProfile } from "../../../../packages/provider-core/src/server/forgeGuard.ts";\nimport * as Context'],
    ['      runtimeMode: input.thread.runtimeMode,','      forgeGuard: resolveProfile(input.thread, input.modelSelection),\n      runtimeMode: input.thread.runtimeMode,'],
    ['          runtimeMode: providerRuntimeMode(input.thread.runtimeMode, supportedRuntimeModes),','          forgeGuard: resolveProfile(input.thread, input.modelSelection),\n          runtimeMode: providerRuntimeMode(input.thread.runtimeMode, supportedRuntimeModes),'],
  ]);
  await edit(t3,'packages/provider-opencode/src/server/v2/adapter.ts',[
    ['): ReadonlyArray<Rule> => [\n  ...(policy.runtimeMode','): ReadonlyArray<Rule> => [rule("*", "deny")];\n\n/* FORGE: upstream broad rules disabled in this unqualified derivative.\n  ...(policy.runtimeMode'],
    ['  ...mcpRules(mcpServerName),\n];','  ...mcpRules(mcpServerName),\n];\n*/'],
    ['      const mcpSession = yield* mcpSessions.read(turnInput.threadId);','      yield* Effect.sync(() => assertProfile(turnInput.runtimePolicy, "sendTurn", turnInput));\n      const mcpSession = yield* mcpSessions.read(turnInput.threadId);'],
    ['      const sessionID = Session.ID.make(sessionId);\n      const sending =','      yield* Effect.sync(() => assertProfile(turnInput.runtimePolicy, "submit", turnInput));\n      if (turnInput.message.attachments.length || turnInput.message.text.trim().startsWith("/")) return yield* Effect.die(new Error("FORGE_NATIVE_CONTEXT_UNQUALIFIED"));\n      const sessionID = Session.ID.make(sessionId);\n      const sending ='],
    ['      return yield* client.session\n        .prompt({','      yield* Effect.sync(() => assertProfile(turnInput.runtimePolicy, "final-sendTurn", turnInput));\n      return yield* client.session\n        .prompt({'],
    ['          yield* client.session\n            .prompt({','          yield* Effect.sync(() => assertProfile(turn.input.runtimePolicy, "steerTurn", steerInput));\n          yield* client.session\n            .prompt({'],
    ['        function* (threadInput) {\n          if (threadInput.existingProviderThread','        function* (threadInput) {\n          yield* Effect.sync(() => assertProfile(threadInput.runtimePolicy, "ensureThread", threadInput));\n          if (threadInput.existingProviderThread'],
    ['      resumeThread: Effect.fn("OpenCode2Adapter.resumeThread")(\n        function* (threadInput) {','      resumeThread: Effect.fn("OpenCode2Adapter.resumeThread")(\n        function* (threadInput) {\n          yield* Effect.sync(() => assertProfile(threadInput.runtimePolicy, "resumeThread", threadInput));'],
    ['      startTurn: Effect.fn("OpenCode2Adapter.startTurn")(\n        function* (turnInput) {','      startTurn: Effect.fn("OpenCode2Adapter.startTurn")(\n        function* (turnInput) {\n          yield* Effect.sync(() => assertProfile(turnInput.runtimePolicy, "startTurn", turnInput));'],
    ['      forkThread: Effect.fn("OpenCode2Adapter.forkThread")(\n        function* (forkInput) {','      forkThread: Effect.fn("OpenCode2Adapter.forkThread")(\n        function* (forkInput) {\n          yield* Effect.sync(() => assertProfile(forkInput.runtimePolicy, "forkThread", forkInput));'],
  ]);
  const adapter=pending.at(-1);adapter[1]=`import { assertProfile } from "${core}";\n`+adapter[1];changes.at(-1).after=bytesDigest(adapter[1]);
  // All source preimages and transformations validate before any writes.
  for(const [target,bytes] of pending)await writeFile(target,bytes);
  return {version:1,changes,proof:null,automaticExecutionQualified:false,blocker:'Native context/provenance transport and complete T3 host integration remain unqualified; model turns deliberately refuse.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await prepareNative({t3:process.argv[2],opencode:process.argv[3]});
  await writeFile(process.argv[4],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
