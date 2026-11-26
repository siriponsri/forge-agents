import React,{useEffect,useState} from 'react';
import {scoped,date} from './api.mjs';
import {Field,Heading,Empty} from './ui.jsx';
import {useStrategy,StrategyStatus} from './Assistance.jsx';
import './budgets.css';

export function formatMoney(m,unknown='Unknown'){
  if(!m)return unknown;
  const digits=String(m.minorUnits).padStart(m.scale+1,'0');
  return `${m.currency} ${m.scale?`${digits.slice(0,-m.scale)}.${digits.slice(-m.scale)}`:digits}`;
}
function amount(value,scale,currency){
  const match=/^(\d+)(?:\.(\d+))?$/.exec(value);
  if(!match||match[2]?.length>scale)throw new Error('Use an exact nonnegative amount with the selected decimal places.');
  const units=BigInt(match[1])*10n**BigInt(scale)+BigInt((match[2]??'').padEnd(scale,'0')||'0');
  if(units>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('The amount is too large.');
  return {minorUnits:Number(units),scale,currency};
}
const decimal=m=>m?formatMoney(m).split(' ')[1]:'';
const draftFor=p=>({enabled:p?.enabled??false,unknown:p?.unknown??'block',period:p?.period??'month',currency:p?.limit?.currency??'USD',scale:p?.limit?.scale??2,limit:decimal(p?.limit),reserve:decimal(p?.reserve)});
export default function BudgetStudio(props){return <BudgetPage key={props.projectId} {...props}/>;}
function BudgetPage({t,state,projectId,run,busy}){
  const ui=useStrategy({projectId,run,service:'budgets',readAction:'state'});
  const [scope,setScope]=useState(''),[editor,setEditor]=useState(null),[formError,setFormError]=useState('');
  const bots=scoped(state,'bots',projectId),data=ui.data,policy=data?.policies.find(p=>(p.botId??'')===scope);
  useEffect(()=>{if(policy&&!editor)setEditor({base:policy.policyRevision,draft:draftFor(policy)});},[policy,editor]);
  const disabled=busy||ui.loading||!!ui.uncertain.length||!editor;
  const label=botId=>botId?bots.find(b=>b.id===botId)?.name??botId:t('ทั้งโปรเจกต์','Whole project');
  const unknown=t('ยังไม่ทราบ','Unknown'),money=m=>formatMoney(m,unknown),patch=(key,value)=>setEditor(e=>({...e,draft:{...e.draft,[key]:value}}));
  const d=editor?.draft??draftFor(null);
  const save=async event=>{
    event.preventDefault();setFormError('');
    try{
      const result=await ui.act('configure',{botId:scope||null,expectedRevision:editor.base,enabled:d.enabled,unknown:d.unknown,period:d.period,limit:amount(d.limit,d.scale,d.currency),reserve:amount(d.reserve,d.scale,d.currency)});
      if(result)setEditor(null);
    }catch(error){setFormError(error.message);}
  };
  return <div className="budget-studio">
    <Heading title={t('งบและการใช้งาน','Budgets & usage')} description={t('ดูค่าใช้จ่ายที่บริการ AI แจ้งมา เงินที่กันไว้ และรายการที่ยังไม่รู้ยอด','Provider-reported spending, reserved capacity and unresolved accounting')}>
      <button type="button" disabled={ui.loading} onClick={ui.refresh}>{t('โหลดข้อมูลล่าสุด','Refresh report')}</button>
    </Heading>
    <StrategyStatus ui={ui} t={t}/>
    <section className="panel" aria-label={t('รายงานงบ','Budget report')}>
      <h2>{t('งบตอนนี้','Current budgets')}</h2>
      {!data?<Empty>{t('กำลังโหลดรายงาน…','Loading report…')}</Empty>:<>
        <p className="help">{t('ถ้ายังไม่ได้ตั้งงบ งานจะทำได้ตามปกติ ถ้าบริการ AI ไม่แจ้งราคา จะแสดงว่า “ยังไม่ทราบ”','Without a budget policy, normal supervised work remains available. Unreported prices remain unknown.')}</p>
        <div className="budget-table-scroll"><table><caption>{t('งบของโปรเจกต์และผู้ช่วย AI','Project and bot policies')}</caption><thead><tr>{[t('ใช้กับ','Scope'),t('จำกัดงบ','Policy'),t('ใช้ไปแล้ว (ที่รู้ยอด)','Known spend'),t('เงินที่ยังกันไว้','Remaining held'),t('หยุดเมื่อถึง','Stop threshold'),t('ครั้งที่ไม่รู้ราคา','Unpriced attempts')].map(x=><th key={x} scope="col">{x}</th>)}</tr></thead><tbody>
          {data.policies.map(p=><tr key={p.botId??'project'}><th scope="row">{label(p.botId)}</th><td>{p.enabled?t('เปิด','Enabled'):t('ปิด','Off')}{p.period&&<small>{p.period==='month'?t('เดือน UTC','UTC month'):t('ตลอดโปรเจกต์','Lifetime')}</small>}</td><td>{money(p.exposure?.knownSpend)}</td><td>{money(p.exposure?.held)}</td><td>{money(p.limit)}</td><td>{p.exposure?`${p.exposure.unknownCount}`:unknown}{!!p.exposure?.currencyMismatch.length&&<strong className="budget-warning">{t('สกุลเงินไม่ตรง','Currency mismatch')}</strong>}</td></tr>)}
        </tbody></table></div>
        {!!data.untrackedRuns.length&&<p className="budget-warning">{t('งานก่อนหน้าที่ยังไม่มีบันทึกค่าใช้จ่ายที่เชื่อถือได้:','Earlier runs without trusted accounting receipts:')} {data.untrackedRuns.length}</p>}
      </>}
    </section>
    {!!data?.nativeUsage?.length&&<section aria-labelledby="native-token-heading"><h2 id="native-token-heading">{t('จำนวน โทเคน ที่บริการ AI แจ้ง','Measured native tokens')}</h2><p className="help">{t('ตัวเลขนี้เป็นจำนวน โทเคน ที่บริการ AI แจ้งมาเท่านั้น ไม่นับซ้ำ และไม่ได้บอกยอดรวมของทั้งงานหรือค่าใช้จ่ายเป็นเงิน','Counters retain their measured scope. Context occupancy, cache and reasoning are not added again. Main-agent counts do not establish whole-run totals or monetary cost.')}</p><div className="table-wrap"><table><thead><tr><th>{t('งานย่อย','Run')}</th><th>{t('ผู้ช่วย AI หลัก (ที่วัดได้)','Measured main agent')}</th><th>{t('ยอดรวมทั้งงาน (ที่ยืนยันได้)','Qualified run total')}</th></tr></thead><tbody>{data.nativeUsage.map(row=><tr key={row.runId}><td>{state.tasks.find(task=>task.id===state.runs.find(r=>r.id===row.runId)?.taskId)?.title??row.runId.slice(0,8)}</td><td>{row.mainAgent?.knownTokens==null?unknown:row.mainAgent.knownTokens.toLocaleString()}{row.mainAgent?.basis==='lower_bound'&&'+'}</td><td>{row.usage?.totalTokens==null?unknown:row.usage.totalTokens.toLocaleString()}</td></tr>)}</tbody></table></div></section>}
    {data?.nativeUsage?.some(row=>row.status==='unavailable')&&<p role="status">{t('ยังอ่านจำนวน โทเคน ล่าสุดไม่ได้ ไปที่งานนั้นแล้วกดตรวจสถานะล่าสุด ข้อมูลเดิมยังเก็บไว้เป็นหลักฐาน','Latest native counters are unavailable. Reconcile the run to check current counts; earlier receipts remain historical evidence.')}</p>}
    <section className="panel" aria-labelledby="budget-policy-heading">
      <h2 id="budget-policy-heading">{t('ตั้งงบ','Set policy')}</h2>
      <Field label={t('ตั้งงบให้','Policy scope')}><select value={scope} onChange={e=>{setScope(e.target.value);setEditor(null);setFormError('');}}><option value="">{t('ทั้งโปรเจกต์','Whole project')}</option>{bots.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <form onSubmit={save} aria-busy={ui.loading}>
        <fieldset disabled={disabled}><legend>{label(scope||null)} · {t('ฉบับที่','Revision')} {editor?.base??unknown}</legend>
          <Field label={t('จำกัดงบ','Budget enforcement')}><select value={String(d.enabled)} onChange={e=>patch('enabled',e.target.value==='true')}><option value="false">{t('ปิด','Off')}</option><option value="true">{t('เปิด','Enabled')}</option></select></Field>
          <div className="budget-fields">
            <Field label={t('นับงบรอบละ','Accounting period')}><select value={d.period} onChange={e=>patch('period',e.target.value)}><option value="month">{t('รายเดือน (UTC)','Monthly (UTC)')}</option><option value="lifetime">{t('ตลอดโปรเจกต์','Lifetime')}</option></select></Field>
            <Field label={t('ถ้าไม่รู้ราคาของงาน','When pricing is unknown')}><select value={d.unknown} onChange={e=>patch('unknown',e.target.value)}><option value="block">{t('ไม่ให้เริ่มงานใหม่จนกว่าจะตรวจ','Block new work for review')}</option><option value="allow">{t('ให้ทำต่อ และแสดงว่ายังไม่ทราบราคา','Allow and retain unknown')}</option></select></Field>
            <Field label={t('สกุลเงิน','Currency')}><input required pattern="[A-Z]{3}" maxLength={3} value={d.currency} onChange={e=>patch('currency',e.target.value.toUpperCase())}/></Field>
            <Field label={t('จำนวนตำแหน่งทศนิยม','Decimal places')}><select value={d.scale} onChange={e=>patch('scale',Number(e.target.value))}>{Array.from({length:10},(_,i)=><option key={i} value={i}>{i}</option>)}</select></Field>
            <Field label={t('หยุดงานเมื่อค่าใช้จ่ายถึง','Reported spending stop threshold')}><input required inputMode="decimal" value={d.limit} onChange={e=>patch('limit',e.target.value)}/></Field>
            <Field label={t('เงินที่กันไว้ทุกครั้งที่เริ่มงาน','Capacity reserved per start')} hint={t('เป็นจำนวนที่คุณเลือกกันไว้ ไม่ใช่ราคาประมาณ ค่าใช้จ่ายจริงอาจสูงกว่านี้','Owner-selected capacity, not a price estimate. Actual spending can exceed this amount.')}><input required inputMode="decimal" value={d.reserve} onChange={e=>patch('reserve',e.target.value)}/></Field>
          </div>
        </fieldset>
        <p className="help">{t('งานที่ยังไม่รู้ผลจะยังกันเงินไว้ แม้เปิด FORGE ใหม่ การปิดการจำกัดงบไม่ได้ลบยอดเดิมหรือยกเลิกเงินที่กันไว้ และระบบไม่แปลง โทเคน เวลา หรือค่าสมาชิกเป็นเงิน','Unresolved attempts retain their holds through restart. Turning policy off preserves earlier usage and holds. Tokens, elapsed time and subscriptions are never converted into money.')}</p>
        {formError&&<p role="alert">{formError}</p>}
        {editor&&policy?.policyRevision!==editor.base&&<p role="alert">{t('มีการแก้ไขงบนี้ก่อนหน้า กด โหลดค่าที่บันทึกล่าสุด ตรวจอีกครั้งแล้วลองใหม่','Policy changed. Load the current revision before saving.')}</p>}
        <div className="actions"><button className="primary" type="submit" disabled={disabled} aria-busy={ui.loading}>{t('บันทึกงบ','Save policy')}</button><button type="button" disabled={ui.loading} onClick={()=>{setEditor(policy?{base:policy.policyRevision,draft:draftFor(policy)}:null);setFormError('');}}>{t('โหลดค่าที่บันทึกล่าสุด','Load current policy')}</button></div>
      </form>
    </section>
    <section className="panel" aria-label={t('ประวัติการใช้งาน','Usage ledger and receipts')}>
      <h2>{t('ประวัติการใช้งาน','Usage ledger')}</h2>
      {!data?.attempts.length?<Empty>{t('ยังไม่มีการใช้งานที่บันทึกยอดไว้','No receipt-backed attempts yet')}</Empty>:<div className="budget-table-scroll"><table><thead><tr>{[t('งาน / ผู้ช่วย AI','Run / bot'),t('ค่าใช้จ่ายที่แจ้ง','Reported cost'),t('โทเคน ที่แจ้ง','Reported tokens'),t('เงินที่กันไว้','Reservation'),t('บันทึกล่าสุด','Latest receipt')].map(x=><th scope="col" key={x}>{x}</th>)}</tr></thead><tbody>{data.attempts.map(a=><tr key={a.id}><th scope="row"><code>{a.binding.runId}</code><small>{label(a.binding.botId)} · {a.binding.model}</small></th><td>{money(a.cost)}{a.pricingStatus==='unknown'&&<small className="budget-warning">{t('ยอดยังไม่ครบ หรือไม่รู้ราคา','Incomplete / unknown pricing')}</small>}</td><td>{a.usage?.totalTokens??unknown}</td><td>{a.held?t('ยังกันเงินไว้','Held'):t('ปิดยอดแล้ว','Reconciled')}<small>{date(a.admittedAt)}</small></td><td><code>{a.latestReceipt??unknown}</code><small>{a.latest?.final?t('บริการ AI ยืนยันยอดสุดท้ายแล้ว','Source confirms final accounting'):t('ยังไม่ใช่ยอดสุดท้าย','Accounting not confirmed final')}</small></td></tr>)}</tbody></table></div>}
      {!!data?.stops.length&&<details><summary>{t('ประวัติการหยุดงานเพราะถึงงบ','Budget Stop history')} ({data.stops.length})</summary><ul>{data.stops.map(s=><li key={s.id}><code>{s.binding.runId}</code> · {s.delivery} · {s.status==='unknown'?unknown:t('ส่งคำสั่งหยุดแล้ว ดูผลในหน้างานนั้น','Request returned; check outcome with T3')}</li>)}</ul></details>}
      {!!data?.observations.length&&<details><summary>{t('ยอดที่บริการ AI แจ้งมา','Source receipts')} ({data.observations.length})</summary><ul>{data.observations.map(o=><li key={o.id}><code>{o.sourceReceiptId}</code> · {o.source} · {money(o.cost)} · {o.sequence}{o.stale?` · ${t('ข้อมูลเก่ากว่าล่าสุด ไม่นับซ้ำ','Older snapshot, not counted again')}`:''}</li>)}</ul></details>}
    </section>
  </div>;
}
