import {validateStrategyContext} from './context.mjs';
import {digest,find,fail,rowWorkspace} from './contracts.mjs';
import {inspectWorkspace} from '../workspaces/git.mjs';

// Run after asynchronous prompt/provider preparation, outside the canonical
// writer, then immediately repeat pure admission before the sole dispatch.
export async function validateStrategyFiles({store,dataDir,runId}){
  const before=store.read(),run=find(before,'runs',runId),context=validateStrategyContext(before,run);
  if(!context)return;
  for(const ref of context.dependencyRefs){
    if(!ref.checkId)continue;
    if(!dataDir)fail('STRATEGY_INTEGRATION_REQUIRED','Canonical Workspace storage is required for final dependency inspection',409);
    const workspace=rowWorkspace(before,run.projectId,ref.workspaceId),proof=await inspectWorkspace(workspace,dataDir);
    if(proof.dirty||proof.head!==ref.head)fail('STRATEGY_DEPENDENCY_FILES','Checked predecessor files changed during setup; reconcile and review the retained allocation',409);
  }
  const after=store.read(),current=find(after,'runs',runId),retained=validateStrategyContext(after,current);
  if(digest(retained)!==digest(context))fail('STRATEGY_CONTEXT','Exact strategy allocation changed during final filesystem inspection',409);
}
