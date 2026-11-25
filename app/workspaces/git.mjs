import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fail,pathKey,overlaps} from './contracts.mjs';
const execute=promisify(execFile);
const forgeRoot=fileURLToPath(new URL('../../',import.meta.url));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function checkoutPath(dataDir,id){if(!uuid.test(id))fail('PATH_SCOPE','Invalid owned workspace identity',403);return path.join(path.resolve(dataDir),'parallel-workspaces',id,'checkout');}
export async function noLinks(target){
  let p=path.resolve(target);
  while(true){try{if((await lstat(p)).isSymbolicLink())fail('PATH_SCOPE','Linked workspace ancestors are not accepted',403);}catch(e){if(e.code!=='ENOENT')throw e;}
    const parent=path.dirname(p);if(parent===p)break;p=parent;
  }
}
export async function ownedPath(dataDir,id,{existing=false}={}){
  const target=checkoutPath(dataDir,id);await noLinks(target);
  if(existing&&pathKey(await realpath(target))!==pathKey(target))fail('PATH_SCOPE','Workspace path identity changed',403);
  return target;
}
export async function git(cwd,args,{allowFailure=false,timeout=30000}={}){
  const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_MERGE_AUTOEDIT:'no'};
  for(const k of Object.keys(env))if(/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*)$/i.test(k))delete env[k];
  try{const r=await execute('git',['-c','core.hooksPath='+path.join(path.parse(cwd).root,'forge-disabled-hooks-do-not-create'),'-c','core.fsmonitor=false',...args],{cwd,windowsHide:true,timeout,maxBuffer:4*1024*1024,env});return {ok:true,stdout:r.stdout,stderr:r.stderr};}
  catch(e){if(allowFailure&&Number.isInteger(e.code))return {ok:false,code:e.code,stdout:e.stdout??'',stderr:e.stderr??''};throw Object.assign(new Error(`Git operation failed: ${e.stderr?.trim()||e.message}`),{code:'GIT_FAILED',statusCode:409});}
}
export const gitText=async(cwd,args)=>(await git(cwd,args)).stdout.trim();
export async function inspectSource(workspace){
  await noLinks(workspace);const sourceRoot=await realpath(workspace);
  if(overlaps(sourceRoot,forgeRoot))fail('SOURCE_BOUNDARY','Select a user output repository separate from FORGE source',403);
  const top=await gitText(sourceRoot,['rev-parse','--show-toplevel']);
  if(pathKey(top)!==pathKey(sourceRoot))fail('GIT_ROOT','Select the actual repository root',409);
  const commonDir=await realpath(await gitText(sourceRoot,['rev-parse','--path-format=absolute','--git-common-dir']));
  return {sourceRoot,commonDir,sourceHeadSha:await gitText(sourceRoot,['rev-parse','--verify','HEAD^{commit}']),sourceBranch:await gitText(sourceRoot,['symbolic-ref','--quiet','--short','HEAD']).catch(()=>null)};
}
export async function addWorktree(w,dataDir){
  const target=await ownedPath(dataDir,w.id);if(pathKey(target)!==pathKey(w.worktreePath))fail('PATH_SCOPE','Unowned checkout path',403);
  await mkdir(path.dirname(target),{recursive:true});await noLinks(path.dirname(target));
  // Never reuse an existing directory/branch and never force checkout or remove.
  try{await lstat(target);fail('WORKSPACE_EXISTS','Preserve the existing folder and reconcile creation',409);}catch(e){if(e.code!=='ENOENT')throw e;}
  await git(w.sourceRoot,['worktree','add','-b',w.branch,target,w.baseSha]);
  return inspectWorkspace(w,dataDir);
}
export async function inspectWorkspace(w,dataDir){
  const target=await ownedPath(dataDir,w.id,{existing:true});
  if(pathKey(w.worktreePath)!==pathKey(target))fail('PATH_SCOPE','Stored checkout is outside its owned path',403);
  const source=await inspectSource(w.sourceRoot);
  if(pathKey(source.commonDir)!==pathKey(w.commonDir))fail('GIT_IDENTITY','Source repository identity changed',409);
  const top=await gitText(target,['rev-parse','--show-toplevel']),common=await gitText(target,['rev-parse','--path-format=absolute','--git-common-dir']);
  if(pathKey(top)!==pathKey(target)||pathKey(common)!==pathKey(w.commonDir)||await gitText(target,['symbolic-ref','--short','HEAD'])!==w.branch)fail('GIT_IDENTITY','Checkout registration or branch changed',409);
  const registered=(await git(w.sourceRoot,['worktree','list','--porcelain','-z'])).stdout;
  if(!registered.split('\0\0').some(block=>block.split('\0').some(line=>line.startsWith('worktree ')&&pathKey(line.slice(9))===pathKey(target))&&block.split('\0').includes(`branch refs/heads/${w.branch}`)))fail('GIT_IDENTITY','Checkout is not registered to its owned branch',409);
  const head=await gitText(target,['rev-parse','--verify','HEAD^{commit}']);
  if(!(await git(target,['merge-base','--is-ancestor',w.baseSha,head],{allowFailure:true})).ok)fail('HEAD_DIVERGED','Workspace head no longer descends from its immutable base',409);
  return {path:target,head,sourceHead:source.sourceHeadSha,dirty:!!(await gitText(target,['status','--porcelain=v1','--untracked-files=all'])),changes:(await git(target,['diff','--name-only','-z',w.baseSha,head])).stdout.split('\0').filter(Boolean)};
}

export async function runChecks(cwd,base,head,checks,{staged=false}={}){
  const results=[];
  for(const kind of checks){
    let result;
    if(kind==='diff')result=await git(cwd,['diff','--check',...(staged?['--cached',base]:[base,head])],{allowFailure:true});
    else if(kind==='node-test'){
      const env={...process.env};delete env.NODE_TEST_CONTEXT;
      try{const r=await execute(process.execPath,['--test','--test-reporter=tap'],{cwd,windowsHide:true,timeout:120000,maxBuffer:2*1024*1024,env});const count=Number(/(?:^|\n)# tests (\d+)/.exec(r.stdout)?.[1]??0);result={ok:count>0,...r,...(count?{}:{stderr:r.stderr+'\nNo actual Node tests were observed',code:'NO_TESTS'})};}
      catch(e){result={ok:false,stdout:e.stdout??'',stderr:e.stderr??e.message,code:e.code??'UNKNOWN'};}
    }else fail('CHECK_UNSUPPORTED','Choose a supported verification check');
    results.push({kind,status:result.ok?'passed':'failed',exitCode:result.ok?0:result.code??1,stdout:result.stdout.slice(-12000),stderr:result.stderr.slice(-6000)});
  }
  return {status:results.every(r=>r.status==='passed')?'passed':'failed',checks:results};
}
