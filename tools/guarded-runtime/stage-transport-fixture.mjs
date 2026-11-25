// Portable staging of the actual delayed/lost native acknowledgement fixture.
// Run: node tools/guarded-runtime/stage-transport-fixture.mjs <repo> <new-temp-output-directory>
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const repo=process.argv[2],source=path.join(repo,'tools/guarded-runtime/cli-fixture.mjs'),sourceUrl=pathToFileURL(source),out=path.join(path.resolve(process.argv[3]??''),'transport-fixture.mjs');
if(!process.argv[3]||!path.isAbsolute(process.argv[3]))throw Error('ABSOLUTE_FIXTURE_OUTPUT_REQUIRED');
let text=(await readFile(source,'utf8')).replaceAll('\r\n','\n');
const change=(a,b)=>{if(text.split(a).length!==2)throw Error('FIXTURE_PREIMAGE '+a.slice(0,60));text=text.replace(a,b)};
text=text.replace(/from (['"])(\.[^'"]+)\1/g,(_m,q,p)=>'from '+q+new URL(p,sourceUrl).href+q);
text=text.replace(/new URL\('([^']+)',import.meta.url\)/g,(_m,p)=>'new URL('+JSON.stringify(new URL(p,sourceUrl).href)+')');
// Resolve the engineering driver's pinned dependencies without copying it into
// the immutable build cache. Only this unique disposable fixture root is written.
const driver=String.raw`const file=path.join(root,'t3-native-fixture.ts');
    let driverText=await readFile(fileURLToPath(new URL(DRIVER_URL_PLACEHOLDER)),'utf8');
    driverText=driverText.replaceAll('\r\n','\n').replace(/^import \* as [^\n]+\n/gm,'');
    driverText=driverText.replace('const {Adapter,Client,Server,resolveProfile}', 'const {Adapter,Client,Server,resolveProfile,Effect,Layer,Stream,Deferred,NodeServices,NodeHttpClient,NodeCrypto,IdAllocator,McpProviderSessions:Sessions,ProviderHost}');
    driverText=driverText.replace('const program=Effect.gen(function*(){', 'const denied=()=>Effect.fail(Error("ENGINEERING_HOST_OPERATION_DENIED"));\nconst nativeHost=ProviderHost.ProviderHost.of({paths:{cwd:boot.cwd,baseDir:boot.cwd,stateDir:boot.cwd,providerStatusCacheDir:boot.cwd,attachmentsDir:boot.cwd},settings:{get:denied(),withSnapshot:denied,changes:Stream.empty,subscribe:Effect.succeed(Stream.empty)},shouldRunBackgroundWork:()=>Effect.succeed(false),resolveAttachmentPath:()=>null,credentials:denied,compatibility:()=>Effect.succeed(undefined)});\nconst program=Effect.gen(function*(){');
    driverText=driverText.replace('Host.layer({cwd:boot.cwd})','Layer.succeed(ProviderHost.ProviderHost,nativeHost)');
    await writeFile(file,driverText,{flag:'wx'});`;
change("const file=path.join(cache,'t3/packages/provider-opencode/forge-native-fixture.ts');await copyFile(fileURLToPath(new URL("+JSON.stringify(new URL('./t3-native-fixture.ts',sourceUrl).href)+")),file);",driver.replace('DRIVER_URL_PLACEHOLDER',JSON.stringify(new URL('./t3-native-fixture.ts',sourceUrl).href)));
change("const cache=path.resolve(process.argv[2])","const mode=process.env.FORGE_TRANSPORT_FIXTURE_MODE??'delay';\nconst ownerReceipts=[],actionRequests=[],dropped=[];let bridgeProxy;\nconst cache=path.resolve(process.argv[2])");
change('withFence,authorize:()=>true});',"withFence,authorize:input=>!(mode==='policy'&&input.tool==='read_text'&&input.path==='allowed/a.txt'),recordReceipt:r=>{ownerReceipts.push(r);if(mode==='owner-lost'&&r.effect)throw Object.assign(Error('GUARDED_AUTHORITY_REVOKED'),{code:'GUARDED_AUTHORITY_REVOKED'});}});");
const proxy=String.raw`
  bridgeProxy=http.createServer(async(req,res)=>{
    try{
      let body='';for await(const chunk of req)body+=chunk;
      const value=JSON.parse(body),isAction=req.url==='/action',positive=isAction&&value.request?.path==='allowed/a.txt';
      if(positive)actionRequests.push({operationId:value.operationId,tool:value.request.tool});
      const upstream=await fetch(gateway.url+req.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:req.headers.authorization,...(req.headers['x-forge-mac']?{'X-Forge-Mac':req.headers['x-forge-mac']}:{})},body});
      const answer=await upstream.text();
      if(positive&&upstream.ok){
        if(mode==='delay')await new Promise(resolve=>setTimeout(resolve,6500));
        if(['drop','timeout'].includes(mode)&&value.request.tool==='edit_text'){
          const durable=broker.readReceipt(value.operationId);assert.equal(durable.status,'completed');assert.equal(durable.receipt.effect,true);
          dropped.push({tool:value.request.tool,status:durable.status});
          if(mode==='timeout')await new Promise(resolve=>setTimeout(resolve,31000));
          res.destroy();return;
        }
      }
      if(!res.destroyed){res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(answer);}
    }catch{res.destroy();}
  });
  await new Promise(resolve=>bridgeProxy.listen(0,'127.0.0.1',resolve));
  const bridgeProxyUrl='http://127.0.0.1:'+bridgeProxy.address().port;
`;
change('  const password=',proxy+'\n  const password=');
change('brokerUrl:gateway.url','brokerUrl:bridgeProxyUrl');
const assertions=String.raw`
  const positive=messages.data.flatMap(x=>x.content??[]).filter(x=>x.type==='tool'&&x.state.input?.path==='allowed/a.txt');
  assert.equal(positive.length,3);assert.equal(actionRequests.length,3);assert.equal(new Set(actionRequests.map(x=>x.operationId)).size,3);
  for(const tool of positive){
    const expectedUnknown=['drop','timeout','owner-lost'].includes(mode)&&tool.name==='forge_guarded_edit_text';
    const expectedDenied=mode==='policy'&&tool.name==='forge_guarded_read_text';
    assert.equal(tool.state.status,expectedUnknown||expectedDenied?'error':'completed');
    if(expectedUnknown)assert.equal(tool.state.error.message,'FORGE_BOUNDED_ACTION_OUTCOME_UNKNOWN');
    if(expectedDenied)assert.equal(tool.state.error.message,'FORGE_BOUNDED_ACTION_DENIED');
  }
  assert.equal(ownerReceipts.length,mode==='policy'?2:3);assert.equal(dropped.length,['drop','timeout'].includes(mode)?1:0);
  if(mode==='owner-lost'){
    const edit=ownerReceipts.find(r=>r.effect),durable=broker.readReceipt(edit.operationId);
    assert.equal(durable.status,'completed');assert.equal(durable.receipt.effect,true);
    assert.equal(await readFile(path.join(workspace,'allowed/a.txt'),'utf8'),'after');
  }
  const transportTruth={mode,positive:positive.map(x=>({name:x.name,status:x.state.status,error:x.state.error?.message??null})),actionRequests:actionRequests.length,uniqueOperationIds:new Set(actionRequests.map(x=>x.operationId)).size,localCompletedReceipts:ownerReceipts.length,editEffects:ownerReceipts.filter(r=>r.effect).length,droppedAfterCompleted:dropped.length,automaticRetries:0,artificialAcknowledgementDelayMs:mode==='delay'?6500:mode==='timeout'?31000:0};
`;
change('  const report={version:1,',assertions+'\n  const report={version:1,transportTruth,');
change("path.join(cache,'cli-fixture-report.json')","path.join("+JSON.stringify(path.dirname(out))+",'transport-'+mode+'-report.json')");
change("path.join(cache,'cli-fixture-last-log.txt')","path.join("+JSON.stringify(path.dirname(out))+",'transport-'+mode+'-last-log.txt')");
change('  if(gateway)await gateway.close();',"  if(bridgeProxy){bridgeProxy.closeAllConnections();await new Promise(resolve=>bridgeProxy.close(resolve));}\n  if(gateway)await gateway.close();");
await mkdir(path.dirname(out),{recursive:true});await writeFile(out,text,{flag:'wx'});console.log(JSON.stringify({stagedFixture:out,productionAuthorityUnchanged:true}));
