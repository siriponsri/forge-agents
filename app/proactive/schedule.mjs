import {fail,integer,exact} from '../goals/contracts.mjs';

const formats=new Map();
function format(zone){
  try {
    if(!formats.has(zone))formats.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}));
    return formats.get(zone);
  }catch{fail('TIMEZONE','Choose a valid IANA timezone');}
}
export function validateTrigger(t){
  exact(t,['kind','timezone','localTime','weekdays','maxLatenessMs','source','subject','eventType','maxAgeMs'],'trigger');
  if(typeof t.timezone!=='string'||!t.timezone||t.timezone.length>100)fail('TIMEZONE','IANA timezone is required');
  format(t.timezone);
  if(t.kind==='schedule'){
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.localTime)||!Array.isArray(t.weekdays)||!t.weekdays.length||new Set(t.weekdays).size!==t.weekdays.length||t.weekdays.some(x=>!Number.isInteger(x)||x<0||x>6))fail('SCHEDULE','Choose a daily time and unique weekdays (Sunday = 0)');
    if(['source','subject','eventType','maxAgeMs'].some(k=>t[k]!==undefined))fail('SCHEDULE','Schedule cannot include event fields');
    integer(t.maxLatenessMs,'maxLatenessMs',60000,86400000);
  }else if(t.kind==='event'){
    if(['localTime','weekdays','maxLatenessMs'].some(k=>t[k]!==undefined))fail('TRIGGER','Event cannot include schedule fields');
    for(const k of ['source','subject','eventType'])if(typeof t[k]!=='string'||!t[k].trim()||t[k].length>200)fail('TRIGGER',`Event ${k} is required`);
    integer(t.maxAgeMs,'maxAgeMs',1000,86400000);
  }else fail('TRIGGER','Choose schedule or authenticated event');
  return structuredClone(t);
}
export function localSlot(at,timezone){
  const p=Object.fromEntries(format(timezone).formatToParts(at).map(p=>[p.type,p.value]));
  return {key:`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`,time:`${p.hour}:${p.minute}`,weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday)};
}
// Minute precision, bounded eight-day search. Nonexistent DST times are skipped;
// a repeated local time has one identity, so fall-back never dispatches twice.
export function nextSchedule(trigger,after,lastSlot=null){
  const end=after+8*86400000;
  for(let at=Math.floor(after/60000)*60000+60000;at<=end;at+=60000){
    const s=localSlot(at,trigger.timezone);
    if(s.time===trigger.localTime&&trigger.weekdays.includes(s.weekday)&&(!lastSlot||s.key>lastSlot))return {at,key:s.key};
  }
  fail('SCHEDULE','No schedule occurrence within eight days');
}
