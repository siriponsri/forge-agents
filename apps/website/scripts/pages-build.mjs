// Preparation only: no deploy command, Cloudflare token, or account mutation.
import {spawnSync} from 'node:child_process';
const approved=process.env.FORGE_APPROVED_PRODUCTION_BRANCH?.trim();
if(!approved)throw new Error('Set FORGE_APPROVED_PRODUCTION_BRANCH to the exact owner-approved branch before a Pages production build.');
if(!process.env.CF_PAGES_BRANCH||process.env.CF_PAGES_BRANCH!==approved)throw new Error('This build is not running from the approved production branch.');
if(!process.env.SITE_URL)throw new Error('Set SITE_URL to the approved HTTPS canonical origin before a Pages production build.');
for(const args of [['node_modules/typescript/bin/tsc','--noEmit'],['node_modules/vite/bin/vite.js','build'],['scripts/static.mjs']]){
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
  if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
}
