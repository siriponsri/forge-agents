// Facts are discovered from canonical state, never asked. Browser-safe.
export const EXTENSIONS=Object.freeze({
  tabular:['csv','tsv','xlsx','xls','parquet'],
  images:['jpg','jpeg','png','webp','bmp','gif','tif','tiff'],
  text:['txt','md','jsonl'],
  documents:['pdf','docx','doc','pptx'],
  audio:['wav','mp3','m4a','flac','ogg'],
});
const kindOf=name=>{const ext=String(name).toLowerCase().split('.').pop();return Object.entries(EXTENSIONS).find(([,list])=>list.includes(ext))?.[0]??null;};
export function discoverFacts(state,projectId){
  const project=state?.projects?.find(p=>p.id===projectId);
  if(!project)return null;
  const providerConfig=project.profile?.provider??{},connection=(state.connections??[]).find(c=>c.id===providerConfig.connectionId&&c.projectId===projectId);
  const counts={tabular:0,images:0,text:0,documents:0,audio:0},examples={tabular:[],images:[],text:[],documents:[],audio:[]};
  for(const a of state.artifacts??[]){
    if(a.projectId!==projectId||a.status!=='verified')continue;const k=kindOf(a.name);if(!k)continue;
    counts[k]++;if(examples[k].length<3)examples[k].push({name:a.name,bytes:a.bytes});
  }
  return {
    provider:{connected:!!(connection&&connection.enabled!==false&&providerConfig.model),name:connection?.name??null,model:providerConfig.model??null},
    compute:{kind:project.profile?.compute?.kind??'local'},
    files:{counts,examples,source:'registered-artifacts'},
  };
}
