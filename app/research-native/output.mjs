import path from 'node:path';
import {open,lstat} from 'node:fs/promises';
import {inspectWorkspace,noLinks} from '../workspaces/git.mjs';
import {pathKey} from '../workspaces/contracts.mjs';
import {append,digest} from '../research/contracts.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code,statusCode:409});};
/** Fixed basename bootstrap only; never an agent create-file capability.
 * Call AFTER bridge.prepare's pristine check and BEFORE native launch. The
 * existing canonical store writer serializes this with Stop/restore/policy.
 * A crash-created orphan is preserved and refused, never silently adopted.
 */
export async function precreateResearchOutput({store,dataDir,runId,admit,clock=Date.now}){
  if(!store?.transaction||typeof admit!=='function')throw new TypeError('Canonical writer/admission required');
  return store.transaction(async s=>{
    const run=s.runs.find(r=>r.id===runId);
    const check=()=>{const value=admit(s,{run,stage:'output-bootstrap'});if(value!==true)fail('RESEARCH_NATIVE_OUTPUT_ADMISSION');};
    check();
    const c=run.researchContext,workspaceId=run.workspaceContext?.workspaceId??c?.workspaceId,w=s.events.find(e=>e.type==='workspace.workspace'&&e.projectId===run.projectId&&e.id===workspaceId);
    if(!w||w.taskId!==run.taskId||w.runOperationId!==run.operationId||pathKey(w.worktreePath)!==pathKey(run.workspace??run.actualWorkspace??''))fail('RESEARCH_NATIVE_OUTPUT_OWNERSHIP');
    const observed=await inspectWorkspace(w,dataDir);check();
    if(observed.head!==w.baseSha)fail('RESEARCH_NATIVE_OUTPUT_HEAD');
    const target=path.join(observed.path,'output.json');await noLinks(target);check();
    const prior=s.events.find(e=>e.type==='research.native-output'&&e.runId===run.id&&e.attemptId===run.attemptId);
    if(prior){
      const st=await lstat(target);check();
      if(!st.isFile()||st.nlink!==1||st.size!==0||prior.workspaceId!==w.id||prior.device!==st.dev||prior.inode!==st.ino||prior.digest!==digest({...prior,digest:undefined}))fail('RESEARCH_NATIVE_OUTPUT_CHANGED');
      return {path:target,revision:prior.revisionHash,replayed:true};
    }
    if(observed.dirty)fail('RESEARCH_NATIVE_OUTPUT_DIRTY');
    const file=await open(target,'wx',0o600);
    try{
      const st=await file.stat();await noLinks(target);const current=await lstat(target);check();
      if(!st.isFile()||st.nlink!==1||st.size!==0||current.ino!==st.ino||current.dev!==st.dev||current.nlink!==1)fail('RESEARCH_NATIVE_OUTPUT_CHANGED');
      await file.sync();
      const e=append(s,'native-output',{runId:run.id,attemptId:run.attemptId,trialId:c.trialId,manifestDigest:c.manifestDigest,workspaceId:w.id,name:'output.json',device:st.dev,inode:st.ino,revisionHash:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'},run.projectId,clock);e.digest=digest(e);
      return {path:target,revision:e.revisionHash,replayed:false};
    }finally{await file.close();}
  });
}
