// Built-in, deterministic ML requirements design tree (offline fallback).
// Stateless and browser-safe: no storage, no Node imports. Method adapted from
// mattpocock/skills `grilling` (MIT): each round asks the whole frontier —
// every unsettled, relevant question whose prerequisites are settled — with a
// recommended answer phrased so that "yes" accepts it. Facts FORGE can
// discover (registered files, provider, compute profile) are never asked.
// Answers are persisted only as Workflow Presets brief decisions.

export const MAX_DECISIONS=12; // app/playbooks/contracts.mjs decisions() limit
const o=(value,th,en)=>({value,label:{th,en}});
const SUPERVISED=['classification','regression','forecasting','detection'];
const HEAVY_MODALITIES=['images','text','documents','audio','mixed'];
const has=(re,s)=>re.test(s);

/** Deterministic hints from the owner's description. Labelled as inferred. */
export function inferFromPrompt(prompt=''){
  const s=String(prompt).toLowerCase();
  let taskType='classification',inferredTask=true;
  if(has(/chat ?bot|แชตบอต|แชทบอท|ตอบคำถาม|generate|สร้างข้อความ|สรุป|summar|fine.?tun|ปรับจูน|\bllm\b|เขียนข้อความ/,s))taskType='generation';
  else if(has(/detect|ตรวจจับ|หาตำแหน่ง|นับจำนวน|bounding/,s))taskType='detection';
  else if(has(/extract|ดึงข้อมูล|อ่านใบ|invoice|ใบเสร็จ|ใบแจ้งหนี้|ocr/,s))taskType='extraction';
  else if(has(/forecast|พยากรณ์|ล่วงหน้า|next (week|month|day)|เดือนหน้า|สัปดาห์หน้า|time.?series/,s))taskType='forecasting';
  else if(has(/recommend|แนะนำสินค้า|แนะนำเพลง|แนะนำหนัง/,s))taskType='recommendation';
  else if(has(/cluster|segment|แบ่งกลุ่มลูกค้า|จัดกลุ่มลูกค้า/,s))taskType='clustering';
  else if(has(/price|ราคา|ยอดขาย|sales|revenue|รายได้|how much|เท่าไร|amount|จำนวนเงิน|อุณหภูมิ|temperature/,s))taskType='regression';
  else if(!has(/classif|แยกประเภท|จัดประเภท|spam|fraud|ทุจริต|churn|ลาออก|ยกเลิก|ใช่หรือไม่/,s))inferredTask=false;
  let modality=null;
  if(has(/image|photo|picture|camera|รูป|ภาพ|กล้อง|vision/,s))modality='images';
  else if(has(/pdf|document|เอกสาร|สแกน|scan|invoice|ใบเสร็จ|ใบแจ้งหนี้/,s))modality='documents';
  else if(has(/audio|speech|voice|เสียง|พูด/,s))modality='audio';
  else if(has(/text|ข้อความ|review|รีวิว|comment|ความคิดเห็น|email|อีเมล|tweet|โพสต์|sentiment|แชต|chat|บทความ/,s))modality='text';
  else if(has(/csv|excel|ตาราง|spreadsheet|ยอดขาย|ลูกค้า|customer|sales|ราคา|price/,s))modality='tabular';
  return {taskType,inferredTask,modality,web:has(/website|เว็บ|scrap|crawl|ออนไลน์/,s)};
}
const fileCount=(f,m)=>f?.files?.counts?.[m==='mixed'?'tabular':m]??0;
function modalityFromFacts(f){
  const c=f?.files?.counts??{},ranked=Object.entries(c).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
  return ranked[0]?.[0]??null;
}
const heavy=d=>HEAVY_MODALITIES.includes(d.modality)||['generation','detection','extraction'].includes(d.task_type);
export const COMPUTE_LABELS=Object.freeze({local_cpu:{th:'เครื่องนี้ (CPU)',en:'This computer (CPU)'},colab:{th:'Colab',en:'Colab'},jupyter:{th:'Jupyter',en:'Jupyter'},ssh:{th:'เครื่องอื่นผ่าน SSH',en:'Another machine over SSH'},cloud_gpu:{th:'GPU บนคลาวด์แบบเสียเงิน (RunPod/Vast)',en:'Paid cloud GPU (RunPod/Vast)'}});
const why=(th,en)=>({th,en});
const INFERRED=why('เดาจากคำอธิบายของคุณ','Inferred from your description');

/** Ordered tree. `needs` are prerequisite ids; `when` gates relevance. */
export const QUESTION_TREE=Object.freeze([
  {id:'task_type',topic:{th:'ประเภทงาน',en:'Task type'},needs:[],options:[
    o('classification','แยกประเภท เช่น ใช่/ไม่ใช่ หรือเป็นกลุ่มไหน','Classification: pick a category or yes/no'),
    o('regression','ทำนายตัวเลข เช่น ราคา หรือยอดขาย','Regression: predict a number such as price or sales'),
    o('forecasting','พยากรณ์ค่าในอนาคตตามเวลา','Forecasting: predict future values over time'),
    o('detection','หาและนับสิ่งของในภาพ','Detection: find and count objects in images'),
    o('extraction','ดึงข้อมูลจากเอกสาร','Extraction: pull fields out of documents'),
    o('generation','สร้างข้อความหรือตอบคำถาม (ปรับจูน AI ภาษา)','Generation: write text or answer questions (fine-tune a language model)'),
    o('clustering','แบ่งกลุ่มข้อมูลที่ยังไม่มีคำตอบ','Clustering: group data that has no answers yet'),
    o('recommendation','แนะนำสิ่งที่ผู้ใช้น่าจะชอบ','Recommendation: suggest items people may like'),
  ],recommend:(d,f,h)=>({value:h.taskType,why:h.inferredTask?INFERRED:why('คำอธิบายยังไม่ชัด จึงเริ่มจากงานที่พบบ่อยที่สุด','The description is not specific, so this starts from the most common task')}),
  ask:{th:l=>`งานนี้คือ "${l}" ใช่ไหม`,en:l=>`Is this a "${l}" task?`}},

  {id:'modality',topic:{th:'ชนิดข้อมูล',en:'Data type'},needs:['task_type'],options:[
    o('tabular','ตาราง เช่น CSV หรือ Excel','Tables such as CSV or Excel'),
    o('images','รูปภาพ','Images'),o('text','ข้อความ','Text'),
    o('documents','เอกสาร PDF หรือไฟล์สแกน','PDF or scanned documents'),
    o('audio','เสียง','Audio'),o('mixed','หลายแบบรวมกัน','A mix of these'),
  ],recommend:(d,f,h)=>{
    const byTask={detection:'images',extraction:'documents',generation:'text',forecasting:'tabular',recommendation:'tabular',regression:'tabular'}[d.task_type];
    if(h.modality)return {value:h.modality,why:INFERRED};
    const seen=modalityFromFacts(f);if(seen)return {value:seen,why:why('ไฟล์ส่วนใหญ่ที่ลงทะเบียนในโปรเจกต์เป็นแบบนี้','Most files registered in this project are this kind')};
    return {value:byTask??'tabular',why:why('เหมาะกับงานแบบนี้ที่สุด','The usual fit for this task')};
  },ask:{th:l=>`ข้อมูลหลักเป็น "${l}" ใช่ไหม`,en:l=>`Is the main data "${l}"?`}},

  {id:'success_metric',topic:{th:'เกณฑ์ว่างานเสร็จ',en:'Acceptance criteria'},needs:['task_type'],
  optionsFor:d=>({
    classification:[o('f1_080','F1 อย่างน้อย 0.80 และดีกว่าการเดาแบบง่าย','F1 of at least 0.80 and better than a simple guess'),o('accuracy_090','ทายถูกอย่างน้อย 90%','At least 90% correct')],
    regression:[o('mae_20','ผิดพลาดเฉลี่ย (MAE) น้อยกว่าการเดาแบบง่ายอย่างน้อย 20%','Average error (MAE) at least 20% below a simple guess'),o('r2_070','R² อย่างน้อย 0.70','R² of at least 0.70')],
    forecasting:[o('beat_last','ดีกว่าการใช้ค่าล่าสุดเป็นคำทำนาย','Better than repeating the last value'),o('mape_15','ผิดพลาดเฉลี่ยไม่เกิน 15% ของค่าจริง','Average error within 15% of actual values')],
    detection:[o('map_050','mAP@0.5 อย่างน้อย 0.50','mAP@0.5 of at least 0.50'),o('recall_090','พบสิ่งของจริงอย่างน้อย 90%','Finds at least 90% of real objects')],
    extraction:[o('field_090','ดึงช่องข้อมูลถูกอย่างน้อย 90%','At least 90% of fields extracted correctly'),o('field_095','ดึงช่องข้อมูลถูกอย่างน้อย 95%','At least 95% of fields extracted correctly')],
    generation:[o('human_4of5','คนให้คะแนนเฉลี่ยอย่างน้อย 4 จาก 5 ใน 20 ตัวอย่าง','People rate 20 samples at least 4 of 5 on average'),o('win_rate','ชนะคำตอบเดิมอย่างน้อย 60% เมื่อเทียบกันทีละคู่','Wins at least 60% of side-by-side comparisons')],
    clustering:[o('review','คุณตรวจกลุ่มแล้วเห็นว่าใช้ได้','You review the groups and find them useful'),o('silhouette','กลุ่มแยกกันชัด (silhouette ≥ 0.4)','Clearly separated groups (silhouette ≥ 0.4)')],
    recommendation:[o('beat_popular','ดีกว่าการแนะนำของยอดนิยม','Better than recommending the most popular items'),o('hit_10','สิ่งที่ผู้ใช้เลือกจริงอยู่ใน 10 อันดับแรกอย่างน้อย 30%','The real choice is in the top 10 at least 30% of the time')],
  }[d.task_type]),
  recommend:d=>({value:{classification:'f1_080',regression:'mae_20',forecasting:'beat_last',detection:'map_050',extraction:'field_090',generation:'human_4of5',clustering:'review',recommendation:'beat_popular'}[d.task_type],why:why('เป็นเกณฑ์ตั้งต้นที่เสนอ ยังไม่ใช่ผลวัด ปรับให้เหมาะกับงานก่อนเริ่ม','A proposed starting criterion, not a measured result; adjust for the task before starting')}),
  ask:{th:l=>`ถือว่างานเสร็จเมื่อ "${l}" ใช่ไหม`,en:l=>`Is the work done when "${l}"?`}},

  {id:'deployment_form',topic:{th:'รูปแบบการใช้งาน',en:'How it will be used'},needs:['task_type'],options:[
    o('local_api','เปิดใช้งานโมเดลในเครื่องนี้ พร้อมฟอร์มลองทำนาย','Deploy the model on this computer with a try-it form'),
    o('batch','ใส่ไฟล์แล้วได้ไฟล์ผลลัพธ์กลับมา','Give it a file and get a results file back'),
    o('chat_ui','หน้าแชตในเครื่องนี้','A chat page on this computer'),
    o('export','ส่งออกไฟล์โมเดลไปใช้ที่อื่น','Export the model file to use elsewhere'),
  ],recommend:d=>({value:d.task_type==='generation'?'chat_ui':d.task_type==='extraction'?'batch':'local_api',why:why('วางแผนให้ใช้งานในเครื่องก่อน ต้องตรวจเครื่องมือที่รองรับอีกครั้ง','Plan for local use first; tool compatibility still needs checking')}),
  ask:{th:l=>`ใช้งานแบบ "${l}" ใช่ไหม`,en:l=>`Should it be used as "${l}"?`}},

  {id:'data_source',topic:{th:'แหล่งข้อมูล',en:'Data source'},needs:['modality'],options:[
    o('workspace','ไฟล์ในโฟลเดอร์งานของโปรเจกต์นี้','Files in this project\'s workspace folder'),
    o('folder','โฟลเดอร์อื่นที่ฉันจะคัดลอกเข้ามา','Another folder I will copy in'),
    o('web','เก็บจากเว็บที่ฉันระบุและอนุญาตให้เก็บ โดยให้ AI ใช้เบราว์เซอร์ (ถามก่อนเปิดแต่ละเว็บ)','Collect from sites I name that permit it, with AI using the browser (asks before each site)'),
    o('none_yet','ยังไม่มีข้อมูล ให้ช่วยวางแผนเก็บ','No data yet; help me plan collection'),
  ],recommend:(d,f,h)=>{
    const n=fileCount(f,d.modality);
    if(n>0)return {value:'workspace',why:why(`พบไฟล์ที่เข้ากันได้ ${n} ไฟล์ในโปรเจกต์แล้ว`,`Found ${n} matching files in this project`)};
    if(h.web)return {value:'web',why:why('คำอธิบายของคุณพูดถึงเว็บ','Your description mentions websites')};
    return {value:'workspace',why:why('ยังไม่พบไฟล์ที่ลงทะเบียนไว้ วางไฟล์ในโฟลเดอร์งานแล้วตรวจในขั้นชุดข้อมูลได้','No registered files yet; put files in the workspace folder and check them in the Data step')};
  },ask:{th:l=>`ข้อมูลมาจาก "${l}" ใช่ไหม`,en:l=>`Does the data come from "${l}"?`}},

  {id:'labels',topic:{th:'คำตอบที่ถูกต้อง',en:'Labels'},needs:['task_type','modality'],when:d=>SUPERVISED.includes(d.task_type)||d.task_type==='extraction',options:[
    o('have','มีคำตอบที่ถูกต้องของตัวอย่างเก่าอยู่แล้ว','I already have correct answers for past examples'),
    o('need_labeling','ต้องติดป้ายเพิ่ม (AI ช่วยร่าง คนตรวจ)','Need labeling (AI drafts, a person checks)'),
  ],recommend:d=>({value:d.modality==='tabular'?'have':'need_labeling',why:why('โมเดลแบบนี้ต้องมีคำตอบที่ถูกต้องให้เรียนรู้','This kind of model needs correct answers to learn from')}),
  ask:{th:l=>`สถานะคือ "${l}" ใช่ไหม`,en:l=>`Is the situation "${l}"?`}},

  {id:'target',topic:{th:'สิ่งที่จะทำนาย',en:'Target'},needs:['task_type','modality'],when:d=>SUPERVISED.includes(d.task_type)&&d.modality==='tabular',options:[
    o('after_profile','เลือกคอลัมน์หลังตรวจชุดข้อมูล','Choose a column after reviewing the dataset'),
  ],recommend:()=>({value:'after_profile',why:why('ชื่อคอลัมน์อ่านได้จากไฟล์ จึงไม่ต้องเดาตอนนี้ หรือพิมพ์ชื่อคอลัมน์เองได้','Column names can be read from the file, so no need to guess now; or type the column name')}),
  ask:{th:l=>`เลือกสิ่งที่จะทำนายแบบ "${l}" ใช่ไหม`,en:l=>`Should the target be chosen this way: "${l}"?`}},

  {id:'language',topic:{th:'ภาษาของข้อมูล',en:'Data language'},needs:['modality'],when:d=>['text','documents','audio'].includes(d.modality)||d.task_type==='generation',options:[
    o('th_en','ไทยและอังกฤษ','Thai and English'),o('th','ไทยเท่านั้น','Thai only'),o('en','อังกฤษเท่านั้น','English only'),
  ],recommend:()=>({value:'th_en',why:why('งานส่วนใหญ่ในไทยมีทั้งสองภาษา','Most work in Thailand mixes both languages')}),
  ask:{th:l=>`ภาษาของข้อมูลคือ "${l}" ใช่ไหม`,en:l=>`Is the data language "${l}"?`}},

  {id:'compute_target',topic:{th:'เครื่องประมวลผล',en:'Compute target'},needs:['task_type','modality'],
  options:Object.entries(COMPUTE_LABELS).map(([v,l])=>o(v,l.th,l.en)),
  recommend:(d,f)=>{
    const configured=f?.compute?.kind;
    if(!heavy(d))return {value:'local_cpu',why:why('เริ่มวางแผนด้วยเครื่องนี้ก่อน ต้องตรวจขนาดข้อมูลและทรัพยากร','Plan for this computer first; dataset size and resources still need checking')};
    if(['colab','jupyter','ssh'].includes(configured))return {value:configured,why:why('โปรเจกต์นี้ตั้งค่าเครื่องประมวลผลนี้ไว้แล้ว','This project already has this compute target set up')};
    return {value:'colab',why:why('เสนอ Colab เป็นตัวเลือก ต้องตรวจสิทธิ์ ทรัพยากร และค่าใช้จ่ายก่อน','Colab is a proposed option; check access, resources and cost first')};
  },ask:{th:l=>`เทรนบน "${l}" ใช่ไหม`,en:l=>`Should training run on "${l}"?`}},

  {id:'budget',topic:{th:'งบ',en:'Budget'},needs:['compute_target'],when:d=>d.compute_target==='cloud_gpu',options:[
    o('up_to_5','เสนอวงเงินไม่เกิน 5 ดอลลาร์ ต้องอนุมัติก่อนใช้','Propose up to $5; separate spending approval required'),
    o('up_to_25','เสนอวงเงินไม่เกิน 25 ดอลลาร์ ต้องอนุมัติก่อนใช้','Propose up to $25; separate spending approval required'),
  ],recommend:()=>({value:'up_to_5',why:why('GPU บนคลาวด์มีค่าใช้จ่าย FORGE จะขออนุมัติก่อนเริ่มใช้เงินทุกครั้ง','Cloud GPUs cost money; FORGE asks for approval before any spending starts')}),
  ask:{th:l=>`งบคือ "${l}" ใช่ไหม`,en:l=>`Is the budget "${l}"?`}},

  {id:'evaluation',topic:{th:'วิธีวัดผล',en:'Evaluation'},needs:['task_type','modality'],
  optionsFor:d=>[
    o('holdout_20','กันข้อมูล 20% ไว้วัดผล โมเดลไม่เห็นตอนเทรน (สุ่มแบบคงที่)','Hold out 20% the model never sees in training (fixed random seed)'),
    ...(d.task_type==='forecasting'?[o('time_split','ใช้ช่วงเวลาล่าสุด 20% วัดผล','Measure on the latest 20% of the timeline')]:[]),
    ...(['generation','clustering'].includes(d.task_type)?[o('human_review','ให้คนตรวจตัวอย่าง 20 รายการแบบเทียบกัน','A person reviews 20 samples side by side')]:[]),
  ],recommend:d=>({value:d.task_type==='forecasting'?'time_split':['generation','clustering'].includes(d.task_type)?'human_review':'holdout_20',why:why('วัดกับข้อมูลที่โมเดลไม่เคยเห็น ผลจึงใกล้การใช้งานจริง','Measuring on unseen data is closest to real use')}),
  ask:{th:l=>`วัดผลแบบ "${l}" ใช่ไหม`,en:l=>`Should evaluation be "${l}"?`}},

  {id:'error_cost',topic:{th:'ความผิดพลาดที่สำคัญกว่า',en:'Which mistake matters more'},needs:['task_type','success_metric'],when:d=>['classification','detection'].includes(d.task_type),options:[
    o('equal','พลาดทั้งสองแบบแย่พอกัน','Both kinds of mistake are equally bad'),
    o('miss_worse','พลาดเคสจริงแย่กว่าแจ้งเตือนผิด','Missing a real case is worse than a false alarm'),
    o('false_alarm_worse','แจ้งเตือนผิดแย่กว่าพลาดเคสจริง','A false alarm is worse than missing a real case'),
  ],recommend:()=>({value:'equal',why:why('เริ่มแบบสมดุล ปรับเกณฑ์ได้หลังเห็นผลวัดจริง','Start balanced; adjust after seeing real results')}),
  ask:{th:l=>`ใช่ไหมว่า "${l}"`,en:l=>`Is it true that "${l}"?`}},

  {id:'base_model',topic:{th:'วิธีสร้างโมเดล',en:'Model approach'},needs:['task_type','compute_target'],when:d=>d.task_type==='generation',options:[
    o('small_open_lora','เริ่มจากโมเดลเปิดขนาดเล็ก (ราว 1–3B) แล้วปรับจูนแบบ LoRA','Start from a small open model (about 1–3B) and fine-tune with LoRA'),
    o('rag','ค้นจากเอกสารแล้วตอบ ไม่ต้องเทรน','Search documents and answer, no training'),
    o('prompt_only','ใช้บริการ AI ที่เชื่อมไว้กับตัวอย่างคำตอบ ไม่ต้องเทรน','Use the connected AI service with examples, no training'),
  ],recommend:()=>({value:'small_open_lora',why:why('เป็นแนวทางที่เสนอ ต้องตรวจสิทธิ์โมเดล หน่วยความจำ และเครื่องมือก่อน','A proposed approach; model license, memory and tooling need checking')}),
  ask:{th:l=>`ใช้วิธี "${l}" ใช่ไหม`,en:l=>`Should the approach be "${l}"?`}},

  {id:'data_upload',topic:{th:'การส่งข้อมูลออกนอกเครื่อง',en:'Sending data off this computer'},needs:['compute_target','data_source'],when:d=>d.compute_target!=='local_cpu',options:[
    o('training_copy','อัปโหลดเฉพาะสำเนาที่ใช้เทรน และลบเมื่อเสร็จ','Upload only the training copy and delete it when done'),
    o('anonymize_first','ลบข้อมูลส่วนตัวก่อน แล้วค่อยอัปโหลด','Remove personal details first, then upload'),
    o('no_upload','ห้ามส่งข้อมูลออกจากเครื่องนี้','Never send data off this computer'),
  ],recommend:()=>({value:'no_upload',why:why('เก็บข้อมูลในเครื่องก่อน หากต้องส่งออกต้องตรวจสิทธิ์และอนุมัติแยก','Keep data local first; any transfer needs separate review and authorization')}),
  ask:{th:l=>`จัดการข้อมูลแบบ "${l}" ใช่ไหม`,en:l=>`Should data be handled as "${l}"?`}},
]);

export const valuesOf=decisions=>Object.fromEntries(Object.entries(decisions??{}).map(([k,v])=>[k,v?.value??null]));
const relevant=(n,d)=>n.when?n.when(d):true;
const optionsOf=(n,d)=>(n.optionsFor?n.optionsFor(d):n.options)??[];
export const node=id=>QUESTION_TREE.find(n=>n.id===id)??null;

/** Every unsettled, relevant question whose prerequisites are all settled. */
export function openQuestions(decisions){
  const d=valuesOf(decisions);
  return QUESTION_TREE.filter(n=>!Object.hasOwn(d,n.id)&&n.needs.every(k=>Object.hasOwn(d,k))&&relevant(n,d));
}
/** The cap is a safety net only; the tree itself fits (see tests/studio.test.mjs). */
export function frontier(decisions,facts,prompt){
  const d=valuesOf(decisions),h=inferFromPrompt(prompt),room=MAX_DECISIONS-Object.keys(d).length;
  return room>0?openQuestions(decisions).slice(0,room).map(n=>question(n,d,facts,h)):[];
}
function question(n,d,facts,h){
  const proposed=optionsOf(n,d),options=proposed.length?proposed:[o('review_required','กำหนดเกณฑ์เฉพาะงานก่อนเริ่ม','Define task-specific criteria before starting')],rec=n.recommend(d,facts,h),chosen=options.find(x=>x.value===rec.value)??options[0];
  return {id:n.id,topic:{...n.topic},prompt:{th:n.ask.th(chosen.label.th),en:n.ask.en(chosen.label.en)},why:rec.why,options:structuredClone(options),recommended:{value:chosen.value,label:{...chosen.label}},source:'built-in'};
}
/** Drops answers whose prerequisites or relevance no longer hold. */
export function prune(decisions){
  const out={...decisions};let again=true;
  while(again){again=false;const d=valuesOf(out);
    for(const n of QUESTION_TREE)if(Object.hasOwn(out,n.id)&&(!n.needs.every(k=>Object.hasOwn(out,k))||!relevant(n,d))){delete out[n.id];again=true;}}
  return out;
}
/** Re-answering a parent invalidates its whole dependent subtree, even if a
 * child remains relevant. Old metrics must not survive a task-type change. */
export function reopenDecision(decisions,id){
  const removed=new Set([id]);
  for(const n of QUESTION_TREE)if(n.needs.some(k=>removed.has(k)))removed.add(n.id);
  return prune(Object.fromEntries(Object.entries(decisions).filter(([k])=>!removed.has(k))));
}
/** Answer for one question: {accept:true} | {value} | {text}. */
export function settle(question,answer){
  if(answer?.text!==undefined){const v=String(answer.text).trim().slice(0,1000);if(!v)throw new Error('EMPTY_ANSWER');return {value:'custom',text:v,label:{th:v,en:v},source:'override',topic:question.topic};}
  const value=answer?.accept?question.recommended.value:answer?.value,opt=question.options.find(x=>x.value===value);
  if(!opt)throw new Error('UNKNOWN_OPTION');
  return {value,label:{...opt.label},source:value===question.recommended.value?'recommended':'chosen',topic:question.topic};
}
/** Rebuilds the decision map from saved brief decisions (label → option value). */
export function decisionsFromBrief(saved=[]){
  const out={};
  for(const item of saved){
    const n=node(item.id),answer=String(item.answer??'').trim();if(!answer)continue;
    if(!n){out[item.id]={value:'custom',text:answer,label:{th:answer,en:answer},source:'provider',topic:{th:item.question,en:item.question}};continue;}
    const opt=optionsOf(n,valuesOf(out)).find(x=>x.label.th===answer||x.label.en===answer);
    out[item.id]=opt?{value:opt.value,label:{...opt.label},source:'saved',topic:{...n.topic}}:{value:'custom',text:answer,label:{th:answer,en:answer},source:'override',topic:{...n.topic}};
  }
  return out;
}

const term=(key,th,en,dth,den,ath=[],aen=[])=>({key,term:{th,en},definition:{th:dth,en:den},avoid:{th:ath,en:aen}});
/** Short domain glossary of terms the owner settled (domain-modeling style). */
export function glossaryFor(decisions){
  const d=valuesOf(decisions),out=[];
  out.push(term('dataset','ชุดข้อมูล','Dataset','ตัวอย่างทั้งหมดที่ใช้สอนและวัดผลโมเดล','All the examples used to teach and measure the model.',['ดาต้า','ข้อมูลดิบ'],['data dump','raw data']));
  if(['classification','regression','forecasting','detection','extraction'].includes(d.task_type))out.push(term('target','สิ่งที่จะทำนาย','Target','คำตอบที่โมเดลต้องให้ เช่น คอลัมน์หนึ่งในตาราง','The answer the model must produce, such as one column in a table.',['คอลัมน์ผลลัพธ์','เลเบล'],['output column','label column']));
  if(d.labels)out.push(term('label','คำตอบที่ถูกต้อง','Label','คำตอบจริงของตัวอย่างเก่า ใช้สอนและตรวจโมเดล','The true answer for a past example, used to teach and check the model.',['แท็ก'],['tag','annotation']));
  out.push(term('train','เทรน','Train','ให้โมเดลเรียนรู้รูปแบบจากชุดข้อมูล','Let the model learn patterns from the dataset.',['ฝึก','สอนโมเดล'],['fit','teach']));
  if(d.evaluation==='holdout_20')out.push(term('holdout','ข้อมูลชุดวัดผล','Holdout set','ข้อมูล 20% ที่กันไว้ โมเดลไม่เห็นตอนเทรน ใช้วัดผลจริง','The 20% kept aside that the model never sees in training, used for honest measurement.',['ข้อมูลทดสอบ'],['test data','validation data']));
  if(d.evaluation==='time_split')out.push(term('time_split','ช่วงเวลาวัดผล','Time split','ช่วงเวลาล่าสุดที่กันไว้วัดผล เหมือนทำนายอนาคตจริง','The latest period kept aside to measure, like predicting the real future.',['ข้อมูลทดสอบ'],['test data']));
  if(d.evaluation==='human_review')out.push(term('human_review','การตรวจโดยคน','Human review','คนอ่านตัวอย่างผลลัพธ์แล้วให้คะแนนตามเกณฑ์ที่ตกลงไว้','A person reads sample outputs and scores them against agreed criteria.',['ทดสอบผู้ใช้'],['user testing']));
  out.push(term('baseline','การเดาแบบง่าย','Baseline','วิธีง่ายที่สุดที่ใช้เทียบ เช่น ทายคำตอบที่พบบ่อยที่สุดเสมอ','The simplest method to compare against, such as always guessing the most common answer.',['ค่าอ้างอิง'],['benchmark','reference model']));
  if(d.task_type==='generation'&&d.base_model==='small_open_lora')out.push(term('fine_tune','ปรับจูน','Fine-tune','เทรนโมเดลที่มีอยู่แล้วต่อด้วยตัวอย่างของคุณ','Train an existing model further on your examples.',['ฝึกโมเดลใหม่'],['retrain from scratch']));
  if(d.compute_target)out.push(term('compute','เครื่องประมวลผล','Compute target',`เครื่องที่ใช้เทรน ตกลงไว้ว่าเป็น ${COMPUTE_LABELS[d.compute_target]?.th??'เครื่องที่เลือก'}`,`The machine that runs training; settled as ${COMPUTE_LABELS[d.compute_target]?.en??'the selected machine'}.`,['เซิร์ฟเวอร์'],['server','backend']));
  out.push(term('deploy','เปิดใช้งานโมเดล','Deploy','ทำให้โมเดลพร้อมรับข้อมูลใหม่และตอบผลในเครื่องนี้','Make the model ready to take new inputs and answer, on this computer.',['การให้บริการ'],['serve','publish']));
  if(d.task_type==='classification'&&d.error_cost&&d.error_cost!=='equal')out.push(term('threshold','เกณฑ์ตัดสิน','Decision threshold','ค่าที่ใช้ตัดสินว่าใช่หรือไม่ ปรับตามความผิดพลาดที่ยอมรับได้','The cut-off that turns a score into yes/no, tuned to the mistake you can accept.',['ค่าตัด'],['cutoff value']));
  return out;
}

/** Normalised task description used by briefs and trainer backends. */
export function taskSpecFrom(decisions){
  const d=valuesOf(decisions);
  return {taskType:d.task_type??null,modality:d.modality??null,dataSource:d.data_source??null,labels:d.labels??null,target:d.target??null,language:d.language??null,
    compute:d.compute_target??null,budget:d.budget??(d.compute_target&&d.compute_target!=='cloud_gpu'?'zero':null),evaluation:d.evaluation??null,metric:d.success_metric??null,
    deployment:d.deployment_form??null,baseModel:d.base_model??null,dataUpload:d.data_upload??null,errorCost:d.error_cost??null};
}
