// Anonymous public metadata only. No GitHub token, account access or private API.
import {writeFile} from 'node:fs/promises';
import {selectReleases} from './release-policy.mjs';
const repository='siriponsri/forge-agents';
const manifest={schemaVersion:1,repository,checkedAt:new Date().toISOString(),state:'unavailable',httpStatus:null,note:'',releases:[]};
try {
  const response=await fetch(`https://api.github.com/repos/${repository}/releases?per_page=20`,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'FORGE-public-website-metadata'},signal:AbortSignal.timeout(15000)});
  manifest.httpStatus=response.status;
  if(response.ok){manifest.releases=selectReleases(await response.json());manifest.state=manifest.releases.length?'public_metadata':'no_public_releases';manifest.note='Anonymous GitHub API snapshot. Only uploaded Windows ZIP assets with GitHub SHA-256 digests and repository-scoped URLs are eligible.'}
  else manifest.note=response.status===404?'Public metadata unavailable. A private or absent repository is indistinguishable to this anonymous request. No public download is advertised.':'Public metadata could not be verified. No public download is advertised.';
}catch{manifest.note='Public GitHub API request failed or timed out. No public download is advertised.'}
await writeFile(new URL('../public/releases.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({state:manifest.state,httpStatus:manifest.httpStatus,releases:manifest.releases.length,downloads:manifest.releases.reduce((n,r)=>n+r.downloads.length,0)}));
