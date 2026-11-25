import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {canonical,digest,exact,fail,relativeTextPath,secretEqual,TOOLS} from './profile.mjs';

export function signRequest(key,body){return {...body,mac:createHmac('sha256',key).update(canonical(body)).digest('hex')};}

/** Private inbound transport handler, not an HTTP/MCP install endpoint.
 * Host must serialize Stop/revoke/profile/policy mutations with withFence, and
 * hold that same fence through the awaited file operation/receipt. No awaitable
 * authorization callbacks; read current canonical state inside the fence twice.
 * Database path belongs to host's protected local state, outside editable scope.
 */
export function createBoundedBroker({authority,handle,key,file,receiptPath,withFence,authorize}){
  if(!Buffer.isBuffer(key)||key.length!==32||typeof withFence!=='function'||typeof authorize!=='function')fail('BROKER_HOST_REQUIRED');
  const secret=Buffer.from(key),bound=authority.assert(handle);
  const db=new DatabaseSync(receiptPath);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS guarded_receipts (run TEXT NOT NULL, operation TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL, result TEXT, PRIMARY KEY(run,operation));');
  const get=db.prepare('SELECT * FROM guarded_receipts WHERE run=? AND operation=?');
  const reserve=db.prepare("INSERT INTO guarded_receipts VALUES (?,?,?,'unknown',NULL)");
  const finish=db.prepare("UPDATE guarded_receipts SET status='completed',result=? WHERE run=? AND operation=? AND request_hash=? AND status='unknown'");
  let tail=Promise.resolve(),closed=false;
  function check(request){
    const p=authority.assert(handle);
    const capability={read_text:'read',propose_change:'propose',edit_text:'workspace.write'}[request.tool];
    if(!p.scope.capabilities.includes(capability)||!p.scope.paths.some(s=>s==='.'||request.path===s||request.path.startsWith(s+'/')))fail('SCOPE_DENIED');
    const decision=authorize({profile:p,capability,path:request.path,tool:request.tool});
    if(decision!==true)fail('CANONICAL_ACTION_DENIED');
    return p;
  }
  async function perform(envelope){
    if(closed)fail('BROKER_CLOSED');
    exact(envelope,['version','runId','operationId','request','mac']);
    const {mac,...body}=envelope;
    if(!secretEqual(mac,signRequest(secret,body).mac)||envelope.version!==1||envelope.runId!==bound.runId||typeof envelope.operationId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(envelope.operationId))fail('TRANSPORT_DENIED');
    const request=envelope.request;
    if(!TOOLS.includes(request?.tool))fail('TOOL_DENIED');
    exact(request,request.tool==='read_text'?['tool','path']:['tool','path','expectedRevision','text']);
    relativeTextPath(request.path);
    if(request.tool!=='read_text'&&(!/^[a-f0-9]{64}$/.test(request.expectedRevision)||typeof request.text!=='string'||request.text.includes('\0')||!request.text.isWellFormed()||Buffer.byteLength(request.text)>bound.scope.maxBytes))fail('TEXT_DENIED');
    const requestHash=digest(body);
    return withFence(bound.runId,async()=>{
      const p=check(request);
      const previous=get.get(bound.runId,envelope.operationId);
      if(previous){
        if(previous.request_hash!==requestHash)fail('OPERATION_COLLISION');
        if(previous.status!=='completed')fail('OUTCOME_UNKNOWN');
        return {...JSON.parse(previous.result),replayed:true};
      }
      // Persist uncertainty BEFORE opening a path or returning data. Any crash,
      // failed ack, validation or partially completed edit leaves no retry grant.
      reserve.run(bound.runId,envelope.operationId,requestHash);
      try {
        const held=await file.command({op:'prepare',path:request.path,write:request.tool==='edit_text',maxBytes:p.scope.maxBytes});
        check(request); // current authority after race-safe handle acquisition
        if(request.tool!=='read_text'&&held.revision!==request.expectedRevision)fail('REVISION_CHANGED');
        let result;
        if(request.tool==='read_text'){
          result={tool:request.tool,path:request.path,revision:held.revision,text:held.text};
          await file.command({op:'abort'});
        }else if(request.tool==='propose_change'){
          result={tool:request.tool,path:request.path,expectedRevision:held.revision,text:request.text,effect:false};
          await file.command({op:'abort'});
        }else{
          check(request);
          const edited=await file.command({op:'commit',ticket:held.ticket,expectedRevision:request.expectedRevision,text:request.text});
          result={tool:request.tool,path:request.path,...edited,effect:true};
        }
        finish.run(JSON.stringify(result),bound.runId,envelope.operationId,requestHash);
        return {...result,replayed:false};
      }catch(e){try{await file.command({op:'abort'});}catch{}throw e;}
    });
  }
  return Object.freeze({
    receive(envelope){const snapshot=structuredClone(envelope);const work=tail.then(()=>perform(snapshot));tail=work.catch(()=>{});return work;},
    async close(){await tail;closed=true;secret.fill(0);await file.close();db.close();},
  });
}
