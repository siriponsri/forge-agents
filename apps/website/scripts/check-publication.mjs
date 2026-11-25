// Explicit anonymous verification; normal builds never contact GitHub.
import {writeFile} from 'node:fs/promises';
const baseline='01ee779ffd049ba875ad85bd36f2c8accd274ca0';
const endpoints={
  main:'commits/main',
  baseline:`commits/${baseline}`,
  office:`contents/app/web/src/Office.jsx?ref=${baseline}`,
  // Prepared worker base, not a future publication claim or moving local HEAD.
  integration:'commits/418791275f4a682cacf3c2b36a54d97ac0510be0',
  releases:'releases',
};
const observations=[];
for(const [key,path] of Object.entries(endpoints)){
  const url=`https://api.github.com/repos/siriponsri/forge-agents/${path}`;
  const response=await fetch(url,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'FORGE-publication-verification'},signal:AbortSignal.timeout(15000)});
  const json=await response.json();
  observations.push({key,url,httpStatus:response.status,sha:json.sha??null,items:Array.isArray(json)?json.length:null,message:json.message??null});
}
const report={checkedAt:new Date().toISOString(),authentication:'anonymous; no token',observations};
if(process.argv.includes('--record'))await writeFile(new URL(`../docs/evidence/publication-${report.checkedAt.slice(0,10).replaceAll('-','')}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
