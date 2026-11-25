import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
const source=path.join(path.resolve(process.argv[2]),'t3/apps/server/dist');
const stage=await mkdtemp(path.join(os.tmpdir(),'forge-guarded-package-import-'));
try{
  const files=(await readdir(source)).filter(x=>x.endsWith('.mjs'));
  for(const file of files)await copyFile(path.join(source,file),path.join(stage,file));
  // This copy has no node_modules or source checkout ancestor. Node resolves
  // imports from the copied artifact's location, not the fixture's workspace.
  const native=await import(pathToFileURL(path.join(stage,'forge-guarded-host.mjs')).href);
  console.log(JSON.stringify({runtimeNode:process.versions.node,standalonePrivateEntryImport:'PASS',files:files.length,exports:Object.keys(native),proof:null}));
}finally{await rm(stage,{recursive:true,force:true});}
