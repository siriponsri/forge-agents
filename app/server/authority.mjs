// Opaque host-created handles. JSON fields and model-supplied actor labels can
// never create a caller, scope grant, QA identity or Owner approval here.
export function createLocalAuthority(){
  const handles=new WeakMap(),owners=new WeakMap(),runs=new Map();
  function owner(session){
    if(!session||session.expiresAt<Date.now())return null;
    let handle=owners.get(session);if(!handle){handle=Object.freeze({});owners.set(session,handle);handles.set(handle,{kind:'owner',session,subject:'local-owner'});}return handle;
  }
  function forRun(run,{allowWrite=false}={}){
    const key=`${run.id}:${run.attemptId}:${allowWrite}`,known=runs.get(key);if(known)return known;
    const handle=Object.freeze({});handles.set(handle,{kind:'run',projectId:run.projectId,runId:run.id,attemptId:run.attemptId,allowWrite});runs.set(key,handle);return handle;
  }
  function validScope(scope,state){
    if(!scope||!state.projects.some(p=>p.id===scope.projectId))return false;
    if(scope.kind==='project')return scope.id===scope.projectId;
    if(scope.kind==='owner')return scope.id==='local-owner';
    if(scope.kind==='team')return scope.id===scope.projectId||state.conversations.some(c=>c.projectId===scope.projectId&&c.id===scope.id&&c.kind==='team');
    const key={agent:'bots',session:'conversations',task:'tasks'}[scope.kind];
    return !!key&&state[key].some(x=>x.id===scope.id&&x.projectId===scope.projectId);
  }
  function authorize({action,scope,callerContext,state}){
    const identity=handles.get(callerContext);if(!identity)return false;
    if(action.startsWith('owner.'))return identity.kind==='owner'&&identity.session.expiresAt>Date.now()&&scope?.kind==='owner'&&scope.id==='local-owner'&&scope.projectId===undefined;
    if(!validScope(scope,state))return false;
    if(identity.kind==='owner')return identity.session.expiresAt>Date.now();
    const run=state.runs.find(r=>r.id===identity.runId&&r.projectId===identity.projectId&&r.attemptId===identity.attemptId);
    if(!run||run.projectId!==scope.projectId||run.stopRequest||['failed','cancelled','interrupted','rolled_back','stopped'].includes(run.status))return false;
    const ids={project:run.projectId,team:run.projectId,agent:run.botId,session:run.conversationId,task:run.taskId};
    if(ids[scope.kind]!==scope.id)return false;
    if(action.startsWith('context.'))return ['preDispatch','compose','compact','resolve','retrieve','status','usage'].includes(action.slice(8));
    if(action==='read')return true;
    return action==='write'&&identity.allowWrite&&['submitting','starting','running','waiting'].includes(run.status)&&['project','agent','session','task'].includes(scope.kind);
  }
  function goalAuthorize(request,caller){
    const id=handles.get(caller);if(id?.kind!=='owner'||id.session.expiresAt<Date.now())return null;
    return {kind:'human',subject:id.subject,role:request.action==='qa'?'qa':'owner',independent:true};
  }
  return {owner,forRun,authorize,goalAuthorize};
}
