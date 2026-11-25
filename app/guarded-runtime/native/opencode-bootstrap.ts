// Trusted process bootstrap, inherited pipe only. Never a plugin/config tool.
import {createReadStream,readFileSync} from "node:fs"
import {createHash,createHmac} from "node:crypto"
const canonical=(x:any):string=>x===null||typeof x!=="object"?JSON.stringify(x):Array.isArray(x)?"["+x.map(canonical).join(",")+"]":"{"+Object.keys(x).sort().map(k=>JSON.stringify(k)+":"+canonical(x[k])).join(",")+"}"
const hash=(x:any)=>createHash("sha256").update(canonical(x)).digest("hex")
type Bootstrap={version:number;profile:any;key:string;brokerUrl:string;provider:any;runtimeDirectory:string;toolManifest:any[]}
let boot:Bootstrap|undefined
if(process.env.FORGE_GUARDED_BOOTSTRAP_FD==="3"){
  const text=await new Promise<string>((resolve,reject)=>{
    let text="";const stream=createReadStream("",{fd:3,autoClose:true,encoding:"utf8"})
    stream.on("data",value=>{text+=value;if(Buffer.byteLength(text)>300000){stream.destroy();reject(Error("BOOTSTRAP_LIMIT"))}})
    stream.on("end",()=>resolve(text));stream.on("error",reject)
  })
  boot=JSON.parse(text)
  if(boot?.version!==1||!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(boot.brokerUrl)||!/^[a-f0-9]{64}$/.test(boot.key)||boot.profile?.version!==1||boot.profile.expiresAt<=Date.now()||boot.runtimeDirectory!==process.cwd())throw Error("FORGE_BOOTSTRAP_INVALID")
  if(createHash("sha256").update(readFileSync(process.execPath)).digest("hex")!==boot.profile.route.opencodeBinarySha256)throw Error("FORGE_BINARY_CHANGED")
  if(hash(boot.toolManifest)!==boot.profile.manifestDigest||hash({provider:boot.provider,runtimeDirectory:boot.runtimeDirectory,toolManifest:boot.toolManifest})!==boot.profile.contextDigest)throw Error("FORGE_BOOTSTRAP_CHANGED")
}
const current=()=>{if(!boot||boot.profile.expiresAt<=Date.now())throw Error("FORGE_PRIVATE_PROFILE_REQUIRED");return boot}
async function call(endpoint:string,body:any){
  const b=current(),text=canonical(body)
  // Transport patience does not extend canonical expiry, action admission or
  // Stop. A missing acknowledgement is uncertain delivery, never a retry grant.
  let response:Response,result:any
  try{
    response=await fetch(b.brokerUrl+endpoint,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+b.key,"X-Forge-Mac":createHmac("sha256",Buffer.from(b.key,"hex")).update(text).digest("hex")},body:text,signal:AbortSignal.timeout(30000)})
    result=await response.json()
  }catch{throw Error(endpoint==="/action"?"FORGE_BOUNDED_ACTION_OUTCOME_UNKNOWN":"FORGE_CURRENT_AUTHORITY_UNAVAILABLE")}
  if(!response.ok||!result?.ok){
    if(endpoint==="/action"&&(response.status>=500||response.ok&&result?.ok!==false||result?.error==="OUTCOME_UNKNOWN"||result?.error==="BROKER_UNKNOWN"))throw Error("FORGE_BOUNDED_ACTION_OUTCOME_UNKNOWN")
    throw Error("FORGE_CURRENT_AUTHORITY_DENIED")
  }
  if(endpoint==="/action"&&(!result.result||typeof result.result!=="object"))throw Error("FORGE_BOUNDED_ACTION_OUTCOME_UNKNOWN")
  return result.result
}
export const bound=()=>!!boot
export async function fence(phase:string,sessionID?:string){const b=current();return call("/fence",{profileDigest:hash(b.profile),phase,sessionID:sessionID??null})}
export function config(){
  const b=current()
  // Exact, host-owned provider descriptor; no plugin/package/env/file expansion.
  if(Object.keys(b.provider).some(k=>!["id","model","compatibility","settings"].includes(k))||b.provider.id!==b.profile.route.apiProviderId||b.provider.id+"/"+b.provider.model!==b.profile.route.modelId||!b.provider.compatibility)throw Error("FORGE_PROVIDER_CHANGED")
  return {model:{providerID:b.provider.id,model:b.provider.model},providers:{[b.provider.id]:{name:"FORGE guarded route",package:"@opencode/ai/providers/openai/chat",compatibility:b.provider.compatibility,settings:b.provider.settings,models:{[b.provider.model]:{name:b.provider.model,type:"chat",limit:{context:16000,output:4000},capabilities:{tools:true,input:["text"],output:["text"]}}}}},permissions:[{action:"*",resource:"*",effect:"deny"},...["read_text","propose_change","edit_text"].map(name=>({action:"forge_guarded_"+name,resource:"*",effect:"allow"}))],mcp:{servers:{forge_guarded:{type:"remote",url:b.brokerUrl+"/mcp",oauth:false,codemode:false,protocol:"legacy",headers:{Authorization:"Bearer "+b.key}}}}}
}
export function expectedSession(sessionID:string){return fence("context",sessionID)}
export async function boundedAction(name:string,input:any,context:any){
  const b=current();if(!["read_text","propose_change","edit_text"].includes(name))throw Error("FORGE_TOOL_DENIED")
  const body={version:1,runId:b.profile.runId,operationId:context.id,request:{...input,tool:name}}
  const result=await call("/action",{...body,mac:createHmac("sha256",Buffer.from(b.key,"hex")).update(canonical(body)).digest("hex"),nativeSessionId:context.sessionID})
  // Canonical owner receipt stays on the private host channel. The model gets
  // only bounded action data, never internal route/profile/run proof metadata.
  const {receipt,...visible}=result;return visible
}
export const manifest=()=>current().profile.manifestDigest
export const hasBootstrap=()=>boot!==undefined
export function acceptsMcp(discovered:any){const b=current();return discovered.server==="forge_guarded"&&b.toolManifest.some((x:any)=>x.operation===discovered.name&&x.rawName==="forge_guarded_"+discovered.name&&x.schemaDigest===hash(discovered.inputSchema))}
export function assertModel(ref:any){const b=current();if(b.profile.purpose==="installation-check")throw Error("FORGE_INSTALLATION_HAS_NO_MODEL_AUTHORITY");const options=b.profile.route.options,variant=Array.isArray(options)?options.find(x=>x.id==="variant")?.value:options.variant;if(ref.providerID!==b.provider.id||ref.id!==b.provider.model||(ref.variant??"default")!==(variant??"default"))throw Error("FORGE_MODEL_CHANGED")}
export function sealMetadata(metadata:any){return {...metadata,forgeGuard:{version:1,profileDigest:hash(current().profile)}}}
export function checkMetadata(session:any){if(session.metadata?.forgeGuard?.version!==1||session.metadata.forgeGuard.profileDigest!==hash(current().profile))throw Error("FORGE_CACHED_CONTEXT_CHANGED")}
export async function checkCreate(input:any){const b=current();if(input.parentID||input.location?.directory!==b.runtimeDirectory)throw Error("FORGE_NESTED_OR_FOREIGN_CONTEXT_DENIED");await fence("create")}
export function bootstrapObservation(){const b=current();return {profileDigest:hash(b.profile),pid:process.pid,binarySha256:b.profile.route.opencodeBinarySha256,manifestDigest:b.profile.manifestDigest,contextDigest:b.profile.contextDigest,toolGeneration:b.profile.toolGeneration,policyGeneration:b.profile.policyGeneration,runtimeDirectory:b.runtimeDirectory}}
export function verifyHostProbe(body:any,mac:string|undefined){const b=current();if(!body||Object.keys(body).sort().join(',')!=="nonce,sessionID"||typeof body.nonce!=="string"||body.nonce.length!==64||typeof body.sessionID!=="string"||mac!==createHmac("sha256",Buffer.from(b.key,"hex")).update(canonical(body)).digest("hex"))throw Error("FORGE_PROBE_AUTH_DENIED")}
export function signObservation(body:any){return createHmac("sha256",Buffer.from(current().key,"hex")).update(canonical(body)).digest("hex")}
