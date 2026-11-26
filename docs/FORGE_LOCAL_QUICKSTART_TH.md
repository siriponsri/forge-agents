# เปิด FORGE workbench ระหว่างพัฒนา

สถานะปัจจุบัน **IMPLEMENTATION_INCOMPLETE** ยังไม่ใช่ complete-product release
และ **HOME_UAT_NOT_RUN**. checkpoint ล่าสุดส่งผ่าน main เพื่อทำต่อที่เครื่องบ้าน
ตาม [สถานะและคำแนะนำ checkpoint](CHECKPOINT_HOME_20261125.md).
ไม่สร้าง CA-EWS หรือโปรเจกต์ต้นแบบให้อัตโนมัติ

1. ติดตั้ง Node.js24.13 ขึ้นไป และ Git สำหรับงาน coding/Git
2. ดับเบิลคลิก `Start-FORGE.cmd` ที่ root ของ repository
3. ครั้งแรกตัวช่วยใช้ `npm ci` จาก lockfile แล้ว build หน้าจอ เปิด browser เมื่อ
   service พร้อมแล้วเท่านั้น ต้องมีอินเทอร์เน็ตเพื่อรับ dependencies ครั้งแรก
4. สร้าง project โดยเลือกชื่อและ workspace แยกจาก source repository ของ FORGE
   เลือกทีม/แผน/งาน เอกสาร ตาราง notebook และ report ผ่านหน้าจอ
5. งาน coding ใช้ T3 v0.1.11 matching GUI/server ของ FORGE เอง ลงชื่อเข้าใช้ผ่าน
   native setup ของ runtime นั้น การเปิด repo ใน T3 ที่ใช้พัฒนาไม่ใช่การตั้งค่า
   runtime ของ FORGE และไม่ย้าย session/credential ข้ามกัน
6. Report Settings มี Discover/Install ของ WordCraft0.18.1/PdfCraft0.22.0
   Windows x64 ที่ตรวจ archive/executable checksum แล้ว ไม่ต้อง compile Rust
   เลือก font ที่มีจริงและสร้าง DOCX/PDF จาก report revision ที่บันทึกแล้ว
   Native Univer snapshots ใช้แก้ต่อได้โดยไม่ต้องมี Office Exchange
7. ปิดระบบด้วย `Stop-FORGE.cmd`; เริ่มใหม่ด้วย `Restart-FORGE.cmd`
   ปิด browser อย่างเดียวไม่ใช่การหยุด service

## Landing และ macOS launcher (งานเพิ่มล่าสุด)

หน้าแนะนำผลิตภัณฑ์อยู่ที่ `/welcome` และ workbench ที่ `/app` ปุ่มดาวน์โหลดเป็น
source+launcher ZIP ของ commit ที่แสดง พร้อม SHA256 ไม่ใช่ signed EXE/DMG.
ไฟล์ดาวน์โหลดจริงอยู่ที่ [Windows ZIP](../apps/website/public/downloads/FORGE-Windows.zip)
และ [macOS ZIP](../apps/website/public/downloads/FORGE-macOS.zip) พร้อม
[manifest](../apps/website/public/downloads/manifest.json) และ
[SHA256SUMS](../apps/website/public/downloads/SHA256SUMS) ต้องแตกทั้งโฟลเดอร์
แพ็กเกจรวม source และเครื่องมือ setup runtime แต่ไม่รวม Node.js หรือบัญชีผู้ใช้
สำหรับ macOS เปิด `Start-FORGE.command`, ปิด/เริ่มใหม่ด้วยไฟล์ .command คู่กัน
ติดตั้ง Node.js24.13+ ก่อนใช้งาน ข้อมูลอยู่ที่
`~/Library/Application Support/FORGE/workbench`.
**macOS live qualification NOT_RUN**; native report-engine binaries ในรอบนี้
ตรวจจริงเฉพาะ Windows x64 ส่วน GUI/native snapshot editing ไม่ต้องพึ่ง engine.

Windows clean-package check: source ZIP จาก d23560b แตกลง temp directory ใหม่
ที่มีช่องว่าง ไม่มี node_modules/build เดิม ตัวช่วย npm ci/build/start/restart/stop
ผ่านบน Node24.19.0. Browser auto-open ถูกปิดไว้สำหรับ engineering fixture;
browser UI ตรวจด้วย Preview/Playwright แยก. ต้องตรวจซ้ำกับ UI/theme revision ใหม่.

ตามคำขอเจ้าของวันที่ 26 พ.ย. การทดสอบสร้าง product จริงและเชื่อมต่อ server
ภายนอกจะรอทำที่บ้าน เนื่องจากข้อจำกัดสิทธิ์ admin/เครือข่ายของเครื่องทำงาน
สถานะส่วนนี้ยังเป็น NOT_RUN ไม่แทนด้วย fixture และไม่ใช้ปิดงาน implementation
ที่ยังมี defect แยกต่างหาก ดูสถานะปัจจุบันก่อนทดสอบ native Orchestrator

ข้อมูลถาวรค่าเริ่มต้นอยู่ที่ `%LOCALAPPDATA%/FORGE/workbench` แยกจาก source/build
และจาก legacy portable package. มี SQLite, report settings, engines, outputs และ
logs ภายในตำแหน่งนี้ ห้ามส่งทั้ง directory เข้า Git หรือย้าย credentials ไปบ้าน
ด้วยการ copy. Metadata backup ไม่รวม artifact bytes, engine binaries, native
provider accounts หรือเครื่องมือที่ผูกกับเครื่อง ให้ตรวจ scope ก่อน restore.

เมื่อ port4317 ถูกใช้งาน ตัวช่วยเลือก loopback port อื่นโดยไม่หยุดโปรแกรมนั้น
ถ้าตัวช่วยเปิด instance ที่พร้อมอยู่แล้ว จะใช้ instance นั้น ตรวจ version/commit
ในหน้า health. หาก start ไม่สำเร็จ อ่าน service.log ใน data directory แล้ว retry.
Developer fixtures ใช้ `FORGE_DATA_DIR`, `FORGE_PORT`, `FORGE_NO_BROWSER=1`
เพื่อแยกข้อมูล/port ออกจากการใช้งานจริง

คำสั่งสำหรับผู้พัฒนา: `npm ci`, `npm run build`, `npm test`, `npm run check`,
`npm start`. Live provider smoke เป็นคำสั่งแยก `node tests/live-t3-smoke.mjs`.
Real report qualification เปิด `FORGE_REPORT_REAL=1` ตาม docs/worker-reports.md.
Fixture tests ไม่ได้ยืนยันบัญชี cloud หรือ native desktop. ดู gaps และ next task
ใน acceptance evidence ก่อนประเมินความพร้อมของ feature ที่ต้องใช้
