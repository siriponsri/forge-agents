import { find, fail, changed, now } from '../server/domain.mjs';
import { appendProtocol, digest } from '../server/agui.mjs';
import { applyObservation, markDisconnected, publishState, projectState, identity, TERMINAL, rejectFrontendToolResult, T3_PROTOCOL_CAPABILITIES } from './observations.mjs';

// Observation owner only: no planner, provider turn, domain command dispatcher,
// frontend effect executor, or automatic reconnect/retry loop lives here.
export function createProtocolController({store,call,openFeed,sendApproval}){
  const watches=new Map(),queues=new Map();let feed,opening,closing=false,recovered;
  const scoped=id=>find(store.read(),'runs',id);
  function priorReceipt(operationId,fingerprint){
    const prior=store.read().receipts.find(x=>x.operationId===operationId);
    if(prior&&prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Operation ID belongs to another response',409);
    return prior;
  }
  function serialize(id,fn){const task=(queues.get(id)??Promise.resolve()).catch(()=>{}).then(fn);queues.set(id,task);return task.finally(()=>{if(queues.get(id)===task)queues.delete(id);});}
  async function readFeed(){
    if(feed)return feed;if(opening)return opening;
    opening=openFeed(async()=>{
      feed=undefined;const ids=[...watches.keys()];watches.clear();
      await Promise.all(ids.map(id=>serialize(id,()=>store.transaction(s=>markDisconnected(s,find(s,'runs',id))))));
    }).then(value=>feed=value).finally(()=>{opening=undefined;});return opening;
  }
  async function nativeObservation(run){
    const reader=await readFeed();const observation=await reader.projection(run.threadId);
    // The wire intentionally withholds large outputs. Fetch the supported detail
    // API before calling something a result; never convert outputOmitted to null.
    for(let n=0;n<(observation.turnItems??[]).length;n++){
      const item=observation.turnItems[n];
      if(item.runId===run.providerRunId&&item.outputOmitted){const detail=await reader.item(run.threadId,item.id);if(detail.item)observation.turnItems[n]=detail.item;}
    }
    return observation;
  }
  async function mcpObservation(run){
    let afterPosition=-1,items=[],latest;
    for(let page=0;page<100;page++){
      latest=await call('t3_thread_read',{threadId:run.threadId,view:'activity',afterPosition,limit:100,runLimit:50,maxCharsPerItem:20000});
      for(const item of latest.items??[]){
        let text=item.text??'',offset=item.nextTextOffset;
        while(item.textTruncated&&offset!=null){
          const part=await call('t3_thread_read',{threadId:run.threadId,itemId:item.itemId,textOffset:offset,maxCharsPerItem:20000});
          const chunk=part.items?.[0];if(!chunk||chunk.nextTextOffset===offset)fail('T3_TRUNCATED','T3 item continuation made no progress',502);
          text+=chunk.text??'';offset=chunk.nextTextOffset;if(!chunk.textTruncated)break;
        }
        items.push({...item,text});
      }
      if(!latest.hasMore)return {...latest,items};
      if(latest.nextPosition==null||latest.nextPosition<=afterPosition)fail('T3_TRUNCATED','T3 activity pagination made no progress',502);
      afterPosition=latest.nextPosition;
    }
    fail('T3_TRUNCATED','T3 activity exceeds the bounded reconciliation limit',502);
  }
  async function reconcileUnlocked(id,{snapshot=false,source='native'}={}){
    const run=scoped(id);if(!run.threadId)return run;
    try{
      const observation=source==='mcp'?await mcpObservation(run):await nativeObservation(run);
      await store.transaction(s=>applyObservation(s,find(s,'runs',id),observation,{snapshot,source}));
    }catch(error){
      await store.transaction(s=>markDisconnected(s,find(s,'runs',id),error.code??'read-failed'));
      throw error;
    }
    return scoped(id);
  }
  const api={
    capabilities:()=>T3_PROTOCOL_CAPABILITIES,
    recover(){
      recovered??=store.transaction(s=>{
        for(const run of s.runs){
          if(run.status==='submitting')run.status='unknown';
          if(run.stopRequest?.status==='submitting')run.stopRequest.status='unknown';
          if(run.threadId)markDisconnected(s,run,'backend-restarted');
        }
        for(const receipt of s.receipts)if(['t3.input-response','t3.permission-response'].includes(receipt.type)&&receipt.status==='submitting')receipt.status='unknown';
      });return recovered;
    },
    reconcile(id,options){return serialize(id,()=>reconcileUnlocked(id,options));},
    async observe(id){
      await api.reconcile(id,{snapshot:true});
      if(watches.has(id))return scoped(id);
      const run=scoped(id),reader=await readFeed();
      const off=reader.subscribe(run.threadId,async frame=>{
        if(closing||!watches.has(id))return;
        // Feed event sequences are notifications to read current authority. Full
        // reconciliation also handles upserts, late text corrections and gaps.
        if(frame.kind==='snapshot'||frame.kind==='event')await api.reconcile(id);
      });
      watches.set(id,off);return scoped(id);
    },
    async disconnect(id){
      watches.get(id)?.();watches.delete(id);
      await serialize(id,()=>store.transaction(s=>markDisconnected(s,find(s,'runs',id),'explicit-detach')));
      return scoped(id);
    },
    async reconnect(id){
      watches.get(id)?.();watches.delete(id);
      // Always query the existing thread; never startRun, resend a question answer
      // or dispatch a replayed tool call on reconnection.
      return api.observe(id);
    },
    recovery(id){const run=scoped(id);return {identity:identity(run),status:run.status,sequence:run.protocolSequence??0,events:[{type:'MESSAGES_SNAPSHOT',messages:run.protocolMessages??[]},{type:'STATE_SNAPSHOT',snapshot:run.protocolState??{identity:identity(run)}}],connection:run.connection??{status:'disconnected'},capabilities:T3_PROTOCOL_CAPABILITIES};},
    async refreshState(id){
      // Safe to call after domain commands or from a store subscriber: unchanged
      // projections don't transact, so publishing cannot form an event loop.
      const state=store.read(),run=find(state,'runs',id);
      if(digest(projectState(state,run))===digest(run.protocolState))return api.recovery(id);
      await store.transaction(s=>{const r=find(s,'runs',id);publishState(s,r);});return api.recovery(id);
    },
    async stop(id){
      const run=scoped(id);if(!run.threadId||!run.providerRunId)fail('OUTCOME_UNKNOWN','No observed execution identity; reconcile the environment before another action',409);
      let send=false;
      await store.transaction(s=>{const r=find(s,'runs',id);if(TERMINAL.has(r.status)||r.stopRequest)return;r.stopRequest={status:'submitting',at:now()};changed(r);publishState(s,r);send=true;});
      if(send){
        try{
          // runId confines this stop to the mapped execution. stop:true ignores
          // runId and could stop an unrelated later turn on the same T3 thread.
          const result=await call('t3_thread_interrupt',{threadId:run.threadId,runId:run.providerRunId,clientRequestId:`stop-${id}`});
          await store.transaction(s=>{const r=find(s,'runs',id);r.stopRequest={...r.stopRequest,status:result.status};changed(r);publishState(s,r);});
        }catch(error){await store.transaction(s=>{const r=find(s,'runs',id);r.stopRequest.status='unknown';markDisconnected(s,r,'stop-outcome-unknown');});throw error;}
      }
      return api.reconcile(id);
    },
    async respondInput(id,{operationId,requestId,answers}){
      if(typeof operationId!=='string'||!operationId.trim()||typeof requestId!=='string'||!answers||typeof answers!=='object'||Array.isArray(answers))fail('VALIDATION','operationId, requestId and answers are required');
      const run=scoped(id),fingerprint=digest({id,requestId,answers});let replay;
      const stored=priorReceipt(operationId,fingerprint);if(stored)return stored;
      // Query the real pending contract first. This operation cannot approve tools.
      const pending=await call('t3_pending_request',{action:'list',threadId:run.threadId});
      await store.transaction(s=>{
        const prior=s.receipts.find(r=>r.operationId===operationId);
        if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Operation ID belongs to another input response',409);replay=prior;return;}
        const r=find(s,'runs',id);
        const submitted=s.receipts.find(x=>x.type==='t3.input-response'&&x.runId===id&&x.requestId===requestId);
        if(submitted)fail('INPUT_ALREADY_SUBMITTED','This question already has a response or an uncertain response; reconcile instead of resending',409);
        if(!pending.requestIds?.includes(requestId)||!r.pendingInputs?.some(x=>x.requestId===requestId))fail('T3_INPUT_NOT_PENDING','Question is not pending on this mapped run',409);
        s.receipts.push({operationId,fingerprint,type:'t3.input-response',runId:id,requestId,status:'submitting',at:now()});
      });
      if(replay)return replay;
      try{
        const result=await call('t3_pending_request',{action:'respond',threadId:run.threadId,requestId,answers});
        await store.transaction(s=>{const receipt=s.receipts.find(x=>x.operationId===operationId);receipt.status='accepted';receipt.result=result;const r=find(s,'runs',id);appendProtocol(s,r,{type:'CUSTOM',name:'forge.input.accepted',value:{requestId,operationId}},`input:${requestId}`);});
      }catch(error){await store.transaction(s=>{s.receipts.find(x=>x.operationId===operationId).status='unknown';});throw error;}
      return store.read().receipts.find(x=>x.operationId===operationId);
    },
    returnToolResult:rejectFrontendToolResult,
    async respondApproval(id,{operationId,requestId,decision}){
      if(!operationId||!requestId||!['accept','decline','cancel'].includes(decision))fail('VALIDATION','Use operationId, requestId and a single-request accept/decline/cancel decision');
      if(!sendApproval)fail('T3_APPROVAL_UNAVAILABLE','Native permission response channel unavailable',409);
      const fingerprint=digest({id,requestId,decision});let replay;
      const stored=priorReceipt(operationId,fingerprint);if(stored)return stored;
      // Refresh native authority; a client cannot invent a permission request or
      // borrow an approval from another run, thread, project or bot.
      await api.reconcile(id);
      await store.transaction(s=>{
        const prior=s.receipts.find(x=>x.operationId===operationId);
        if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Operation ID belongs to another permission response',409);replay=prior;return;}
        if(s.receipts.some(x=>x.type==='t3.permission-response'&&x.runId===id&&x.requestId===requestId))fail('INPUT_ALREADY_SUBMITTED','Permission already answered or uncertain; reconcile before another action',409);
        if(!find(s,'runs',id).pendingApprovals?.some(x=>x.requestId===requestId))fail('T3_INPUT_NOT_PENDING','Permission request is not pending on this mapped run',409);
        s.receipts.push({operationId,fingerprint,type:'t3.permission-response',runId:id,requestId,status:'submitting',at:now()});
      });
      if(replay)return replay;
      try{
        const result=await sendApproval({threadId:scoped(id).threadId,requestId,decision,commandId:`forge-permission-${digest(operationId)}`});
        await store.transaction(s=>{const receipt=s.receipts.find(x=>x.operationId===operationId);receipt.status='accepted';receipt.result=result;});
      }catch(error){await store.transaction(s=>{s.receipts.find(x=>x.operationId===operationId).status='unknown';});throw error;}
      return store.read().receipts.find(x=>x.operationId===operationId);
    },
    async close(){closing=true;for(const off of watches.values())off();watches.clear();feed?.close();feed=undefined;await Promise.allSettled([...queues.values()]);},
  };
  return api;
}
