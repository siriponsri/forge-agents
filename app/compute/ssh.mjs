import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { error, secret, clean, checkRuntimeSignal } from './common.mjs';

const worker=await readFile(new URL('./ssh-worker.py',import.meta.url),'utf8');
// This command is constant. All project paths, source, IDs and actions travel on stdin.
const command=`python3 -c "import base64;exec(base64.b64decode('${Buffer.from(worker).toString('base64')}'))"`;
export function sshArgs(c,runtime={}){const known=secret(c.knownHostsFileEnv,runtime).replace(/\\/g,'/');if(/[\r\n"%]/.test(known))error('COMPUTE_CONFIG','Selected known-hosts path contains unsupported characters');const identity=c.identityFileEnv?secret(c.identityFileEnv,runtime):null;if(identity&&/[\r\n]/.test(identity))error('COMPUTE_CONFIG','Selected identity-file reference must be a filepath');return ['-F','none','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',`UserKnownHostsFile="${known}"`,'-o','IdentitiesOnly=yes','-o','ClearAllForwardings=yes','-o','PermitLocalCommand=no','-o','ConnectTimeout=10',...(identity?['-i',identity]:[]),'-p',String(c.port),`${c.user}@${c.host}`,command];}
export async function ssh(c,action,job,runtime={}){
  if(runtime.beforeDispatch)await runtime.beforeDispatch();
  checkRuntimeSignal(runtime);const {spawnProcess=spawn}=runtime;
  const args=sshArgs(c,runtime);const req={action,expectedMachineId:c.expectedMachineId,...(job?{jobId:job.id,owner:job.ownerToken,workspace:c.workspace,code:job.code,checkpointPath:job.checkpoint?.path,limitSeconds:job.limitSeconds,workerSource:worker}:{})};
  return new Promise((resolve,reject)=>{
    const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','Path','SystemRoot','USERPROFILE','HOME','TEMP','TMP','SSH_AUTH_SOCK'].includes(k)));
    let child,out='',size=0,done=false,timer;
    const uncertain=()=>Object.assign(new Error('SSH transport failed or timed out; reconcile owned receipt before retry'),{code:'COMPUTE_UNCERTAIN',statusCode:502});
    const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);runtime.signal?.removeEventListener('abort',abort);err?reject(err):resolve(value);};
    const abort=()=>{child?.kill();finish(Object.assign(new Error('SSH transport cancelled; reconcile owned receipt before retry'),{code:'COMPUTE_UNCERTAIN',statusCode:502}));};
    try{child=spawnProcess('ssh',args,{shell:false,windowsHide:true,env,stdio:['pipe','pipe','pipe']});}catch{return finish(uncertain());}
    timer=setTimeout(()=>{child.kill();finish(uncertain());},c.timeoutMs);
    child.stdout.on('data',b=>{size+=b.length;if(size>2000000){child.kill();finish(uncertain());}else out+=b;});
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.on('error',()=>finish(uncertain()));
    child.on('close',code=>{let data;try{data=JSON.parse(out);}catch{return finish(uncertain());}if(code||data.error)return finish(Object.assign(new Error(['HOST_IDENTITY_MISMATCH','OWNERSHIP_MISMATCH'].includes(data.error)?data.error:'Remote worker refused request'),{code:data.error==='HOST_IDENTITY_MISMATCH'?'HOST_IDENTITY_MISMATCH':'COMPUTE_REMOTE',statusCode:409}));const redact=v=>typeof v==='string'?clean(v,c,runtime):Array.isArray(v)?v.map(redact):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[clean(k,c,runtime),redact(x)])):v;finish(null,redact(data));});
    runtime.signal?.addEventListener('abort',abort,{once:true});if(runtime.signal?.aborted){abort();return;}
    child.stdin.end(JSON.stringify(req));
  });
}
export async function sshHealth(c,runtime={}){const observed=await ssh(c,'health',undefined,runtime);return {...observed,verified:!!c.expectedMachineId&&observed.machineId===c.expectedMachineId,execution:!!c.expectedMachineId&&observed.machineId===c.expectedMachineId};}
