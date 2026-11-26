// Trainer backend interface (browser-safe, no Node imports). Training is NOT
// wired in this checkpoint: the lead owns the universal training plan
// (tabular, vision, text, LLM fine-tuning across local/Colab/Jupyter/SSH/cloud
// GPU). A backend is a descriptor {id,label,supports,plan,run,artifacts};
// Studio only asks which declared backends fit a task spec so plans stay honest.
const error=(code,message,statusCode)=>Object.assign(new Error(message),{code,statusCode});

export const TRAINER_BACKEND_FIELDS=Object.freeze(['id','label','supports','plan','run','artifacts']);
export function defineTrainerBackend(spec){
  if(!spec||typeof spec!=='object')throw new TypeError('Trainer backend must be an object');
  for(const key of TRAINER_BACKEND_FIELDS)if(spec[key]===undefined)throw new TypeError(`Trainer backend is missing ${key}`);
  if(typeof spec.id!=='string'||!/^[a-z][a-z0-9-]{1,47}$/.test(spec.id))throw new TypeError('Trainer backend id must be a short kebab-case identifier');
  if(typeof spec.label?.th!=='string'||typeof spec.label?.en!=='string')throw new TypeError('Trainer backend label needs th and en');
  for(const key of ['supports','plan','run','artifacts'])if(typeof spec[key]!=='function')throw new TypeError(`Trainer backend ${key} must be a function`);
  return Object.freeze({...spec,label:Object.freeze({...spec.label}),status:spec.status??'available'});
}
export function createTrainerRegistry(backends=[]){
  const items=new Map();
  for(const b of backends){const d=defineTrainerBackend(b);if(items.has(d.id))throw new TypeError(`Duplicate trainer backend ${d.id}`);items.set(d.id,d);}
  return {
    list:()=>[...items.values()],
    get(id){const b=items.get(id);if(!b)throw error('TRAINER_NOT_FOUND','Trainer backend not found',404);return b;},
    /** Plain, serialisable summary for briefs and UI. */
    compatible(taskSpec){return [...items.values()].map(b=>{let supported=false;try{supported=b.supports(taskSpec)===true;}catch{/* unsupported */}return {id:b.id,label:{...b.label},status:b.status,supported};});},
  };
}
/** Declared only: quick local baseline for small tables. Not THE trainer. */
export const localQuickBaseline=defineTrainerBackend({
  id:'local-quick-baseline',status:'declared',
  label:{th:'โมเดลพื้นฐานแบบเร็วในเครื่องนี้ (ใช้เป็นเส้นเทียบ)',en:'Quick local baseline on this computer (for comparison)'},
  supports:t=>t?.modality==='tabular'&&['classification','regression'].includes(t?.taskType)&&(t?.compute==null||t.compute==='local_cpu'),
  plan:t=>({steps:['profile','split-80-20-seeded','fit-linear-or-logistic','holdout-metrics-vs-naive'],outputs:['forge.linear.v1','forge.standardize.v1'],taskType:t?.taskType??null}),
  run:()=>{throw error('TRAINER_PENDING','Training is not available in this FORGE build yet',409);},
  artifacts:()=>['forge.linear.v1','forge.standardize.v1'],
});
export const defaultTrainerRegistry=()=>createTrainerRegistry([localQuickBaseline]);
