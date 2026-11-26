// Child stderr is untrusted. Retain only these bounded classifications, never
// raw log text, error messages, identities, credentials or authority receipts.
const stages=new Set(['before-call-tool','after-call-tool','after-current-check','before-result-for','after-result-for','cancellation']);
const codes=new Set(['UNKNOWN','SESSION_NATIVE_BINDING','SESSION_NATIVE_CONTEXT','SESSION_NATIVE_INPUT','SESSION_NATIVE_RESULT','SESSION_NATIVE_REFUSED','SESSION_NATIVE_TOOL_DENIED','INVALID_SHAPE','NON_JSON','ABORT_ERR','ETIMEDOUT','ECONNRESET','ECONNREFUSED','UND_ERR_ABORTED','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET',-32700,-32600,-32601,-32602,-32603,-32000,-32001,-32002]);
const names=new Set(['Error','TypeError','RangeError','SyntaxError','ReferenceError','URIError','EvalError','McpError','AbortError','TimeoutError','Unknown']);
const prefix='FORGE_SESSION_DIAGNOSTIC ';
export function createNativeSessionDiagnostics(){
  let line='',discard=false;const records=[];
  function accept(){
    if(!line.startsWith(prefix))return;
    try{
      const value=JSON.parse(line.slice(prefix.length));
      if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='errorCode,errorName,stage'||!stages.has(value.stage)||!codes.has(value.errorCode)||!names.has(value.errorName))return;
      records.push({stage:value.stage,errorCode:value.errorCode,errorName:value.errorName});
      if(records.length>16)records.shift();
    }catch{/* Never preserve or reflect malformed native output. */}
  }
  return Object.freeze({
    push(chunk){for(const char of String(chunk)){
      if(char==='\n'){if(!discard)accept();line='';discard=false;}
      else if(!discard){if(line.length<256)line+=char;else{line='';discard=true;}}
    }},
    snapshot(){return records.map(value=>({...value}));},
  });
}
