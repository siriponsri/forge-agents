import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {find,fail,confined,changed} from './domain.mjs';
import {createComputeService} from '../compute/index.mjs';
import {createColabMcpAdapter} from '../compute/colab-mcp.mjs';
import {createComputeCredentialRuntime} from './compute-credentials.mjs';
import {prepareComputeEnvironment} from '../compute/environment.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');

// The browser selects canonical IDs. Only this host facade moves validated
// compute selection into the local process owner's private second argument.
export function createComputeRouter({store,dataDir,jobs,artifacts,admit,resolveBearer,resolveEnvironment,secrets}){
  const localJobs={start:({resolvedCompute,...input})=>jobs.start(input,{resolvedCompute}),stop:id=>jobs.stop(id)};
  const credentials=secrets?createComputeCredentialRuntime({store,secrets}):null;
  const prepareRuntime=credentials?.prepare??(async({projectId,config})=>prepareComputeEnvironment(config,async name=>{if(!resolveEnvironment)fail('CREDENTIAL_REQUIRED','Save the selected compute credential in Settings',409);return resolveEnvironment({projectId,name});}));
  const baseline=createComputeService({store,dataDir,localJobs,admit,prepareRuntime});
  const colab=createColabMcpAdapter({store,dataDir,resolveBearer,resolveEnvironment,admit});
  function targetKind(input){
    const s=store.read(),p=find(s,'projects',input.projectId);
    let choice=p.profile?.compute??{kind:'local'};
    if(input.phaseId){find(s,'phases',input.phaseId,p.id);choice=p.profile?.phaseOverrides?.[input.phaseId]?.compute??choice;}
    const n=input.notebookId?find(s,'notebooks',input.notebookId,p.id):null;if(n?.compute)choice=n.compute;
    const id=input.targetId??choice.connectionId??choice.targetId;
    if(!id)return choice.kind??'local';
    const c=find(s,'connections',id,p.id);if(c.kind!=='compute'||c.enabled===false)fail('COMPUTE_SCOPE','Select an enabled compute target',409);return c.config?.kind;
  }
  const selected=input=>targetKind(input)==='colab-mcp'?colab:baseline;
  function owner(input){const j=find(store.read(),'jobs',input.jobId,input.projectId);if(!j.notebookId)fail('COMPUTE_SCOPE','Select a notebook attempt',409);return j.computeAttempt?.kind==='colab-mcp'?colab:baseline;}
  async function publish(input,result){
    if(!result?.resultRef&&!result?.localPath)return result;
    const s=store.read(),j=find(s,'jobs',input.jobId??result.id,input.projectId),p=find(s,'projects',j.projectId);
    const ref=result.resultRef??result,source=ref.path??ref.localPath;
    const sourcePath=await confined(path.join(dataDir,'compute',j.id),source),bytes=await readFile(sourcePath);
    if(hash(bytes)!==ref.sha256||bytes.length!==ref.bytes)fail('INTEGRITY','Compute result no longer matches its verified receipt',409);
    const dir=await confined(p.workspace,path.join('.forge','compute',j.id),{existing:false});await mkdir(dir,{recursive:true});await confined(p.workspace,dir);
    const name=result.resultRef?'owner-result.ipynb':path.basename(result.relativePath??'download.bin');
    const file=await confined(p.workspace,path.join(dir,`${ref.sha256}-${name}`),{existing:false});
    try{await writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||hash(await readFile(file))!==ref.sha256)throw e;}
    const a=await artifacts.register({projectId:p.id,path:file,kind:'compute-result',source:{kind:'compute-result',jobId:j.id,operationId:input.operationId??j.operationId,sourceSha256:j.source?.sha256,provenance:result.provenance??null}});
    await store.transaction(state=>{const job=find(state,'jobs',j.id,p.id);job.artifactRefs??=[];if(!job.artifactRefs.includes(a.id)){job.artifactRefs.push(a.id);changed(job);}});
    const out={...result,artifactId:a.id};delete out.localPath;return out;
  }
  const api={
    configure:input=>(input.config?.kind==='colab-mcp'?colab:baseline).configure(input),
    health:input=>selected(input).health(input),
    async start(input){
      const allowed=['projectId','notebookId','operationId','phaseId','targetId','mode','previousJobId','checkpointArtifactId'];
      if(Object.keys(input).some(k=>!allowed.includes(k)))fail('COMPUTE_INPUT','Start with canonical target and notebook IDs only',400);
      const prior=store.read().jobs.find(j=>j.operationId===input.operationId);
      return (prior?owner({projectId:input.projectId,jobId:prior.id}):selected(input)).start(input);
    },
    status:input=>owner(input).status(input),logs:input=>owner(input).logs(input),stop:input=>owner(input).stop(input),
    async reconcile(input={}){return input.jobId?owner(input).reconcile(input):[...await baseline.reconcile(input),...await colab.reconcile(input)];},
    lifecycle:input=>baseline.lifecycle(input),exportNotebook:input=>owner(input).exportNotebook(input),
    async importResult(input){const result=await owner(input).importResult(input);return publish(input,result);},
    linkArtifact:input=>baseline.linkArtifact(input),
    async uploadArtifact(input){
      if(input.bytes!==undefined||input.base64!==undefined)fail('COMPUTE_INPUT','Select a registered artifact, never inline bytes');
      const a=find(store.read(),'artifacts',input.artifactId,input.projectId);if(a.status!=='verified')fail('INTEGRITY','Select a verified artifact',409);
      const file=await artifacts.download(a.id),bytes=await readFile(file.path);
      const {artifactId,...request}=input;return colab.uploadArtifact({...request,sha256:a.sha256,bytes});
    },
    async downloadArtifact(input){return publish(input,await colab.downloadArtifact(input));},
    reconcileTransfer:input=>colab.reconcileTransfer(input),
    invalidateCredential:input=>credentials?.invalidate(input),
    async shutdown(){credentials?.close();await baseline.shutdown();await colab.shutdown();},
  };return api;
}
