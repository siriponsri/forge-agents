import {performance} from 'node:perf_hooks';
import {fail,hash,integer,redact,safeJson,scopeOf,text} from './contracts.mjs';

export function memoryGroupsOf(version){
  if(version.memoryGroups)return version.memoryGroups;
  return version.memoryRequest?[{request:version.memoryRequest,refs:version.memoryRefs??[]}]:[];
}

export function createMemoryContext({access,memoryContext,memoryResolveRefs,limits}){
  const sameScope=(a,b)=>a?.projectId===b.projectId&&a?.kind===b.kind&&a?.id===b.id;
  async function resolve(state,projectId,groups,caller,{legacyIds=false}={}){
    const resolved=[];
    for(const group of groups){
      const scope=scopeOf(projectId,group.request.scope);await access(state,'resolve',scope,caller);
      if(!group.refs.length||typeof memoryResolveRefs!=='function')continue;
      const result=await memoryResolveRefs({projectId,scope,refs:structuredClone(group.refs)},caller);
      if(!Array.isArray(result?.items)||result.items.length>limits.maxMemoryRefs)fail('CONTEXT_MEMORY','Invalid memory reference resolution');
      const seen=new Set();
      for(const item of result.items){
        // A matching ID/hash in another scope is not a substitute. A moved,
        // forgotten, revised or tampered record must disappear, never migrate.
        if(!sameScope(item?.scope,scope)||typeof item.content!=='string'||!group.refs.some(r=>r.id===item.id&&r.revision===item.revision&&r.sha256===item.sha256&&r.sha256===hash(item.content))||seen.has(item.id))continue;
        seen.add(item.id);text(item.content,'memory content',limits.maxTextBytes);
        const refs=[{kind:'memory',id:item.id,revision:item.revision,sha256:item.sha256},...(item.sourceRefs??[])];
        if(refs.length>33||Buffer.byteLength(JSON.stringify(refs))>16000)fail('CONTEXT_LIMIT','Memory provenance exceeds limit');
        resolved.push({id:legacyIds?`memory:${item.id}`:`memory:${hash(scope)}:${item.id}`,kind:'memory',text:redact(item.content),sha256:hash(redact(item.content)),scope,sourceRefs:safeJson(refs),verification:safeJson(item.verification??null),stale:item.stale===true,provenanceStale:item.provenanceStale===true,conflicts:safeJson(item.conflicts??[]),trust:'untrusted-data',memory:true});
      }
    }
    if(resolved.length>limits.maxMemoryRefs||resolved.reduce((n,i)=>n+Buffer.byteLength(i.text),0)>limits.maxContextBytes)fail('CONTEXT_LIMIT','Combined memory context exceeds limit');
    return resolved;
  }
  async function gather(state,input,caller){
    if(input.memory===undefined||input.memory===null)return {memory:[],memoryGroups:[],memoryLatencyMs:null};
    const requests=Array.isArray(input.memory)?input.memory:[input.memory];
    if(requests.length>limits.maxMemoryGroups)fail('CONTEXT_LIMIT','Too many memory scope requests');
    if(!requests.length)return {memory:[],memoryGroups:[],memoryLatencyMs:null};
    if(typeof memoryContext!=='function'||typeof memoryResolveRefs!=='function')fail('CONTEXT_MEMORY_UNAVAILABLE','Memory context and reference resolvers required',409);
    const start=performance.now(),groups=new Map();
    for(const value of requests){
      if(!value||typeof value!=='object'||Array.isArray(value))fail('CONTEXT_MEMORY','Invalid memory scope request');
      const request={...safeJson(value),projectId:input.projectId,scope:scopeOf(input.projectId,value.scope)};
      await access(state,'compose',request.scope,caller);
      const recalled=await memoryContext(request,caller);
      if(!Array.isArray(recalled?.items)||recalled.items.length>limits.maxMemoryRefs)fail('CONTEXT_MEMORY','Invalid bounded memory data');
      // Preserve authorized empty requests too, so later reads recheck grants.
      const ensure=scope=>{const key=hash(scope);if(!groups.has(key)){if(groups.size>=limits.maxMemoryGroups)fail('CONTEXT_LIMIT','Too many original memory scopes');groups.set(key,{request:{...request,scope},refs:[]});}return groups.get(key);};
      ensure(request.scope);
      for(const item of recalled.items){
        const originalScope=scopeOf(input.projectId,item.scope);await access(state,'compose',originalScope,caller);
        const group=ensure(originalScope),ref={id:text(item.id,'memory id'),revision:integer(item.revision,'memory revision',1,1e9),sha256:text(item.sha256,'memory hash',64)};
        if(!/^[a-f0-9]{64}$/.test(ref.sha256))fail('CONTEXT_MEMORY','Invalid memory content hash');
        const existing=group.refs.find(r=>r.id===ref.id);if(existing&&hash(existing)!==hash(ref))fail('CONTEXT_MEMORY','Conflicting revisions for the same memory in one scope',409);
        if(!existing)group.refs.push(ref);
      }
    }
    const memoryGroups=[...groups.values()];
    if(memoryGroups.reduce((n,g)=>n+g.refs.length,0)>limits.maxMemoryRefs)fail('CONTEXT_LIMIT','Combined memory reference limit exceeded');
    const memory=await resolve(state,input.projectId,memoryGroups,caller);
    return {memory,memoryGroups,memoryLatencyMs:performance.now()-start};
  }
  return {gather,resolve};
}
