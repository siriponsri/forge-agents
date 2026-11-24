import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdir,rename,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const run=promisify(execFile);
const sourcePaths=['app','assets/forge-mark.svg','package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.md','docs/FORGE_LOCAL_QUICKSTART_TH.md'];
export function createDownloadService({sourceRoot,dataDir}){
  let pending;
  const git=async args=>(await run('git',args,{cwd:sourceRoot,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024})).stdout.trim();
  async function prepare(){
    const commit=await git(['rev-parse','HEAD']);
    const manifest=JSON.parse(await git(['show',`${commit}:package.json`]));
    const dir=path.join(dataDir,'downloads',commit);await mkdir(dir,{recursive:true});
    const platforms=[];
    for(const [id,label,extension] of [['windows','Windows','cmd'],['macos','macOS','command']]){
      const filename=id==='windows'?'FORGE-Windows.zip':'FORGE-macOS.zip',file=path.join(dir,filename);
      try{await stat(file);}catch{
        const temporary=`${file}.${crypto.randomUUID()}.tmp`;
        const info={product:'FORGE',version:manifest.version,commit,status:'alpha',platform:id,qualification:id==='windows'?'developer-verified-local-core':'NOT_RUN',reportEngines:'Qualified automatic acquisition currently Windows x64 only',credentials:'Not included; configure accounts on this machine',source:'https://github.com/siriponsri/forge-agents'};
        const readme=`FORGE ${manifest.version} — alpha\n\nExtract the entire FORGE folder. Install Node.js 24.13+ from https://nodejs.org.\nOpen Start-FORGE.${extension}; Stop/Restart launchers are included.\nFirst start installs pinned dependencies and builds the local workbench.\nProjects/settings are saved in machine application data, separate from this source.\n\nIMPLEMENTATION_INCOMPLETE / HOME_UAT_NOT_RUN\nmacOS launchers are included; actual macOS qualification is NOT_RUN.\nNative report-engine packages are currently qualified only on Windows x64.\nRead docs/FORGE_LOCAL_QUICKSTART_TH.md and release-info.json before use.\nSource commit: ${commit}\n`;
        await run('git',['archive','--format=zip','--prefix=FORGE/',`--output=${temporary}`,`--add-virtual-file=FORGE/release-info.json:${JSON.stringify(info,null,2)}`,`--add-virtual-file=FORGE/README_FIRST.txt:${readme}`,commit,...sourcePaths,`Start-FORGE.${extension}`,`Stop-FORGE.${extension}`,`Restart-FORGE.${extension}`],{cwd:sourceRoot,windowsHide:true,maxBuffer:2*1024*1024});
        await rename(temporary,file);
      }
      const bytes=await readFile(file);platforms.push({id,label,filename,url:`/downloads/${filename}`,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,qualification:id==='windows'?'developer-verified':'not-run',requirements:['Node.js 24.13+',id==='windows'?'Windows x64':'macOS; native platform verification pending','Internet for initial dependency installation',...(id==='macos'?['Native report engines currently qualified on Windows x64 only']:[])]});
    }
    return {version:manifest.version,commit,status:'alpha',platforms,dir};
  }
  async function metadata(){if(!pending)pending=prepare().finally(()=>{pending=null;});const {dir,...metadata}=await pending;return metadata;}
  return {metadata,async file(filename){if(!['FORGE-Windows.zip','FORGE-macOS.zip'].includes(filename))throw Object.assign(new Error('Download not found'),{statusCode:404});const m=await metadata();return {path:path.join(dataDir,'downloads',m.commit,filename),filename,contentType:'application/zip'};}};
}
