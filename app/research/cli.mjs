import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openStore} from '../server/store.mjs';
import {createResearchService,defaultResearchConfig} from './index.mjs';
import {runResearchExperiment,readPinnedResearchConfig} from './runner.mjs';
// Explicit engineering fixture CLI. It never opens the real product state or
// supplies browser credentials, provider identities, or native runtime handles.
const args=process.argv.slice(2);
if(args[0]!=='--fixture'||![1,3].includes(args.length)||args.length===3&&args[1]!=='--config'){
  process.stderr.write('Usage: node app/research/cli.mjs --fixture [--config pinned-config.json]\n');process.exitCode=2;
}else{
  let store,service;
  try{
    let config=defaultResearchConfig(),expectedConfigDigest=null;if(args[2]){const bytes=await readFile(args[2]);if(bytes.length>2000000)throw new Error('Config/export exceeds 2 MB');({config,expectedConfigDigest}=readPinnedResearchConfig(JSON.parse(bytes)));}
    if(config.execution!=='local')throw new Error('Fixture CLI permits only fixed local CPU fixtures');
    const dataDir=await mkdtemp(path.join(os.tmpdir(),'forge-research-headless-')),projectId=randomUUID(),caller=Object.freeze({});
    store=await openStore(dataDir);await store.transaction(s=>{s.projects.push({id:projectId,name:'HEADLESS_ENGINEERING_FIXTURE',revision:1});});
    service=createResearchService({store,dataDir,authorizeOwner:(_r,c)=>c===caller?{kind:'human',role:'owner',subject:'explicit-headless-fixture'}:null});
    const result=await runResearchExperiment({service,caller,projectId,config,expectedConfigDigest});process.stdout.write(JSON.stringify({qualification:'REAL_LOCAL_FIXTURE_NO_AGENT_PROVIDER',dataDir,...result})+'\n');
    if(result.data.trials.some(t=>t.status!=='PASSED'))process.exitCode=1;
  }catch(error){process.stderr.write(JSON.stringify({error:{code:error.code??'RESEARCH_RUNNER',message:error.message}})+'\n');process.exitCode=1;}
  finally{await service?.close();await store?.close();}
}
