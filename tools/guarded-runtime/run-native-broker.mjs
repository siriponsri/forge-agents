import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {buildWindows} from './build-windows.mjs';
import {openConfinedText} from '../../app/guarded-runtime/windows-client.mjs';
import {createBoundedBroker} from '../../app/guarded-runtime/broker.mjs';
import {createProfileAuthority} from '../../app/guarded-runtime/profile.mjs';
const [source,bun]=process.argv.slice(2);
if(!path.isAbsolute(source??'')||!path.isAbsolute(bun??''))throw Error('ISOLATED_PATHS_REQUIRED');
const root=await mkdtemp(path.join(os.tmpdir(),'forge-guarded-protocol-'));
const workspace=path.join(root,'workspace');await mkdir(path.join(workspace,'allowed'),{recursive:true});
await writeFile(path.join(workspace,'allowed/a.txt'),'before');await writeFile(path.join(root,'outside.txt'),'OUTSIDE');
const build=await buildWindows(path.join(root,'build')),file=await openConfinedText({...build,root:workspace});
const hash='a'.repeat(64),key=randomBytes(32);
const profile={version:1,projectId:'project',taskId:'task',runId:'run',threadId:'thread',envelopeDigest:hash,identitySnapshot:hash,scope:{paths:['allowed'],capabilities:['read','propose','workspace.write'],maxBytes:65536},route:{providerInstanceId:'fixture-only',providerImplementation:'opencode2-api',accountGeneration:'no-account',modelId:'no-model-turn',options:{},t3Revision:'59651c1761f6c63e9b6056839067066968e6a406',opencodeRevision:'6f0514052a3c859894ad01bb14cc14dda1e44b96',t3BinarySha256:hash,opencodeBinarySha256:hash},policyGeneration:'1',toolGeneration:'1',manifestDigest:hash,contextDigest:hash,expiresAt:Date.now()+60000};
const authority=createProfileAuthority({readCurrent:()=>({profile,runtimeMode:'approval-required',governanceAllowed:true})}),handle=authority.bind(profile);
const broker=createBoundedBroker({authority,handle,key,file,receiptPath:path.join(root,'receipts.sqlite'),withFence:(_run,fn)=>fn(),authorize:()=>true});
const fixture=path.join(source,'packages/core/forge-guarded-protocol-fixture.ts');await copyFile(fileURLToPath(new URL('./native-broker-fixture.ts',import.meta.url)),fixture);
const env={SystemRoot:process.env.SystemRoot,TEMP:root,TMP:root,HOME:root,USERPROFILE:root,APPDATA:root,LOCALAPPDATA:root,XDG_CONFIG_HOME:root,XDG_DATA_HOME:root,XDG_CACHE_HOME:root,OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_DISABLE_MODELS_FETCH:'1'};
const child=spawn(bun,[fixture],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
const done=new Promise(resolve=>child.once('close',resolve));
let passed=false,stderr='';child.stderr.on('data',b=>{stderr+=b.toString();});child.stdin.write(JSON.stringify({key:key.toString('hex')})+'\n');
const timeout=setTimeout(()=>child.kill(),30000);
try{
  for await(const line of createInterface({input:child.stdout})){
    const msg=JSON.parse(line);
    if(msg.kind==='done'){passed=msg.nativeBrokerProtocol==='PASS';continue;}
    if(msg.kind!=='action')throw Error('PROTOCOL_UNKNOWN');
    try{child.stdin.write(JSON.stringify({ok:true,result:await broker.receive(msg.envelope)})+'\n');}
    catch(e){child.stdin.write(JSON.stringify({ok:false,error:e.code??'ACTION_DENIED'})+'\n');}
  }
  const exitCode=await done;assert.equal(exitCode,0,stderr);assert.equal(passed,true);
  assert.equal(await readFile(path.join(root,'outside.txt'),'utf8'),'OUTSIDE');assert.equal(await readFile(path.join(workspace,'allowed/a.txt'),'utf8'),'after');
  console.log(JSON.stringify({nativeModuleToAuthenticatedWindowsBroker:'PASS',outsideEffects:0,proof:null}));
}finally{clearTimeout(timeout);child.kill();await done;await broker.close();key.fill(0);await rm(root,{recursive:true,force:true});}
