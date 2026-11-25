import {createHash} from 'node:crypto';
import {entity,find,fail,changed} from '../server/domain.mjs';
export {entity,find,fail,changed};
export const records=(s,type,projectId)=>s.events.filter(e=>e.type===`budget.${type}`&&(!projectId||e.projectId===projectId));
export function append(s,type,data,projectId){const e=entity({type:`budget.${type}`,...data},projectId);s.events.push(e);return e;}
export function exact(o,keys,label='input'){if(!o||Object.getPrototypeOf(o)!==Object.prototype||Object.keys(o).some(k=>!keys.includes(k)))fail('VALIDATION',`Unexpected ${label} fields`);}
export function text(v,label){if(typeof v!=='string'||!v||v.trim()!==v||v.length>300)fail('VALIDATION',`Invalid ${label}`);return v;}
export function integer(v,label,min=0,max=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(v)||v<min||v>max)fail('VALIDATION',`Invalid ${label}`);return v;}
export function stable(v){if(v===null||typeof v==='string'||typeof v==='boolean')return v;if(typeof v==='number'&&Number.isFinite(v))return v;if(Array.isArray(v))return v.map(stable);if(v&&Object.getPrototypeOf(v)===Object.prototype)return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));fail('VALIDATION','Finite JSON data required');}
export const digest=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
export function money(v){exact(v,['minorUnits','scale','currency'],'money');integer(v.minorUnits,'minorUnits');integer(v.scale,'scale',0,9);if(!/^[A-Z]{3}$/.test(v.currency))fail('VALIDATION','Use a three-letter uppercase currency');return {...v};}
const units=(m,scale)=>BigInt(m.minorUnits)*10n**BigInt(scale-m.scale);
export function compare(a,b){if(a.currency!==b.currency)fail('BUDGET_CURRENCY','Currencies cannot be combined',409);const scale=Math.max(a.scale,b.scale);return units(a,scale)<units(b,scale)?-1:units(a,scale)>units(b,scale)?1:0;}
export function sum(values,currency,scale=0){const ms=values.filter(Boolean);if(ms.some(v=>v.currency!==currency))fail('BUDGET_CURRENCY','Currencies cannot be combined',409);scale=Math.max(scale,...ms.map(m=>m.scale));const value=ms.reduce((n,m)=>n+units(m,scale),0n);if(value>BigInt(Number.MAX_SAFE_INTEGER))fail('BUDGET_OVERFLOW','Exact monetary total exceeds safe integer storage',409);return {minorUnits:Number(value),scale,currency};}
export function remainder(hold,cost){if(!cost)return hold;if(cost.currency!==hold.currency)fail('BUDGET_CURRENCY','Reservation and observation currencies differ',409);const scale=Math.max(hold.scale,cost.scale),value=units(hold,scale)-units(cost,scale);if(value>BigInt(Number.MAX_SAFE_INTEGER))fail('BUDGET_OVERFLOW','Reservation exceeds safe integer storage',409);return {minorUnits:Number(value>0n?value:0n),scale,currency:hold.currency};}
export const terminal=r=>['completed','failed','cancelled','interrupted','rolled_back','stopped'].includes(r.status);
export function binding(run){return {projectId:text(run.projectId,'projectId'),botId:run.botId??null,runId:text(run.id,'runId'),attemptId:text(run.attemptId,'attemptId'),providerInstanceId:text(run.providerInstanceId??run.selection?.instanceId,'providerInstanceId'),model:text(run.model??run.selection?.model??run.profile?.provider?.model,'model')};}
export function owned(s,b){const r=find(s,'runs',b.runId,b.projectId);if(digest(binding(r))!==digest(b))fail('BUDGET_OWNERSHIP','Observation does not match canonical run, attempt, provider and model',409);if(b.botId)find(s,'bots',b.botId,b.projectId);return r;}
export const policy=(s,projectId,botId=null)=>records(s,'policy',projectId).filter(p=>p.botId===botId).sort((a,b)=>b.policyRevision-a.policyRevision)[0]??null;
export const policyFence=(s,b)=>[null,...(b.botId?[b.botId]:[])].map(botId=>({botId,revision:policy(s,b.projectId,botId)?.policyRevision??0}));
export function periodStart(p,now){const d=new Date(now);if(!Number.isFinite(d.getTime()))fail('VALIDATION','Invalid budget clock');return p.period==='month'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1):0;}
export const reservation=(s,runId)=>records(s,'reservation').find(r=>r.binding.runId===runId);
export function currentObservation(s,r){return records(s,'observation',r.projectId).filter(o=>o.binding.runId===r.binding.runId&&!o.stale).sort((a,b)=>b.sequence-a.sequence)[0]??null;}
export function accounting(s,r){const obs=records(s,'observation',r.projectId).filter(o=>o.binding.runId===r.binding.runId&&!o.stale).sort((a,b)=>b.sequence-a.sequence),latest=obs[0]??null;return {latest,cost:obs.find(o=>o.cost!==null)?.cost??null,usage:obs.find(o=>o.usage!==null)?.usage??null,pricingStatus:latest?.cost!==null&&latest?.cost!==undefined?'reported':'unknown'};}
