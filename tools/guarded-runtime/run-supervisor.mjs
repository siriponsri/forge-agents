import {spawn} from 'node:child_process';
import {copyFile,mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {digest} from '../../app/guarded-runtime/profile.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
const cache=path.resolve(process.argv[2]),repo=fileURLToPath(new URL('../../',import.meta.url)),fixture=path.join(cache,'t3/packages/provider-opencode/forge-supervisor-fixture.ts'),home=await mkdtemp(path.join(os.tmpdir(),'forge-guarded-supervisor-home-'));
const patches=JSON.parse(await readFile(path.join(cache,'patch-report.json'),'utf8'));
for(const [name,source] of [['cli-build-report.json','opencode'],['t3-build-report.json','t3']]){const report=JSON.parse(await readFile(path.join(cache,name),'utf8'));if(report.exitCode!==0||report.patchDigest!==digest(patches.changes.filter(x=>x.source===source)))throw Error('REFUSE_STALE_OR_FAILED_BUILD');}
await copyFile(fileURLToPath(new URL('./supervisor-fixture.ts',import.meta.url)),fixture);
try{
  const env={SystemRoot:process.env.SystemRoot,TEMP:home,TMP:home,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:home,XDG_DATA_HOME:home,XDG_CACHE_HOME:home};
  const runtimeNode=process.argv.includes('--current-node')?process.execPath:path.join(cache,'node/node.exe');
  const child=spawn(runtimeNode,[fixture],{cwd:home,env,windowsHide:true,stdio:['ignore','pipe','pipe','pipe']});
  let output='';const done=new Promise(resolve=>child.once('close',resolve));child.stdout.on('data',b=>{output+=b;process.stdout.write(b)});child.stderr.on('data',b=>process.stderr.write(b));
  child.stdio[3].end(JSON.stringify({cache,repo,stopDuring:process.argv.includes('--stop-during')}));
  const timer=setTimeout(()=>child.kill(),120000);const status=await done;clearTimeout(timer);if(status!==0)process.exitCode=1;
  const result=status===0?JSON.parse(output.trim().split(/\r?\n/).at(-1)):null;
  await writeFile(path.join(cache,'supervisor-'+(process.argv.includes('--current-node')?'current':'pinned')+(process.argv.includes('--stop-during')?'-stop':'')+'-report.json'),JSON.stringify({version:1,scope:'isolated actual compiled native engineering qualification; no installed product activation or real provider/account turn',exitCode:status,result,proof:null},null,2)+'\n');
}finally{await rm(home,{recursive:true,force:true});}
