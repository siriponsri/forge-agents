import {binding,text,integer} from './contracts.mjs';

/** Exact base-ten conversion of an explicitly REPORTED amount. Never round. */
export function legacyCostToMoney(value){
  if(!value||value.basis&&value.basis!=='reported'||typeof value.source!=='string'||!value.source.trim()||!(/^[A-Z]{3}$/).test(value.currency))return null;
  if(typeof value.amount!=='number'&&typeof value.amount!=='string'||typeof value.amount==='number'&&(!Number.isFinite(value.amount)||value.amount<0))return null;
  const match=/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value.amount));if(!match)return null;
  let digits=match[1]+(match[2]??''),scale=(match[2]?.length??0)-Number(match[3]??0);
  if(!Number.isSafeInteger(scale)||Math.abs(scale)>100)return null;
  while(scale>0&&digits.endsWith('0')){digits=digits.slice(0,-1);scale--;}
  if(scale<0){digits+='0'.repeat(-scale);scale=0;}if(scale>9)return null;
  const n=BigInt(digits||'0');if(n>BigInt(Number.MAX_SAFE_INTEGER))return null;
  return {minorUnits:Number(n),scale,currency:value.currency};
}

/** The caller supplies native source identity, monotonic sequence and accounting
 * finality. A terminal run, model text or a fabricated local receipt is not that
 * evidence. Snapshot floats are lexical reported observations, not new prices. */
export function legacyObservation(run,{source,sourceReceiptId,sequence,final,occurredAt}){
  const u=run.reportedUsage;
  const usage=Number.isSafeInteger(u?.totalTokens)&&u.totalTokens>=0&&typeof u.source==='string'&&u.source.trim()&&(!u.basis||u.basis==='reported')?{totalTokens:u.totalTokens}:null;
  return {...binding(run),source:text(source,'source'),sourceReceiptId:text(sourceReceiptId,'sourceReceiptId'),sequence:integer(sequence,'sequence'),cost:legacyCostToMoney(run.reportedCost),usage,final,...(occurredAt===undefined?{}:{occurredAt})};
}
