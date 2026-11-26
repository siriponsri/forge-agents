// Stateless drafting: settled decisions → Workflow Presets brief → Mission
// definition. FORGE Missions/Goals stay the only planning authority; this
// module only proposes text the Owner reviews. Browser-safe.
import {valuesOf,COMPUTE_LABELS,MAX_DECISIONS} from './question-tree.mjs';

// TODO(lead): switch to the lead-owned ML product preset when presets.mjs adds
// it. Until then Studio uses the closest compiled preset: bounded improvement
// (stop criteria + bounded Goals/Adaptive evaluation).
export const STUDIO_PRESET_ID='bounded-improvement';
export const STUDIO_MARKER='task_type'; // a brief with this decision came from Studio
export const BRIEF_SECTIONS=Object.freeze([
  {key:'objective',th:'เป้าหมาย',en:'Goal'},
  {key:'inputsScope',th:'ชุดข้อมูลและสิ่งที่จะทำนาย',en:'Data, target and features'},
  {key:'acceptance',th:'เกณฑ์ว่างานเสร็จและวิธีวัดผล',en:'Success metric and evaluation'},
  {key:'interfacesDependencies',th:'วิธีสร้างโมเดล เครื่องประมวลผล และการเปิดใช้งาน',en:'Model approach, compute and deployment'},
  {key:'risksDecisions',th:'ความเสี่ยงและสิ่งที่ยังสมมติไว้',en:'Risks and open assumptions'},
]);
const LIMIT=4000;
const clip=(s,n=LIMIT)=>s.length>n?`${s.slice(0,n-1)}…`:s;
const lines=list=>list.filter(Boolean).join('\n');

export function briefTitle(prompt){
  const first=String(prompt??'').trim().split(/\r?\n/)[0].replace(/\s+/g,' ');
  return clip(first||'AI product',80);
}
/** One-language brief text (the UI language at drafting time). */
export function draftBrief({prompt,decisions,facts,lang='th',backends=[],comments=[]}){
  const T=lang==='th',d=valuesOf(decisions),say=(id,fallback=T?'ยังไม่ได้ตกลง':'not settled')=>{const x=decisions?.[id];return x?(x.text??x.label?.[lang]??fallback):fallback;};
  const n=facts?.files?.counts?.[d.modality==='mixed'?'tabular':d.modality]??0,ex=(facts?.files?.examples?.[d.modality]??[]).map(x=>x.name).join(', ');
  const supported=backends.filter(b=>b.supported),paid=d.compute_target==='cloud_gpu';
  const objective=lines([String(prompt??'').trim(),`${T?'ประเภทงาน':'Task type'}: ${say('task_type')}`]);
  const inputsScope=lines([
    `${T?'ชนิดข้อมูล':'Data type'}: ${say('modality')}`,`${T?'แหล่งข้อมูล':'Data source'}: ${say('data_source')}`,
    n?(T?`FORGE พบไฟล์ที่เข้ากันได้ ${n} ไฟล์ในโปรเจกต์ เช่น ${ex}`:`FORGE found ${n} matching files in this project, e.g. ${ex}`):(T?'ยังไม่พบไฟล์ที่ลงทะเบียนในโปรเจกต์ จะตรวจในขั้นชุดข้อมูล':'No registered files in this project yet; checked in the Data step'),
    decisions?.labels&&`${T?'คำตอบที่ถูกต้อง':'Labels'}: ${say('labels')}`,
    decisions?.target&&`${T?'สิ่งที่จะทำนาย':'Target'}: ${say('target')}`,
    decisions?.target&&(T?'ข้อมูลที่ใช้ทำนาย: ยังไม่เลือกคอลัมน์ ต้องตรวจข้อมูลรั่วไหล รหัส และข้อมูลส่วนตัวก่อน':'Features: not selected yet; check leakage, identifiers and personal data first'),
    decisions?.language&&`${T?'ภาษา':'Language'}: ${say('language')}`,
  ]);
  const acceptance=lines([
    `${T?'เกณฑ์ว่างานเสร็จ':'Acceptance criteria'}: ${say('success_metric')}`,
    `${T?'วิธีวัดผล':'Evaluation'}: ${say('evaluation')}`,
    decisions?.error_cost&&`${T?'ความผิดพลาดที่สำคัญกว่า':'Which mistake matters more'}: ${say('error_cost')}`,
    T?'รายงานเฉพาะตัวเลขจริงจากข้อมูลที่โมเดลไม่เคยเห็น และเทียบกับการเดาแบบง่ายเสมอ':'Report only real numbers from data the model never saw, always next to the simple-guess baseline.',
  ]);
  const interfacesDependencies=lines([
    d.task_type==='generation'?`${T?'วิธีสร้างโมเดล':'Model approach'}: ${say('base_model')}`:(T?'วิธีสร้างโมเดล: เริ่มจากการเดาแบบง่ายและโมเดลพื้นฐานเป็นเส้นเทียบ แล้วลองโมเดลที่เหมาะกับข้อมูลนี้':'Model approach: start with a simple guess and a basic model as the comparison line, then try models suited to this data'),
    supported.length?`${T?'เครื่องมือเทรนที่เข้ากันได้':'Compatible trainers'}: ${supported.map(b=>`${b.label[lang]}${b.status==='declared'?(T?' (ยังไม่เปิดใช้ในรุ่นนี้)':' (not enabled in this build)'):''}`).join(', ')}`
      :(T?'เครื่องมือเทรนสำหรับงานแบบนี้ยังไม่มีใน FORGE รุ่นนี้':'No trainer for this kind of task exists in this FORGE build yet'),
    `${T?'เครื่องประมวลผล':'Compute target'}: ${say('compute_target')}`,
    paid?`${T?'งบ':'Budget'}: ${say('budget')}`:(T?'งบ: ยังไม่อนุมัติค่าใช้จ่าย ต้องตรวจราคาก่อนใช้บริการภายนอก':'Budget: no spending authorized; check costs before using external services'),
    paid&&(T?'จะมีค่าใช้จ่าย FORGE ต้องขออนุมัติจากคุณอีกครั้งก่อนเริ่มเช่าเครื่อง':'This costs money; FORGE must ask for your approval again before renting any machine.'),
    decisions?.data_upload&&`${T?'การส่งข้อมูลออกนอกเครื่อง':'Sending data off this computer'}: ${say('data_upload')}`,
    `${T?'รูปแบบการใช้งาน':'How it will be used'}: ${say('deployment_form')}`,
    T?'รุ่นนี้สร้างสรุปงานและภารกิจวางแผนได้ สูตรเทรนหลายชนิดข้อมูลยังไม่พร้อมใช้งาน ไม่มีการเทรน ส่งข้อมูล หรือเปิดใช้โมเดลจากหน้านี้':'This build creates briefs and planning missions. Universal training recipes are not implemented. This page does not train, transfer data or deploy models.',
  ]);
  const risksDecisions=lines([
    T?'ความเสี่ยง: ชุดข้อมูลน้อยหรือไม่สมดุลอาจทำให้ผลวัดดูดีเกินจริง':'Risk: a small or unbalanced dataset can make results look better than they are.',
    T?'ความเสี่ยง: ข้อมูลส่วนตัวต้องไม่หลุดออกนอกเครื่องโดยไม่ได้ตั้งใจ':'Risk: personal data must never leave this computer by accident.',
    paid&&(T?'ความเสี่ยง: ค่าใช้จ่ายเกินงบถ้าไม่หยุดเครื่องตามเวลา':'Risk: costs can exceed the budget if a machine is not stopped on time.'),
    d.data_source==='web'&&(T?'ความเสี่ยง: เว็บอาจไม่อนุญาตให้เก็บข้อมูล หรือข้อมูลเปลี่ยนบ่อย':'Risk: sites may not permit collection, or content may change often.'),
    d.data_upload==='no_upload'&&d.compute_target!=='local_cpu'&&(T?'ยังใช้ข้อมูลจริงบนเครื่องภายนอกไม่ได้ เพราะเลือกห้ามส่งข้อมูล ต้องเปลี่ยนเครื่องประมวลผลหรือทบทวนสิทธิ์แยกก่อน':'Real data cannot be used on external compute while uploads are forbidden. Change compute or review permissions separately first.'),
    T?'สมมติไว้: ชุดข้อมูลที่เลือกเป็นตัวแทนของการใช้งานจริง':'Assumption: the selected dataset represents real use.',
    T?'เกณฑ์หยุด: หยุดเมื่อผ่านเกณฑ์ว่างานเสร็จ หรือเมื่อลองครบตามจำนวนรอบที่ภารกิจกำหนด':'Stop criteria: stop when the acceptance criteria pass, or when the mission attempt limit is reached.',
    ...comments.map(c=>`${T?'ความเห็นของคุณ':'Your comment'}: ${c}`),
  ]);
  return Object.fromEntries(Object.entries({objective,inputsScope,acceptance,interfacesDependencies,risksDecisions}).map(([k,v])=>[k,clip(v)]));
}
/** Brief decisions {id,question,answer} in settled order, capped at the playbook limit. */
export function briefDecisions(decisions,lang='th'){
  return Object.entries(decisions??{}).slice(0,MAX_DECISIONS).map(([id,x])=>({id,question:clip(x.topic?.[lang]??id,2000),answer:clip(x.text??x.label?.[lang]??'',2000)}));
}
/** Path-safe key for mission outputs; passes app/missions relative() rules. */
export function outputKey(workflowId){const k=String(workflowId??'').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,12);return k.length>=4?k:'product';}
/** Mission definition for playbooks.materialize (objective and decisions must match the brief exactly). */
export function missionDefinitionFrom({title,brief,decisions:saved,workflowId,lang='th'}){
  const T=lang==='th',dir=`studio/${outputKey(workflowId)}`,out=(key,th,en,file,acceptance,dependsOn)=>({key,name:T?th:en,path:`${dir}/${file}`,acceptance:clip(acceptance,2000),testFiles:[`${dir}/checks/${key}.test.mjs`],sourcePaths:[],botId:null,dependsOn});
  return {
    title:clip(String(title??'AI product'),180),objective:brief.objective,
    constraints:planningConstraints(brief,lang),
    inputs:brief.inputsScope,
    outputs:[
      out('data','แผนเตรียมชุดข้อมูล','Dataset preparation plan','data-plan.json',T?'ระบุแหล่งข้อมูล สิทธิ์ใช้งาน สิ่งที่จะทำนาย และข้อมูลที่ต้องตรวจ โดยยังไม่อ่านหรือส่งข้อมูลจริง':'Identify sources, permissions, target and checks without reading or transferring actual data.',[]),
      out('train','แผนเลือกวิธีเทรน','Training approach plan','training-plan.json',T?'เสนอวิธีเทรน เครื่องมือ ทรัพยากร และค่าใช้จ่าย ระบุสิ่งที่ยังไม่รองรับ ห้ามเริ่มเทรน':'Propose methods, tools, resources and costs; identify unsupported capabilities. Do not train.',['data']),
      out('evaluate','แผนวัดผล','Evaluation plan','evaluation-plan.json',T?'กำหนดการแบ่งข้อมูล วิธีเทียบ และเกณฑ์ว่างานเสร็จตามข้อจำกัดภารกิจ ห้ามแต่งผลวัด':'Define splits, comparisons and acceptance criteria from mission constraints. Never invent results.',['train']),
      out('deploy','แผนนำโมเดลไปใช้','Model usage plan','deployment-plan.json',T?'ระบุวิธีนำไปใช้และสิ่งที่ต้องตรวจตามรูปแบบที่เลือก ห้ามเปิดบริการหรือส่งออกโมเดล':'Describe the selected usage mode and prerequisite checks. Do not start services or export models.',['evaluate']),
    ],
    decisions:structuredClone(saved),
  };
}
export const isStudioBrief=b=>Array.isArray(b?.decisions)&&b.decisions.some(d=>d.id===STUDIO_MARKER);
export const computeName=(v,lang)=>COMPUTE_LABELS[v]?.[lang]??v;

/** Keep reviewed constraints intact; never silently truncate risk decisions. */
export function planningConstraints(brief,lang='th'){
  const boundary=lang==='th'?'ภารกิจนี้วางแผนเท่านั้น ห้ามเทรน เรียกบริการที่เสียเงิน ส่งข้อมูลออกนอกเครื่อง หรือเปิดบริการ ต้องอนุมัติงานเหล่านั้นแยก ห้ามอ่านคีย์ลับ .env .git หรือ node_modules ห้ามแต่งผลวัด':'Planning only. Do not train, call paid services, transfer data off this computer or deploy. Those actions require separate approval. Do not read secrets, .env, .git or node_modules. Never invent measurements.';
  const text=[boundary,brief.acceptance,brief.interfacesDependencies,brief.risksDecisions].join('\n\n');
  if(text.length>4000)throw Object.assign(new Error('Shorten acceptance, dependencies and risks to fit the Mission limit.'),{code:'STUDIO_CONSTRAINTS_SIZE'});
  return text;
}
