# ส่งต่องาน FORGE ไปทดสอบที่บ้าน

**จุดพักล่าสุด:** [ขั้นตอนเริ่มต่อที่บ้านและ review FIX 4 ข้อ](universal-training/06_RESUME_AT_HOME_TH.md). เป็น checkpoint ยังไม่ใช่ product-complete acceptance.

## ??? Universal Training ???????????? Claude ? 26 ?.?. 2026

???? [handoff ??????](universal-training/00_HANDOFF_TH.md) ???????????????????????: ??????????? Studio ??????????????????????????????????, shell ????, ???????, dependency Python ??????????? ???????????????? browser command. Owner ?????? dr-train ???? SSH ??? Cloudflare deploy ??????????????? ??? Cardiac ????? public AHE ??????? ?????????????????????????. Universal recipes/remote environment binding ??????? implementation backlog. ???????????????? [verification](universal-training/verification.json).


## อัปเดต main ตามคำขอ Owner — 26 พฤศจิกายน

Push checkpoint `f2387e866a2ae3808ad1989a0a7860ae437e9956` เข้า
`https://github.com/siriponsri/forge-agents` สาขา `main` สำเร็จ และตรวจ remote
revision ตรงกันแล้ว การแก้เอกสารสถานะหลังจากนั้นไม่เปลี่ยน source ที่แพ็กไว้.
เป็น development checkpoint ไม่ใช่การรับรอง complete product หรือ deploy เว็บไซต์.

ที่บ้าน หาก checkout สะอาดและไม่มี commit แยกจาก main ให้ใช้:

```powershell
git switch main
git pull --ff-only origin main
```

แล้วดับเบิลคลิก `Start-FORGE.cmd`. หากมีงานค้างหรือประวัติแยก ให้เก็บงานเดิมก่อน;
ไม่ใช้ reset ล้างงาน. ทำ Home UAT ตามลำดับด้านล่าง.

## ไฟล์ที่เปิดใช้งานได้

- [Windows source launcher](../apps/website/public/downloads/FORGE-Windows.zip)
- [macOS source launcher](../apps/website/public/downloads/FORGE-macOS.zip)
- [เวอร์ชันและข้อจำกัดของแพ็กเกจ](../apps/website/public/downloads/manifest.json)
- [SHA-256](../apps/website/public/downloads/SHA256SUMS)

แพ็กเกจเป็น development source ZIP แบบไม่เซ็น ไม่ใช่ signed `.exe` หรือ `.dmg`.
ติดตั้ง Node.js 24.13+ และแตกทั้งโฟลเดอร์ก่อนเปิด `Start-FORGE.cmd` บน Windows
หรือ `Start-FORGE.command` บน macOS. การเปิดครั้งแรกต้องเชื่อมต่อเพื่อดึง dependencies.
ใช้ไฟล์ Stop/Restart คู่กันเพื่อปิดหรือเริ่มใหม่. ดู
[คู่มือเริ่มต้น](FORGE_LOCAL_QUICKSTART_TH.md) สำหรับตำแหน่งข้อมูลและการแก้ setup.

อ่าน `manifest.json` เพื่อดู source commit ที่แพ็กจริง ไม่ใช้เลข commit ของเอกสาร
หรือภาพแทนเวอร์ชันแพ็กเกจ. แพ็กไม่มีบัญชี credentials หรือ native runtime ของเครื่องนี้.
ตั้งค่าบัญชีใหม่ที่บ้าน; อย่าคัดลอก vault หรือทั้ง application-data directory.
macOS และการสร้าง product ด้วยบัญชีจริงยังเป็น **NOT_RUN**.
Private FORGE Guarded/native Orchestrator/selection-tool setup รองรับ Windows
x64 เท่านั้นใน source ปัจจุบัน; Mac launcher ไม่ได้หมายถึง native feature parity.

## สิ่งที่รวมแล้ว

- Session roles และ approved parent–child prompting; Strategist พร้อม reviewed
  handoff ใน Assistance.
- GUI ครบหกโหมด: Supervisor/Workers, fan-out/fan-in, Router/Specialists,
  Generator/Verifier, DAG และ independent candidates + reviewed selection.
- Landing รอบใหม่ด้วย Impeccable, โลโก้ส้มกับเหลือง/เทารอง และปุ่ม ZIP จริง.
  Reviewer เดิมปิดข้อแก้ไขสี่จุดแล้ว; ความพอใจด้านหน้าตายังเป็นการตัดสินของ Owner.
- แก้ native return transport ที่ `246daac`. Mounted native parent ผ่านบน image
  เดิม: model protocol loopback สามครั้ง ส่งงานลูกครั้งเดียว รับผลใน turn เดิม
  และจบ parent. Parent runtime/SDK/canonical owners เป็นของจริง; account/catalog,
  model protocol และ ordinary child transport ระบุว่า injected.
  [หลักฐานและขอบเขต](evidence/session-control-transport-20261126.json).
- ตรวจ predecessor files อีกครั้งก่อน verifier dispatch เพื่อป้องกันการใช้
  checked evidence ที่ไฟล์เปลี่ยนระหว่างเตรียม Context; recheck อิสระผ่าน.

## ทดสอบที่บ้านตามลำดับ

1. เปิดแพ็กในโฟลเดอร์ใหม่ ตรวจ readiness และเปลี่ยนภาษา/ธีม; ปิด เปิดใหม่ และ
   ตรวจว่า project/settings/เอกสารที่บันทึกยังอยู่. จด source commit จากแพ็ก.
2. ตั้งค่า provider/harness ใน Settings ผ่านบัญชีของเครื่องบ้าน ตรวจ catalog
   และเลือก model/options ที่แสดงว่ารันได้จริง. บันทึกค่า unknown ตามจริง.
3. สร้าง project ทดสอบแยกจากงานจริง อนุมัติแผนขนาดเล็ก ตั้ง role ของ parent
   เป็น Orchestrator แล้วเริ่ม attempt ใหม่. อนุมัติ child membership แบบเจาะจง.
   ตรวจว่าลูกได้รับ prompt ครั้งเดียว parent รับผลกลับ และ reload/replay ไม่ส่งซ้ำ.
4. ทดลองหกโหมดจาก GUI ทีละโหมดด้วย tasks ที่อนุมัติและ Workspace แยกตามที่หน้า
   setup กำหนด. ตรวจ exact run/evidence, dependency joins, feedback และ Owner
   selection. คำกล่าวของ agent หรือ role label ไม่ใช่ผลตรวจหรือสิทธิ์เพิ่ม.
5. ทดลอง Stop/Take over ระหว่างงานค้าง ตรวจว่าไม่มี effect ใหม่หลังเพิกถอนสิทธิ์.
   หาก outcome เป็น unknown ให้เก็บ operation/run เดิมและ reconcile;
   อย่าเริ่ม operation ใหม่เพื่อกลบผลที่อาจเกิดไปแล้ว.
6. ทำ journey สร้าง product จริงที่ Owner เลือก: brief → approved plan → output
   → local tests/preview → independent evidence → Delivery Pack. ตรวจ bytes/hash
   และเปิดผลงานจากแพ็ก ไม่ใช้ข้อความตอบของ model เป็นหลักฐานความสำเร็จ.
7. ทดสอบ Vast MCP/remote server, compute, serving, storage และ mobile เฉพาะ
   integration ที่ตั้งค่าและอนุมัติขอบเขตแล้ว. ไม่เปิด public service หรือซื้อ compute
   เป็นผลอัตโนมัติจากคู่มือนี้.

## ข้อจำกัดที่ยังต้องรายงานตรงตามจริง

การทดสอบ product จริงและเชื่อมต่อ server ภายนอกถูกเลื่อนไปบ้านตามคำขอ Owner
เพราะข้อจำกัดสิทธิ์ admin/เครือข่ายเครื่องทำงาน. **HOME_UAT_NOT_RUN** และ
**EXTERNAL_PRODUCT_JOURNEY_NOT_RUN** จนกว่าจะมีหลักฐานใหม่.
Native monetary billing finality ยัง unsupported (`cost:null`, `final:false`);
นี่เป็นขอบเขต implementation แยกจาก credentials. คง policy ที่ปฏิเสธ hard caps
ที่รับรองไม่ได้; อย่าแทน unknown ด้วยศูนย์. Official benchmark/model quality
และ actual macOS execution ไม่ได้ผ่านโดยอนุมานจาก local fixtures.

บันทึกผลใน [Home UAT results](owner/forge-local-complete-20261124-v3/progress/HOME_UAT_RESULTS.md)
พร้อม source/image, บัญชีหรือ route ที่ตรวจโดยไม่เก็บ secret, operation/run refs,
ขั้นตอนทำซ้ำ และ expected/actual evidence. สถานะ release อยู่ที่
[Current Status](owner/forge-local-complete-20261124-v3/progress/CURRENT_STATUS.md).
Owner อนุมัติและส่ง checkpoint รอบนี้ผ่าน `main` แล้วตามบันทึกด้านบน.
ไม่ได้ deploy เว็บไซต์หรือเปิดบริการสาธารณะ และไม่ได้ยกเลิกข้อจำกัดการรับรอง.
