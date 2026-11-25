import path from 'node:path';
import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {entity,find,fail,changed,revision,confined} from '../server/domain.mjs';
export {entity,find,fail,changed,revision,confined};
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const digest=value=>hash(Buffer.from(JSON.stringify(value)));
export const records=(s,kind,projectId)=>s.events.filter(e=>e.type===`mission.${kind}`&&e.projectId===projectId);
export function record(s,kind,id,projectId){const r=find(s,'events',id,projectId);if(r.type!==`mission.${kind}`)fail('NOT_FOUND',`Mission ${kind} not found`,404);return r;}
export function append(s,kind,data,projectId){const r=entity({...data,type:`mission.${kind}`},projectId);s.events.push(r);return r;}
export function exact(input,keys){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))fail('VALIDATION','Unexpected request fields');}
export function text(value,label,max=4000,{empty=false}={}){if(typeof value!=='string'||value.length>max||!empty&&!value.trim())fail('VALIDATION',`${label} needs bounded text`);return value.trim();}
export function relative(value){
  value=text(value,'Project-relative file',240).replaceAll('\\','/');
  if(path.isAbsolute(value)||value.includes(':')||value.split('/').some(p=>!p||p==='.'||p==='..'||/^(\.git|\.forge|node_modules|\.env(?:\..*)?|.*(?:credential|secret|token|private.key).*)$/i.test(p))||/[\x00-\x1f]/.test(value))fail('PATH_SCOPE','Use a project file outside private/configuration and runtime folders',403);
  return value;
}
export function paths(values,label,min=0){if(!Array.isArray(values)||values.length<min||values.length>12)fail('VALIDATION',`${label}: select ${min}..12 files`);return [...new Set(values.map(relative))];}
export function definition(input){
  exact(input,['title','objective','constraints','inputs','outputs','decisions']);
  if(!Array.isArray(input.outputs)||!input.outputs.length||input.outputs.length>12)fail('VALIDATION','Choose 1..12 deliverables');
  const seen=new Set(),outputs=input.outputs.map(o=>{
    exact(o,['key','name','path','acceptance','testFiles','sourcePaths','botId','dependsOn']);
    const key=text(o.key,'Output key',80);if(!/^[a-zA-Z0-9_-]+$/.test(key)||seen.has(key))fail('VALIDATION','Use unique simple output keys');seen.add(key);
    const testFiles=paths(o.testFiles,'Tests',1);if(testFiles.some(f=>! /\.(?:mjs|cjs|js)$/.test(f)))fail('VALIDATION','Select explicit JavaScript test files');
    const dependsOn=o.dependsOn??[];if(!Array.isArray(dependsOn)||dependsOn.some(d=>!seen.has(d)||d===key)||new Set(dependsOn).size!==dependsOn.length)fail('DEPENDENCY','Dependencies must reference earlier output keys');
    return {key,name:text(o.name,'Output name',180),path:relative(o.path),acceptance:text(o.acceptance,'Measurable acceptance',2000),testFiles,sourcePaths:paths(o.sourcePaths??[],'Source files'),botId:o.botId?text(o.botId,'Bot',200):null,dependsOn};
  });
  if(new Set(outputs.map(o=>o.path.toLowerCase())).size!==outputs.length)fail('VALIDATION','Deliverables need distinct file paths');
  const decisions=input.decisions??[];if(!Array.isArray(decisions)||decisions.length>12)fail('VALIDATION','At most 12 decisions');
  const ids=new Set();for(const d of decisions){exact(d,['id','question','answer']);text(d.id,'Decision id',100);text(d.question,'Question',2000);text(d.answer,'Answer',2000,{empty:true});if(ids.has(d.id))fail('VALIDATION','Duplicate decision');ids.add(d.id);}
  return {title:text(input.title,'Title',180),objective:text(input.objective,'Objective'),constraints:text(input.constraints??'','Constraints',4000,{empty:true}),inputs:text(input.inputs??'','Inputs',4000,{empty:true}),outputs,decisions:structuredClone(decisions)};
}
export async function fileBytes(workspace,relativePath,max=16*1024*1024){
  const file=await confined(workspace,relativePath),handle=await open(file,'r');
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size>max)fail('SIZE','Select regular files up to 16 MiB');const bytes=Buffer.alloc(stat.size+1),r=await handle.read(bytes,0,bytes.length,0);if(r.bytesRead!==stat.size)fail('INTEGRITY','File changed while reading',409);return {bytes:bytes.subarray(0,r.bytesRead),path:file,sha256:hash(bytes.subarray(0,r.bytesRead))};}finally{await handle.close();}
}
export const sourceFiles=o=>[...new Set([o.path,...o.testFiles,...o.sourcePaths])].sort();
export async function snapshot(workspace,o){return Promise.all(sourceFiles(o).map(async p=>{const f=await fileBytes(workspace,p);return {path:p,sha256:f.sha256,bytes:f.bytes.length};}));}
export function verifier(m,o){return {id:`forge.mission:${m.id}:${m.definitionRevision}:${o.key}`,version:'1'};}
export async function sourceRevision(workspace,o){
  const selectedFiles=await snapshot(workspace,o),exec=promisify(execFile);let git={status:'NOT_A_QUALIFIED_GIT_REVISION'};
  try{const options={cwd:workspace,windowsHide:true,timeout:5000,maxBuffer:1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}};
    const args=['-c','core.fsmonitor=false'],head=(await exec('git',[...args,'rev-parse','--verify','HEAD'],options)).stdout.trim();
    const status=(await exec('git',[...args,'status','--porcelain=v1','--untracked-files=no','--ignore-submodules=all'],options)).stdout;
    if(/^[a-f0-9]{40,64}$/.test(head))git={status:'OBSERVED_LOCAL_GIT',head,trackedDirty:!!status.trim(),scope:'HEAD and tracked dirty flag only; selected file hashes below include outputs/tests and explicitly selected source. Unlisted and untracked files are not qualified.'};
  }catch{/* A source file workspace need not be a Git repository. */}
  return {git,selectedFiles,sha256:digest(selectedFiles)};
}
