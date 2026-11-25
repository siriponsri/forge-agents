// Host-only setup. Inventory is never live qualification or execution authority.
import {open, mkdir, readFile, writeFile, rename, lstat, realpath, readdir, copyFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fileDigest} from './file-digest.mjs';
import {digest} from './profile.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), {code}); };
const ENTRY = 'forge-guarded-host.mjs';
const APPROVED = {t3:'3494a3e4bce00e971a999fe51f5334d471e8d7a220db43e90f50f535314b0bf9',opencode:'33ef775f30afbf7808773e97bc4d70e1dc990155541162c92e5b6e2dc1c18ad3',broker:'0c8a796db59f0829ac4b28b97be774523210f5ff99b7e6139e3fc442e8d2e08d'};
const FRONTEND_PATCH_DIGEST = '036f7cd3a33311b93f9e324bd5d399c01f154da9a06155ab156b6882bcb993d8';
const FRONTEND_APPROVED = {t3:'715c5c8657db3f2910b031e740f9391f04649914569a8c2a0da155d5f73179a5',opencode:'edde02f4107862e229cbe5436fde8b3a28d94195dd6fba85e9f716acaf6cf934'};
const SDK_NOTICE = "MIT License\n\nCopyright (c) 2024 Anthropic, PBC\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n";
const COMPILER_HASH = '46809206887326d2d24db1eff1f3064de972c3451abe766b49111450a5e08e00';
const PIPELINE = {
  "package-lock.json": "0c38ef85bc5d79add8b0c662c5aaaab7cf067488be8cd3eada71a35fe3befe8d",
  "app/frontend-tools/contract.mjs": "e68232d09dd9579ca42878887d8d63515741863177225b2aa8646c2ea551b058",
  "app/frontend-tools/native-tool.mjs": "0717e41a45ee89e8e83739aaf947220877308738d226cf0e47e3a6853e22f2e3",
  "app/frontend-tools/opencode-cli-runtime.ts": "ece9bc3c93e15e77adeb202479e869370acedc8b0a00d959f3ac6ba5996f43ad",
  "tools/frontend-tools/clone-generation.mjs": "64401eac115a59b805b05117d27135c3be8e68a18019c69b9e50755f5cf98406",
  "tools/frontend-tools/patch-generation.mjs": "73e8921cca5667f4caa9632666f1a62b75a5f86b2e499cc6703cee0ac1e681f4",
  "tools/frontend-tools/link-t3-dependencies.mjs": "ce390fbf4e7953e6c4d3c4506df8b3bf7d88774c6e845e60f69bfc41f0e92f20",
  "tools/frontend-tools/build-generation.mjs": "6a10d764dd5ad0ff23140a1b7a7d003c3f6ffd9da703b7e0c111bdd28a1fcd46",
  "tools/frontend-tools/pipeline.mjs": "d514864a46a5c1d1be749ecf03ef71e0b895d6f9d40275fd08b2b98ad896cb09",
  "tools/frontend-tools/source-provenance.json": "154da3bc2636b644af8049a9849628911d5b15f582e3a99ba9fe25bcb92dbe0f",
  "LICENSE": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  "app/guarded-runtime/native/OPENCODE-LICENSE.txt": "625f0f619133f89bbbb2abe37369613dfa1885eba1e50d02170deb62bb42cb6b",
  "app/guarded-runtime/native/T3-LICENSE.txt": "935d8f2af0c703f9c39517ee57cc4930b19d02d533be930b63f0e82f93614b43",
  "app/guarded-runtime/native/opencode-attest.ts": "d7d3e67c979641705e6ea826b94c19b70e872d169155c831ff0bc5a5d49e7643",
  "app/guarded-runtime/native/opencode-bootstrap.ts": "733c714e30cf6dd5389ec3085639ec6d08123330c09a56c99a86227cc650f1a3",
  "app/guarded-runtime/native/opencode-guard.ts": "a1f6992ea6c0c17d15e430732da265b31579322f1b3810fa4fcc7952d7c9f470",
  "app/guarded-runtime/native/patch-inputs.json": "cc7e7ca7f1f8f9b34b078876ae1947afa9d666ab70fc95a16aa58f809ea93ab6",
  "app/guarded-runtime/native/t3-guard.ts": "b08a98fb2865752d31d2a4d85cc4ce0a98d397f1286222544b9894771fd52bd4",
  "app/guarded-runtime/native/t3-host-entry.ts": "650621442cbe5165fa65a7aa4b5bcd94f44326a10e3290796acdd717f3cdb9e1",
  "app/guarded-runtime/profile.mjs": "22ae18f9a1999349d5c24eeb14292100c71b43dce5315b318805d12d02063b4a",
  "app/guarded-runtime/windows/ConfinedText.cs": "f5ee43d7d32c5b783359baec2984f22c25ffece380c5d28c9f1325547a5a58b2",
  "app/proactive-native/audit-upstream.mjs": "32b5e95a0c8014fa8300118e2a913c74214663ee33926880e751a1d6565e0f5a",
  "app/proactive-native/source-pins.json": "174c4ad2440a04713b6b43a7dde8102a712fbe03e134aec02af48633ce7ee03a",
  "tools/guarded-runtime/acquire-t3-toolchain.mjs": "58f0117604e6c537a1d4b662d513247e3745886145d70f6f8cceb6175105d0c1",
  "tools/guarded-runtime/acquire.mjs": "90e0bb7f7658c55a91c3151eb4379c8c1736ce3fc393e36d7b64bb6b382425f1",
  "tools/guarded-runtime/artifact-manifest.mjs": "628a080bfab1f45874782562e1dd967340ebddd825cb2474ad18998a6c8f6230",
  "tools/guarded-runtime/build-native.mjs": "5010946cc3beeca85a0d4da8fb6d95faced063ac699f30403b551b9d60ab822c",
  "tools/guarded-runtime/build-t3.mjs": "5ec773734e4e3ba5a6fea7c992167ee871e1dc69e1f03a73f0d244a64da8f010",
  "tools/guarded-runtime/build-windows.mjs": "fd604002966d03ba239200cb99212bce32632f12af33ee7ee29e7ac2fcc4ab57",
  "tools/guarded-runtime/extract.py": "04dee9c4039ca6deaf783b7cbb7c87fb8250d84b9f897f924288c0d94b5c7517",
  "tools/guarded-runtime/prepare-native.mjs": "c6b9cb2d75211962c78b2aab9f2e1187f1ee008eda43822f4a3fe12f825e8b6b"
};
const PATCH_DIGEST = '93dd03f0c868158be340019d8bbaea7a86b3c8681104dfd5d3da5d3d62631582';
const ARCHIVES = {
  't3.tgz':'6828739be5126583b945e7173e7caef5acaa7ae57ffe566d9db9f65b5ab94ca2',
  'opencode.tgz':'2e6432bb7c27b03b5bffa170360f6b95210213520ba43c1c7f82fd1d9e2f6f28',
  'bun.tgz':'2fa598bc6c8d20440929f9c18b6363c15323274dc0fc5031e33ea209e687121c',
  'node.zip':'e2edda75bfb089654705cf65a13b58933bfd5f57148e8ebda916f58a2474f1f7',
};
const STAGES = ['preflight','sources','toolchain','patch','opencode-dependencies','t3-dependencies','opencode-build','t3-build','broker-build','frontend-dependencies','frontend-clone-generation','frontend-patch-generation','frontend-link-t3-dependencies','frontend-build-generation','verify','copy','complete'];
const inside = (root, value) => { const rel=path.relative(root,value); return rel==='' || !rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel); };
function absolute(value) {
  if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0')||value.startsWith('\\\\')||value.slice(3).includes(':')) fail('PRIVATE_PATH_REQUIRED');
  return path.resolve(value);
}
// Private host paths only. Never follow a junction, symlink or file hardlink.
async function checked(file, {directory=false,systemCompiler=false}={}) {
  const resolved=absolute(file), parsed=path.parse(resolved); let current=parsed.root;
  for(const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part); const s=await lstat(current);
    if(s.isSymbolicLink() || s.isFile() && s.nlink!==1 && !systemCompiler) fail('PRIVATE_LINK_DENIED');
  }
  if((await realpath(resolved)).toLowerCase()!==resolved.toLowerCase()) fail('PRIVATE_ESCAPE_DENIED');
  const s=await lstat(resolved);
  if(directory?!s.isDirectory():!s.isFile()) fail('PRIVATE_TYPE_DENIED');
  return resolved;
}
async function bytes(file) {
  await checked(file); const fd=await open(file,'r');
  try { const s=await fd.stat(); if(!s.isFile()||s.nlink!==1) fail('PRIVATE_LINK_DENIED'); return await fd.readFile(); } finally {await fd.close();}
}
const json = async file => JSON.parse((await bytes(file)).toString('utf8'));
const fileHash = async file => fileDigest(await checked(file));
// A minimal private SDK closure from the exact reviewed lock. npm verifies every
// tarball integrity; no workspace/node_modules or shared cache is used by setup.
export function frontendDependencyLock(lock){
  if(lock.lockfileVersion!==3||lock.packages?.['node_modules/@modelcontextprotocol/sdk']?.version!=='1.32.2')fail('SDK_LOCK_CHANGED');
  const root={name:'forge-private-frontend-build',version:'1.0.0',dependencies:{'@modelcontextprotocol/sdk':'1.32.2'}},packages={'':root};
  function resolve(from,name){
    for(let at=from;;){const key=(at?at+'/':'')+'node_modules/'+name;if(lock.packages[key])return key;if(!at)fail('SDK_LOCK_INCOMPLETE');const i=at.lastIndexOf('/node_modules/');at=i<0?'':at.slice(0,i);}
  }
  function add(key){
    if(packages[key])return;const p=lock.packages[key];
    if(p.link||!p.integrity||!p.resolved?.startsWith('https://registry.npmjs.org/'))fail('SDK_LOCK_INVALID');
    packages[key]=structuredClone(p);delete packages[key].dev;
    for(const name of Object.keys({...p.dependencies,...p.optionalDependencies}))add(resolve(key,name));
    for(const name of Object.keys(p.peerDependencies??{}))if(!p.peerDependenciesMeta?.[name]?.optional)add(resolve(key,name));
  }
  add('node_modules/@modelcontextprotocol/sdk');
  return {manifest:{...root,private:true},lock:{name:root.name,version:root.version,lockfileVersion:3,requires:true,packages}};
}
async function durable(file, value) {
  const tmp=file+'.'+randomUUID()+'.tmp'; const fd=await open(tmp,'wx',0o600);
  try {await fd.writeFile(JSON.stringify(value)+'\n');await fd.sync();} finally {await fd.close();}
  await rename(tmp,file);
}
function strictOperation(input) {
  if(!input || Object.keys(input).join(',')!=='operationId' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.operationId??'')) fail('SETUP_OPERATION_REQUIRED');
  return input.operationId;
}
const safeError = code => ({code,action:({WINDOWS_X64_REQUIRED:'use-windows-x64',PYTHON_REQUIRED:'install-python-3',FRAMEWORK_REQUIRED:'enable-net-framework-4',COMPILER_CHANGED:'update-forge-build-pins',SETUP_TIMEOUT:'check-network-and-retry',INSTALL_INTERRUPTED:'reconcile-installed-files',ARTIFACT_CHANGED:'reinstall-private-artifacts'})[code]??'retry-setup-with-new-operation'});

// Windows JobObject owns all descendant processes from their suspended creation.
// Closing stdin on app death closes the job; no persisted PID is ever killed.
const SUPERVISOR_SOURCE = String.raw`
using System; using System.IO; using System.Text; using System.Threading; using System.Runtime.InteropServices;
using System.Security.AccessControl; using System.Security.Principal; using System.Web.Script.Serialization;
class GuardedSetupJob {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string reserved,desktop,title; public int x,y,xs,ys,xc,yc,fill,flags; public short show,cb2; public IntPtr r2,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public int pid,tid; }
 [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a,b; public uint flags; public UIntPtr min,max; public uint count; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO {public ulong a,b,c,d,e,f;}
 [StructLayout(LayoutKind.Sequential)] struct LIMIT {public BASIC basic;public IO io;public UIntPtr a,b,c,d;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr a,IntPtr b,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO si,out PROCESS_INFORMATION pi);
 [DllImport("kernel32.dll")] static extern IntPtr CreateJobObject(IntPtr a,string name);
 [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,int kind,ref LIMIT data,uint len);
 [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr p);
 [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr t);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr p,uint ms);
 [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr p,out uint code);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr p,uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 static object gate=new object();static IntPtr job=IntPtr.Zero;static Thread worker;static bool cancelled;
 static void Stop(){lock(gate){cancelled=true;if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}}}
 static string Q(string s){var b=new StringBuilder("\"");int n=0;foreach(char c in s){if(c=='\\'){n++;continue;}if(c=='\"')b.Append(new string('\\',n*2+1));else b.Append(new string('\\',n));b.Append(c);n=0;}b.Append(new string('\\',n*2));return b.Append('"').ToString();}
 static void Run(string line){int result=1;IntPtr env=IntPtr.Zero;PROCESS_INFORMATION pi=new PROCESS_INFORMATION();
  try {var d=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(line);
   var args=(System.Collections.ArrayList)d["args"];var cmd=new StringBuilder(Q((string)d["command"]));foreach(string arg in args)cmd.Append(" "+Q(arg));
   var vars=(System.Collections.Generic.Dictionary<string,object>)d["env"];var keys=new System.Collections.Generic.List<string>(vars.Keys);keys.Sort(StringComparer.OrdinalIgnoreCase);var block=new StringBuilder();foreach(string key in keys)block.Append(key+"="+(string)vars[key]+"\0");block.Append('\0');env=Marshal.StringToHGlobalUni(block.ToString());
   var si=new STARTUPINFO();si.cb=Marshal.SizeOf(si);var limit=new LIMIT();limit.basic.flags=0x2000|8;limit.basic.count=64;
   lock(gate){if(cancelled)throw new Exception();job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero||!SetInformationJobObject(job,9,ref limit,(uint)Marshal.SizeOf(limit)))throw new Exception();
    if(!CreateProcess((string)d["command"],cmd,IntPtr.Zero,IntPtr.Zero,false,0x08000000|4|0x400,env,(string)d["cwd"],ref si,out pi))throw new Exception();
    if(!AssignProcessToJobObject(job,pi.process)){TerminateProcess(pi.process,1);throw new Exception();}ResumeThread(pi.thread);}
   if(WaitForSingleObject(pi.process,Convert.ToUInt32(d["timeoutMs"]))==258)result=124;else {uint code;GetExitCodeProcess(pi.process,out code);result=(int)code;}
  }catch {result=1;}finally{Stop();if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);if(pi.process!=IntPtr.Zero)CloseHandle(pi.process);if(env!=IntPtr.Zero)Marshal.FreeHGlobal(env);Console.WriteLine("{\"exitCode\":"+result+"}");Console.Out.Flush();}}
 static int Main(string[] args){
  try {var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);acl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));Directory.SetAccessControl(args[0],acl);
   using(var owner=new FileStream(Path.Combine(args[0],"owner.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None)){
    Console.WriteLine("{\"ready\":true}");Console.Out.Flush();string line;while((line=Console.ReadLine())!=null){if(line=="cancel"){Stop();continue;}if(worker!=null)worker.Join();cancelled=false;string command=line;worker=new Thread(()=>Run(command));worker.Start();}Stop();if(worker!=null)worker.Join();}return 0;
  }catch{return 2;}
 }
}`;

async function compileSupervisor(root,compiler) {
  const source=path.join(root,'setup-supervisor.cs'),binary=path.join(root,'setup-supervisor.exe');
  await writeFile(source,SUPERVISOR_SOURCE,{mode:0o600});
  await new Promise((resolve,reject)=>{
    const p=spawn(compiler,['/nologo','/target:exe','/r:System.Web.Extensions.dll',`/out:${binary}`,source],{windowsHide:true,stdio:'ignore'});
    const timeout=setTimeout(()=>{p.kill();},30000);
    p.once('error',()=>{clearTimeout(timeout);reject(Object.assign(Error(),{code:'FRAMEWORK_REQUIRED'}));});
    p.once('close',code=>{clearTimeout(timeout);code===0?resolve():reject(Object.assign(Error(),{code:'FRAMEWORK_REQUIRED'}));});
  });return binary;
}
async function supervisor(binary,root) {
  const p=spawn(binary,[root],{stdio:['pipe','pipe','ignore'],windowsHide:true,env:{SystemRoot:process.env.SystemRoot}});
  let pending,buffer='',readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const exited=new Promise(resolve=>p.once('close',()=>{readyReject(Error('SETUP_OWNER_BUSY'));pending?.reject(Error('SETUP_OWNER_LOST'));resolve();}));
  p.on('error',()=>{readyReject(Error('SETUP_OWNER_BUSY'));pending?.reject(Error('SETUP_OWNER_LOST'));});
  p.stdin.on('error',()=>{});
  p.stdout.on('data',chunk=>{buffer+=chunk.toString();if(buffer.length>1024){p.kill();return;}let nl;while((nl=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,nl);buffer=buffer.slice(nl+1);try{const event=JSON.parse(line);if(event.ready)readyResolve();else {const own=pending;pending=null;own?.resolve(event);}}catch{p.kill();}}});
  await ready;
  return {run:spec=>new Promise((resolve,reject)=>{if(pending)return reject(Error('SETUP_BUSY'));pending={resolve,reject};p.stdin.write(JSON.stringify(spec)+'\n');}),cancel:()=>p.stdin.write('cancel\n'),close:async()=>{p.stdin.end();await exited;}};
}

/** Trusted host options never come from JSON/HTTP. No listener or turn owner. */
export async function createGuardedArtifactService({dataDir,approvedCache=null,workspaceRoots=[],pythonPath,commandRunner}={}) {
  const data=absolute(dataDir),root=path.join(data,'guarded-artifacts');
  for(const workspace of [REPO,process.cwd(),...workspaceRoots].map(absolute)) if(inside(workspace,root)||inside(root,workspace))fail('PRIVATE_WORKSPACE_OVERLAP');
  // Check existing ancestors before creating anything through them.
  let ancestor=data;while(true){try{await checked(ancestor,{directory:true});break;}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(ancestor);if(parent===ancestor)throw e;ancestor=parent;}}
  await mkdir(root,{recursive:true,mode:0o700});await checked(root,{directory:true});
  const compiler=path.join(process.env.SystemRoot??'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  let runner=null,initError=null;
  try {
    if(process.platform!=='win32'||process.arch!=='x64')fail('WINDOWS_X64_REQUIRED');
    await checked(compiler,{systemCompiler:true});
    if(hash(await readFile(compiler))!==COMPILER_HASH)fail('COMPILER_CHANGED');
    // Unique helper image: restarting never rebuilds an executing binary.
    const helper=path.join(root,'supervisors',randomUUID());await mkdir(helper,{recursive:true});
    runner=await supervisor(await compileSupervisor(helper,compiler),root);
  }catch(e){if(e.message==='SETUP_OWNER_BUSY')fail('SETUP_OWNER_BUSY');initError=safeError(['WINDOWS_X64_REQUIRED','COMPILER_CHANGED'].includes(e.code)?e.code:'FRAMEWORK_REQUIRED');}
  if(!runner && !initError)fail('SETUP_OWNER_REQUIRED');
  const stateFile=path.join(root,'setup.json');let record={version:1,current:null,operations:{}};
  try {record=await json(stateFile);if(record.version!==1||!record.operations)fail('SETUP_STATE_INVALID');}catch(e){if(e.code!=='ENOENT') {await runner?.close();throw e;}}
  let active=null,closed=false,closePromise=null,serial=Promise.resolve();
  const exclusive=fn=>{const next=serial.then(fn,fn);serial=next.catch(()=>{});return next;};
  const current=()=>record.operations[record.current]??null;
  const save=()=>durable(stateFile,record);
  if(current()?.status==='preparing' && runner){Object.assign(current(),{status:'failed',recovery:'reconcile-required',error:safeError('INSTALL_INTERRUPTED')});await save();}
  function snapshot(job=current()) {
    return {status:job?.status??'missing',operationId:job?.operationId??null,progress:{stage:job?.stage??'preflight',completed:Math.max(0,STAGES.indexOf(job?.stage)),total:STAGES.length-1},recovery:job?.recovery??null,error:job?.error??initError,checkRequired:true};
  }
  async function pipelineCopy(dest) {
    for(const [name,expected] of Object.entries(PIPELINE)) {
      const content=await bytes(path.join(REPO,name));if(hash(content.toString('utf8').replaceAll('\r\n','\n'))!==expected)fail('PIPELINE_CHANGED');
      const target=path.join(dest,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);
    }
  }
  async function verifyBuild(cache,approved,pipeline) {
    await checked(cache,{directory:true});
    for(const [name,expected] of Object.entries(ARCHIVES))if(await fileHash(path.join(cache,name))!==expected)fail('SOURCE_ARCHIVE_CHANGED');
    for(const [name,expected] of [['pnpm.tgz','wYum2HmT09Fky16JSPMrLAbuhUSH4GzY2GeBNC+z5btGNDZwNHEehoArqpw3vqkGzhkprQjXCITJfYAd8TOJpg=='],['pnpm-exe.tgz','/LSX6mew/sLf08XqcjemuklNKf1K/Ftpgj4//hK/HKzI2dKbmxDB27a/2OaQ5a0O3/3OFzlssXDziZsi+yVBwQ==']])if(createHash('sha512').update(await bytes(path.join(cache,name))).digest('base64')!==expected)fail('TOOLCHAIN_CHANGED');
    const patches=await json(path.join(cache,'patch-report.json'));
    if(digest(patches.changes)!==PATCH_DIGEST)fail('PATCH_CHANGED');
    for(const p of patches.changes) if(hash((await bytes(path.join(cache,p.source,p.file))).toString('utf8').replaceAll('\r\n','\n'))!==p.after)fail('PATCH_SOURCE_CHANGED');
    const pins=await json(path.join(pipeline,'app/proactive-native/source-pins.json'));
    for(const source of pins.sources)for(const p of source.files){const expected=patches.changes.find(c=>c.source===source.id&&c.file===p.path)?.after??p.sha256LF;if(hash((await bytes(path.join(cache,source.id,p.path))).toString('utf8').replaceAll('\r\n','\n'))!==expected)fail('PATCH_SOURCE_CHANGED');}
    for(const [name,source] of [['cli-build-report.json','opencode'],['t3-build-report.json','t3']]){
      const report=await json(path.join(cache,name));if(report.exitCode!==0||report.patchDigest!==digest(patches.changes.filter(p=>p.source===source)))fail('BUILD_REPORT_INVALID');
    }
    const manifest=await json(path.join(cache,'artifact-manifest.json'));
    if(manifest.proof!==null||manifest.automaticExecutionQualified!==false)fail('INVENTORY_INVALID');
    const names=(await readdir(path.join(cache,'t3/apps/server/dist'))).filter(n=>n.endsWith('.mjs')).sort();
    if(names.length!==45||!names.includes(ENTRY)||names.some(n=>!/^[\w.-]+\.mjs$/.test(n)))fail('T3_GRAPH_INCOMPLETE');
    const files=[];for(const name of names)files.push({name,sha256:await fileHash(path.join(cache,'t3/apps/server/dist',name))});
    const runtime={name:'node.exe',sha256:await fileHash(process.execPath)},profile=digest([...files,runtime].sort((a,b)=>a.name.localeCompare(b.name)));
    const opencode=await fileHash(path.join(cache,'opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe'));
    const broker=await fileHash(path.join(cache,'windows/ConfinedText.exe'));
    const build=await json(path.join(cache,'windows/build.json'));
    if(build.compilerSha256!==COMPILER_HASH||build.sourceSha256!==PIPELINE['app/guarded-runtime/windows/ConfinedText.cs']||build.binarySha256!==broker)fail('BROKER_BUILD_INVALID');
    if(profile!==manifest.t3.profileSha256||digest(files)!==digest(manifest.t3.files)||runtime.sha256!==manifest.t3.runtimeNode.sha256||opencode!==manifest.opencode.sha256||broker!==manifest.fileBroker.binarySha256)fail('ARTIFACT_CHANGED');
    if(approved&&(profile!==APPROVED.t3||opencode!==APPROVED.opencode||broker!==APPROVED.broker))fail('CACHE_NOT_APPROVED');
    return {files,runtime,profile,opencode,broker,sourcePins:ARCHIVES,patchDigest:PATCH_DIGEST,compilerSha256:COMPILER_HASH,pipeline:PIPELINE,proof:null};
  }
  async function verifyUnified(generation,approved,pipeline){
    const meta=await json(path.join(generation,'generation.json'));
    if(meta.root!==generation||meta.cache===generation||!path.basename(generation).startsWith('forge-frontend-generation-')||meta.proof!==null)fail('NEW_GENERATION_REQUIRED');
    const base=await verifyBuild(absolute(meta.cache),approved,pipeline);
    const provenance=await json(path.join(pipeline,'tools/frontend-tools/source-provenance.json')),patches=await json(path.join(generation,'frontend-patches.json'));
    if(digest(patches)!==digest(provenance.patches))fail('FRONTEND_PATCH_CHANGED');
    for(const p of patches.changes){if(!['t3','opencode'].includes(p.tree)||p.file.includes('..')||path.isAbsolute(p.file)||hash((await bytes(path.join(generation,p.tree,p.file))).toString('utf8').replaceAll('\r\n','\n'))!==p.after)fail('FRONTEND_SOURCE_CHANGED');}
    const basePatches=await json(path.join(meta.cache,'patch-report.json')),pins=await json(path.join(pipeline,'app/proactive-native/source-pins.json'));
    for(const source of pins.sources)for(const p of source.files){
      const expected=patches.changes.find(c=>c.tree===source.id&&c.file===p.path)?.after??basePatches.changes.find(c=>c.source===source.id&&c.file===p.path)?.after??p.sha256LF;
      if(hash((await bytes(path.join(generation,source.id,p.path))).toString('utf8').replaceAll('\r\n','\n'))!==expected)fail('FRONTEND_SOURCE_CHANGED');
    }
    for(const name of ['contract.mjs','native-tool.mjs'])if(await fileHash(path.join(generation,'opencode/packages/core/src/forge-frontend',name))!==hash(await bytes(path.join(pipeline,'app/frontend-tools',name))))fail('FRONTEND_SOURCE_CHANGED');
    let runtime=(await bytes(path.join(generation,'opencode/packages/core/src/forge-frontend-runtime.ts'))).toString('utf8').replaceAll('\r\n','\n');
    const imports=['FORGE_MCP_SDK_CLIENT','FORGE_MCP_SDK_TRANSPORT'],suffixes=['index.js','streamableHttp.js'];
    for(let i=0;i<imports.length;i++){
      const pattern=new RegExp('"([^"\\n]+/node_modules/@modelcontextprotocol/sdk/dist/esm/client/'+suffixes[i].replace('.','\\.')+')"'),match=runtime.match(pattern);
      if(!match||!path.isAbsolute(match[1]))fail('SDK_SOURCE_CHANGED');
      if(!approved&&path.resolve(match[1])!==path.join(pipeline,'node_modules/@modelcontextprotocol/sdk/dist/esm/client',suffixes[i]))fail('SDK_SOURCE_CHANGED');
      runtime=runtime.replace(match[0],'"'+imports[i]+'"');
    }
    if(runtime!==(await bytes(path.join(pipeline,'app/frontend-tools/opencode-cli-runtime.ts'))).toString('utf8').replaceAll('\r\n','\n'))fail('SDK_SOURCE_CHANGED');
    for(const name of ['opencode','t3']){const report=await json(path.join(generation,name+'-frontend-build.json'));if(report.name!==name||report.exitCode!==0||report.proof!==null)fail('FRONTEND_BUILD_REPORT_INVALID');}
    const names=(await readdir(path.join(generation,'t3/apps/server/dist'))).filter(n=>n.endsWith('.mjs')).sort();
    if(names.length!==45||!names.includes(ENTRY)||names.some(n=>!/^[\w.-]+\.mjs$/.test(n)))fail('T3_GRAPH_INCOMPLETE');
    const files=[];for(const name of names)files.push({name,sha256:await fileHash(path.join(generation,'t3/apps/server/dist',name))});
    const profile=digest([...files,base.runtime].sort((a,b)=>a.name.localeCompare(b.name))),opencode=await fileHash(path.join(generation,'opencode/forge-frontend-cli-build/cli-windows-x64/bin/opencode.exe'));
    if(approved&&(profile!==FRONTEND_APPROVED.t3||opencode!==FRONTEND_APPROVED.opencode))fail('CACHE_NOT_APPROVED');
    return {...base,files,profile,opencode,frontend:{version:'2.4.1-forge-frontend.0',patchDigest:digest(patches),proof:null}};
  }
  async function installed(job) {
    if(!job?.generation||!job.inventory)return null;
    if(!/^[a-f0-9-]{36}$/.test(job.generation))fail('ARTIFACT_CHANGED');
    const dest=path.join(root,'generations',job.generation);await checked(dest,{directory:true});
    const inv=job.inventory,files=[];
    if(inv.patchDigest!==PATCH_DIGEST||digest(inv.pipeline)!==digest(PIPELINE)||digest(inv.sourcePins)!==digest(ARCHIVES)||inv.compilerSha256!==COMPILER_HASH||inv.files.length!==45)fail('ARTIFACT_CHANGED');
    if(inv.frontend&&(inv.frontend.version!=='2.4.1-forge-frontend.0'||inv.frontend.proof!==null||inv.frontend.patchDigest!==FRONTEND_PATCH_DIGEST))fail('ARTIFACT_CHANGED');
    const names=(await readdir(path.join(dest,'t3'))).sort(),expected=inv.files.map(f=>f.name).sort();
    if(digest(names)!==digest(expected)||new Set(expected).size!==45||!expected.includes(ENTRY))fail('ARTIFACT_CHANGED');
    for(const file of inv.files) {
      if(!/^[\w.-]+\.mjs$/.test(file.name))fail('ARTIFACT_CHANGED');
      const target=path.join(dest,'t3',file.name);if(await fileHash(target)!==file.sha256)fail('ARTIFACT_CHANGED');files.push({name:file.name,path:target});
    }
    if(await fileHash(process.execPath)!==inv.runtime.sha256)fail('ARTIFACT_CHANGED');
    if(digest([...inv.files,inv.runtime].sort((a,b)=>a.name.localeCompare(b.name)))!==inv.profile)fail('ARTIFACT_CHANGED');
    const oc=path.join(dest,'opencode.exe'),broker=path.join(dest,'ConfinedText.exe');
    if(await fileHash(oc)!==inv.opencode||await fileHash(broker)!==inv.broker)fail('ARTIFACT_CHANGED');
    const notices={'MCP-SDK-LICENSE.txt':hash(SDK_NOTICE),'FORGE-LICENSE.txt':PIPELINE.LICENSE,'T3-LICENSE.txt':PIPELINE['app/guarded-runtime/native/T3-LICENSE.txt'],'OPENCODE-LICENSE.txt':PIPELINE['app/guarded-runtime/native/OPENCODE-LICENSE.txt'],'NODE-LICENSE.txt':hash((await bytes(path.join(path.dirname(process.execPath),'LICENSE'))).toString('utf8').replaceAll('\r\n','\n'))};
    if(digest((await readdir(path.join(dest,'notices'))).sort())!==digest(Object.keys(notices).sort()))fail('ARTIFACT_CHANGED');
    for(const [name,expected] of Object.entries(notices))if(hash((await bytes(path.join(dest,'notices',name))).toString('utf8').replaceAll('\r\n','\n'))!==expected)fail('ARTIFACT_CHANGED');
    files.push({name:'node.exe',path:process.execPath});
    return {t3:{entry:path.join(dest,'t3',ENTRY),files},opencode:{path:oc},fileBroker:{path:broker,sha256:inv.broker}};
  }
  async function execute(job,signal) {
    const build=path.join(root,'builds',job.generation),pipeline=path.join(build,'pipeline'),cache=path.join(build,'cache');
    const stage=async name=>{signal.throwIfAborted();await exclusive(async()=>{job.stage=name;await save();});};
    try {
      await stage('preflight');if(initError)fail(initError.code);
      await mkdir(cache,{recursive:true});await pipelineCopy(pipeline);
      let source=cache,unified=false,brokerSource=cache;
      if(approvedCache){source=absolute(approvedCache);for(const workspace of [REPO,process.cwd(),...workspaceRoots].map(absolute))if(inside(workspace,source))fail('PRIVATE_WORKSPACE_OVERLAP');}
      else {
        let python=pythonPath;
        if(!python){
          const base=path.join(process.env.LOCALAPPDATA??os.homedir(),'Programs/Python');
          const candidates=(await readdir(base).catch(()=>[])).filter(n=>/^Python3[0-9]+$/.test(n)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
          for(const name of candidates){const candidate=path.join(base,name,'python.exe');if(await lstat(candidate).then(s=>s.isFile(),()=>false)){python=candidate;break;}}
        }
        try {await checked(python);}catch{fail('PYTHON_REQUIRED');}
        for(const workspace of [REPO,process.cwd(),...workspaceRoots].map(absolute))if(inside(workspace,path.resolve(python)))fail('PRIVATE_WORKSPACE_OVERLAP');
        const home=path.join(build,'home');await mkdir(home,{recursive:true});
        const env={SystemRoot:process.env.SystemRoot??'C:/Windows',TEMP:home,TMP:home,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:home,XDG_DATA_HOME:home,XDG_CACHE_HOME:home,CI:'1',PATH:[path.dirname(python),path.join(cache,'node'),path.join(cache,'bun/bin'),path.join(process.env.SystemRoot??'C:/Windows','System32')].join(path.delimiter),PYTHONNOUSERSITE:'1',BUN_INSTALL_CACHE_DIR:path.join(cache,'bun-cache'),NPM_CONFIG_USERCONFIG:path.join(home,'empty.npmrc'),NPM_CONFIG_GLOBALCONFIG:path.join(home,'empty.npmrc')};
        await writeFile(env.NPM_CONFIG_USERCONFIG,'');
        const script=name=>path.join(pipeline,'tools/guarded-runtime',name+'.mjs');
        const run=async(name,command,args,cwd=build)=>{
          await stage(name);const spec={stage:name,command,args,cwd,env,timeoutMs:600000};
          const result=commandRunner?await commandRunner({...spec,signal},runner.run):await runner.run(spec);
          signal.throwIfAborted();if(result?.exitCode!==0)fail(result?.exitCode===124?'SETUP_TIMEOUT':'BUILD_STAGE_FAILED');
        };
        await run('sources',process.execPath,[script('acquire'),cache]);
        await run('toolchain',process.execPath,[script('acquire-t3-toolchain'),cache]);
        await run('patch',process.execPath,[script('prepare-native'),path.join(cache,'t3'),path.join(cache,'opencode'),path.join(cache,'patch-report.json')]);
        await run('opencode-dependencies',path.join(cache,'bun/bin/bun.exe'),['install','--frozen-lockfile','--ignore-scripts','--filter','@opencode/core','--filter','@opencode/cli'],path.join(cache,'opencode'));
        await run('t3-dependencies',process.execPath,[script('build-t3'),cache,'install']);
        await run('opencode-build',process.execPath,[script('build-native'),path.join(cache,'opencode'),path.join(cache,'bun/bin/bun.exe')]);
        await run('t3-build',process.execPath,[script('build-t3'),cache,'build']);
        await run('broker-build',process.execPath,[script('build-windows'),path.join(cache,'windows')]);
        await run('verify',process.execPath,[script('artifact-manifest'),cache,process.execPath]);
        // Verify the prepared source before a derivative script can consume it.
        await verifyBuild(cache,false,pipeline);
        const sdk=frontendDependencyLock(await json(path.join(pipeline,'package-lock.json')));
        await writeFile(path.join(pipeline,'package.json'),JSON.stringify(sdk.manifest));
        await writeFile(path.join(pipeline,'package-lock.json'),JSON.stringify(sdk.lock));
        await run('frontend-dependencies',path.join(cache,'node/node.exe'),[path.join(cache,'node/node_modules/npm/bin/npm-cli.js'),'ci','--ignore-scripts','--no-audit','--no-fund','--cache',path.join(build,'npm-cache')],pipeline);
        if((await bytes(path.join(pipeline,'node_modules/@modelcontextprotocol/sdk/LICENSE'))).toString('utf8')!==SDK_NOTICE)fail('SDK_NOTICE_CHANGED');
        const {runFrontendPipeline}=await import(pathToFileURL(path.join(pipeline,'tools/frontend-tools/pipeline.mjs')).href);
        const output=await runFrontendPipeline({preparedCache:cache,buildDirectory:build,environment:env,signal,
          onProgress:()=>{},runCommand:async spec=>{await stage(spec.stage);return commandRunner?commandRunner({...spec,signal},runner.run):runner.run(spec);}});
        // The hook creates a NEW generation under this private setup home's TEMP.
        source=path.dirname(path.dirname(path.dirname(path.dirname(path.dirname(output.t3.entry)))));
        if(!inside(home,source))fail('PRIVATE_ESCAPE_DENIED');unified=true;
      }
      if(approvedCache)unified=await lstat(path.join(source,'generation.json')).then(()=>true,()=>false);
      brokerSource=unified?absolute((await json(path.join(source,'generation.json'))).cache):source;
      await stage('verify');const inventory=unified?await verifyUnified(source,!!approvedCache,pipeline):await verifyBuild(source,!!approvedCache,pipeline);
      await stage('copy');const dest=path.join(root,'generations',job.generation);await mkdir(path.join(dest,'t3'),{recursive:true});
      for(const f of inventory.files){signal.throwIfAborted();await copyFile(await checked(path.join(source,'t3/apps/server/dist',f.name)),path.join(dest,'t3',f.name));}
      signal.throwIfAborted();await copyFile(await checked(path.join(source,unified?'opencode/forge-frontend-cli-build/cli-windows-x64/bin/opencode.exe':'opencode/forge-guarded-cli-build/cli-windows-x64/bin/opencode.exe')),path.join(dest,'opencode.exe'));
      await copyFile(await checked(path.join(brokerSource,'windows/ConfinedText.exe')),path.join(dest,'ConfinedText.exe'));
      await mkdir(path.join(dest,'notices'));for(const name of ['T3-LICENSE.txt','OPENCODE-LICENSE.txt'])await copyFile(path.join(pipeline,'app/guarded-runtime/native',name),path.join(dest,'notices',name));
      await copyFile(path.join(pipeline,'LICENSE'),path.join(dest,'notices/FORGE-LICENSE.txt'));
      await copyFile(await checked(path.join(path.dirname(process.execPath),'LICENSE')),path.join(dest,'notices/NODE-LICENSE.txt'));
      await writeFile(path.join(dest,'notices/MCP-SDK-LICENSE.txt'),SDK_NOTICE);
      job.inventory=inventory;await installed(job);signal.throwIfAborted();
      await exclusive(async()=>{signal.throwIfAborted();Object.assign(job,{status:'ready',stage:'complete',error:null,recovery:null});await save();});
    } catch(e) {
      await exclusive(async()=>{Object.assign(job,{status:signal.aborted?'cancelled':'failed',error:signal.aborted?null:safeError(e.code??'BUILD_STAGE_FAILED'),recovery:'retry-with-new-operation'});delete job.inventory;await save();});
    }
  }
  async function artifacts() {
    if(closed||!runner||current()?.status!=='ready')return null;
    try {return await installed(current());}catch {await exclusive(async()=>{Object.assign(current(),{status:'failed',error:safeError('ARTIFACT_CHANGED'),recovery:'reconcile-required'});await save();});return null;}
  }
  return Object.freeze({
    state:async()=>{if(current()?.status==='ready')await artifacts();return snapshot();},
    install:input=>exclusive(async()=>{
      const op=strictOperation(input);if(closed)fail('SETUP_CLOSED');
      if(record.operations[op])return snapshot(record.operations[op]);if(active)fail('SETUP_BUSY');
      if(!runner)fail(initError?.code??'SETUP_OWNER_REQUIRED');
      if(Object.keys(record.operations).length>=1000)fail('SETUP_HISTORY_FULL');
      const job={operationId:op,generation:randomUUID(),status:'preparing',stage:'preflight',error:null,recovery:null};record.current=op;record.operations[op]=job;await save();
      const controller=new AbortController();active={op,controller,promise:null};
      // Scheduling occurs after the durable acceptance response is resolved.
      active.promise=new Promise(resolve=>setImmediate(resolve)).then(()=>execute(job,controller.signal)).catch(()=>{
        // A storage failure cannot turn a lost durable acknowledgement into ready.
        Object.assign(job,{status:'failed',error:safeError('SETUP_STORAGE_FAILED'),recovery:'reconcile-required'});delete job.inventory;
      }).finally(()=>{active=null;});
      return snapshot();
    }),
    cancel:async input=>{
      const op=strictOperation(input);if(current()?.operationId!==op)fail('SETUP_OPERATION_MISMATCH');
      if(active){active.controller.abort();runner?.cancel();await active.promise;}return snapshot();
    },
    artifacts,
    close:()=>{if(closePromise)return closePromise;closed=true;return closePromise=(async()=>{try{await serial;if(active){active.controller.abort();runner?.cancel();await active.promise;}}finally{await runner?.close();}})();},
  });
}
