// Private stdin/stdout engineering fixture, no model/provider/server.
import { Effect, Schema } from "effect"
import { execute } from "@opencode/core/tool/runtime"
import { installHost } from "@opencode/core/forge-guard"
import { createHmac } from "node:crypto"
import { createInterface } from "node:readline"
import assert from "node:assert/strict"
const lines=createInterface({input:process.stdin})[Symbol.asyncIterator]()
const boot=JSON.parse((await lines.next()).value)
const canonical=(x:any):string=>x===null||typeof x!=="object"?JSON.stringify(x):Array.isArray(x)?"["+x.map(canonical).join(",")+"]":"{"+Object.keys(x).sort().map(k=>JSON.stringify(k)+":"+canonical(x[k])).join(",")+"}"
const key=Buffer.from(boot.key,"hex"),trusted=new Set<Function>()
const make=(operation:string)=>{
  const executor=(input:any,ctx:any)=>Effect.tryPromise({try:async()=>{
    const body={version:1,runId:"run",operationId:ctx.id,request:{tool:operation,...input}}
    const envelope={...body,mac:createHmac("sha256",key).update(canonical(body)).digest("hex")}
    console.log(JSON.stringify({kind:"action",envelope}))
    const reply=JSON.parse((await lines.next()).value)
    if(!reply.ok)throw Error(reply.error)
    return {output:reply.result}
  },catch:(e:any)=>new Error(e.message)})
  trusted.add(executor)
  return {name:operation,description:"private fixture",options:{namespace:"forge",codemode:false},input:operation==="read_text"?Schema.Struct({path:Schema.String}):Schema.Struct({path:Schema.String,expectedRevision:Schema.String,text:Schema.String}),output:Schema.Unknown,execute:executor}
}
const read=make("read_text"),propose=make("propose_change"),edit=make("edit_text")
installHost({assert(x:any){if(!trusted.has(x.tool?.execute)||x.rawName!=="forge_"+x.tool.name||x.rawName!==x.resolvedName||x.context.sessionID!=="thread"||x.context.codemode)throw Error("DENIED")}})
const ctx=(id:string)=>({sessionID:"thread",agent:"build",messageID:"message",id,progress:()=>Effect.void}) as any
const r:any=(await Effect.runPromise(execute(read,{path:"allowed/a.txt"},ctx("read")))).output
assert.equal(r.text,"before")
const change={path:"allowed/a.txt",expectedRevision:r.revision,text:"after"}
assert.equal((await Effect.runPromise(execute(propose,change,ctx("propose")))).output.effect,false)
assert.equal((await Effect.runPromise(execute(edit,change,ctx("edit")))).output.effect,true)
assert.equal((await Effect.runPromise(execute(edit,change,ctx("edit")))).output.replayed,true)
await assert.rejects(Effect.runPromise(execute(read,{path:"../outside.txt"},ctx("outside"))),/PATH_DENIED/)
await assert.rejects(Effect.runPromise(execute(edit,{...change,path:"outside.txt"},ctx("outside-write"))),/SCOPE_DENIED/)
const shell={...read,name:"shell",execute:()=>Effect.die("MUST_NOT_RUN")}
await assert.rejects(Effect.runPromise(execute(shell,{},ctx("shell"))),/FORGE_NATIVE_ACTION_DENIED/)
console.log(JSON.stringify({kind:"done",nativeBrokerProtocol:"PASS",proof:null}))
key.fill(0);process.stdin.destroy()
