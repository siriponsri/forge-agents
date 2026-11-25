import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const [source,bun]=process.argv.slice(2);
if(!path.isAbsolute(source??'')||!path.isAbsolute(bun??''))throw Error('ISOLATED_PATHS_REQUIRED');
const home=path.join(path.dirname(source),'build-home');await mkdir(home,{recursive:true});
const out=path.join(source,'forge-guarded-cli-build');
// Upstream removes its outdir before building. Confirm its exact absolute target
// is inside this explicitly selected engineering source tree before invoking it.
if(path.dirname(out)!==path.resolve(source)||path.basename(out)!=='forge-guarded-cli-build')throw Error('UNSAFE_BUILD_OUTPUT');
const env={SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TEMP,PATH:[path.dirname(bun),path.dirname(process.execPath),path.join(process.env.SystemRoot,'System32')].join(path.delimiter),HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:home,XDG_DATA_HOME:home,XDG_CACHE_HOME:home,OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_DISABLE_MODELS_FETCH:'1',OPENCODE_CONFIG_PROJECT_DISABLE:'1',OPENCODE_DISABLE_PROJECT_CONFIG:'1'};
env.OPENCODE_VERSION='2.4.1-forge-guarded.0';env.OPENCODE_CHANNEL='forge-guarded';
const result=spawnSync(bun,['run','script/build.ts','--single','--skip-install','--skip-web-ui',`--outdir=${out}`],{cwd:path.join(source,'packages/cli'),env,encoding:'utf8',timeout:180000,windowsHide:true,maxBuffer:4*1024*1024});
console.log(result.stdout,result.stderr);
await writeFile(path.join(path.dirname(source),'cli-build-report.json'),JSON.stringify({version:1,exitCode:result.status,error:result.error?.code??null,stdout:result.stdout,stderr:result.stderr,proof:null},null,2)+'\n');
if(result.status!==0)process.exitCode=1;
