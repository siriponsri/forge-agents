import {digest,fail} from './profile.mjs';
const slot=Symbol.for('FORGE.GuardedRoute.T3Host.v1');
const installed=new WeakSet();
const observations=new WeakMap();
const installationConnections=new WeakMap();
// Machine check capabilities authorize only a fixed native connection. They
// never resolve a thread/profile or grant a turn/action capability.
export function registerInstallationConnection(host,input,assertCurrent){
  assertInstalledT3Host(host);if(typeof assertCurrent!=='function')fail('INSTALLATION_HOST_REQUIRED');
  const entry={input:structuredClone(input),assertCurrent};installationConnections.get(host).add(entry);
  return ()=>installationConnections.get(host).delete(entry);
}
export function assertInstalledT3Host(host){if(!installed.has(host)||globalThis[slot]!==host)fail('PRIVATE_T3_HOST_REQUIRED');return host;}
export function observeInstalledT3Host(host,handle){assertInstalledT3Host(host);return structuredClone(observations.get(host)?.get(handle)??null);}

// Install only during trusted in-process application bootstrap, before importing
// the matching T3 server bundle. No HTTP/MCP/config method installs this slot.
// It binds opaque process-local handles to canonical T3 thread/run selection.
export function installT3GuardedHost({resolveThread,assertCurrent,runtimeDirectory,resolveConnection,toolNames}){
  if(globalThis[slot]||![resolveThread,assertCurrent,runtimeDirectory].every(x=>typeof x==='function'))fail('T3_HOST_ALREADY_INSTALLED');
  const seen=new WeakMap();
  const host=Object.freeze({
    directory:runtimeDirectory,
    ...(toolNames?{toolNames(handle){
      if(!seen.has(handle))fail('PRIVATE_PROFILE_REQUIRED');
      const p=assertCurrent(handle);if(!p||p.then)fail('PRIVATE_PROFILE_REQUIRED');
      const names=toolNames(handle,p);if(names?.then)fail('SYNCHRONOUS_ROUTE_OBSERVATION_REQUIRED');
      if(names!==undefined&&(p.purpose!=='supervised-frontend-v1'||JSON.stringify(names)!==JSON.stringify(['forge_frontend_selection_read'])))fail('PRIVATE_TOOL_PROFILE_REQUIRED');
      return names;
    }}:{}),
    connection(input){
      for(const check of installationConnections.get(host)??[]){
        if(['serverUrl','serverPassword','binaryPath','directory'].every(k=>input[k]===check.input[k])){if(check.assertCurrent()?.then)fail('SYNCHRONOUS_ROUTE_OBSERVATION_REQUIRED');return;}
      }
      if(typeof resolveConnection!=='function'||resolveConnection(input)!==true)fail('PRIVATE_NATIVE_CONNECTION_REQUIRED');
    },
    resolve(thread,modelSelection){const bound=resolveThread(thread,modelSelection);if(!bound||typeof bound!=='object'||bound.then)fail('PRIVATE_PROFILE_REQUIRED');if(!seen.has(bound))seen.set(bound,{resolved:true,phases:[]});return bound;},
    assert(handle,phase,input){
      const p=assertCurrent(handle);if(!p||p.then)fail('PRIVATE_PROFILE_REQUIRED');
      const threadId=input.threadId??input.targetThreadId??input.providerThread?.appThreadId;
      if(threadId!==undefined&&threadId!==p.threadId)fail('T3_THREAD_CHANGED');
      const selection=input.modelSelection;
      if(selection&&(selection.instanceId!==p.route.providerInstanceId||selection.model!==p.route.modelId||digest(selection.options??{})!==digest(p.route.options)))fail('T3_SELECTION_CHANGED');
      if(input.runtimePolicy&&(input.runtimePolicy.cwd!==runtimeDirectory(handle)||input.runtimePolicy.runtimeMode!=='approval-required'))fail('T3_RUNTIME_POLICY_CHANGED');
      const observation=seen.get(handle);if(!observation)fail('PRIVATE_PROFILE_REQUIRED');if(!observation.phases.includes(phase))observation.phases.push(phase);
      return p;
    },
  });
  Object.defineProperty(globalThis,slot,{value:host,writable:false,configurable:false,enumerable:false});
  installed.add(host);
  observations.set(host,seen);
  installationConnections.set(host,new Set());
  return host;
}
