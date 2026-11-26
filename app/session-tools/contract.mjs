import {canonical,digest,exact,fail} from '../guarded-runtime/profile.mjs';
export const PURPOSE='supervised-orchestrator-v1';
export const META_KEY='forge/session-native-v1';
export const TOOL_NAMES=Object.freeze(['session_children','session_prompt']);
export const NATIVE_NAMES=Object.freeze(TOOL_NAMES.map(name=>'forge_sessions_'+name));
const id={type:'string',minLength:1,maxLength:200};
export const SESSION_TOOLS=Object.freeze([
  {name:'session_children',description:'List only the Owner-approved child sessions of this exact parent run. Roles do not grant tool or plan authority.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'session_prompt',description:'Send bounded advice to one approved child membership. Reuse the SAME operationId and text after a lost response. This never approves a plan, grants a tool, or bypasses Budget/workspace admission.',inputSchema:{type:'object',properties:{membershipId:id,operationId:id,text:{type:'string',minLength:1,maxLength:48000}},required:['membershipId','operationId','text'],additionalProperties:false}},
]);
export const toolManifest=()=>SESSION_TOOLS.map(t=>({operation:t.name,rawName:'forge_sessions_'+t.name,schemaDigest:digest(t.inputSchema)}));
export function identifier(value){if(typeof value!=='string'||!value.trim()||value.length>200||/[\x00-\x1f]/.test(value))fail('SESSION_NATIVE_BINDING');return value;}
export function bindingFor(value){
  exact(value,['projectId','runId','attemptId','threadId','providerThreadId','providerTurnId','nativeSessionId','nativeTurnId','identityKind']);
  if(value.identityKind!=='private-adapter')fail('SESSION_NATIVE_BINDING');
  for(const k of Object.keys(value))identifier(value[k]);return structuredClone(value);
}
export function argumentsFor(name,input){
  if(!TOOL_NAMES.includes(name))fail('SESSION_NATIVE_TOOL_DENIED');
  exact(input,name==='session_children'?[]:['membershipId','operationId','text']);
  if(name==='session_prompt'){
    identifier(input.membershipId);identifier(input.operationId);
    if(typeof input.text!=='string'||!input.text.trim()||input.text.length>48000)fail('SESSION_NATIVE_INPUT');
  }
  return structuredClone(input);
}
export function endpointFor(value){
  const u=new URL(value);
  if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.pathname==='/'||u.username||u.password||u.search||u.hash)fail('SESSION_NATIVE_ENDPOINT');return u;
}
export function resultFor(result){
  // The gateway's failure remains a native failed call, even with valid content.
  if(result?.isError||result?.structuredContent?.error)fail('SESSION_NATIVE_REFUSED');
  const value=result?.structuredContent;
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Buffer.byteLength(canonical(value))>196608||!Array.isArray(result.content)||result.content.length!==1||result.content[0]?.type!=='text')fail('SESSION_NATIVE_RESULT');
  let text;try{text=JSON.parse(result.content[0].text);}catch{fail('SESSION_NATIVE_RESULT');}
  if(canonical(value)!==canonical(text))fail('SESSION_NATIVE_RESULT');return value;
}
