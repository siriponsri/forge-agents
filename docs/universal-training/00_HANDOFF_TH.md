# Universal Training App — ขอบเขตและงานต่อที่บ้าน

**จุดพักล่าสุด:** [ขั้นตอนเริ่มต่อที่บ้านและ review FIX 4 ข้อ](06_RESUME_AT_HOME_TH.md). เป็น checkpoint ยังไม่ใช่ product-complete acceptance.

ฉบับ 26 พฤศจิกายน 2026 ตามคำตอบ Owner Q1–Q7 และคำยืนยันเพิ่มเติมเรื่อง Cloudflare/SSH

## ข้อกำหนดที่เปลี่ยน

เอกสารชุดนี้แก้ข้อกำหนดเดิมเฉพาะเรื่องต่อไปนี้ ส่วน authority, canonical state,
protected legacy และการแยกผลทดสอบจริงออกจาก fixture ยังคงเดิม:

- FORGE ต้องพัฒนาเป็น Universal Training App: เริ่มจากอธิบายเป้าหมาย ถามสิ่งที่ยังไม่ชัด
  ทบทวนแผนและงบ แล้วทำงานผ่านเจ้าของงานเดิมของระบบ จนได้โมเดล ผลวัด และแพ็กส่งมอบ
- Python แยก environment ตามชุดงาน/เวอร์ชัน อัปเดตได้ตามต้องการ แต่ไม่เปลี่ยนชุดของงานที่กำลังรัน
- รับแผน Cardiac Arrest เป็น **โครงการจริงสำหรับทดสอบที่บ้าน** บน `dr-train` ผ่าน SSH
  รอบเตรียมนี้ไม่ activate CA-EWS ไม่ดึงข้อมูลผู้ป่วย ไม่เทรน benchmark และไม่เปิด cloud compute
- เตรียม RunPod/Vast/Colab MCP qualification และ Cloudflare ในทีมที่มี `ai-cie.com`
  **Owner ยืนยันให้ deploy ที่บ้าน** รอบนี้ไม่ deploy ไม่เปลี่ยน DNS และไม่แตะ Worker `cwn2026`
- อนุมัติตรวจ/แก้ช่องโหว่ และรวมงานที่ตรวจแล้วเข้า main พร้อม push
- งาน Claude ที่ติด usage limit ให้รับต่อ: desktop shell, Studio, หน้าเริ่มต้น และภาษาไทยอ่านง่าย

แผนที่แนบมีคำสั่งให้ execute M0–M4 อยู่ท้ายไฟล์ แต่ยังไม่เริ่มบนเครื่องทำงานนี้ตามคำสั่งล่าสุด
เก็บต้นฉบับไว้ที่ [reference/CARDIAC_ARREST_MASTER_PLAN.md](reference/CARDIAC_ARREST_MASTER_PLAN.md)
พร้อม SHA-256 ใน [reference/source.json](reference/source.json) การเก็บไฟล์ไม่ใช่การเปิดใช้งานโครงการ

## ลำดับอ่านและลงมือ

1. [แผนผลิตภัณฑ์และ acceptance](01_PRODUCT_PLAN_TH.md)
2. [คู่มือ SSH / MCP / cloud ที่บ้าน](02_HOME_DR_TRAIN_TH.md)
3. [แผนทดสอบโครงการจริง](03_CARDIAC_PROJECT_TH.md)
4. [เตรียม Cloudflare](04_CLOUDFLARE_TH.md)
5. [ผลตรวจและช่องว่างความปลอดภัย](05_SECURITY_AND_VERIFICATION.md)
6. [Python environment CLI](../worker-training-env.md) เมื่อรวม worker แล้ว

## หลักฐานที่ต้องแยก

| สถานะ | หมายถึง |
|---|---|
| IMPLEMENTED | มี code/flow แล้ว ไม่ได้แปลว่าต่อบัญชีจริงผ่าน |
| VERIFIED_LOCAL | ผ่านคำสั่ง/fixture ที่ระบุ พร้อม source revision |
| IMPLEMENTATION_INCOMPLETE | ยังขาด code หรือการเชื่อมส่วนประกอบ ต้องแก้ก่อนทดสอบจริง |
| HOME_UAT_NOT_RUN | ต้องให้ผู้ใช้ลองบนเครื่องบ้าน |
| LIVE_NOT_RUN | ยังไม่ได้เชื่อม provider/เครื่อง/บัญชีจริง |
| UNKNOWN | อาจเกิดผลแล้ว แต่ยังยืนยันไม่ได้ ห้ามเริ่มงานใหม่แทนโดยอัตโนมัติ |

อย่าเปลี่ยน implementation gap เป็นคำว่า “รอ credentials” และอย่าแปลผล synthetic
หรือ deterministic loopback ว่าโมเดลทำงานกับโครงการจริงสำเร็จ

## ข้อเสนอเวลาและงบ (ยังไม่ใช่ spending approval)

- `dr-train` CPU: smoke 10 นาที แล้ว public AHE sprint ไม่เกิน 4 CPU-hours,
  workers ไม่เกิน 4, พื้นที่เพิ่มเป้าหมายไม่เกิน 5 GB ตามแผนแนบ ตรวจพื้นที่จริงก่อน
- RunPod: 1 disposable resource, lifecycle smoke ไม่เกิน 30 นาที, ไม่เกิน US$3
- Vast: เช่นเดียวกัน 30 นาที/US$3 ทำทีละเจ้ารวมไม่เกิน US$6
- Colab: เริ่ม CPU/free eligibility 15 นาที ไม่สมัคร plan/ซื้อ compute units อัตโนมัติ
- ราคาเสนอจริง + storage/egress + ภาษี/เครดิตขั้นต่ำอาจทำให้เกินวงเงิน:
  ถ้าเกินไม่เปิด resource เปลี่ยนเป็น read-only discovery หรือขออนุมัติวงเงินใหม่

วงเงินข้างต้นเป็นเพดานที่เสนอ ไม่ใช่ระบบตัดบิลที่รับประกันได้ ตั้ง owner timer,
ตรวจสถานะและ billing หลัง cleanup; stop อาจยังมีค่า storage

## ก่อนจบรอบบ้าน

เก็บ commit/environment lock/resource IDs/operation IDs/logs ที่ลบความลับแล้ว,
ไฟล์ผลลัพธ์พร้อม hash และ cleanup receipts ไว้นอก Git ส่วนรายงานที่ผ่านตรวจแล้ว
จึง commit ได้ ระบุทุก resource ว่า running/stopped/deleted/unknown และค่าใช้จ่าย
ที่สังเกตจริงหรือยังไม่ทราบ ห้ามสรุปว่าหมดค่าใช้จ่ายจากการเห็น “stopped” อย่างเดียว
