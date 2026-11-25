import { inspect } from 'node:util';
import { envRef, error } from './common.mjs';

/** Resolver is host-owned: bind project, purpose, revision and generation in its closure. */
export async function prepareComputeEnvironment(config,resolver){
  if(typeof resolver!=='function')error('COMPUTE_CONFIG','A trusted compute secret resolver is required');
  const names=new Set(),seen=new Set();
  function visit(c){
    if(!c||typeof c!=='object'||Array.isArray(c))error('COMPUTE_CONFIG','Invalid compute configuration');
    if(seen.has(c))error('COMPUTE_CONFIG','Cyclic compute executor configuration');seen.add(c);
    for(const field of ['authEnv','identityFileEnv','knownHostsFileEnv'])if(Object.hasOwn(c,field)&&c[field]!==undefined){envRef(c[field]);names.add(c[field]);}
    if(Object.hasOwn(c,'executor')&&c.executor!==undefined)visit(c.executor);
  }
  visit(config);const env=Object.create(null);
  for(const name of names){
    let value;try{value=await resolver(name);}catch{error('CREDENTIAL_REQUIRED',`Resolve compute environment reference ${name} for this project and purpose`,409);}
    if(typeof value!=='string'||!value.length)error('CREDENTIAL_REQUIRED',`Configure compute environment reference ${name}`,409);
    Object.defineProperty(env,name,{value,enumerable:true});
  }
  // Keep normal own-property/spread access for trusted transport wiring, with safe incidental
  // JSON/logging of the runtime wrapper. The env map itself must remain host-only and ephemeral.
  Object.defineProperty(env,inspect.custom,{value:()=>`[Compute environment: ${[...names].join(', ')}]`});Object.freeze(env);
  const runtime={env};Object.defineProperty(runtime,'toJSON',{value:()=>({environmentReferences:[...names]})});Object.defineProperty(runtime,inspect.custom,{value:()=>`[Compute runtime: ${[...names].join(', ')}]`});
  return Object.freeze(runtime);
}
