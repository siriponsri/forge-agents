import { randomUUID, createHash } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
export const now=()=>new Date().toISOString();
export function fail(code,message,statusCode=400,details){throw Object.assign(new Error(message),{code,statusCode,details});}
export function required(value,label){if(typeof value!=='string'||!value.trim())fail('VALIDATION',`${label} is required`);return value.trim();}
export function find(s,collection,id,projectId){const x=s[collection].find(x=>x.id===id);if(!x || (projectId && x.projectId!==projectId))fail('NOT_FOUND',`${collection} record not found in this project`,404);return x;}
export function revision(x,expected){if(expected!==x.revision)fail('REVISION_CONFLICT','Newer changes exist. Reload and review before saving.',409,{currentRevision:x.revision});}
export function entity(data,projectId){return {...data,id:randomUUID(),...(projectId?{projectId}:{}),revision:1,createdAt:now(),updatedAt:now()};}
export function changed(x){x.revision++;x.updatedAt=now();}
const map={project:'projects',bot:'bots',conversation:'conversations',plan:'plans',phase:'phases',task:'tasks',connection:'connections',notebook:'notebooks',document:'documents',report:'reports',desktopTarget:'desktopTargets',skill:'skills'};
const fields={project:['name','description','workspace','profile'],bot:['name','role','instructions','kind','taskId','capabilities'],conversation:['name','kind','botId'],plan:['name','description','approved'],phase:['name','planId','description'],task:['title','description','status','planId','phaseId','botId','dependsOn','evidence','artifactIds'],connection:['name','kind','route','url','command','args','enabled','config','providerInstanceId'],notebook:['name','code','cells','language','compute'],document:['name','kind','snapshot','packageVersion','resources'],report:['name','spec'],desktopTarget:['name','kind','connectionId','capabilities'],skill:['name','version','requires','instructions','status','evidence']};
function pick(data,keys){return Object.fromEntries(keys.filter(k=>data[k]!==undefined).map(k=>[k,structuredClone(data[k])]));}
function validateLinks(s,x,projectId){
  for(const [field,collection] of [['botId','bots'],['planId','plans'],['phaseId','phases'],['taskId','tasks']]) if(x[field])find(s,collection,x[field],projectId);
  for(const id of x.dependsOn??[])find(s,'tasks',id,projectId);
  if(x.phaseId && x.planId && find(s,'phases',x.phaseId,projectId).planId!==x.planId)fail('SCOPE','Phase belongs to a different plan');
}
function validateTask(s,x,projectId){
  const statuses=['backlog','ready','running','blocked','review','done'];
  if(!statuses.includes(x.status))fail('VALIDATION','Unsupported task status');
  if(x.status==='done' && (!Array.isArray(x.evidence)||!x.evidence.length))fail('EVIDENCE_REQUIRED','Add concrete verification evidence before completing a task',409);
  const visit=(id,seen=new Set())=>{if(id===x.id)fail('CYCLE','Task dependency cycle');if(seen.has(id))return;seen.add(id);for(const dep of find(s,'tasks',id,projectId).dependsOn??[])visit(dep,seen);};
  for(const id of x.dependsOn??[])visit(id);
}
function validateSnapshot(snapshot){
  if(!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot))fail('VALIDATION','Native editor snapshot is required');
  if(/blob:/.test(JSON.stringify(snapshot)))fail('RESOURCE_NOT_DURABLE','Save temporary browser images as project resources before saving this document');
}
export async function command(store,input){
  const operationId=required(input.operationId,'operationId'); const type=required(input.type,'type');
  const fingerprint=createHash('sha256').update(JSON.stringify({...input,operationId:undefined})).digest('hex');
  // Workspace initialization is reversible and explicitly selected by the user.
  if(type==='project.create'){
    const workspace=path.resolve(required(input.data?.workspace,'workspace'));
    await mkdir(workspace,{recursive:true});
    if(!(await stat(workspace)).isDirectory())fail('WORKSPACE','Choose a workspace folder');
  }
  return store.transaction(s=>{
    const prior=s.receipts.find(r=>r.operationId===operationId);
    if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Operation ID was used for another command',409);return prior.result;}
    const data=input.data??{};let x;
    if(type==='settings.update'){
      if(data.language && !['th','en'].includes(data.language))fail('VALIDATION','Language must be th/en');
      if(data.theme!==undefined && (typeof data.theme!=='string'||!/^[a-z0-9-]{1,80}$/.test(data.theme)))fail('VALIDATION','Invalid theme identifier');
      s.settings={...s.settings,...pick(data,['language','theme','activeProjectId'])};x={id:'settings',revision:s.revision+1,...s.settings};
    }else if(type==='message.send'){
      x=find(s,'conversations',data.conversationId,input.projectId);revision(x,input.expectedRevision);
      x.messages.push(entity({role:'user',text:required(data.text,'message'),botId:x.botId},input.projectId)); changed(x);
    }else{
      const [kind,action]=type.split('.'); const collection=map[kind];if(!collection)fail('UNKNOWN_COMMAND',type);
      if(kind!=='project')find(s,'projects',input.projectId);
      if(action==='create'){
        const defaults={task:{status:'backlog',dependsOn:[],runIds:[],artifactIds:[],evidence:[]},conversation:{kind:'team',messages:[]},document:{history:[],resources:[],packageVersion:'1.6.1'},report:{history:[]},project:{description:'',profile:{provider:{},compute:{kind:'local'},serving:{},storage:{kind:'local'},mcp:[],phaseOverrides:{},limits:{concurrency:1}}},bot:{kind:'resident',capabilities:[]}};
        x=entity({...defaults[kind],...pick(data,fields[kind])},kind==='project'?null:input.projectId);
        required(x.title??x.name,kind==='task'?'title':'name');
        if(kind==='project'){x.workspace=path.resolve(required(x.workspace,'workspace'));if(s.projects.some(p=>path.resolve(p.workspace).toLowerCase()===x.workspace.toLowerCase()))fail('WORKSPACE_EXISTS','This workspace already has a project',409);}
        if(kind==='document'){if(!['sheet','doc'].includes(x.kind))fail('VALIDATION','Document kind must be sheet/doc');if(x.snapshot)validateSnapshot(x.snapshot);}
        validateLinks(s,x,input.projectId);if(kind==='task')validateTask(s,x,input.projectId);
        s[collection].push(x);
      }else if(['update','save','restore'].includes(action)){
        x=find(s,collection,input.id,kind==='project'?null:input.projectId); revision(x,input.expectedRevision);
        if(['document','report'].includes(kind)){
          x.history.push({revision:x.revision,snapshot:structuredClone(x.snapshot),spec:structuredClone(x.spec),summary:data.summary??action,actor:data.actor??'user',at:now()});
        }
        let patch=pick(data,fields[kind]);
        if(action==='restore'){
          const historic=x.history.find(h=>h.revision===data.sourceRevision);
          if(!historic)fail('NOT_FOUND','Revision not found',404);patch=kind==='document'?{snapshot:historic.snapshot}:{spec:historic.spec};
        }
        if(patch.snapshot)validateSnapshot(patch.snapshot);
        // Identity/type cannot be changed by snapshot payloads or ordinary updates.
        delete patch.kind;if(kind==='project')delete patch.workspace;
        const candidate={...x,...patch};validateLinks(s,candidate,input.projectId);
        if(kind==='task')validateTask(s,candidate,input.projectId);
        Object.assign(x,patch); changed(x);
      }else fail('UNKNOWN_COMMAND',type);
    }
    const receipt={operationId,type,entityId:x.id,revision:x.revision,outcome:'applied',at:now()};
    const result={receipt,entity:structuredClone(x),stateRevision:s.revision+1};
    s.receipts.push({operationId,fingerprint,result});
    s.events.push(entity({type,projectId:input.projectId,entityId:x.id,revision:x.revision}));
    return result;
  });
}
export async function confined(root,relative,{existing=true}={}){
  const realRoot=await realpath(root); const candidate=path.resolve(realRoot,relative);
  const inside=(p)=>{const r=path.relative(realRoot,p);return r===''||(!r.startsWith(`..${path.sep}`)&&r!=='..'&&!path.isAbsolute(r));};
  if(!inside(candidate))fail('PATH_SCOPE','Path escapes the selected workspace',403);
  const resolved=existing?await realpath(candidate):path.join(await realpath(path.dirname(candidate)),path.basename(candidate));
  if(!inside(resolved))fail('PATH_SCOPE','Linked path escapes the workspace',403);
  if(path.relative(realRoot,resolved).split(path.sep).includes('.git'))fail('PATH_SCOPE','Git internals are excluded',403);
  return resolved;
}
