import { find, fail, entity, changed } from './domain.mjs';

/** Desktop control is a distinct MCP capability; a browser never qualifies it. */
export function createControlService({store,connections}){
  return {
    async acquire({projectId,targetId,controllerId}){
      if(!controllerId)fail('VALIDATION','controllerId required');
      return store.transaction(s=>{const target=find(s,'desktopTargets',targetId,projectId);if(target.controllerId&&target.controllerId!==controllerId)fail('TARGET_BUSY','Another controller owns this target. Stop or take over explicitly.',409);target.controllerId=controllerId;target.controlState='owned';changed(target);return target;});
    },
    async action({projectId,targetId,controllerId,operationId,name,arguments:args}){
      const target=find(store.read(),'desktopTargets',targetId,projectId);if(target.controllerId!==controllerId||target.controlState!=='owned')fail('CONTROLLER_REQUIRED','Acquire this target before sending input',409);
      if(!target.capabilities?.includes(name))fail('CAPABILITY','Target does not advertise this operation',409);
      return connections.call(target.connectionId,{name,arguments:args,operationId,projectId});
    },
    async stop({projectId,targetId,controllerId,takeover=false}){
      return store.transaction(s=>{const target=find(s,'desktopTargets',targetId,projectId);if(!takeover&&target.controllerId!==controllerId)fail('CONTROLLER_REQUIRED','Only the controller can release this target',409);target.controllerId=null;target.controlState=takeover?'human_control':'stopped';target.stopQualification='FORGE blocks further dispatch. Already in-flight remote input outcome requires driver reconciliation.';changed(target);return target;});
    },
    async select({projectId,requires=[]}){
      const s=store.read();find(s,'projects',projectId);const candidates=s.skills.filter(x=>x.projectId===projectId&&x.status==='active'&&requires.every(c=>x.requires?.includes(c)));
      return {method:'explicit capability filtering; not learned optimization',candidates:candidates.map(x=>({id:x.id,name:x.name,version:x.version,evidence:x.evidence??[]}))};
    },
  };
}
