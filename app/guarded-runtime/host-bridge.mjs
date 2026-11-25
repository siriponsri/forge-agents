import {readFileSync} from 'node:fs';
import {createProfileAuthority,digest,bytesDigest,fail} from './profile.mjs';
import {canonicalGuard} from './canonical-guard.mjs';
import {createBoundedBroker} from './broker.mjs';

/** Lead-owned native bootstrap seam. None of these callbacks, opaque handles or
 * profile bytes belong in model-visible launch/config/MCP arguments. The root
 * qualifier remains null until complete actual-runtime evidence exists.
 *
 * readRunState is canonical FORGE state; observeRoute is the native adapter's
 * actual provider/account/model/typed-options/revision/binary observation. The
 * host must atomically mutate Stop/policy/route under the SAME withFence used
 * by receive. Merely supplying this bridge/config cannot create evidence.
 */
export function createGuardedHostBridge({readRunState,observeRoute,observeManifest,observeContext,observePolicyGeneration,binaries,snapshot,proofForRun,ordinaryGovernance,withFence,clock=Date.now}){
  for(const fn of [readRunState,observeRoute,observeManifest,observeContext,observePolicyGeneration,snapshot,proofForRun,ordinaryGovernance,withFence])if(typeof fn!=='function')fail('HOST_BRIDGE_REQUIRED');
  if(!binaries?.t3||!binaries?.opencode)fail('OBSERVED_BINARIES_REQUIRED');
  const sync=(fn,...args)=>{const value=fn(...args);if(value?.then)fail('SYNCHRONOUS_OBSERVATION_REQUIRED');return value;};
  const readCurrent=runId=>{
    const current=sync(readRunState,runId);if(!current?.profile)fail('PRIVATE_PROFILE_REQUIRED');
    const p=current.profile;
    if(digest(sync(observeRoute,runId))!==digest(p.route))fail('OBSERVED_ROUTE_CHANGED');
    if(bytesDigest(readFileSync(binaries.t3))!==p.route.t3BinarySha256||bytesDigest(readFileSync(binaries.opencode))!==p.route.opencodeBinarySha256)fail('OBSERVED_BINARY_CHANGED');
    if(digest(sync(observeManifest,runId))!==p.manifestDigest)fail('MANIFEST_CHANGED');
    if(digest(sync(observeContext,runId))!==p.contextDigest)fail('CONTEXT_CHANGED');
    if(sync(observePolicyGeneration,runId)!==p.policyGeneration)fail('POLICY_CHANGED');
    const proof=sync(proofForRun,p);if(!proof)fail('NATIVE_ENFORCEMENT_UNQUALIFIED');
    return current;
  };
  const authority=createProfileAuthority({readCurrent,clock});
  const admit=canonicalGuard({snapshot,currentProof:proofForRun,ordinaryGovernance,clock});
  return Object.freeze({
    bindRun({profile,key,file,receiptPath}){
      // bind() alone has no effect authority; force actual observations/proof
      // now too, and repeat inside every action while canonical fence is held.
      const handle=authority.bind(profile);authority.assert(handle);
      const broker=createBoundedBroker({authority,handle,key,file,receiptPath,withFence,authorize:admit});
      return Object.freeze({profileHandle:handle,assertCurrent:()=>authority.assert(handle),receive:broker.receive,close:broker.close});
    },
  });
}
