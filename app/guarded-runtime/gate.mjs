import {fail,digest,TOOLS} from './profile.mjs';

// Construct only in the trusted native MCP-registration path after an
// authenticated broker handshake. Registration names/options are NOT provenance.
// Native patch integration is deliberately separate from this executable gate.
export function createNativeGate({authority,handle,manifest}){
  const p=authority.assert(handle);
  if(digest(manifest)!==p.manifestDigest)fail('MANIFEST_CHANGED');
  const trusted=new WeakMap();
  const current=()=>{
    const live=authority.assert(handle);
    if(digest(manifest)!==live.manifestDigest)fail('MANIFEST_CHANGED');
    return live;
  };
  return Object.freeze({
    registerAuthenticated(tool,attestation){
      current();
      if(!tool||typeof tool!=='object'||!TOOLS.includes(attestation?.operation)||attestation.runId!==p.runId||attestation.threadId!==p.threadId||attestation.toolGeneration!==p.toolGeneration||attestation.manifestDigest!==p.manifestDigest||attestation.authenticated!==true)fail('MCP_PROVENANCE_DENIED');
      const entry=manifest.find(x=>x.operation===attestation.operation);
      if(!entry||entry.rawName!==attestation.rawName||entry.serverIdentity!==attestation.serverIdentity||entry.schemaDigest!==attestation.schemaDigest)fail('MCP_PROVENANCE_DENIED');
      trusted.set(tool,Object.freeze({...entry}));
    },
    assert({rawName,resolvedName,tool,context}){
      current();const entry=trusted.get(tool);
      if(!entry||rawName!==entry.rawName||resolvedName!==entry.rawName||context?.sessionID!==p.threadId||context?.codemode||context?.background||context?.parentCallId||context?.delegated)fail('NATIVE_TOOL_DENIED');
      return entry.operation;
    },
    context(){current();fail('NATIVE_CONTEXT_DENIED');},
  });
}

// No native matching build has been qualified by this module. Host integration
// must retain this null result until native provenance/context/lifecycle wiring
// is implemented and tested on the actual derivative, not this helper.
export const qualifyGuardedRuntime=()=>null;
