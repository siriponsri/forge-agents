import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { find, fail, confined, now } from './domain.mjs';
const execute=promisify(execFile),sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
export function createGitStorageService({store}){
  async function target(projectId){const project=find(store.read(),'projects',projectId);const workspace=await realpath(project.workspace);if(workspace.toLowerCase()===(await realpath(sourceRoot)).toLowerCase())fail('SOURCE_BOUNDARY','Select a user output repository, separate from FORGE source',403);const top=(await execute('git',['rev-parse','--show-toplevel'],{cwd:workspace,windowsHide:true})).stdout.trim();if((await realpath(top)).toLowerCase()!==workspace.toLowerCase())fail('GIT_ROOT','Select the root folder of the output repository');return {project,workspace};}
  return {
    async run({projectId,operationId,action,message,paths=[]}){
      const {project,workspace}=await target(projectId);const git=async args=>(await execute('git',args,{cwd:workspace,windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout;
      if(action==='status')return {status:await git(['status','--porcelain=v1']),branch:(await git(['branch','--show-current'])).trim(),remotes:await git(['remote','-v'])};
      if(!['commit','push'].includes(action))fail('VALIDATION','Choose status, commit or push');if(!operationId)fail('VALIDATION','operationId required');
      const reservation=await store.transaction(s=>{const existing=s.events.find(x=>x.type==='storage.git'&&x.operationId===operationId);if(existing){if(existing.projectId!==projectId||existing.action!==action)fail('OPERATION_REUSE','Git operation belongs to another command',409);return {...existing,replayed:true};}const e={id:crypto.randomUUID(),type:'storage.git',operationId,projectId,action,status:'pending',createdAt:now()};s.events.push(e);return e;});if(reservation.replayed)return reservation;
      let output,status='completed',error;
      try{
        if(action==='commit'){
          if(!message?.trim()||!paths.length)fail('VALIDATION','Choose files and enter a commit message');
          const relative=[];for(const file of paths){const scoped=await confined(workspace,file);relative.push(path.relative(workspace,scoped));}
          await git(['add','--',...relative]);output=await git(['commit','-m',message,'--only','--',...relative]);
        }else{
          const config=project.profile?.storage?.git;if(!config?.remote||!config.branch)fail('SETUP_REQUIRED','Configure an output remote and branch before pushing');
          if(config.remote.startsWith('-')||config.branch.startsWith('-'))fail('VALIDATION','Invalid remote/branch');
          const remoteUrl=(await git(['remote','get-url',config.remote])).trim();if(/:\/\/[^/]+@/.test(remoteUrl))fail('CREDENTIAL_URL','Use the native Git credential manager, not credentials in a remote URL');
          output=await git(['push',config.remote,`HEAD:refs/heads/${config.branch}`]);
        }
      }catch(e){status='failed';error=e.message;}
      return store.transaction(s=>{const e=s.events.find(x=>x.id===reservation.id);Object.assign(e,{status,output,error,finishedAt:now()});return e;});
    },
  };
}
