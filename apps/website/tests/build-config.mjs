// Local fixture builds only; no deploy or account/service mutation.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const base={...process.env};
delete base.SITE_URL;delete base.FORGE_APPROVED_PRODUCTION_BRANCH;delete base.CF_PAGES_BRANCH;
function run(args,env=base,success=true){const r=spawnSync(process.execPath,args,{env,encoding:'utf8',maxBuffer:4*1024*1024});if(r.error)throw r.error;assert.equal(r.status===0,success,(r.stdout+r.stderr).slice(-3000));return r}
run(['scripts/pages-build.mjs'],base,false);
run(['scripts/pages-build.mjs'],{...base,FORGE_APPROVED_PRODUCTION_BRANCH:'fixture/approved',CF_PAGES_BRANCH:'fixture/other',SITE_URL:'https://forge-website.test'},false);
run(['scripts/pages-build.mjs'],{...base,FORGE_APPROVED_PRODUCTION_BRANCH:'fixture/approved',CF_PAGES_BRANCH:'fixture/approved',SITE_URL:'https://forge-website.test'});
run(['scripts/verify-static.mjs'],{...base,SITE_URL:'https://forge-website.test'});
// Restore the locally reviewable, unindexed output; never leave the fixture origin.
run(['node_modules/vite/bin/vite.js','build']);run(['scripts/static.mjs']);run(['scripts/verify-static.mjs']);
console.log(JSON.stringify({result:'PASSED',missingApprovedBranch:'rejected',wrongBranch:'rejected',approvedBranchFixture:'built',canonicalHreflangSitemap:'verified using a reserved .test fixture origin',finalOutput:'SITE_URL unset; noindex; empty sitemap',deployment:'NOT_RUN'}));
