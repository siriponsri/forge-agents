import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm,link,symlink,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,createHmac} from 'node:crypto';
import {buildWindows} from '../tools/guarded-runtime/build-windows.mjs';
import {openConfinedText} from '../app/guarded-runtime/windows-client.mjs';
import {createProfileAuthority,digest,bytesDigest} from '../app/guarded-runtime/profile.mjs';
import {createBoundedBroker,signRequest,inspectGuardedReceipt,inspectGuardedOperations} from '../app/guarded-runtime/broker.mjs';
import {createNativeGate,qualifyGuardedRuntime} from '../app/guarded-runtime/gate.mjs';
import {openLocalGateway} from '../app/guarded-runtime/local-gateway.mjs';
import {canonical} from '../app/guarded-runtime/profile.mjs';

export function profile(){
  const hash='a'.repeat(64);
  return {version:1,projectId:'project',taskId:'task',runId:'run',threadId:'thread',envelopeDigest:hash,identitySnapshot:hash,scope:{paths:['allowed'],capabilities:['read','propose','workspace.write'],maxBytes:65536},route:{providerInstanceId:'fixture-only',apiProviderId:'fixture-api',providerImplementation:'opencode2-api',accountGeneration:'no-account',modelId:'no-model-turn',options:{},t3Revision:'59651c1761f6c63e9b6056839067066968e6a406',opencodeRevision:'6f0514052a3c859894ad01bb14cc14dda1e44b96',t3BinarySha256:hash,opencodeBinarySha256:hash},policyGeneration:'1',toolGeneration:'1',manifestDigest:hash,contextDigest:hash,expiresAt:Date.now()+60000};
}
async function fixture(overrides={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'forge-guarded-fixture-'));
  const workspace=path.join(root,'workspace');await mkdir(path.join(workspace,'allowed'),{recursive:true});
  await writeFile(path.join(workspace,'allowed','a.txt'),'before');await writeFile(path.join(root,'outside.txt'),'OUTSIDE');
  const build=await buildWindows(path.join(root,'build'));
  const file=await openConfinedText({...build,root:workspace});
  let live={profile:profile(),stopped:false,revoked:false,runtimeMode:'approval-required',governanceAllowed:true};
  const authority=createProfileAuthority({readCurrent:()=>live}),handle=authority.bind(live.profile),key=randomBytes(32);
  const received=[];
  let stopPending=false;
  const authorize=()=>!stopPending;
  let fence=Promise.resolve();
  const withFence=(run,fn)=>{const next=fence.then(fn);fence=next.catch(()=>{});return next;};
  const options={authority,handle,key,file,receiptPath:path.join(root,'receipts.sqlite'),withFence,authorize,...overrides};
  let broker=createBoundedBroker(options);
  const request=(operationId,request,change={})=>signRequest(key,{version:1,runId:'run',operationId,request,...change});
  return {root,workspace,file,authority,handle,key,options,request,get live(){return live;},get broker(){return broker;},stop(){return withFence('run',()=>{live.stopped=true;});},setStopPending(){stopPending=true;},async restart(){await broker.close();const nextFile=await openConfinedText({...build,root:workspace});broker=createBoundedBroker({...options,file:nextFile});},async close(){await broker.close();await rm(root,{recursive:true,force:true});}};
}
const windows={skip:process.platform!=='win32'?'Native Windows broker requires Windows NTFS':false};

test('actual Windows read/proposal/revision edit, concurrent replay, lost ack, restart and Stop',windows,async()=>{
  const f=await fixture();try{
    const read=f.request('read',{tool:'read_text',path:'allowed/a.txt'});
    const r=await f.broker.receive(read);assert.equal(r.text,'before');
    const proposal=await f.broker.receive(f.request('propose',{tool:'propose_change',path:'allowed/a.txt',expectedRevision:r.revision,text:'proposed'}));
    assert.equal(proposal.effect,false);assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'before');
    const edit=f.request('edit',{tool:'edit_text',path:'allowed/a.txt',expectedRevision:r.revision,text:'after'});
    const values=await Promise.all([f.broker.receive(edit),f.broker.receive(edit)]);assert.deepEqual(values.map(x=>x.replayed),[false,true]);
    assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'after');
    await f.restart();assert.equal((await f.broker.receive(edit)).replayed,true); // lost ack exact receipt, no write
    await assert.rejects(f.broker.receive(f.request('edit',{...edit.request,text:'collision'})),{code:'OPERATION_COLLISION'});
    await f.stop();await assert.rejects(f.broker.receive(f.request('stopped',{tool:'read_text',path:'allowed/a.txt'})),{code:'PROFILE_REVOKED'});
  }finally{await f.close();}
});

test('actual confined handles reject outside, ADS, junction, hardlink and revision attacks without outside effects',windows,async()=>{
  const f=await fixture();try{
    for(const p of ['../outside.txt','allowed/../../outside.txt','C:/outside','allowed/a.txt:stream','allowed/CON','allowed/a.txt.','/outside','allowed\\a.txt','allowed//a.txt']){
      await assert.rejects(f.broker.receive(f.request('bad'+Math.random().toString().slice(2),{tool:'read_text',path:p})),{code:'PATH_DENIED'});
    }
    await symlink(f.root,path.join(f.workspace,'allowed/junction'),'junction');
    await assert.rejects(f.broker.receive(f.request('junction',{tool:'read_text',path:'allowed/junction/outside.txt'})));
    await link(path.join(f.root,'outside.txt'),path.join(f.workspace,'allowed/hard.txt'));
    await assert.rejects(f.broker.receive(f.request('hard',{tool:'edit_text',path:'allowed/hard.txt',expectedRevision:bytesDigest('OUTSIDE'),text:'bad'})),{code:'UNSAFE_FILE'});
    await assert.rejects(f.broker.receive(f.request('stale',{tool:'edit_text',path:'allowed/a.txt',expectedRevision:'a'.repeat(64),text:'bad'})),{code:'REVISION_CHANGED'});
    assert.equal(await readFile(path.join(f.root,'outside.txt'),'utf8'),'OUTSIDE');assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'before');
  }finally{await f.close();}
});

test('handle-relative preparation pins directories and file through attempted replacement',windows,async()=>{
  const f=await fixture();try{
    const held=await f.file.command({op:'prepare',path:'allowed/a.txt',write:true,maxBytes:65536});
    await assert.rejects(rename(path.join(f.workspace,'allowed'),path.join(f.workspace,'old')));
    await assert.rejects(rename(path.join(f.workspace,'allowed/a.txt'),path.join(f.workspace,'allowed/old.txt')));
    await assert.rejects(writeFile(path.join(f.workspace,'allowed/a.txt'),'raced'));
    await assert.rejects(link(path.join(f.workspace,'allowed/a.txt'),path.join(f.root,'raced-hardlink.txt')));
    await f.file.command({op:'commit',ticket:held.ticket,expectedRevision:held.revision,text:'safe'});
    assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'safe');
    assert.equal(await readFile(path.join(f.root,'outside.txt'),'utf8'),'OUTSIDE');
  }finally{await f.close();}
});

test('transport identity/schema/expiry/current profile/current governance failures have zero file effects',windows,async()=>{
  const f=await fixture();try{
    const request={tool:'edit_text',path:'allowed/a.txt',expectedRevision:bytesDigest('before'),text:'bad'};
    await assert.rejects(f.broker.receive({...f.request('mac',request),mac:'0'.repeat(64)}),{code:'TRANSPORT_DENIED'});
    await assert.rejects(f.broker.receive(f.request('other',request,{runId:'other'})),{code:'TRANSPORT_DENIED'});
    for(const tool of ['shell','execute','t3_thread_send','read_text_alias','unknown','mcp_other_read_text'])await assert.rejects(f.broker.receive(f.request('tool'+tool,{...request,tool})),{code:'TOOL_DENIED'});
    for(const field of ['route','policyGeneration','toolGeneration','manifestDigest','contextDigest','identitySnapshot']){
      const old=f.live.profile[field];f.live.profile[field]=typeof old==='object'?{...old,accountGeneration:'swapped'}:'b'.repeat(64);
      await assert.rejects(f.broker.receive(f.request('swap'+field,request)));f.live.profile[field]=old;
    }
    const expiry=f.live.profile.expiresAt;f.live.profile.expiresAt=Date.now()-1;await assert.rejects(f.broker.receive(f.request('expired',request)),{code:'PROFILE_EXPIRED'});f.live.profile.expiresAt=expiry;
    f.live.governanceAllowed=false;await assert.rejects(f.broker.receive(f.request('governance',request)),{code:'PROFILE_REVOKED'});f.live.governanceAllowed=true;
    f.setStopPending();await assert.rejects(f.broker.receive(f.request('policy',request)),{code:'CANONICAL_ACTION_DENIED'});
    assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'before');
  }finally{await f.close();}
});

test('durable unknown outcome is never auto-replayed after a lost effect acknowledgement or restart',windows,async()=>{
  const f=await fixture();try{
    const original=f.options.file;
    // Separate ledger for injected transport failure; effect runs in the actual
    // native broker and its successful commit ack is deliberately discarded.
    const faulty=createBoundedBroker({...f.options,receiptPath:path.join(f.root,'lost.sqlite'),file:{close(){},async command(x){const r=await original.command(x);if(x.op==='commit')throw Error('LOST_ACK');return r;}}});
    const req=f.request('lost',{tool:'edit_text',path:'allowed/a.txt',expectedRevision:bytesDigest('before'),text:'once'});
    await assert.rejects(faulty.receive(req),{code:'OUTCOME_UNKNOWN'});await faulty.close();
    assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'once');
    const recovered=createBoundedBroker({...f.options,receiptPath:path.join(f.root,'lost.sqlite'),file:{...original,close(){}}});
    await assert.rejects(recovered.receive(req),{code:'OUTCOME_UNKNOWN'});await recovered.close();
    const unknown=inspectGuardedReceipt({receiptPath:path.join(f.root,'lost.sqlite'),runId:'run',operationId:'lost'});
    assert.equal(unknown.status,'unknown');assert.equal(unknown.receipt,null);assert.equal('text' in unknown,false);
    assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'once');
  }finally{await f.close();}
});

test('Stop arriving while native handles are being acquired fences the next effect',windows,async()=>{
  const f=await fixture();try{
    const file=f.options.file;
    const racing=createBoundedBroker({...f.options,receiptPath:path.join(f.root,'stop-race.sqlite'),file:{close(){},async command(x){const result=await file.command(x);if(x.op==='prepare')f.live.stopped=true;return result;}}});
    const req=f.request('stop-race',{tool:'edit_text',path:'allowed/a.txt',expectedRevision:bytesDigest('before'),text:'BAD'});
    await assert.rejects(racing.receive(req),{code:'PROFILE_REVOKED'});f.live.stopped=false;
    await assert.rejects(racing.receive(req),{code:'OUTCOME_UNKNOWN'});await racing.close();
    assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'before');
  }finally{await f.close();}
});

test('durable completed owner receipt survives callback lost acknowledgement without repeating the edit',windows,async()=>{
  let lost=true;const owner=new Map();
  const f=await fixture({recordReceipt(receipt){if(lost)throw Error('OWNER_LOST_ACK');owner.set(receipt.id,receipt);}});
  try{
    const req=f.request('owner-receipt',{tool:'edit_text',path:'allowed/a.txt',expectedRevision:bytesDigest('before'),text:'once'});
    await assert.rejects(f.broker.receive(req),{code:'OUTCOME_UNKNOWN'});
    assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'once');
    const durable=f.broker.readReceipt('owner-receipt');assert.equal(durable.status,'completed');
    assert.equal(durable.receipt.runId,'run');assert.equal(durable.receipt.afterRevision,bytesDigest('once'));
    assert.equal(durable.receipt.profileDigest,digest(f.live.profile));assert.equal(durable.receipt.effect,true);
    // A replay must retain its receipt while leaving subsequent file changes alone.
    await writeFile(path.join(f.workspace,'allowed/a.txt'),'subsequent');lost=false;
    assert.equal((await f.broker.receive(req)).replayed,true);await f.restart();
    assert.equal((await f.broker.receive(req)).replayed,true);assert.equal(owner.size,1);
    await f.stop();const recovery=inspectGuardedReceipt({receiptPath:f.options.receiptPath,runId:'run',operationId:'owner-receipt'});
    assert.equal(recovery.receipt.id,durable.receipt.id);assert.equal('text' in recovery,false);
    assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'subsequent');
  }finally{await f.close();}
});

test('uninstalled gate helper refuses raw aliases/nested/unknown/provenance swaps and never mints a proof',()=>{
  const p=profile();const entry={rawName:'forge_read_text',operation:'read_text',schemaDigest:'s',serverIdentity:'private-broker'};const manifest=[entry];p.manifestDigest=digest(manifest);
  const live={profile:p,runtimeMode:'approval-required',governanceAllowed:true};const authority=createProfileAuthority({readCurrent:()=>live}),handle=authority.bind(p);
  assert.throws(()=>authority.assert(structuredClone(handle)),{code:'PRIVATE_PROFILE_REQUIRED'});
  const gate=createNativeGate({authority,handle,manifest});const tool={name:'read_text'};
  gate.registerAuthenticated(tool,{...entry,authenticated:true,runId:p.runId,threadId:p.threadId,toolGeneration:p.toolGeneration,manifestDigest:p.manifestDigest});
  const action={rawName:entry.rawName,resolvedName:entry.rawName,tool,context:{sessionID:p.threadId}};
  assert.equal(gate.assert(action),'read_text');
  for(const rawName of ['read','write','shell','execute','unknown','forge_read_text_alias','t3_send'])assert.throws(()=>gate.assert({...action,rawName}),{code:'NATIVE_TOOL_DENIED'});
  for(const context of [{sessionID:'other'},{sessionID:p.threadId,codemode:true},{sessionID:p.threadId,background:true},{sessionID:p.threadId,parentCallId:'x'},{sessionID:p.threadId,delegated:true}])assert.throws(()=>gate.assert({...action,context}),{code:'NATIVE_TOOL_DENIED'});
  assert.throws(()=>gate.assert({...action,tool:{...tool}}),{code:'NATIVE_TOOL_DENIED'});assert.throws(()=>gate.context(),{code:'NATIVE_CONTEXT_DENIED'});
  assert.equal(qualifyGuardedRuntime({supported:true,proof:{}}),null);
});

test('actual HTTP gateway distinguishes completed edit receipt-owner loss from a pre-effect denial',windows,async()=>{
  let allow=true,ownerAvailable=false;
  const f=await fixture({authorize:()=>allow,recordReceipt(){if(!ownerAvailable)throw Object.assign(Error('revoked after completion'),{code:'GUARDED_AUTHORITY_REVOKED'});}});
  const gateway=await openLocalGateway({...f.options,broker:f.broker,nativeSessionId:()=> 'native-session'});
  const send=async request=>{
    const body=canonical({...request,nativeSessionId:'native-session'});
    const response=await fetch(gateway.url+'/action',{method:'POST',headers:{Authorization:'Bearer '+f.key.toString('hex'),'Content-Type':'application/json','X-Forge-Mac':createHmac('sha256',f.key).update(body).digest('hex')},body});
    return {status:response.status,value:await response.json()};
  };
  try{
    const request=f.request('owner-http',{tool:'edit_text',path:'allowed/a.txt',expectedRevision:bytesDigest('before'),text:'once'});
    assert.deepEqual(await send(request),{status:403,value:{ok:false,error:'OUTCOME_UNKNOWN'}});
    assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'once');
    assert.equal(f.broker.readReceipt('owner-http').status,'completed');
    assert.equal((await send(request)).value.error,'OUTCOME_UNKNOWN');
    ownerAvailable=true;assert.equal((await send(request)).value.result.replayed,true);
    allow=false;const denied=await send(f.request('denied-http',{tool:'edit_text',path:'allowed/a.txt',expectedRevision:bytesDigest('once'),text:'BAD'}));
    assert.equal(denied.value.error,'CANONICAL_ACTION_DENIED');assert.equal(f.broker.readReceipt('denied-http'),null);
    assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'once');
  }finally{await gateway.close();await f.close();}
});

test('private resource admission sees durable unknown/completed operations and exact replay never consumes another action',windows,async()=>{
  const admissions=[];
  const f=await fixture({beforeAction(input){admissions.push(input);if(input.priorOperations.length>=2)throw Object.assign(Error('action cap'),{code:'ACTION_LIMIT'});}});
  try{
    const stale=f.request('stale-resource',{tool:'edit_text',path:'allowed/a.txt',expectedRevision:'b'.repeat(64),text:'BAD'});
    await assert.rejects(f.broker.receive(stale),{code:'REVISION_CHANGED'});
    const edit=f.request('actual-resource',{tool:'edit_text',path:'allowed/a.txt',expectedRevision:bytesDigest('before'),text:'once'});
    await f.broker.receive(edit);assert.equal((await f.broker.receive(edit)).replayed,true);
    assert.equal(admissions.length,2);assert.deepEqual(admissions[0].priorOperations,[]);
    assert.equal(admissions[1].priorOperations[0].status,'unknown');
    assert.equal(admissions[1].priorOperations[0].operationId,'stale-resource');
    assert.equal(admissions[1].priorOperations[0].runId,'run');
    const inspect=()=>inspectGuardedOperations({receiptPath:f.options.receiptPath,runId:'run'});
    const rows=inspect();assert.deepEqual(rows.map(x=>x.status).sort(),['completed','unknown']);
    assert.equal(rows.every(x=>/^[a-f0-9]{64}$/.test(x.requestDigest)),true);assert.equal(JSON.stringify(rows).includes('once'),false);
    await f.restart();assert.deepEqual(inspect(),rows);
    await assert.rejects(f.broker.receive(f.request('over-cap',{tool:'read_text',path:'allowed/a.txt'})),{code:'ACTION_LIMIT'});
    assert.equal(f.broker.readReceipt('over-cap'),null);assert.equal(await readFile(path.join(f.workspace,'allowed/a.txt'),'utf8'),'once');
  }finally{await f.close();}
});
