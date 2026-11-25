import {digest,canonical,fail,bytesDigest} from './contracts.mjs';
import {readFixed,writeFixed} from './files.mjs';
import {RESEARCH_SOURCES} from './sources.mjs';
import {readFileSync} from 'node:fs';
const IMPLEMENTATION_DIGEST=bytesDigest(readFileSync(new URL(import.meta.url)));

function rowsFor(split,seed){let n=(seed+(split==='dev'?17:100003))>>>0;return Array.from({length:split==='dev'?9:13},(_,i)=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return {key:['beta','alpha','gamma'][i%3],value:n%1000-500};});}
function reference(rows){const keys=[...new Set(rows.map(r=>r.key))].sort();return keys.map(key=>({key,total:rows.filter(r=>r.key===key).map(r=>r.value).reduce((a,b)=>a+b,0)}));}
// This fixed local implementation is an engineering fixture, never an agent.
function normalizeRows(rows){const totals=new Map();for(const r of rows)totals.set(r.key,(totals.get(r.key)??0)+r.value);return [...totals].sort(([a],[b])=>a.localeCompare(b)).map(([key,total])=>({key,total}));}
function dataset(id){return {id,version:'1',digests:Object.fromEntries(['dev','test'].map(split=>[split,digest({id,version:1,split,generator:'lcg-rows-v1',namespace:split==='dev'?17:100003})]))};}
function localAdapter(id,protocol=false){return Object.freeze({id,version:'1',title:protocol?'LongMemEval JSONL protocol fixture':'Deterministic table aggregation',localExecutable:true,agentExecutable:!protocol,pin:{revision:'forge-cpu-fixtures/1',implementationDigest:IMPLEMENTATION_DIGEST,license:'PROJECT',protocol:protocol?'longmemeval-output-jsonl/1':'table-aggregate-json/1'},dataset:dataset(id),qualification:'LOCAL_FIXTURE_NOT_BENCHMARK_OUTCOME',
  async prepare({dir,split,seed,limits}){const rows=rowsFor(split,seed),input=protocol?rows.map((r,i)=>({question_id:`${split}-${i}`,question:`Repeat value for ${r.key}`,haystack_sessions:[[{role:'user',content:String(r.value)}]]})):rows;const bytes=Buffer.from(canonical(input)+'\n');if(bytes.length>limits.maxBytes)fail('RESEARCH_ARTIFACT_LIMIT','Input exceeds byte limit');await writeFixed(dir,'input.json',bytes,{exclusive:true});return {inputDigest:bytesDigest(bytes),prompt:protocol?'Emit JSONL with question_id and hypothesis, copying the value in each session.':'Aggregate input.json by key into sorted {key,total} rows in output.json.',output:protocol?'output.jsonl':'output.json'};},
  async execute({dir,limits}){const {bytes}=await readFixed(dir,'input.json',limits.maxBytes);const input=JSON.parse(bytes);const output=protocol?input.map(q=>JSON.stringify({question_id:q.question_id,hypothesis:q.haystack_sessions[0][0].content})).join('\n')+'\n':canonical(normalizeRows(input))+'\n';if(Buffer.byteLength(output)>limits.maxBytes)fail('RESEARCH_ARTIFACT_LIMIT','Output exceeds byte limit');await writeFixed(dir,protocol?'output.jsonl':'output.json',output);return {tool:'fixed-node-file-transform',providerExecution:'NONE',tokens:null,cost:null};},
  async validate({dir,split,seed,limits,inputDigest}){
    const input=await readFixed(dir,'input.json',limits.maxBytes),artifact=await readFixed(dir,protocol?'output.jsonl':'output.json',limits.maxBytes);
    const checks=[{kind:'external-state',passed:input.sha256===inputDigest,validator:'input-integrity/1'}];
    const rows=rowsFor(split,seed);let valid=false;
    try{if(protocol){const lines=artifact.bytes.toString('utf8').trim().split('\n').map(JSON.parse);valid=lines.length===rows.length&&new Set(lines.map(l=>l.question_id)).size===rows.length&&lines.every((l,i)=>Object.keys(l).sort().join(',')==='hypothesis,question_id'&&l.question_id===`${split}-${i}`&&l.hypothesis===String(rows[i].value));}else valid=canonical(JSON.parse(artifact.bytes))===canonical(reference(rows));}catch{/* Invalid bytes are failed evidence. */}
    checks.push({kind:split==='test'?'held-out':'deterministic',passed:valid,validator:protocol?'protocol-exact-answer/1':'independent-table-reference/1'});
    checks.push({kind:'artifact',passed:artifact.size>0&&artifact.size<=limits.maxBytes,validator:'bounded-regular-file-sha256/1',sha256:artifact.sha256,bytes:artifact.size});
    return {status:checks.every(c=>c.passed)?'PASSED':'FAILED',checks,artifact:{name:protocol?'output.jsonl':'output.json',sha256:artifact.sha256,bytes:artifact.size},qualification:protocol?'JSONL protocol + deterministic fixture answers; official model judge NOT_RUN':'Actual deterministic CPU/file result; no model quality claim'};
  },
});}

export function createResearchAdapterRegistry(extra=[]){
  const adapters=new Map();
  function register(adapter){if(!adapter?.id||!adapter.version||!adapter.pin?.revision)fail('RESEARCH_ADAPTER','Versioned adapter and source pin required');if(adapter.localExecutable||adapter.agentExecutable){if(!adapter.dataset?.digests?.dev||!adapter.dataset?.digests?.test)fail('RESEARCH_ADAPTER','Executable dataset pins required');if(adapter.dataset.digests.dev===adapter.dataset.digests.test)fail('RESEARCH_SPLIT','Dev and test pins must differ');}if(adapter.localExecutable&&['prepare','execute','validate'].some(k=>typeof adapter[k]!=='function'))fail('RESEARCH_ADAPTER','Executable adapters require actual prepare/execute/validate');const key=`${adapter.id}@${adapter.version}`;if(adapters.has(key))fail('RESEARCH_ADAPTER','Adapter version already registered');adapters.set(key,Object.freeze(adapter));}
  register(localAdapter('forge-table'));register(localAdapter('forge-longmem-protocol',true));
  for(const source of RESEARCH_SOURCES.filter(s=>!s.id.startsWith('arxiv:')))register({id:source.id,version:source.revision,title:source.id,localExecutable:false,agentExecutable:false,pin:{revision:source.revision,license:source.license,protocol:source.protocol},dataset:{id:'NOT_AVAILABLE',version:'NOT_AVAILABLE',digests:{dev:null,test:null}},qualification:source.qualification,setup:{dataset:'NOT_AVAILABLE',installed:false,executed:false,officialOutcome:null,blocker:source.license==='NOT_AVAILABLE'?'LICENSE_NOT_AVAILABLE':'PUBLIC_RUNNER_INTEGRATION_REQUIRED'},source});
  for(const adapter of extra)register(adapter);
  return Object.freeze({register,get(id,version){const adapter=adapters.get(`${id}@${version}`);if(!adapter)fail('RESEARCH_ADAPTER','Unknown pinned adapter version',404);return adapter;},list(){return [...adapters.values()].map(({prepare,execute,validate,...meta})=>structuredClone(meta));}});
}
