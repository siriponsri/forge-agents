import {prepareComputeEnvironment} from '../compute/environment.mjs';
import {hash,validateConfig} from '../compute/common.mjs';
import {find,fail} from './domain.mjs';

export function createComputeCredentialRuntime({store,secrets}) {
  const active=new Set();
  return {
    async prepare({projectId,config,targetId}) {
      const checkTarget=()=>{
        find(store.read(),'projects',projectId);
        if(targetId){const target=find(store.read(),'connections',targetId,projectId);if(target.kind!=='compute'||target.enabled===false||hash(validateConfig(target.config))!==hash(config))fail('COMPUTE_BINDING_CHANGED','Compute target changed. Review the selected target before another request.',409);}
      };
      checkTarget();
      let metadata;const references=[];
      const base=await prepareComputeEnvironment(config,async name=>{
        metadata??=(await secrets.list({projectId,purpose:'compute'})).secrets;
        const matches=metadata.filter(record=>record.envName===name);
        if(matches.length>1)fail('COMPUTE_CREDENTIAL_AMBIGUOUS','Select one exact compute credential reference.',409);
        const record=matches[0];
        if(record){references.push({name,reference:record.reference,revision:record.revision,generation:record.generation,source:'vault'});return secrets.resolveRef({projectId,reference:record.reference,purpose:'compute',expectedRevision:record.revision,generation:record.generation});}
        references.push({name,source:'environment'});return secrets.resolveEnv({projectId,name,purpose:'compute'});
      });
      const controller=new AbortController(),binding={projectId,names:new Set(references.map(record=>record.name)),controller};
      const beforeDispatch=async()=>{
        checkTarget();
        for(const reference of references){
          let value;
          try{value=reference.source==='vault'?await secrets.resolveRef({projectId,reference:reference.reference,purpose:'compute',expectedRevision:reference.revision,generation:reference.generation}):await secrets.resolveEnv({projectId,name:reference.name,purpose:'compute'});}catch{fail('COMPUTE_CREDENTIAL_CHANGED','Compute credentials changed or were removed. Review Settings and reconcile existing work.',409);}
          if(value!==base.env[reference.name])fail('COMPUTE_CREDENTIAL_CHANGED','Compute credentials changed before dispatch. Review Settings.',409);
        }
        checkTarget();
      };
      const runtime={};Object.defineProperties(runtime,Object.getOwnPropertyDescriptors(base));
      Object.defineProperties(runtime,{signal:{value:controller.signal},beforeDispatch:{value:beforeDispatch},references:{value:Object.freeze(references.map(record=>Object.freeze(record))),enumerable:true},dispose:{value:()=>{active.delete(binding);controller.abort();}}});
      active.add(binding);return Object.freeze(runtime);
    },
    invalidate({projectId,name}){for(const binding of active)if(binding.projectId===projectId&&binding.names.has(name))binding.controller.abort();},
    close(){for(const binding of active)binding.controller.abort();active.clear();}
  };
}
