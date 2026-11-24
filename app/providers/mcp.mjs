import { randomUUID } from 'node:crypto';
import { changed, digest, entity, fail, find, required, safeError } from './common.mjs';
import { envName } from './routes.mjs';

// Tool connection owner, not a model/turn runtime. Policy is supplied by the
// existing supervised execution boundary, never by a browser boolean.
export function createMcpService({store,authorizeTool,timeoutMs=15000,machineEnv=process.env}){
  const clients=new Map(),opening=new Map(),controllers=new Map();
  const scoped=(input,s=store.read())=>{find(s,'projects',required(input.projectId,'projectId'));const c=find(s,'connections',required(input.connectionId,'connectionId'),input.projectId);if(c.kind!=='mcp')fail('SCOPE','Expected an MCP connection',409);return c;};
  const signature=c=>digest([c.enabled,c.route,c.url,c.command,c.args,c.config?.envRefs,c.config?.authEnv]);
  async function closeClient(id){const c=clients.get(id);clients.delete(id);await c?.client.close().catch(()=>{});}
  function resolveEnv(name){if(!envName(name))fail('SECRET_REFERENCE','Use machine environment references only');const value=machineEnv[name];if(!value)fail('AUTH_REQUIRED','Set the named environment variable on this machine',409);return value;}
  async function connect(input){
    const c=scoped(input);if(c.enabled===false)fail('DISABLED','Enable this MCP connection',409);const key=signature(c);
    if(clients.get(c.id)?.key===key)return clients.get(c.id).client;
    if(opening.get(c.id)?.key===key)return opening.get(c.id).promise;
    const promise=(async()=>{await closeClient(c.id);
      const [{Client},{StreamableHTTPClientTransport},{StdioClientTransport}]=await Promise.all([import('@modelcontextprotocol/sdk/client/index.js'),import('@modelcontextprotocol/sdk/client/streamableHttp.js'),import('@modelcontextprotocol/sdk/client/stdio.js')]);
      const client=new Client({name:'forge-scoped-mcp',version:'1.0.0'},{capabilities:{},listChanged:{tools:{autoRefresh:false,onChanged:()=>{store.transaction(s=>{const current=scoped(input,s);current.discoveryStale=true;changed(current);}).catch(()=>{});}}}});
      let transport;
      if(c.route==='stdio'){
        const env=Object.fromEntries(Object.entries(machineEnv).filter(([k])=>['PATH','Path','SystemRoot','TEMP','TMP','USERPROFILE','LOCALAPPDATA'].includes(k)));
        for(const name of c.config?.envRefs??[])env[name]=resolveEnv(name);
        transport=new StdioClientTransport({command:c.command,args:c.args??[],env,stderr:'pipe'});
      }else{const headers=c.config?.authEnv?{Authorization:`Bearer ${resolveEnv(c.config.authEnv)}`}:{ };transport=new StreamableHTTPClientTransport(new URL(c.url),{requestInit:{headers}});}
      try{await client.connect(transport,{timeout:timeoutMs});if(signature(scoped(input))!==key)fail('CONNECTION_CHANGED','Connection changed during setup',409);clients.set(c.id,{key,client});return client;}
      catch(error){await client.close().catch(()=>{});throw error;}
    })();opening.set(c.id,{key,promise});try{return await promise;}finally{if(opening.get(c.id)?.promise===promise)opening.delete(c.id);}
  }
  const api={
    async configure(input){
      required(input.operationId,'operationId');find(store.read(),'projects',required(input.projectId,'projectId'));
      if(Object.keys(input).some(k=>!['operationId','projectId','name','route','url','command','args','envRefs','authEnv'].includes(k)))fail('MCP_CONFIG','Unexpected MCP configuration field; use machine secret references');
      if(input.route!=='stdio'&&input.route!=='http')fail('MCP_TRANSPORT','Use stdio or Streamable HTTP');
      if(input.route==='stdio'){required(input.command,'command');if(/[\r\n\0]/.test(input.command)||!Array.isArray(input.args??[])||(input.args??[]).some(a=>typeof a!=='string'||/[\r\n\0]/.test(a)))fail('MCP_COMMAND','Use executable and literal argument rows');}
      else{const u=new URL(required(input.url,'url'));if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)fail('MCP_URL','Use an HTTP(S) MCP endpoint without embedded credentials or query');}
      if(input.authEnv&&!envName(input.authEnv)||input.envRefs!==undefined&&!Array.isArray(input.envRefs)||(input.envRefs??[]).some(n=>!envName(n)))fail('SECRET_REFERENCE','Use machine environment names only');
      const fingerprint=digest(input);
      return store.transaction(s=>{const prior=s.receipts.find(r=>r.operationId===input.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','MCP setup operation reused',409);return find(s,'connections',prior.connectionId,input.projectId);}
        const c=entity({name:input.name??'MCP',kind:'mcp',route:input.route,enabled:true,...(input.route==='stdio'?{command:input.command,args:input.args??[]}:{url:input.url}),config:{envRefs:input.envRefs??[],authEnv:input.authEnv},discoveryStale:true},input.projectId);s.connections.push(c);s.receipts.push({operationId:input.operationId,fingerprint,type:'mcp.configure',projectId:c.projectId,connectionId:c.id});return c;});
    },
    async enable(input){
      scoped(input);if(typeof input.enabled!=='boolean')fail('MCP_CONFIG','enabled must be boolean');
      await store.transaction(s=>{const c=scoped(input,s);c.enabled=input.enabled;c.discoveryStale=true;changed(c);});
      // Disabling a connection cancels observation and requests protocol-level
      // cancellation. It cannot prove rollback of a remote write.
      if(!input.enabled)for(const item of controllers.values())if(item.connectionId===input.connectionId)item.controller.abort();
      await closeClient(input.connectionId);return scoped(input);
    },
    async discover(input){
      const c=scoped(input),key=signature(c);let result;
      try{const client=await connect(input);let cursor,tools=[];const seen=new Set();
        for(let page=0;page<100;page++){const value=await client.listTools(cursor?{cursor}:{},{timeout:timeoutMs});tools.push(...value.tools);cursor=value.nextCursor;if(!cursor)break;if(seen.has(cursor))fail('MCP_PAGING','Tool pagination did not advance',502);seen.add(cursor);if(page===99)fail('MCP_PAGING','Tool list exceeds supported limit',502);}
        result={status:'ready',checkedAt:new Date().toISOString(),capabilities:tools.map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema,annotations:t.annotations})),server:client.getServerVersion(),authentication:'transport accepted; operation qualification separate'};
      }catch(error){await closeClient(c.id);result={status:'error',checkedAt:new Date().toISOString(),error:safeError(error)};}
      await store.transaction(s=>{const current=scoped(input,s);if(signature(current)!==key)return;current.lastCheck=result;current.discoveryStale=result.status!=='ready';changed(current);});return result;
    },
    async call(input){
      const c=scoped(input);required(input.operationId,'operationId');required(input.name,'tool name');
      const fingerprint=digest({projectId:input.projectId,connectionId:c.id,name:input.name,arguments:input.arguments});
      const prior=store.read().events.find(e=>e.operationId===input.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','MCP call operation reused',409);return prior;}
      if(c.enabled===false)fail('DISABLED','Enable connection',409);
      if(c.discoveryStale||!c.lastCheck?.capabilities?.some(t=>t.name===input.name))fail('DISCOVER_FIRST','Refresh actual tools before a call',409);
      const {AjvJsonSchemaValidator}=await import('@modelcontextprotocol/sdk/validation/ajv');
      const tool=c.lastCheck.capabilities.find(t=>t.name===input.name);
      let valid=false;try{valid=new AjvJsonSchemaValidator().getValidator(tool.inputSchema)(input.arguments??{}).valid;}catch{fail('MCP_SCHEMA','Discovered tool schema cannot be validated',409);}
      if(!valid)fail('MCP_ARGUMENTS','Tool arguments do not match its discovered schema');
      if(!authorizeTool)fail('SUPERVISED_POLICY_REQUIRED','MCP execution requires the existing supervised tool policy',409);
      let permitted;try{permitted=await authorizeTool({projectId:input.projectId,connectionId:c.id,name:input.name,arguments:input.arguments,operationId:input.operationId,signal:input.signal});}catch(error){const safe=safeError(error);fail(safe.code,safe.message,409);}
      if(permitted!==true)fail('TOOL_DENIED','Tool call was not authorized',403);
      let replay=false;
      const record=await store.transaction(s=>{const prior=s.events.find(e=>e.operationId===input.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','MCP operation reused',409);replay=true;return prior;}if(s.receipts.some(r=>r.operationId===input.operationId)||s.runs.some(r=>r.operationId===input.operationId))fail('OPERATION_REUSE','Operation belongs to other work',409);const current=scoped(input,s);if(signature(current)!==signature(c)||current.discoveryStale)fail('CONNECTION_CHANGED','Refresh changed connection',409);const record={id:randomUUID(),type:'mcp.call',projectId:input.projectId,connectionId:c.id,operationId:input.operationId,fingerprint,name:input.name,status:'submitting',createdAt:new Date().toISOString()};s.events.push(record);return record;});if(replay)return record;
      const controller=new AbortController();controllers.set(record.id,{connectionId:c.id,controller});
      let dispatched=false,result;
      try{const client=await connect(input);dispatched=true;const value=await client.callTool({name:input.name,arguments:input.arguments??{}},undefined,{timeout:timeoutMs,signal:controller.signal});result={status:value.isError?'failed':'completed',result:value};}
      catch(error){result={status:dispatched?'unknown':'failed',error:safeError(error)};}
      finally{controllers.delete(record.id);}
      await store.transaction(s=>Object.assign(s.events.find(e=>e.id===record.id),result));return store.read().events.find(e=>e.id===record.id);
    },
    async stop(input){const c=scoped(input);const event=store.read().events.find(e=>e.id===input.callId&&e.connectionId===c.id&&e.projectId===c.projectId);if(!event)fail('NOT_FOUND','MCP call not found in project',404);controllers.get(event.id)?.controller.abort();await store.transaction(s=>{const e=s.events.find(e=>e.id===event.id);e.stopRequested=true;if(['submitting','running'].includes(e.status))e.status='unknown';});return store.read().events.find(e=>e.id===event.id);},
    async recover(){await store.transaction(s=>{for(const e of s.events)if(e.type==='mcp.call'&&['submitting','running'].includes(e.status))e.status='unknown';for(const c of s.connections)if(c.kind==='mcp')c.discoveryStale=true;});},
    async close(){for(const c of controllers.values())c.controller.abort();await Promise.allSettled([...opening.values()].map(x=>x.promise));await Promise.allSettled([...clients.keys()].map(closeClient));},
  };return api;
}
