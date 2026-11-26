# FORGE: Complete Local Product + AG-UI + Office & Reports

## ??????????????????????? ? Universal Training

????? Owner Q1?Q7 ?????? 26 ?.?. 2026 ??????????????????????? [handoff Universal Training](../../universal-training/00_HANDOFF_TH.md). ????????????????????????????: ????????????? Cardiac ?????????????????????/dr-train SSH, dependency Python ???????????????, ??????????? ??? merge/push ??????????. ???????????? activate CA-EWS ?????? paid compute ?????? deploy Cloudflare; ???????????? runbook. ???????? authority/protected legacy ??????????.


ฉบับ **v3 — 24 พฤศจิกายน 2026, Asia/Bangkok**

## เป้าหมายล่าสุดของเจ้าของ

**สิ่งที่เพิ่มใน v3:** AG-UI เป็น protocol ระหว่าง harness กับหน้าจอ, Univer สำหรับแก้เอกสารและตารางในแอป, WordCraft/PdfCraft สำหรับ report pipelines และขั้นตอนตรวจ T3 ไม่แสดงโมเดล 6.2 ใช้โมเดลที่เลือกและรันได้จริง เช่น GPT 6.1 xhigh ทำงานต่อได้โดยไม่รอแก้ catalog

**พัฒนา FORGE ให้ครบตาม concept และ requirements ที่เก็บไว้ ผู้ใช้ no-code เปิด localhost และใช้งานผ่าน GUI ได้ง่าย โดยยังไม่สร้างโปรเจกต์ต้นแบบในรอบนี้** เมื่อพัฒนาและตรวจฝั่งผู้พัฒนาแล้ว จะส่งงานผ่าน `main` จากนั้นเจ้าของ pull ไปเครื่องบ้านและทดสอบ flow ของระบบ

ฉบับนี้ต่อจาก `forge-local-complete-20261124-v2` และแทนที่คำแนะนำเดิมเฉพาะส่วนที่ปรับล่าสุด ใช้ v3 เป็นเป้าหมายปัจจุบัน G1 ยังเป็นจุดตรวจระหว่างทาง ส่วน CA-EWS/การฝึกโมเดล/การสร้างแอปต้นแบบยังเลื่อนไปหลัง FORGE พร้อมใช้งาน ความสามารถ notebook, training, inference, deployment และ monitoring ในตัว FORGE ต้องพัฒนาครบ

ชุดนี้เป็นเอกสารและ prompt สำหรับ coding agent ไม่มี application code และไม่ใช่หลักฐานว่าแอปสร้างเสร็จแล้ว

## วางไฟล์

แตก ZIP ลง root ของ repo ที่เจ้าของเปิดใน T3 Code:

`C:\Users\siripon.sri\Desktop\my_project\forge-agents`

ต้องพบไฟล์นี้:

`C:\Users\siripon.sri\Desktop\my_project\forge-agents\docs\owner\forge-local-complete-20261124-v3\00_START_HERE_TH.md`

หากเคยวางชุด v1/v2 แล้ว ให้คง progress เดิมไว้เพื่อเทียบกับโค้ดจริง แต่ใช้ v3 เป็นเป้าหมายล่าสุด ไม่ล้างงานหรือเริ่มเขียนแอปใหม่เพราะเปลี่ยนเอกสาร Agent ต้องปรับ pointer ใน `AGENTS.md` ที่มีอยู่ให้ชี้ชุดนี้อย่างเหมาะสม โดยรักษาคำสั่งเดิมที่ยังใช้ได้

ชื่อไฟล์/โฟลเดอร์เอกสารที่เขียนแบบย่อในชุดนี้อ้างอิงจาก `docs/owner/forge-local-complete-20261124-v3/` ส่วนโค้ด, Git, runtime paths และ applicable `AGENTS.md` ให้ตรวจจาก checkout จริง

## อ่านก่อนเริ่ม

1. [01_PRODUCT_BRIEF.md](01_PRODUCT_BRIEF.md) — ขอบเขต complete product และ requirements ที่เลือกแล้ว
2. [04_REPO_STATE_AND_PRECEDENCE.md](04_REPO_STATE_AND_PRECEDENCE.md) — สถานะที่ยังต้องตรวจและการตีความเอกสารเก่า
3. [02_IMPLEMENTATION_PLAN.md](02_IMPLEMENTATION_PLAN.md) — งานทั้งหมดและลำดับ dependency; ห้ามจบเพียง first slice
4. [05_ARCHITECTURE_AND_SETTINGS.md](05_ARCHITECTURE_AND_SETTINGS.md) — สถาปัตยกรรมที่ยืดหยุ่นต่อโปรเจกต์
5. [03_ACCEPTANCE_MATRIX.md](03_ACCEPTANCE_MATRIX.md) — เกณฑ์รับงานและหลักฐาน
6. [progress/CURRENT_STATUS.md](progress/CURRENT_STATUS.md) — เทียบสถานะนี้กับโค้ดจริงก่อนทำต่อ

จากนั้นเปิด [06_LOCALHOST_SETUP_AND_HOME_UAT.md](06_LOCALHOST_SETUP_AND_HOME_UAT.md), [07_MODELS_AND_WORKTREES.md](07_MODELS_AND_WORKTREES.md), [08_RELEASE_MAIN_AND_HOME_HANDOFF.md](08_RELEASE_MAIN_AND_HOME_HANDOFF.md) และ [09_COMPONENT_REUSE_MAP.md](09_COMPONENT_REUSE_MAP.md) เมื่อทำงานส่วนที่เกี่ยวข้อง

ส่วนใหม่ที่ต้องรวมใน architecture และ acceptance: [10_AGUI_HARNESS_PROTOCOL.md](10_AGUI_HARNESS_PROTOCOL.md), [11_OFFICE_AND_REPORTS.md](11_OFFICE_AND_REPORTS.md) และ [12_T3_MODEL_DIAGNOSTIC_TH.md](12_T3_MODEL_DIAGNOSTIC_TH.md)

อ่านรายงานใน [reference/REFERENCE_INDEX.md](reference/REFERENCE_INDEX.md) เฉพาะ component ที่กำลังพัฒนา ไม่ต้องทำ deep research ทุก repo ซ้ำก่อนเริ่ม coding

## เริ่มใน T3 Code

ใช้ [prompts/START_FULL_PRODUCT.txt](prompts/START_FULL_PRODUCT.txt) เพื่อมอบหมายงานทั้งผลิตภัณฑ์ Agent ต้องตรวจ repo แล้วเริ่มพัฒนาในรอบเดียวกัน ทำต่อเป็นช่วงจนถึงเกณฑ์ส่งมอบ หรือบันทึก blocker ที่ระบุขอบเขตชัดเจน

ถ้าใช้หลายโมเดล ให้ lead/orchestrator เป็นเจ้าของภาพรวมและ integration worktree ส่วน worker แต่ละตัวมี worktree/branch แยกกัน ไม่ให้หลาย session แก้ checkout เดียวกัน `main` ใช้เป็นสาขาส่งมอบที่ตรวจแล้ว รายละเอียดและตัวเลือกโมเดลอยู่ในเอกสาร 07

| Prompt | ใช้เมื่อ |
|---|---|
| [START_FULL_PRODUCT.txt](prompts/START_FULL_PRODUCT.txt) | เริ่มพัฒนา FORGE ครบตามขอบเขต |
| [CONTINUE.txt](prompts/CONTINUE.txt) | ทำต่อจากสถานะจริงหรือเปิดแชตใหม่ |
| [ORCHESTRATOR.txt](prompts/ORCHESTRATOR.txt) | มอบหมาย lead ให้แบ่งงานและรวมผลจากหลาย worktree |
| [WORKER.txt](prompts/WORKER.txt) | มอบงานที่มีขอบเขตชัดให้ coding worker |
| [REVIEW_RELEASE.txt](prompts/REVIEW_RELEASE.txt) | ตรวจและแก้ความพร้อมทั้งผลิตภัณฑ์ก่อนส่งมอบ |
| [RELEASE_MAIN.txt](prompts/RELEASE_MAIN.txt) | มอบหมายการรวมงานและ push `main` หลังตรวจพร้อม |
| [HOME_UAT.txt](prompts/HOME_UAT.txt) | เจ้าของ pull ไปบ้านแล้วเปิดใช้งานและตรวจ flow |
| [DIAGNOSE_T3_MODELS.txt](prompts/DIAGNOSE_T3_MODELS.txt) | ตรวจปัญหา 6.2 ไม่แสดง โดยไม่บล็อกงาน FORGE และไม่ย้าย credentials |

## ความหมายของ complete ในรอบนี้

- Feature families ตาม requirements มี implementation ที่ทำงานเชื่อมกัน ไม่จบที่เมนู ปุ่ม placeholder หรือ catalog ของ integrations
- AG-UI เชื่อม events/state จริง; Univer มีเอกสาร/ตารางที่ save/reopen และ agent แก้ได้; report pipeline สร้าง artifact ที่เปิดตรวจได้พร้อม version/provenance
- ผู้ใช้มี setup/start/stop/restart/recovery ผ่านตัวช่วยและ GUI; เก็บข้อมูลจริง ติดตั้งแอปบนเครื่องใหม่จาก source repo ได้ และตั้งค่าบัญชี/ย้ายข้อมูลผ่านวิธีที่ระบบรองรับ
- ผู้พัฒนาต้อง build, เปิดแอปและตรวจ flow ที่ตรวจได้ในเครื่องพัฒนาก่อนส่งงานเข้า `main`
- การทดสอบบัญชี/ทรัพยากรจริงที่ไม่มีในเครื่องพัฒนาและ owner UAT ที่บ้านบันทึกเป็น `NOT_RUN` ตามจริง พร้อมขั้นตอนทดสอบ ไม่แทนผลด้วย mock
- การสร้างผลิตภัณฑ์ CA-EWS, training จริงของต้นแบบ และการประเมินงานวิจัยเป็นงานภายหลัง ไม่ใช่งานที่ต้องแทรกเข้ามารอบนี้

หาก feature ที่จำเป็นยังไม่มี implementation ต้องรายงานงานที่เหลือและทำต่อ ห้ามเปลี่ยนชื่อเป็น complete เพียงเพราะมีแผนจะทดสอบที่บ้าน

## รักษาบริบท

อัปเดต `progress/CURRENT_STATUS.md`, `progress/IMPLEMENTATION_LOG.md`, `progress/DECISIONS.md`, `progress/INTEGRATION_LEDGER.md` และ `progress/TASK_ASSIGNMENTS.md` ตามงานจริง บันทึก build/run commands, commit, evidence, integration ที่รอ auth, owner UAT และ next executable task

การจัดเอกสารชุดนี้ยังไม่มีการแก้ไฟล์บน Windows ของเจ้าของ และยังไม่มีการ commit/push source code ให้ เจ้าของเลือกให้ทำงาน coding ต่อใน T3 จาก checkout จริง
