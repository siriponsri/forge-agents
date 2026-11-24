# FORGE — บันทึกสัมภาษณ์ Requirements

วันที่: 24 พฤศจิกายน 2026 (Asia/Bangkok)

สถานะ: อยู่ระหว่างเก็บ requirements และเลือกสถาปัตยกรรม เอกสารนี้แยกสิ่งที่เจ้าของยืนยันแล้วออกจากข้อเสนอของผู้พัฒนา ฟีเจอร์ที่ระบุเป็นเป้าหมายยังไม่ใช่คำรับรองว่า implementation เสร็จแล้ว

## 1. สิ่งที่ยืนยันแล้ว

| ID | Requirement | หลักฐานจากการสนทนา |
|---|---|---|
| R01 | พัฒนาต่อเป็น FORGE โดยเลือกใช้ component ที่มีอยู่และเหมาะสม | เจ้าของขอรวมส่วนที่เป็นประโยชน์จาก Orca, T3 Code, Paseo, Happy, Agent Orchestrator และ single-agent-loop-kit |
| R02 | ผู้ใช้ที่ไม่เขียนโค้ดต้องใช้งานได้ | เจ้าของระบุว่า no-code user ใช้ได้เลย |
| R03 | ใช้ T3 Code เป็นฐาน GUI จริง | เจ้าของเลือกต่อยอด T3 Code ในการสัมภาษณ์รอบแรก |
| R04 | รองรับ computer use ทั้งเครื่อง Windows หลักและเดสก์ท็อป/VM แยก | เจ้าของเลือกทั้งสองแบบ การควบคุม browser อย่างเดียวไม่ครบ requirement |
| R05 | งานพิสูจน์ต้องสร้างหรือแก้โปรเจกต์และเปิดทดสอบผลผ่าน GUI | เดิมเป็นแอปทั่วไป; R12 และแผน CA-EWS ใน R20 ทำให้ตัวอย่างปัจจุบันเป็น AI training ถึง local replay |
| R06 | นำแนวคิด Skill Adaptive และ Harness Adaptive ที่คุยเกี่ยวกับ Hermes มาพิจารณาร่วม | เจ้าของขอให้ใช้แนวคิดนี้ประกอบการออกแบบ; กลไกเฉพาะยังเป็นข้อเสนอ |
| R07 | ต้องมีระบบ multi-bot | เจ้าของเพิ่ม nightly-labs/openbot เป็น reference |
| R08 | สัมภาษณ์ requirements พร้อมเสนอตัวเลือก Top 3 | เจ้าของขอรูปแบบการทำงานนี้อย่างชัดเจน |
| R09 | ใช้ทีม bot ประจำและเพิ่มผู้ช่วยตามงานได้ | เจ้าของตอบเลือกตัวเลือก 1 ในรอบ multi-bot |
| R10 | รุ่นแรกคุยผ่าน FORGE: แชตส่วนตัว ห้องทีม และหน้าติดตามงาน | เจ้าของตอบเลือกตัวเลือก A; ยังไม่รวมช่องทางแชตภายนอกใน requirement รุ่นแรก |
| R11 | ทิศทางการใช้หรือแจกจ่ายเชิงพาณิชย์ยังไม่กำหนด | เจ้าของตอบว่ายังไม่กำหนด; ไม่ตีความว่าเลือกใช้เฉพาะ noncommercial |
| R12 | FORGE เน้น AI coding สำหรับ Training และ Inference/Deployment ของ AI project | เจ้าของปรับเป้าหมายจากแอปทั่วไปมาเป็นงาน AI โดยตรง |
| R13 | สร้าง Jupyter Notebook ได้ | เจ้าของยก Notebook เป็นผลลัพธ์เริ่มต้นที่ต้องการ |
| R14 | เชื่อม compute หลายแบบได้: Owner Server, Colab, Vast, Runpod และขยายต่อ | เป็นรายชื่อที่เจ้าของต้องการรองรับ; ยังไม่ยืนยันว่ามีบัญชีหรือทรัพยากรใดพร้อมใช้ |
| R15 | สร้าง inference UX/UI พร้อมการใช้ model weights | ต้องเชื่อมหน้าจอใช้งานกับโมเดลจริงและส่งมอบ artifact ที่เกี่ยวข้อง |
| R16 | มี dashboard ติดตามการทำงานของโมเดล | รายละเอียด training metrics, serving metrics และ model-quality metrics ต้องกำหนดตาม use case |
| R17 | เสนอแผนภาพรวมพร้อม diagram ก่อนทำงาน และติดตามแต่ละ phase แบบ Miro/Kanban/Jira | ชื่อผลิตภัณฑ์เป็นตัวอย่าง UX; ยังไม่ได้ขอให้ใช้บัญชี Miro หรือ Jira เป็น backend |
| R18 | ใช้ ChatGPT, Claude, Gemini, OpenRouter นำร่อง และขยาย Grok, OpenCode, Kimi, Qwen, DeepSeek, MaxPlus, KOB และอื่น ๆ | เจ้าของระบุบริการ; ต้องตรวจวิธีเชื่อมที่รองรับจริงแยกจากชื่อแบรนด์ |
| R19 | ทำ deep search หา MCP ที่มีอยู่และโอกาสสร้าง MCP จาก API/SDK ก่อน | เจ้าของขอให้ค้นคว้าก่อนสัมภาษณ์ต่อหรือสร้าง adapter โดยสมมติเอง; มีรายงานผลแล้วก่อนรับแผน CA-EWS |
| R20 | ใช้แผน CA-EWS เป็นโปรเจกต์อ้างอิงสำหรับ requirements ของ FORGE | เจ้าของแนบ `CARDIAC_ARREST_MASTER_PLAN.md` v0.1.0 และบอกว่ามีแผนประมาณนี้; รายละเอียดเป็น draft input สำหรับออกแบบ ไม่ใช่ผลทดสอบหรือคำสั่งเริ่มรัน prompt ที่อยู่ในไฟล์ |
| R21 | เดิมเลือก Windows public CPU + Runpod training | **ถูกแทนที่ส่วน training ด้วย R22**; เก็บเป็นประวัติการตัดสินใจ ไม่ใช่ provider ที่เลือกอยู่ปัจจุบัน |
| R22 | โปรเจกต์ต้นแบบใช้ Windows เครื่องหลักสำหรับ public CPU และ Google Colab สำหรับ training | เจ้าของเปลี่ยนจาก Runpod โดยตรง; tier ตอบแล้วใน R25 ส่วนบัญชี/สิทธิ์/runtime ยังไม่ตรวจ |
| R23 | เพิ่มการเชื่อม LitServe MCP | เจ้าของส่งเอกสาร LitServe MCP; เสนอใช้เปิดโมเดลที่ฝึกแล้วเป็น inference tool และรับ artifacts มา serve บน Windows ใน pilot |
| R24 | การเลือกชุดนี้ใช้กับโปรเจกต์ต้นแบบ; product FORGE ต้อง flexible | แยก project profile ออกจากแกนกลาง เลือก/เปลี่ยน compute, serving, storage, tracking, MCP และ agent provider ได้ตามงาน |
| R25 | ปัจจุบันเจ้าของใช้ **Colab Free** | ใช้เป็นฐานของต้นแบบโดยไม่บังคับอัปเกรด; ไม่เท่ากับกำหนดให้ FORGE ต้องใช้ฟรีตลอดหรือห้าม paid compute ทุกโปรเจกต์; API eligibility ยังต้องตรวจแยก |
| R26 | ต้นแบบเก็บงานบน **Google Drive + Local Windows + Git repository** ร่วมกัน | เจ้าของกำหนดทั้งสามปลายทางแล้ว; เลือกบัญชี/โฟลเดอร์/path/remote จริงตอน setup ไม่ถามเลือกประเภท storage ซ้ำ |
| R27 | Product จริงเลือก storage ได้อิสระในหน้า **Settings** | เสนอ Project Settings → Storage & Sync พร้อม destination/file routing/sync/retention ที่แก้ต่อโปรเจกต์ได้; ไม่บังคับทุกโปรเจกต์ใช้ครบสามตัว |

บริบทที่ใช้ต่อ: Windows เป็นเครื่องหลัก, ภาษาไทยเป็นค่าเริ่มต้นและมีภาษาอังกฤษ, ใช้ชื่อและตัวตนของ FORGE ต่อไป รายละเอียด provider และ runtime ควรอยู่ในส่วนขั้นสูง

## 2. รูปแบบทีมที่เลือกและทางเลือกที่พิจารณา

**ผลสัมภาษณ์: เลือกข้อ 1 — ทีมประจำและผู้ช่วยตามงาน** ชื่อและจำนวน bot ประจำ รวมถึงบทบาทหัวหน้าทีม/นักพัฒนา/ผู้ตรวจงาน ยังเป็นข้อเสนอเริ่มต้นที่ปรับได้

| อันดับ | รูปแบบ | ประสบการณ์ของผู้ใช้ | ผลต่อระบบ |
|---|---|---|---|
| 1 — เลือกแล้ว | ทีมประจำและผู้ช่วยตามงาน | มี bot ที่รู้จัก เช่น หัวหน้าทีม นักพัฒนา และผู้ตรวจงาน คุยตรงได้ และหัวหน้าหาผู้ช่วยเพิ่มเฉพาะงานที่จำเป็น | เก็บตัวตนและความจำของทีมประจำ แยกงานย่อยและผู้ช่วยชั่วคราวออกจากประวัติระยะยาว |
| 2 — ไม่เลือกเป็นค่าเริ่มต้น | ทีมประจำเท่านั้น | กำหนดสมาชิกและบทบาทไว้ งานทั้งหมดกระจายภายในทีมชุดนี้ | เมื่อมีงานประเภทใหม่ อาจต้องปรับสมาชิกหรือบทบาท |
| 3 — ไม่เลือกเป็นค่าเริ่มต้น | ทีมที่สร้างใหม่ตามเป้าหมาย | เจ้าของบอกผลลัพธ์ แล้วระบบจัดทีมเฉพาะงานและเก็บผลเมื่อจบ | หน้าจอเริ่มต้นเรียบง่าย แต่ไม่มีความต่อเนื่องของเพื่อนร่วมงานแต่ละตัวมากเท่าทีมประจำ |

คำว่า multi-bot ต้องแยกจาก multi-provider: การมีหลาย bot ไม่จำเป็นต้องใช้หลายบัญชีหรือหลายบริษัทโมเดล แต่ละ bot อาจใช้ provider เดียวกันได้ ขอบเขตบัญชีและความจำต้องระบุไว้ต่างหาก

## 3. UX ที่เสนอสำหรับผู้ใช้ no-code

- สร้าง bot ด้วยภาษาธรรมชาติ แล้วแก้ชื่อ บทบาท ความถนัดและขอบเขตงานผ่านแบบฟอร์ม
- คุยกับหัวหน้าทีม คุยกับ bot โดยตรง หรือคุยในห้องของโครงการได้
- งานแต่ละงานแสดงผู้รับผิดชอบ สิ่งที่กำลังทำ งานที่รอ และผลที่ตรวจสอบแล้ว
- มีการหยุดงาน ส่งต่องาน และกลับมาทำต่อโดยไม่ทำงานเดิมซ้ำโดยไม่จำเป็น
- แสดงหน้าจอเป้าหมายที่ bot ใช้งาน พร้อมหยุดและรับช่วงควบคุมได้
- ผู้ใช้เห็นผลลัพธ์และหลักฐานก่อนดู diff, log หรือรายละเอียดเครื่องมือขั้นสูง

แชตส่วนตัว ห้องทีม และหน้าติดตามงานภายใน FORGE เป็นขอบเขตรุ่นแรกที่เจ้าของยืนยันแล้ว รายละเอียดการสร้าง bot การจัดวางหน้าจอและขั้นตอนตรวจผลงานยังเป็นข้อเสนอที่ต้องทดสอบกับงานตัวอย่างของเจ้าของ

## 4. ขอบเขต multi-bot ที่เสนอ

| สิ่งที่แยก | เหตุผล |
|---|---|
| Bot identity | ชื่อ บทบาท คำสั่งหลัก skill และค่ากำหนดคงอยู่ข้ามงาน |
| Project context | ข้อมูลของโครงการไม่ไหลไปโครงการอื่นโดยอัตโนมัติ |
| Conversation/session | เปลี่ยนหรือเริ่ม session ใหม่ได้โดยไม่สูญเสียตัวตนของ bot |
| Task/run | ระบุผู้รับผิดชอบ สถานะ เกณฑ์สำเร็จ ขีดจำกัดงานและหลักฐานของรอบนั้น |
| Desktop target/session | ยืนยันว่า bot กำลังทำงานบนเครื่องหรือ VM ใด ไม่ใช้ bot ID แทนการระบุเครื่อง |

ข้อเสนอด้านการทำงานร่วมกัน:

1. ทุก task มีผู้รับผิดชอบหลัก และการมอบหมายงานเป็นรายการที่ตรวจสอบย้อนกลับได้
2. ข้อความระหว่าง bot แยกคำสั่งงาน ผลตอบกลับ และข้อมูลแจ้งให้ทราบ เพื่อไม่ให้ข้อความตอบกันเองก่อให้เกิดงานซ้ำ
3. งานแก้ไฟล์พร้อมกันใช้พื้นที่แยกและมีขั้นตอนรวมผลที่ชัดเจน
4. หนึ่ง desktop ให้ผู้ควบคุมการคลิก/พิมพ์ได้ครั้งละหนึ่งตัว ผู้ใช้รับช่วงแล้ว bot ต้องหยุดส่งคำสั่งใหม่
5. งาน GUI พร้อมกันใช้คนละ desktop/VM; การมีหลาย bot ไม่ได้แปลว่าทุกตัวต้องเริ่มทำงานพร้อมกันทุกครั้ง
6. การเปลี่ยน skill หรือการเลือก harness ต้องมีเหตุผลและ evidence ที่สอดคล้องกับข้อมูลจริง ห้ามเรียกกฎตาม capability ว่าเป็นระบบเรียนรู้ประสิทธิภาพที่วัดผลแล้ว

## 5. Component ที่เสนอและสถานะสิทธิ์

| ส่วน | แนวทาง | สถานะ |
|---|---|---|
| GUI, projects, conversations, provider sessions | ต่อบน T3 Code และรักษา server/client-runtime ที่ใช้งานร่วมกัน | ฐาน GUI ยืนยันแล้ว; จุดขยายและวิธีตาม upstream ยังอยู่ระหว่างออกแบบ |
| Bot identities, team tasks, delivery evidence | FORGE module ของเรา ประยุกต์พฤติกรรมที่ต้องการจาก OpenBot | เป็นข้อเสนอ ยังไม่มี implementation multi-bot |
| Native computer observation/actions | Cua Driver/SDK โดยเลือกเฉพาะ component ที่ใช้ MIT | แนะนำ; ยังไม่ได้ติดตั้งหรือทดสอบบนเครื่องเจ้าของ |
| Isolated desktops | Driver ใน guest พร้อมการจัดการ VM/desktop และการเชื่อมต่อของ FORGE | ยังต้องเลือกระบบปฏิบัติการและผู้ให้บริการ desktop |
| Skills and harness selection | กลไก FORGE ที่ได้แนวคิดจาก Hermes | มี prototype แบบกฎและ capability; ยังไม่มี adaptive learning ที่พิสูจน์ผล |
| Loop efficiency | ใช้แนวคิดและเครื่องมือประเมินจาก single-agent-loop-kit | ไม่ใช่ข้อจำกัดว่าต้องมี bot เดียวทั้งผลิตภัณฑ์ |
| AO/Paseo/Happy/Orca | เลือก adapter หรือแนวคิดเฉพาะที่ไม่ซ้ำซ้อนกับ runtime หลัก | ยังไม่ควรรวม runtime ทั้งหมดเข้ามาโดยอัตโนมัติ |

**OpenBot:** commit ที่ตรวจคือ `20d1cd63d95ac91f049054b1afdd00ece27b322b`; LICENSE ระบุ PolyForm Noncommercial 1.0.0 และมีช่องทางขอ commercial license แยก เจ้าของตอบแล้วว่าทิศทางเชิงพาณิชย์ยังไม่กำหนด จึงรักษาทางเลือกไว้โดยใช้เป็นแหล่งอ้างอิงพฤติกรรมและเขียนบริการ bot ของ FORGE เอง ยังไม่ได้คัดลอก source ของ OpenBot เข้า FORGE

**Cua:** Driver/SDK กับ Spaces/streaming เป็นคนละขอบเขต license การเลือก Driver ไม่ได้ทำให้ทั้ง monorepo เป็น MIT และ Driver ไม่ได้จัดหา VM หรือโมเดลให้อัตโนมัติ

## 6. ผลสัมภาษณ์รอบ multi-bot

เจ้าของตอบเมื่อ 24 พฤศจิกายน 2026:

| คำถาม | คำตอบ | ผลต่อการออกแบบ |
|---|---|---|
| รูปแบบทีม | 1 — ทีมประจำและผู้ช่วยตามงาน | มี bot identity คงอยู่ ส่วนผู้ช่วยชั่วคราวผูกกับงาน |
| ช่องทางคุยรุ่นแรก | A — ใช้ใน FORGE ก่อน | สร้างแชตส่วนตัว ห้องทีม และหน้าติดตามงานในแอปเดียว |
| ทิศทางการใช้ | ยังไม่กำหนด | เก็บทางเลือกเชิงพาณิชย์ไว้และยังใช้ OpenBot เป็น reference |

### ผลสัมภาษณ์รอบงานพิสูจน์แรก

| คำถาม | คำตอบของเจ้าของ | ผลต่อการออกแบบ |
|---|---|---|
| งานแรก/ประเภทแอป | เน้น AI Training และ Inference/Deployment; Notebook, Cloud GPU, inference UI/weights, model dashboard | เปลี่ยน acceptance target เป็น AI project lifecycle; ยังไม่เลือก modality/model/dataset เฉพาะ |
| การทำงานอัตโนมัติ | เสนอแผนใหญ่พร้อมแผนผังสวยงามก่อน แล้วติดตามแต่ละ phase | มี visual plan และ task state ชุดเดียวกันสำหรับ canvas/board/detail |
| บัญชี/บริการนำร่อง | ChatGPT, Claude, Gemini, OpenRouter | ตรวจสิทธิ์และช่องทาง native login/API ของแต่ละบริการ โดยไม่สมมติจากชื่อ subscription |
| การขยาย provider | Grok, OpenCode, Kimi, Qwen, DeepSeek, MaxPlus AI, KOB และอื่น ๆ | แยก model API, coding harness/ACP และ MCP tool integration |
| ขั้นตอนถัดไป | ให้ deep search ก่อน เพราะหลายส่วนมี MCP หรือสร้าง MCP เชื่อม API ได้ | ทำ capability/source/license matrix และเสนอ reuse/wrapper strategy ก่อนถามรอบใหม่ |

### ผลจากแผนโปรเจกต์ที่เจ้าของแนบ

แผน CA-EWS v0.1.0 ลงวันที่ 24 พฤศจิกายน 2026 ให้ข้อมูลสำหรับ pilot ดังนี้ รายการนี้อธิบายเนื้อหาแผนที่ได้รับ ยังไม่ใช่ implementation หรือการรับรองข้อกำหนดทุกข้อของ draft โดยเจ้าของ:

| ประเด็น | สิ่งที่แผนระบุ | ผลต่อข้อเสนอ FORGE |
|---|---|---|
| งานแรก | Public M0–M4: AHE baseline/temporal training, local replay, IHCA feasibility | ใช้ time-series/tabular ML เป็น acceptance case แรก |
| ข้อมูลเริ่มต้น | PhysioNet Challenge 2009; demo ICU data สำหรับ feasibility ตามสิทธิ์ | เพิ่ม dataset version/access/manifests; ไม่ถามให้เลือก LLM/vision ใหม่ |
| โมเดล | Baseline, logistic latest/temporal และ gradient boosting ตามความเหมาะสม | Python package/CLI + notebooks; predictor ไม่ต้องใช้ LLM |
| Compute ในต้นฉบับ | CPU first, no paid compute, ข้อเสนอ ≤5 GB เพิ่มเติมและ ≤4 CPU-hours | R22 แทน R21 เป็น Windows CPU + Colab training; ตัวเลขต้นฉบับไม่ใช่ remote budget หรือการเลือก paid Colab |
| ผลลัพธ์ | Model/preprocessor, held-out predictions/metrics, FastAPI/React replay app, evidence/handoff | GUI FORGE กับ UI ของแอปที่สร้างเป็นคนละชั้น |
| ข้อมูลและขอบเขต | AHE แยกจาก IHCA; controlled-data local-only ตามแผน; M5–M7 conditional | Policy ต่อ project/track, input/output origin แยกกัน, หนึ่ง branch ติดขัดไม่หยุดทั้งโครงการ |
| การทำงาน | วางแผนก่อน แล้วเดินงานวิศวกรรมปกติภายในขอบเขต | ไม่เพิ่มการถามเจ้าของทุก milestone; เก็บผลกับเกณฑ์รับงานจริง |

แหล่งต้นทาง: `CARDIAC_ARREST_MASTER_PLAN.md`, SHA-256 `494f1c2634a3d3529e3992e5188c4068acd4b8e1f31b48e7dc125dff665b2ec5`, โดยเฉพาะ §§0, 2, 4–11, 14 รายละเอียดการแปลงเป็น requirements อยู่ใน [CA_EWS_FORGE_PILOT_TH.md](projects/CA_EWS_FORGE_PILOT_TH.md)

### ผลสัมภาษณ์เรื่องเครื่องและ training server

คำตอบล่าสุด: **public CPU บน Windows เครื่องหลัก + Google Colab สำหรับ training + เพิ่ม LitServe MCP** แทน Runpod ที่เลือกก่อนหน้า และใช้กับโปรเจกต์ต้นแบบ CA-EWS เท่านั้น ไม่ต้องให้เจ้าของเลือก provider ซ้ำ

ข้อเสนอแบ่งงาน: Windows รัน FORGE, public-data acquisition/audit/preprocessing, tests และ CPU smoke; Colab รัน training/evaluation หลัก; ส่ง model/preprocessor, metrics, logs และ manifests กลับมาเพื่อ local replay และ LitServe inference/MCP รายละเอียดตำแหน่ง serving เป็นข้อเสนอที่สอดคล้องกับแผนเดิม และยังไม่ได้ติดตั้ง/เชื่อมต่อ

**ขอบเขต product ที่เจ้าของย้ำ:** เก็บชุดนี้เป็น project profile ที่แก้ได้ ส่วน FORGE core ดูแล plans/tasks/bots/runs/artifacts/evidence และ policy ทั่วไป ผ่าน adapters ที่ประกาศ capability จริง โปรเจกต์อื่นเลือก owner server, Runpod, Vast, serving framework หรือ MCP อื่นได้ การเปลี่ยน provider ต้องตรวจ environment และสร้าง execution attempt ใหม่ตามจำเป็น ไม่รับรองการย้าย kernel ที่กำลังรันได้ทันที

การค้นคว้ารอบล่าสุดพบ Colab สองช่องทาง: **official remote Colab API MCP** สำหรับ runtime/session/code/file transfer และ **official local Colab browser MCP** สำหรับ notebook ที่เปิดใน browser จึงไม่ควรจำกัด FORGE เป็น browser bridge อย่างเดียว เลือกช่องทางจากสิทธิ์และ capability ที่ตรวจผ่าน connection setup [Remote MCP](https://developers.google.com/colab/api/reference/mcp) · [Browser MCP](https://github.com/googlecolab/colab-mcp)

### ผลการเลือก compute และ storage

**ตอบแล้ว: Colab Free** จึงไม่ถาม tier ซ้ำ เริ่มออกแบบกับทรัพยากรฟรีที่เข้าถึงได้จริง และให้การอัปเกรดภายหลังเป็นทางเลือกของ project profile

ข้อเสนอสำหรับต้นแบบ: เริ่มตรวจ official browser-notebook MCP, ทำ training เป็นการทดลองย่อยครั้งละหนึ่งงาน และบันทึก artifacts ของรอบที่จบทันที งานที่รองรับ checkpoint จึงกู้กลางทางได้; โมเดลที่ไม่รองรับต้องเริ่ม attempt ใหม่จากข้อมูล/config เดิม หาก runtime ไม่พร้อมให้แสดงรอทรัพยากรหรือใช้ fallback ที่กำหนดไว้ ไม่เปลี่ยนไปใช้ paid provider เอง

**ตอบแล้ว: Google Drive + Local Windows + Git repository** เจ้าของย้ำให้เลือกอย่างอิสระในหน้า Settings ของ product จริง ไม่ต้องถามเลือก storage ซ้ำ ข้อเสนอค่าเริ่มต้นคือ Drive เก็บ checkpoint/model bundles, Windows เก็บ workspace และสำเนาสำหรับ inference, Git เก็บ source/notebooks/configuration/รายงาน/manifests โดยแก้ mapping และจังหวะ sync ได้

เพิ่ม **Project → Settings → Storage & Sync** ให้เลือก account/folder/local path/Git remote/branch ผ่าน GUI แสดงสถานะสำเนาแต่ละปลายทาง และแยก save/commit/push ตาม policy ที่ตั้งไว้ Repo ของ output project ไม่สมมติว่าเป็น repo `forge-agents` รายละเอียดอยู่ใน [PROJECT_STORAGE_SETTINGS_TH.md](PROJECT_STORAGE_SETTINGS_TH.md)

บัญชี/โฟลเดอร์/remote ที่ใช้จริงและพื้นที่ว่างตรวจผ่าน setup เมื่อเชื่อมต่อ ยังไม่มีการสร้าง folder, push Git หรือ sync artifacts ในรอบ requirements นี้ ส่วน account/API eligibility/runtime ของ Colab ตรวจแยกจาก Free tier

การเลือก Colab สำหรับ training ไม่ได้เปิด permanent inference server หรือ guest desktop และ LitServe MCP ไม่ได้แทน Colab connector หรือระบบ multi-bot ของ FORGE

ข้อเสนอเว็บติดตามงาน/CSV และคำถามให้เลือก LLM/vision/inference ทั่วไปจากรอบก่อนถูกแทนด้วยแผน CA-EWS ที่เจ้าของส่งมาเป็น reference pilot แล้ว

## 7. หลักการเชื่อมต่อที่เสนอจากโจทย์ AI

1. ใช้ MCP ของผู้ให้บริการโดยตรงเมื่อมีขอบเขตเครื่องมือและ license เหมาะสม
2. ประเมิน MCP ของชุมชนเป็นราย repository; การมีชื่อ provider ในชื่อ repo ไม่ทำให้เป็น official integration
3. ส่วนที่ยังขาดให้ห่อ official API/SDK เป็น MCP ที่มีเครื่องมือระดับงาน เช่น ส่ง training job, อ่านสถานะ, เก็บ checkpoint และหยุดทรัพยากร
4. ใช้ model API/native coding harness สำหรับโมเดลที่ bot ใช้คิด และใช้ MCP สำหรับเครื่องมือ ข้อมูลและทรัพยากร การมี MCP ไม่ได้เปลี่ยน subscription เป็น API credits
5. คง plan/task/job/artifact IDs เพื่อให้ canvas, Kanban, Notebook, training dashboard และ delivery อ้างอิงงานเดียวกัน
6. งานยาวคืน job/task handle และติดตามต่อหลัง reconnect; การกดหยุดใน UI ต้องแยกจากการยืนยันว่าผู้ให้บริการหยุด compute แล้ว
7. การเชื่อม MCP อย่างเดียวไม่สร้าง training metrics: script/runtime ต้องส่งข้อมูลไปยัง tracker ก่อน bot และ dashboard จึงอ่านได้
8. Notebook, weights/checkpoint, config, dataset revision, evaluation และ deployment revision ต้องเชื่อมโยงกันได้ ไม่ถือว่า notebook cell จบเท่ากับโมเดลผ่านเกณฑ์
9. Project profile เลือก components ได้อิสระ; capabilities ที่ provider ไม่มีต้องแสดงตามจริง การมี adapter หนึ่งตัวไม่รับรองทุก provider และไม่ทำให้ compute ทุกประเภทมี lifecycle เหมือนกัน
10. แยก MCP สำหรับควบคุม environment (เช่น Colab) จาก MCP ที่เปิดโมเดลเป็นเครื่องมือ (เช่น LitServe) ทั้งสองชนิดอยู่ใน connection registry ได้โดยมีบทบาทต่างกัน
11. Storage settings เป็นของแต่ละ project; ใช้ artifact IDs/checksums และ code revision เชื่อมสำเนา Drive/local/Git แสดง training completed แยกจาก sync completed และไม่เปลี่ยนประวัติย้อนหลังเมื่อแก้ destination

รายละเอียดข้อเสนอเหล่านี้ยังไม่ใช่ implementation ที่ผ่านการทดสอบกับบริการจริง ผลการค้นคว้าและ Top 3 แนวทางรวมอยู่ใน [FORGE_AI_MCP_RESEARCH_TH.md](FORGE_AI_MCP_RESEARCH_TH.md) พร้อมรายงานแยกด้าน compute, provider, planning UI, training/monitoring และ computer use

## 8. งานที่มีอยู่ใน repository

มี workbench และ execution engine ต้นแบบที่แยก workspace, เรียก native coding provider, จัดการงานและตรวจผลได้บางส่วน งานนี้เกิดก่อนเจ้าของเลือกฐาน T3 และเพิ่ม multi-bot จึงเก็บไว้เป็น prototype เพื่อพิจารณานำส่วนที่เหมาะสมกลับมาใช้ ไม่ถือว่า UI ต้นแบบหรือ REST server เดิมเป็นสถาปัตยกรรมปลายทางที่ได้รับการเลือกแล้ว

ยังไม่ได้มีระบบ multi-bot, guest lifecycle หรือ native GUI use ที่ผ่าน acceptance บน Windows ของเจ้าของ ยังไม่มีการ publish, merge หรือ deploy ผลงานจากรอบนี้ และไม่มีการใช้โมเดลจริงเพื่ออ้างผลลัพธ์ของ workflow ปลายทาง

## แหล่งอ้างอิงที่ตรวจ

- [OpenBot README](https://github.com/nightly-labs/openbot/blob/20d1cd63d95ac91f049054b1afdd00ece27b322b/README.md)
- [OpenBot LICENSE](https://github.com/nightly-labs/openbot/blob/20d1cd63d95ac91f049054b1afdd00ece27b322b/LICENSE)
- [OpenBot channels and messaging](https://github.com/nightly-labs/openbot/blob/20d1cd63d95ac91f049054b1afdd00ece27b322b/docs/architecture/channels-and-messaging.md)
- [OpenBot computer use](https://github.com/nightly-labs/openbot/blob/20d1cd63d95ac91f049054b1afdd00ece27b322b/docs/architecture/computer-use.md)
- [T3 Code v0.1.11](https://github.com/pingdotgg/t3code/tree/v0.1.11)
- [T3 Code license](https://github.com/pingdotgg/t3code/blob/v0.1.11/LICENSE)
- [Cua Driver](https://github.com/trycua/cua/blob/f7a7a2f1d7f0915f5d2e63c5164f42bd547de580/libs/cua-driver/README.md)
- [Cua license map](https://github.com/trycua/cua/blob/f7a7a2f1d7f0915f5d2e63c5164f42bd547de580/legal/LICENSING.md)
- [Hermes adaptation notes](HERMES_ADAPTATION.md)
- [Component provenance](COMPONENTS.md)
