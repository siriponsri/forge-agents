import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { error, secret } from './common.mjs';

const worker=await readFile(new URL('./ssh-worker.py',import.meta.url),'utf8');
// This command is constant. All project paths, source, IDs and actions travel on stdin.
const command=`python3 -c "import base64;exec(base64.b64decode('${Buffer.from(worker).toString('base64')}'))"`;
export function sshArgs(c){const known=secret(c.knownHostsFileEnv).replace(/\\/g,'/');if(/[\r\n"%]/.test(known))error('COMPUTE_CONFIG','Selected known-hosts path contains unsupported characters');return ['-F','none','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',`UserKnownHostsFile="${known}"`,'-o','IdentitiesOnly=yes','-o','ClearAllForwardings=yes','-o','PermitLocalCommand=no','-o','ConnectTimeout=10',...(c.identityFileEnv?['-i',secret(c.identityFileEnv)]:[]),'-p',String(c.port),`${c.user}@${c.host}`,command];}
export async function ssh(c,action,job,{spawnProcess=spawn}={}){
  const args=sshArgs(c);const req={action,expectedMachineId:c.expectedMachineId,...(job?{jobId:job.id,owner:job.ownerToken,workspace:c.workspace,code:job.code,checkpointPath:job.checkpoint?.path,limitSeconds:job.limitSeconds,workerSource:worker}:{})};
  return new Promise((resolve,reject)=>{
    const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','Path','SystemRoot','USERPROFILE','HOME','TEMP','TMP','SSH_AUTH_SOCK'].includes(k)));
    const child=spawnProcess('ssh',args,{shell:false,windowsHide:true,env,stdio:['pipe','pipe','pipe']});let out='',size=0,done=false;
    const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);err?reject(err):resolve(value);};
    const uncertain=()=>Object.assign(new Error('SSH transport failed or timed out; reconcile owned receipt before retry'),{code:'COMPUTE_UNCERTAIN',statusCode:502});
    const timer=setTimeout(()=>{child.kill();finish(uncertain());},c.timeoutMs);
    child.stdout.on('data',b=>{size+=b.length;if(size>2000000){child.kill();finish(uncertain());}else out+=b;});
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.on('error',()=>finish(uncertain()));
    child.on('close',code=>{let data;try{data=JSON.parse(out);}catch{return finish(uncertain());}if(code||data.error)return finish(Object.assign(new Error(['HOST_IDENTITY_MISMATCH','OWNERSHIP_MISMATCH'].includes(data.error)?data.error:'Remote worker refused request'),{code:data.error==='HOST_IDENTITY_MISMATCH'?'HOST_IDENTITY_MISMATCH':'COMPUTE_REMOTE',statusCode:409}));finish(null,data);});
    child.stdin.end(JSON.stringify(req));
  });
}
export async function sshHealth(c){const observed=await ssh(c,'health');return {...observed,verified:!!c.expectedMachineId&&observed.machineId===c.expectedMachineId,execution:!!c.expectedMachineId&&observed.machineId===c.expectedMachineId};}
