import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { find, fail, changed, now } from './domain.mjs';

export const integrationCatalog=[
  ...['Codex','Claude','Gemini','Grok','OpenCode','Kimi','Qwen','DeepSeek','MaxPlus','KOB'].map(name=>({name,kind:'provider',route:'t3',implementation:'T3 provider instance required; discovery in matching T3 GUI',live:'NOT_RUN'})),
  {name:'OpenRouter',kind:'model-api',route:'https',implementation:'Health endpoint only; model execution IMPLEMENTATION_INCOMPLETE',live:'NOT_RUN'},
  ...['Windows/local','Owner server','Colab browser','Colab API','Vast','Runpod'].map(name=>({name,kind:'compute',implementation:name==='Windows/local'?'Local bounded Python notebook jobs':'IMPLEMENTATION_INCOMPLETE',live:'NOT_RUN'})),
  ...['Google Drive','project Git','LitServe','native Windows','desktop/VM','browser'].map(name=>({name,implementation:'IMPLEMENTATION_INCOMPLETE',live:'NOT_RUN'})),
];
export function createConnectionService({store}){
  const clients=new Map(),signatures=new Map();
  async function connect(id){
    const c=find(store.read(),'connections',id);if(c.enabled===false)fail('DISABLED','Enable this connection first',409);
    const signature=JSON.stringify([c.route,c.url,c.command,c.args]);
    if(clients.has(id)&&signatures.get(id)===signature)return clients.get(id);
    if(clients.has(id)){await clients.get(id).close();clients.delete(id);}
    const client=new Client({name:'forge-local',version:'0.2.0'},{capabilities:{}});
    const transport=c.route==='stdio'?new StdioClientTransport({command:c.command,args:c.args??[],stderr:'pipe',env:Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','Path','SystemRoot','TEMP','TMP','USERPROFILE','LOCALAPPDATA'].includes(k)))}):new StreamableHTTPClientTransport(new URL(c.url));
    await client.connect(transport,{timeout:15000});clients.set(id,client);signatures.set(id,signature);return client;
  }
  async function record(id,patch){await store.transaction(s=>{const c=find(s,'connections',id);Object.assign(c,patch);changed(c);});}
  return {
    async check(id){const c=find(store.read(),'connections',id);let result;
      try{
        if(c.kind==='mcp'){const client=await connect(id);const tools=await client.listTools();result={status:'ready',capabilities:tools.tools.map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema})),authentication:'transport accepted; operation-specific qualification pending'};}
        else if(c.url){const url=new URL(c.url);if(!['http:','https:'].includes(url.protocol))fail('URL','Only HTTP(S) endpoints supported');const r=await fetch(url,{signal:AbortSignal.timeout(10000),redirect:'error'});result={status:r.ok?'reachable':'error',httpStatus:r.status,authentication:'not independently verified'};await r.body?.cancel();}
        else fail('SETUP_REQUIRED','Configure a supported MCP endpoint or use T3 provider setup',409);
      }catch(e){result={status:'error',error:e.message};await clients.get(id)?.close().catch(()=>{});clients.delete(id);}
      await record(id,{lastCheck:{...result,checkedAt:now()}});return result;
    },
    async discover(id){return this.check(id);},
    async call(id,{name,arguments:args,operationId,projectId}){
      const c=find(store.read(),'connections',id,projectId);if(!c.lastCheck?.capabilities?.some(t=>t.name===name))fail('DISCOVER_FIRST','Discover and enable this tool before calling it',409);
      // Durable reservation: an uncertain remote result is never resubmitted automatically.
      const fingerprint=createHash('sha256').update(JSON.stringify({projectId,connectionId:id,name,args})).digest('hex');
      const reservation=await store.transaction(s=>{const prior=s.events.find(e=>e.operationId===operationId&&e.type==='mcp.call');if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','MCP operation ID reused with different scope/arguments',409);return {replayed:true,...prior};}if(!operationId)fail('VALIDATION','operationId required');const event={id:crypto.randomUUID(),type:'mcp.call',operationId,fingerprint,projectId,connectionId:id,name,status:'pending',createdAt:now()};s.events.push(event);return event;});
      if(reservation.replayed)return reservation;
      const client=await connect(id);let result,status='completed';try{result=await client.callTool({name,arguments:args},undefined,{timeout:30000});if(result.isError)status='failed';}catch(e){status='unknown';result={error:e.message};}
      await store.transaction(s=>Object.assign(s.events.find(e=>e.id===reservation.id),{status,result,finishedAt:now()}));return {status,result};
    },
    async close(){await Promise.allSettled([...clients.values()].map(c=>c.close()));clients.clear();},
  };
}
