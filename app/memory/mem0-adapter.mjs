import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdir, access, realpath, lstat, rm } from 'node:fs/promises';
import { object, text, fail, digest } from './contracts.mjs';

const worker=fileURLToPath(new URL('./mem0_worker.py',import.meta.url));
const requirements=fileURLToPath(new URL('./requirements.txt',import.meta.url));
export function validateBackendConfig(value) {
  object(value,['backend','vectorStore','embeddingModel','extractionModel','dimensions','ollamaUrl']);
  if(value.backend==='keyword'){if(Object.keys(value).length!==1)fail('MEMORY_VALIDATION','Keyword backend has no model configuration');return {backend:'keyword'};}
  if(value.backend!=='mem0'||!['qdrant-local-disk','qdrant-local-memory'].includes(value.vectorStore))fail('MEMORY_VALIDATION','Select local Qdrant storage for optional Mem0');
  text(value.embeddingModel,'embedding model',200);text(value.extractionModel,'extraction model',200);
  if(!Number.isSafeInteger(value.dimensions)||value.dimensions<8||value.dimensions>8192)fail('MEMORY_VALIDATION','Embedding dimensions must be 8..8192');
  let url;try{url=new URL(value.ollamaUrl);}catch{fail('MEMORY_VALIDATION','Invalid local Ollama URL');}
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')fail('MEMORY_VALIDATION','Use a loopback Ollama base URL without credentials');
  if(value.vectorStore==='qdrant-local-memory')fail('MEMORY_VALIDATION','Short-lived isolated workers require persistent local-disk Qdrant storage');
  return {...value,ollamaUrl:url.origin};
}
function execute(command,args,payload,{timeout=60000,env={},raw=false}={}) {
  return new Promise((resolve,reject)=>{
    const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(?:PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|HOME)$/i.test(key)));
    const child=spawn(command,args,{windowsHide:true,shell:false,env:{...inherited,...env},stdio:['pipe','pipe','pipe']});
    let bytes=0,out='',settled=false;const timer=setTimeout(()=>{child.kill();finish(Object.assign(new Error('Optional memory worker timed out'),{code:'MEMORY_VECTOR_TIMEOUT'}));},timeout);
    function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);}
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes>4*1024*1024){child.kill();finish(new Error('Memory worker output limit'));}else out+=b.toString('utf8');});
    // Never surface model output, stderr, environment or paths as API errors.
    child.stderr.on('data',()=>{});child.on('error',()=>finish(Object.assign(new Error('Set up the isolated Python memory environment first'),{code:'MEMORY_VECTOR_SETUP_REQUIRED'})));
    child.on('close',code=>{if(code!==0)return finish(Object.assign(new Error('Optional memory worker unavailable; verify dependencies and local models'),{code:'MEMORY_VECTOR_UNAVAILABLE'}));try{finish(null,raw?{ok:true}:JSON.parse(out));}catch{finish(new Error('Invalid memory worker response'));}});
    child.stdin.on('error',()=>{});child.stdin.end(payload===undefined?'':JSON.stringify(payload));
  });
}

// The host owns pythonCommand/dataDir. No subprocess path or shell text comes from
// GUI/MCP inputs. fixtureMode is a constructor-only engineering fixture seam.
export async function createMem0Adapter({dataDir,config,pythonCommand='python',fixtureMode=false,pythonPath}={}) {
  config=validateBackendConfig(config);if(config.backend!=='mem0'||!path.isAbsolute(dataDir??''))throw new TypeError('Absolute isolated adapter directory and Mem0 config required');
  const venv=path.join(dataDir,'python-env'),python=pythonPath??path.join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python');
  await mkdir(dataDir,{recursive:true});let signature,pending=Promise.resolve();
  const serial=fn=>{const task=pending.then(fn);pending=task.catch(()=>{});return task;};
  const env={MEM0_TELEMETRY:'false',DO_NOT_TRACK:'1',ANONYMIZED_TELEMETRY:'False',MEM0_DIR:path.join(dataDir,'mem0-private'),PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'};
  const call=(action,payload={})=>execute(python,[worker],{...payload,action,config,dataDir,fixtureMode},{env});
  const purge=async()=>{
    const root=await realpath(dataDir);
    // Only these dedicated derived paths, never python-env or the host data root.
    for(const name of ['qdrant','history.sqlite','history.sqlite-wal','history.sqlite-shm','mem0-private']){
      const target=path.resolve(root,name),relative=path.relative(root,target);
      if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Unsafe memory cache path');
      try {const stat=await lstat(target);if(stat.isSymbolicLink()||!path.relative(root,await realpath(target)).startsWith('..'))await rm(target,{recursive:stat.isDirectory()&&!stat.isSymbolicLink(),force:true});else throw new Error('Derived cache escaped its dedicated root');}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    signature=undefined;return {purged:true};
  };
  return {
    replace:records=>serial(async()=>{const current=digest(records);if(current===signature)return {unchanged:true};await purge();if(!records.length){signature=current;return {indexed:0};}const result=await call('replace',{records});signature=current;return result;}),
    purge:()=>serial(purge),
    search:input=>serial(()=>call('search',input)),
    health:()=>serial(()=>call('health')),
    // Explicit local model extraction returns DATA drafts only. The service does
    // not auto-ingest them or promote them to executable instructions.
    extractDraft:input=>serial(()=>call('extract-draft',input)),
    async setup(){
      try{await access(python);}catch{await execute(pythonCommand,['-m','venv',venv],undefined,{timeout:60000,env,raw:true});}
      // pip output is intentionally discarded and completion is actual exit state.
      await new Promise((resolve,reject)=>{const c=spawn(python,['-m','pip','install','--disable-pip-version-check','-r',requirements],{windowsHide:true,shell:false,env:{...process.env,...env},stdio:'ignore'});const timer=setTimeout(()=>{c.kill();reject(new Error('Memory dependency setup timed out'));},180000);c.on('error',e=>{clearTimeout(timer);reject(e);});c.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Memory dependency installation failed'));});});
      return {installed:true};
    },
    close:async()=>{await pending;},
  };
}
