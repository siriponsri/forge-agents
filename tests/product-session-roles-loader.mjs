// Read-only dependency fallback for isolated worktrees without node_modules.
// No installation, symlink, manifest/lockfile write or provider account access.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const common=execFileSync('git',['rev-parse','--git-common-dir'],{encoding:'utf8',windowsHide:true}).trim();
const root=path.dirname(path.resolve(common));
export async function resolve(specifier,context,next){
  try{return await next(specifier,context);}
  catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND'||specifier.startsWith('.')||specifier.startsWith('/')||specifier.includes(':'))throw e;return next(specifier,{...context,parentURL:pathToFileURL(path.join(root,'package.json')).href});}
}
