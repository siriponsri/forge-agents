// Prepare only explicitly selected, isolated source trees. Never installed tools.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditUpstream} from '../../app/proactive-native/audit-upstream.mjs';
import {bytesDigest} from '../../app/guarded-runtime/profile.mjs';

export async function prepareNative({t3,opencode}){
  await auditUpstream({t3,opencode});
  const locked=JSON.parse(await readFile(new URL('../../app/guarded-runtime/native/patch-inputs.json',import.meta.url),'utf8'));
  const changes=[],pending=[];
  async function edit(root,file,transforms){
    const target=path.join(root,file),before=(await readFile(target,'utf8')).replace(/\r\n/g,'\n');let after=before;
    if(bytesDigest(before)!==locked.sources[root===t3?'t3':'opencode'][file])throw Error('PATCH_SOURCE_CHANGED: '+file);
    for(const [from,to] of transforms){if(after.split(from).length!==2)throw Error('PATCH_PREIMAGE: '+file);after=after.replace(from,to);}
    pending.push([target,after]);changes.push({source:root===t3?'t3':'opencode',file,before:bytesDigest(before),after:bytesDigest(after)});
  }
  async function add(root,target,source){
    const src=fileURLToPath(new URL('../../app/guarded-runtime/native/'+source,import.meta.url)),bytes=await readFile(src);pending.push([path.join(root,target),bytes]);changes.push({source:root===t3?'t3':'opencode',file:target,before:null,after:bytesDigest(bytes)});
  }
  await add(opencode,'packages/core/src/forge-guard.ts','opencode-guard.ts');
  await add(opencode,'packages/core/src/forge-bootstrap.ts','opencode-bootstrap.ts');
  await add(opencode,'packages/server/src/forge-attest.ts','opencode-attest.ts');
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
  // Native context/config has no workspace/global sources in guarded mode.
  for(const name of ['instruction','agent','skill','command'])await edit(opencode,`packages/core/src/config/plugin/${name}.ts`,[
    ['  effect: Effect.fn(function* (ctx) {','  effect: Effect.fn(function* (ctx) {\n    return // FORGE: no filesystem/URL/config instruction expansion'],
  ]);
  await edit(opencode,'packages/core/src/session/prompt.ts',[
    ['export * as SessionPrompt from','import { assertSession } from "../forge-guard.js"\n\nexport * as SessionPrompt from'],
    ['  input: Input\n}) {','  input: Input\n}) {\n  yield* assertSession("prompt", request.session.id)\n  if (request.input.files?.length || request.input.skills?.length || request.input.agents?.length) return yield* Effect.die(new Error("FORGE_NATIVE_CONTEXT_DENIED"))'],
  ]);
  const configOriginal=(await readFile(path.join(opencode,'packages/core/src/config.ts'),'utf8')).replace(/\r\n/g,'\n');
  const configured=configOriginal.slice(configOriginal.indexOf('export function configured(options?: Options) {'),configOriginal.indexOf('\nexport const node = configured()'));
  await edit(opencode,'packages/core/src/config.ts',[
    ['export * as Config from','import { privateConfig } from "./forge-guard.js"\n\nexport * as Config from'],
    [configured,'export function configured(_options?: Options) {\n  return makeLocationNode({service:Service,layer:Layer.succeed(Service,Service.of({entries:()=>Effect.sync(()=>[new Document({type:"document",info:new Info(privateConfig())})]),compatibility:()=>Effect.succeed({claude:[],agents:[]}),changes:()=>Stream.empty})),deps:[]})\n}'],
  ]);
  await edit(opencode,'packages/core/src/plugin/module.ts',[
    ['        const version = operation.target.lastIndexOf("@")','        return { blocked: true as const } // FORGE: no external plugin/module imports\n        const version = operation.target.lastIndexOf("@")'],
  ]);
  await edit(opencode,'packages/core/src/mcp/index.ts',[
    ['          yield* attach(ServerName.make(client), transport)','          return yield* Effect.die(new Error("FORGE_ALTERNATE_MCP_DENIED"))\n          yield* attach(ServerName.make(client), transport)'],
  ]);
  await edit(opencode,'packages/core/src/tool/mcp.ts',[
    ['export * as McpTool from','import { trustedMcp } from "../forge-guard.js"\n\nexport * as McpTool from'],
    ['              editor.add({','              editor.add(trustedMcp({'],
    ['              })\n            }\n          })','              }, tool))\n            }\n          })'],
  ]);
  const contextOriginal=(await readFile(path.join(opencode,'packages/core/src/session/context.ts'),'utf8')).replace(/\r\n/g,'\n');
  const loaded=contextOriginal.slice(contextOriginal.indexOf('      const loaded = yield* Effect.all('),contextOriginal.indexOf('\n      return {\n        session,\n        agent:'));
  await edit(opencode,'packages/core/src/session/context.ts',[
    ['export * as SessionContext from','import { assertSession, assertCachedContext } from "../forge-guard.js"\n\nexport * as SessionContext from'],
    ['    const selectTitle = Effect.fn("SessionContext.selectTitle")(function* (session: SessionSchema.Info) {','    const selectTitle = Effect.fn("SessionContext.selectTitle")(function* (session: SessionSchema.Info) {\n      return undefined // FORGE: no auxiliary inference'],
    ['    const select = Effect.fn("SessionContext.select")(function* (sessionID: SessionSchema.ID) {','    const select = Effect.fn("SessionContext.select")(function* (sessionID: SessionSchema.ID) {\n      yield* assertSession("context-select", sessionID)'],
    ['      if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))','      if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))\n      yield* assertCachedContext(session)'],
    [loaded,'      const loaded = {builtins:[],discovery:[],skills:[],references:[],mcp:[],machines:[],entries:[]}'],
    ['    const load = Effect.fn("SessionContext.load")(function* (selection: Selection) {','    const load = Effect.fn("SessionContext.load")(function* (selection: Selection) {\n      yield* assertSession("context-load", selection.session.id)'],
  ]);
  await edit(opencode,'packages/core/src/session/model-request.ts',[
    ['export * as SessionModelRequest from','import { assertSession, assertModel } from "../forge-guard.js"\n\nexport * as SessionModelRequest from'],
    ['      const session = input.session\n      const model = input.model','      if (kind !== "primary") return yield* Effect.die(new Error("FORGE_AUXILIARY_INFERENCE_DENIED"))\n      yield* assertSession("model-request", input.session.id)\n      yield* assertModel(input.model.ref)\n      const session = input.session\n      const model = input.model'],
  ]);
  await edit(opencode,'packages/core/src/session.ts',[
    ['export * as Session from','import { assertCreate, assertCachedContext, sealMetadata } from "./forge-guard.js"\n\nexport * as Session from'],
    ['      create: Effect.fn("Session.create")(function* (input) {','      create: Effect.fn("Session.create")(function* (input) {\n        yield* assertCreate(input)'],
    ['              metadata: input.metadata ?? parent?.metadata,','              metadata: sealMetadata(input.metadata ?? parent?.metadata),'],
    ['      fork: Effect.fn("Session.fork")(function* (input) {\n        const parent = yield* result.get(input.sessionID)','      fork: Effect.fn("Session.fork")(function* (input) {\n        const parent = yield* result.get(input.sessionID)\n        yield* assertCachedContext(parent)'],
  ]);
  await edit(opencode,'packages/server/src/routes.ts',[
    ['import { Database }','import { probe as forgeProbe } from "./forge-attest"\nimport { bootstrapObservation } from "@opencode/core/forge-bootstrap"\nimport { Location } from "@opencode/core/location"\nimport { AbsolutePath } from "@opencode/schema/schema"\nimport { Database }'],
    ['        Layer.tap((context) =>\n          Effect.sync','        Layer.tap((context) => {\n          const router = Context.get(context, HttpRouter.HttpRouter)\n          const locations = Context.get(context, LocationServiceMap.Service)\n          const ref = Location.Ref.make({directory:AbsolutePath.make(bootstrapObservation().runtimeDirectory)})\n          return router.add("POST", "/api/forge/attest", forgeProbe.pipe(Effect.provide(locations.get(ref))))\n        }),\n        Layer.tap((context) =>\n          Effect.sync'],
  ]);
  await add(t3,'packages/provider-core/src/server/forgeGuard.ts','t3-guard.ts');
  await add(t3,'apps/server/src/forge-guarded-host.ts','t3-host-entry.ts');
  await edit(t3,'apps/server/vite.config.ts',[
    ['["src/bin.ts", "src/claude-history-worker.ts"]','["src/bin.ts", "src/claude-history-worker.ts", "src/forge-guarded-host.ts"]'],
  ]);
  // Internal source import is intentional: package export map is lead-owned.
  const core='../../../../provider-core/src/server/forgeGuard.ts';
  await edit(t3,'packages/provider-core/src/server/ProviderAdapter.ts',[
    ['  sandboxPolicy: Schema.optional(Schema.Unknown),','  sandboxPolicy: Schema.optional(Schema.Unknown),\n  forgeGuard: Schema.optional(Schema.Unknown),'],
  ]);
  await edit(t3,'apps/server/src/orchestration-v2/RuntimePolicy.ts',[
    ['import * as Context','import { resolveProfile, runtimeDirectoryFor } from "../../../../packages/provider-core/src/server/forgeGuard.ts";\nimport * as Context'],
    ['    return Effect.succeed({\n      runtimeMode: input.thread.runtimeMode,','    const forgeGuard = resolveProfile(input.thread, input.modelSelection);\n    return Effect.succeed({\n      forgeGuard,\n      runtimeMode: input.thread.runtimeMode,'],
    ['      cwd: input.thread.worktreePath,','      cwd: runtimeDirectoryFor(forgeGuard),'],
    ['        return ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({\n          runtimeMode:','        const forgeGuard = resolveProfile(input.thread, input.modelSelection);\n        return ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({\n          forgeGuard,\n          runtimeMode:'],
    ['          cwd,\n          ...(maxRuntimeMode','          cwd: runtimeDirectoryFor(forgeGuard),\n          ...(maxRuntimeMode'],
  ]);
  await edit(t3,'packages/provider-opencode/src/server/v2/OpenCode2Server.ts',[
    ['import { resolveProviderProbeTimeoutMs }','import { assertConnection } from "../../../../provider-core/src/server/forgeGuard.ts";\nimport { resolveProviderProbeTimeoutMs }'],
    ['  const opencode = yield* OpenCode2Client.OpenCode2Client;','  yield* Effect.try({try: () => assertConnection(input), catch: () => new OpenCodeRuntime.OpenCodeRuntimeError({operation:"guarded.connection",detail:"FORGE_PRIVATE_NATIVE_CONNECTION_REQUIRED"})});\n  const opencode = yield* OpenCode2Client.OpenCode2Client;'],
  ]);
  await edit(t3,'packages/provider-opencode/src/server/v2/adapter.ts',[
    ['        const scope = yield* Scope.make();\n        yield* Effect.addFinalizer','        yield* Effect.sync(() => assertProfile(input.runtimePolicy, "openSession", input));\n        const scope = yield* Scope.make();\n        yield* Effect.addFinalizer'],
    ['): ReadonlyArray<Rule> => [\n  ...(policy.runtimeMode','): ReadonlyArray<Rule> => [rule("*", "deny"), ...["read_text", "propose_change", "edit_text"].map(name => rule(`forge_guarded_${name}`, "allow"))];\n\n/* FORGE: upstream broad rules disabled.\n  ...(policy.runtimeMode'],
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
  const adapter=pending.at(-1);adapter[1]=`import { assertProfile } from "${core}";\n`+adapter[1];
  adapter[1]=adapter[1].replace(/Effect\.sync\(\(\) => assertProfile\(([^;\n]+)\)\)/g,'Effect.try({try: () => assertProfile($1), catch: () => new ProviderAdapter.ProviderAdapterProtocolError({driver:OPENCODE_PROVIDER,detail:"FORGE_PRIVATE_PROFILE_REQUIRED"})})');
  changes.at(-1).after=bytesDigest(adapter[1]);
  // All source preimages and transformations validate before any writes.
  for(const [target,bytes] of pending)await writeFile(target,bytes);
  return {version:1,changes,proof:null,automaticExecutionQualified:false,blocker:'Source preparation never installs private runtime authority. Package activation and canonical orchestration/projection integration require the live installation and exact-run gates.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await prepareNative({t3:process.argv[2],opencode:process.argv[3]});
  await writeFile(process.argv[4],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({patchedFiles:result.changes.length,proof:result.proof,automaticExecutionQualified:false}));
}
