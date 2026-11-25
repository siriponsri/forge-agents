import path from 'node:path';
import os from 'node:os';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export async function buildWindows(cache=path.join(os.tmpdir(),'forge-guarded-build','windows')){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  await mkdir(cache,{recursive:true});
  const source=fileURLToPath(new URL('../../app/guarded-runtime/windows/ConfinedText.cs',import.meta.url));
  const binary=path.join(cache,'ConfinedText.exe');
  const compiler=path.join(process.env.SystemRoot??'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const r=spawnSync(compiler,['/nologo','/optimize+','/target:exe','/r:System.Web.Extensions.dll',`/out:${binary}`,source],{encoding:'utf8',windowsHide:true});
  if(r.status!==0)throw Error(`BROKER_BUILD_FAILED: ${r.stdout} ${r.stderr}`);
  const sha256=b=>createHash('sha256').update(b).digest('hex');
  const evidence={version:1,sourceSha256:sha256(await readFile(source)),binarySha256:sha256(await readFile(binary)),compilerSha256:sha256(await readFile(compiler)),nativeQualification:null};
  await writeFile(path.join(cache,'build.json'),JSON.stringify(evidence,null,2)+'\n');
  return {binary,...evidence};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildWindows(process.argv[2])));
