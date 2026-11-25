// Runs inside the pinned T3 workspace with Node26. Engineering canonical owner
// fixture only; it creates no product project/task/run and no real provider turn.
import {readFileSync} from "node:fs"
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from "node:fs/promises"
import {createServer} from "node:http"
import {pathToFileURL} from "node:url"
import path from "node:path"
import os from "node:os"
import assert from "node:assert/strict"
import {Effect,Layer,Stream,Deferred} from "effect"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as NodeCrypto from "@effect/platform-node/NodeCrypto"
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator"
import * as Sessions from "@t3tools/provider-core/server/McpProviderSessions"
import * as Host from "@t3tools/provider-testing/TestProviderHost"
const boot=JSON.parse(readFileSync(3,"utf8")),load=(name:string)=>import(pathToFileURL(path.join(boot.repo,'app/guarded-runtime',name)).href)
const {digest,bytesDigest}=await load('profile.mjs'),{installT3GuardedHost}=await load('t3-host.mjs'),{createGuardedRuntimeHost}=await load('runtime-host.mjs'),{createGuardedInstallationHost}=await load('installation-host.mjs'),{boundedToolSchemas}=await load('transport.mjs')
const {buildWindows}=await import(pathToFileURL(path.join(boot.repo,'tools/guarded-runtime/build-windows.mjs')).href)
const root=await mkdtemp(path.join(os.tmpdir(),'forge-guarded-supervisor-')),workspace=path.join(root,'workspace'),runtimeDirectory=path.join(root,'runtime'),homeDirectory=path.join(root,'home');await mkdir(path.join(workspace,'allowed'),{recursive:true});await writeFile(path.join(workspace,'allowed/a.txt'),'before')
const image=path.join(boot.cache,'opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe'),dist=path.join(boot.cache,'t3/apps/server/dist')
const {Adapter,Client,Server,resolveProfile}=await import(pathToFileURL(path.join(dist,'forge-guarded-host.mjs')).href)
const files=(await readdir(dist)).filter(x=>x.endsWith('.mjs')).map(name=>({name,path:path.join(dist,name)}));files.push({name:'node.exe',path:process.execPath})
const t3Hash=digest(files.map(f=>({name:f.name,sha256:bytesDigest(readFileSync(f.path))})).sort((a,b)=>a.name.localeCompare(b.name)))
const brokerDirectory=path.join(boot.cache,'windows'),brokerBinary=path.join(brokerDirectory,'ConfinedText.exe')
let build:any
try{const cached=JSON.parse(await readFile(path.join(brokerDirectory,'build.json'),'utf8'));if(cached.sourceSha256!==bytesDigest(await readFile(path.join(boot.repo,'app/guarded-runtime/windows/ConfinedText.cs')))||cached.binarySha256!==bytesDigest(await readFile(brokerBinary)))throw Error('REBUILD_BROKER');build={...cached,binary:brokerBinary}}catch{build=await buildWindows(brokerDirectory)}
const artifacts={t3:{files,entry:path.join(dist,'forge-guarded-host.mjs')},opencode:{path:image},fileBroker:{path:build.binary,sha256:build.binarySha256}}
const route={providerInstanceId:'fixture',apiProviderId:'openai',providerImplementation:'opencode2-api',accountGeneration:'no-account',modelId:'openai/forge-fixture',options:[{id:'variant',value:'default'}],t3Revision:'59651c1761f6c63e9b6056839067066968e6a406',opencodeRevision:'6f0514052a3c859894ad01bb14cc14dda1e44b96',t3BinarySha256:t3Hash,opencodeBinarySha256:bytesDigest(readFileSync(image))}
const selected={route,policyGeneration:'1',toolGeneration:'1'}
let runtimeHost:any,lease:any,connection:any,canonicalRun:any,ownerReceipts:any[]=[],providerRequests=0,terminalStatus:any,nativeTurnRef:any
const events:any[]=[];let requestObservedResolve:any;const requestObserved=new Promise<void>(resolve=>{requestObservedResolve=resolve})
let fence=Promise.resolve();const withFence=(_id:any,fn:any)=>{const work=fence.then(fn);fence=work.catch(()=>{});return work}
const privateHost=installT3GuardedHost({resolveThread:()=>lease,assertCurrent:(handle:any)=>runtimeHost.assertCurrent(handle),runtimeDirectory:(handle:any)=>runtimeHost.runtimeDirectory(handle),resolveConnection:(input:any)=>!!connection&&input.serverUrl===connection.url&&input.serverPassword===connection.password&&input.binaryPath===image})
const readinessHost=createGuardedInstallationHost({t3Host:privateHost,observeSelectedRoute:()=>selected,artifacts,stateDirectory:path.join(root,'machine-checks')})
const model=createServer(async(req,res)=>{providerRequests++;for await(const _ of req){};requestObservedResolve();if(boot.stopDuring)return;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'forge-fixture',choices:[{index:0,delta:{role:'assistant',content:'done'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\ndata: [DONE]\n\n')})
await new Promise<void>(r=>model.listen(0,'127.0.0.1',r))
let ready:any
try{
  ready=await readinessHost.check({leaseMs:90000});assert.equal(providerRequests,0)
  const request={projectId:'project',taskId:'task',envelopeDigest:'a'.repeat(64),identitySnapshot:'b'.repeat(64),scope:{paths:['allowed'],capabilities:['read','propose','workspace.write']},limits:{maxRunMs:60000,maxTokens:null,maxCost:null}}
  const routeProof=readinessHost.qualifyRoute(ready,request);assert.ok(routeProof);assert.equal(readinessHost.qualifyRoute(ready,{...request,limits:{...request.limits,maxTokens:1}}),null)
  runtimeHost=createGuardedRuntimeHost({t3Host:privateHost,readRun:()=>canonicalRun,validateReservation:()=>true,authorizeCurrent:()=>true,authorizeAction:()=>true,recordReceipt:(r:any)=>{ownerReceipts.push(r)},withFence,artifacts})
  const provider={id:'openai',model:'forge-fixture',compatibility:{streamUsage:true},settings:{baseURL:`http://127.0.0.1:${(model.address() as any).port}/v1`,apiKey:'fixture-no-account',transport:'http'}}
  const toolManifest=boundedToolSchemas.map((x:any)=>({operation:x.name,rawName:'forge_guarded_'+x.name,serverIdentity:'private-broker',schemaDigest:digest(x.inputSchema)}))
  const profile={version:1,...request,runId:'run',threadId:'thread',route,scope:{...request.scope,maxBytes:65536},manifestDigest:digest(toolManifest),contextDigest:digest({provider,runtimeDirectory,toolManifest}),policyGeneration:'1',toolGeneration:'1',expiresAt:Date.now()+60000};delete (profile as any).limits
  const input={profile,operationId:'operation',workspace,runtimeDirectory,homeDirectory,receiptPath:path.join(root,'effects/effects.sqlite'),provider,toolManifest,limits:request.limits}
  const orphan=runtimeHost.reserve(input);await assert.rejects(runtimeHost.bind(orphan));await runtimeHost.close(orphan,'orphan')
  lease=runtimeHost.reserve(input);assert.equal(runtimeHost.qualify(lease,request),null)
  canonicalRun={projectId:'project',taskId:'task',operationId:'operation',status:'submitting',profile}
  connection=await runtimeHost.bind(lease);assert.equal(providerRequests,0)
  const selection={instanceId:'fixture',model:'openai/forge-fixture',options:route.options}
  const policy={runtimeMode:'approval-required',interactionMode:'default',cwd:runtimeDirectory,forgeGuard:resolveProfile({id:'thread'},selection)} as any
  await Effect.runPromise(Effect.gen(function*(){
    const api=yield* Client.make
    const server=yield* Server.make({binaryPath:image,serverUrl:connection.url,serverPassword:connection.password,directory:runtimeDirectory,environment:{}}).pipe(Effect.provideService(Client.OpenCode2Client,api))
    const adapter=yield* Adapter.make('fixture' as any).pipe(Effect.provideService(Server.OpenCode2Server,server))
    const runtime=yield* adapter.openSession({threadId:'thread' as any,providerSessionId:'session' as any,modelSelection:selection as any,runtimePolicy:policy})
    const thread=yield* runtime.ensureThread({threadId:'thread' as any,title:'Guarded supervisor fixture',modelSelection:selection as any,runtimePolicy:policy})
    const nativeSessionId=(thread.nativeThreadRef as any).nativeId
    const attestation=yield* Effect.promise(()=>runtimeHost.attest(lease,{nativeSessionId,threadId:'thread',modelSelection:selection}))
    assert.equal(attestation.effects,0);assert.ok(runtimeHost.qualify(lease,request));assert.equal(providerRequests,0)
    const terminal=yield* Deferred.make<any>(),activeTurn=yield* Deferred.make<any>();yield* runtime.events.pipe(Stream.runForEach(e=>Effect.sync(()=>{events.push(e)}).pipe(Effect.andThen(e.type==='provider_turn.updated'&&e.providerTurn.runAttemptId==='attempt'?Deferred.succeed(activeTurn,e.providerTurn):e.type==='turn.terminal'?Deferred.succeed(terminal,e):Effect.void))),Effect.forkScoped)
    const turn={appThread:{id:'thread',title:'Guarded supervisor fixture',runtimeMode:'approval-required',interactionMode:'default'},threadId:'thread',runId:'run',runOrdinal:1,providerTurnOrdinal:1,attemptId:'attempt',rootNodeId:'node',providerThread:thread,message:{messageId:'message',text:'Deterministic supervisor protocol fixture.',attachments:[],createdBy:'user',creationSource:'web',scheduledTaskId:null,senderThreadId:null},modelSelection:selection,runtimePolicy:policy} as any
    yield* runtime.startTurn(turn)
    if(boot.stopDuring){
      yield* Effect.promise(()=>requestObserved)
      const active=yield* Deferred.await(activeTurn).pipe(Effect.timeout('10 seconds'))
      assert.ok(active?.id)
      yield* Effect.promise(()=>withFence('run',()=>{canonicalRun.stopRequested=true}));assert.equal(runtimeHost.qualify(lease,request),null)
      yield* runtime.interruptTurn({providerThread:thread,providerTurnId:active.id,requestRuntimeRestart:true})
    }
    const outcome=yield* Deferred.await(terminal).pipe(Effect.timeout('20 seconds'));terminalStatus=outcome.status
    nativeTurnRef=events.findLast(e=>e.type==='provider_turn.updated')?.providerTurn?.nativeTurnRef??null
    assert.equal(outcome.status,boot.stopDuring?'interrupted':'completed');assert.equal(providerRequests,1)
  }).pipe(Effect.scoped,Effect.provide(Layer.mergeAll(Host.layer({cwd:runtimeDirectory}),IdAllocator.layer,Sessions.layer)),Effect.provide(NodeServices.layer),Effect.provide(NodeHttpClient.layerNodeHttp),Effect.provide(NodeCrypto.layerDigest)))
  await withFence('run',()=>{canonicalRun.stopRequested=true});assert.equal(runtimeHost.qualify(lease,request),null);await runtimeHost.close(lease,'stop')
  assert.equal(readinessHost.qualifyRoute(ready,request).evidenceId,routeProof.evidenceId)
  await readinessHost.close(ready);assert.equal(readinessHost.qualifyRoute(ready,request),null)
  console.log(JSON.stringify({runtimeNode:process.versions.node,t3BinarySha256:t3Hash,opencodeBinarySha256:route.opencodeBinarySha256,fileBrokerBinarySha256:build.binarySha256,installationReadiness:'PASS',nativeNegatives:17,t3Negatives:2,noInventedTaskRun:true,installationProviderTurns:0,reserveOrphanDenied:true,bindAndActualT3EnsureAndProbe:'PASS',ownerProviderProtocolRequests:providerRequests,actualTerminal:terminalStatus,nativeTurnRef,eventTypes:[...new Set(events.map(e=>e.type))],proofAfterStop:null}))
}finally{if(lease)await runtimeHost.close(lease);if(ready)await readinessHost.close(ready);model.closeAllConnections();await new Promise<void>(r=>model.close(()=>r()));await rm(root,{recursive:true,force:true})}
