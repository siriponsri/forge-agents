import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdir,rename,stat,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {zipSync} from 'fflate';
import {unzip} from '../reports/files.mjs';
const run=promisify(execFile);
const sourcePaths=['app','assets/forge-mark.svg','package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.md','docs/FORGE_LOCAL_QUICKSTART_TH.md',...['Start','Stop','Restart'].flatMap(x=>[x+'-FORGE.cmd',x+'-FORGE.command'])];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createDownloadService({sourceRoot,dataDir}){
  let pending;
  const git=async args=>(await run('git',args,{cwd:sourceRoot,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024})).stdout.trim();
  async function prepare(){
    let commit,manifest,portable;
    try{await stat(path.join(sourceRoot,'.git'));commit=await git(['rev-parse','HEAD']);manifest=JSON.parse(await git(['show',`${commit}:package.json`]));}
    catch{portable=JSON.parse(await readFile(path.join(sourceRoot,'release-info.json'),'utf8'));if(!/^[a-f0-9]{40}$/.test(portable.commit)||!Array.isArray(portable.sourceFiles))throw Object.assign(new Error('This installation has no verified source manifest for rebuilding downloads.'),{statusCode:503});commit=portable.commit;manifest=JSON.parse(await readFile(path.join(sourceRoot,'package.json'),'utf8'));}
    const dir=path.join(dataDir,'downloads',commit);await mkdir(dir,{recursive:true});
    let sources;
    const getSources=async()=>{
      if(sources)return sources;
      if(!portable){const raw=path.join(dir,'source.zip');await run('git',['archive','--format=zip','--prefix=FORGE/',`--output=${raw}`,commit,...sourcePaths],{cwd:sourceRoot,windowsHide:true,maxBuffer:2*1024*1024});sources=unzip(await readFile(raw),64*1024*1024);}
      else{
        sources=new Map();const root=await realpath(sourceRoot);
        if(portable.sourceFiles.length>5000)throw new Error('Source manifest exceeds its file limit');
        for(const entry of portable.sourceFiles){
          if(typeof entry.path!=='string'||entry.path.split('/').includes('..')||!sourcePaths.some(p=>entry.path===p||entry.path.startsWith(p+'/')))throw new Error('Source manifest path is outside the package');
          const file=await realpath(path.resolve(root,entry.path)),relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Source manifest contains an escaping link');
          const bytes=await readFile(file);if(sha256(bytes)!==entry.sha256)throw Object.assign(new Error('Installed source changed. Rebuild a new qualified source revision before redistributing.'),{statusCode:409});sources.set('FORGE/'+entry.path,bytes);
        }
      }
      for(const name of [...sources.keys()])if(name.endsWith('/'))sources.delete(name);
      return sources;
    };
    const platforms=[];
    for(const [id,label,extension] of [['windows','Windows','cmd'],['macos','macOS','command']]){
      const filename=id==='windows'?'FORGE-Windows.zip':'FORGE-macOS.zip',file=path.join(dir,filename);
      try{await stat(file);}catch{
        const temporary=`${file}.${crypto.randomUUID()}.tmp`;
        const source=await getSources();
        const info={product:'FORGE',version:manifest.version,commit,status:'alpha',platform:id,qualification:id==='windows'?'developer-verified-local-core':'NOT_RUN',reportEngines:'Qualified automatic acquisition currently Windows x64 only',credentials:'Not included; configure accounts on this machine',source:'https://github.com/siriponsri/forge-agents',sourceFiles:[...source].map(([name,bytes])=>({path:name.slice('FORGE/'.length),sha256:sha256(bytes)}))};
        const readme=`FORGE ${manifest.version} — alpha\n\nExtract the entire FORGE folder. Install Node.js 24.13+ from https://nodejs.org.\nOpen Start-FORGE.${extension}; Stop/Restart launchers are included.\nFirst start installs pinned dependencies and builds the local workbench.\nProjects/settings are saved in machine application data, separate from this source.\n\nIMPLEMENTATION_INCOMPLETE / HOME_UAT_NOT_RUN\nmacOS launchers are included; actual macOS qualification is NOT_RUN.\nNative report-engine packages are currently qualified only on Windows x64.\nRead docs/FORGE_LOCAL_QUICKSTART_TH.md and release-info.json before use.\nSource commit: ${commit}\n`;
        const entries=Object.fromEntries([...source].map(([name,bytes])=>[name,[bytes,{os:3,attrs:(name.endsWith('.command')?0o100755:0o100644)<<16}]]));
        entries['FORGE/release-info.json']=Buffer.from(JSON.stringify(info,null,2));entries['FORGE/README_FIRST.txt']=Buffer.from(readme);
        await writeFile(temporary,zipSync(entries,{level:6,mtime:new Date('1980-01-01T00:00:00Z')}));
        await rename(temporary,file);
      }
      const bytes=await readFile(file);platforms.push({id,label,filename,url:`/downloads/${filename}`,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,qualification:id==='windows'?'developer-verified':'not-run',requirements:['Node.js 24.13+',id==='windows'?'Windows x64':'macOS; native platform verification pending','Internet for initial dependency installation',...(id==='macos'?['Native report engines currently qualified on Windows x64 only']:[])]});
    }
    return {version:manifest.version,commit,status:'alpha',platforms,dir};
  }
  async function metadata(){if(!pending)pending=prepare().finally(()=>{pending=null;});const {dir,...metadata}=await pending;return metadata;}
  return {metadata,async file(filename){if(!['FORGE-Windows.zip','FORGE-macOS.zip'].includes(filename))throw Object.assign(new Error('Download not found'),{statusCode:404});const m=await metadata();return {path:path.join(dataDir,'downloads',m.commit,filename),filename,contentType:'application/zip'};}};
}
