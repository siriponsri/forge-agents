# Project Storage Settings

วันที่: **24 พฤศจิกายน 2026 — Asia/Bangkok**

สถานะ: **Owner requirement recorded / proposed design — not implemented or connected**

## 1. สิ่งที่เจ้าของกำหนด

- โปรเจกต์ต้นแบบใช้ **Google Drive + Local Windows + Git repository** ร่วมกัน
- Product FORGE ต้องเลือกที่เก็บได้อย่างอิสระในหน้า **Settings** ของแต่ละโปรเจกต์
- คงโปรไฟล์ต้นแบบ Windows public CPU + Colab Free training + LitServe MCP โดยไม่บังคับให้โปรเจกต์อื่นใช้ชุดเดียวกัน

การเลือกปลายทางทั้งสามยืนยันแล้ว ไม่ต้องถามเลือก storage ใหม่ ส่วนบัญชี โฟลเดอร์ local path และ Git remote/branch ที่ใช้จริงเลือกผ่าน setup เมื่อเชื่อมต่อ ยังไม่ได้สร้างโฟลเดอร์บน Drive เชื่อมบัญชี สร้าง project repository หรือ push งานใดในรอบ requirements นี้

## 2. หน้าที่ของแต่ละปลายทางที่เสนอสำหรับต้นแบบ

| ปลายทาง | หน้าที่เริ่มต้นที่เสนอ | ผลที่ผู้ใช้เห็น |
|---|---|---|
| **Google Drive** | เก็บ checkpoint ที่รองรับการกู้ต่อ, model/preprocessor ที่ฝึกเสร็จ, metrics และ run manifests ที่เลือก | งานที่บันทึกสำเร็จมีสำเนานอก Colab runtime และเลือกนำกลับมาใช้งานได้ |
| **Local Windows** | Working copy ของโค้ด/notebooks, ผลทดสอบ, artifacts ที่รับกลับ และโมเดลสำหรับ LitServe/replay | เปิด แก้ ทดสอบ และใช้งานผลบนเครื่องหลักได้ |
| **Git repository** | Source code, notebooks, environment/configuration, เอกสาร, ผลสรุปขนาดเหมาะสม และ artifact manifests | เห็นประวัติการเปลี่ยนแปลงและผูกผลทดลองกับ code revision |

นี่คือค่าเริ่มต้นสำหรับโปรไฟล์ต้นแบบ ผู้ใช้เปลี่ยน mapping รายประเภทไฟล์ใน Settings ได้ การเลือกทั้งสามปลายทางไม่จำเป็นต้องส่งทุกไฟล์เหมือนกันทุกแห่ง

เสนอให้ weights/checkpoints และ dataset ขนาดใหญ่เก็บใน artifact storage พร้อม manifest อ้างอิงจาก Git หากโปรเจกต์ต้องการ version ไฟล์ใหญ่ผ่าน Git ให้เปิด **Git LFS หรือ backend ที่รองรับ** หลังตรวจความสามารถและพื้นที่ของ remote นั้น Git LFS เก็บ pointer ใน repository และแยกเนื้อหาไฟล์จริงไว้ใน LFS storage จึงต้องตรวจทั้ง commit และ LFS objects ก่อนแสดงว่าสำรองครบ [Git LFS documentation](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)

Git remote ของ **โปรเจกต์ที่ FORGE สร้าง** เป็น setting ของโปรเจกต์นั้น ไม่สมมติว่าเป็น `siriponsri/forge-agents` ซึ่งเป็น repository ของตัว product ชื่อ Git provider ก็เลือกได้ตาม adapter ที่รองรับ ไม่จำกัดว่า Git หมายถึง GitHub เท่านั้น

## 3. หน้า Settings ที่ผู้ใช้ no-code ใช้งานได้

เส้นทางที่เสนอ: **Project → Settings → Storage & Sync**

| ส่วนในหน้า | ตัวเลือกและพฤติกรรม |
|---|---|
| **Destinations** | เปิด/ปิดหนึ่งหรือหลายปลายทาง; แสดง Connected, Needs sign-in, Unavailable ตามสถานะจริง |
| **Google Drive** | เลือกบัญชีและโฟลเดอร์ผ่าน picker; ตรวจสิทธิ์และพื้นที่ที่จำเป็น |
| **Local Workspace** | เลือกโฟลเดอร์ Windows ผ่าน folder picker; ตรวจว่าเขียนได้และมีพื้นที่พอ |
| **Git Repository** | เลือก remote และ branch; แสดง repository ของ output project ให้ชัด; ตรวจสิทธิ์อ่าน/เขียนตาม operation |
| **File Routing** | เลือกปลายทางของ code, notebooks, checkpoints, final models, datasets, metrics/reports และ manifests แยกกัน |
| **Sync Rules** | เลือกเมื่อจบ experiment/phase, เมื่อมี checkpoint ใหม่ หรือกดเอง; แยก Local Save, Commit และ Push |
| **Retention** | กำหนดเวอร์ชันที่จะเก็บและการล้างไฟล์ตามแต่ละปลายทาง; การลบสำเนาหนึ่งไม่ลบทุกแห่งโดยอัตโนมัติ |
| **Connection Check** | ตรวจบัญชี/path/สิทธิ์ก่อนใช้งาน; การทดสอบที่เขียนไฟล์ต้องแสดงขอบเขตเป็น test file อย่างชัดเจน |
| **Sync Status** | สถานะรายปลายทาง, เวลาที่สำเร็จล่าสุด, ไฟล์ที่ค้าง, ข้อผิดพลาด และ Retry/Open location |
| **Restore** | เลือก run/model revision แล้วตรวจไฟล์ก่อนรับกลับและใช้ inference |

FORGE core เก็บความหมายกลางของปลายทางและงาน sync ส่วน adapter เก็บรายละเอียดของ Drive/local/Git โปรเจกต์อื่นเปิดเฉพาะปลายทางที่ต้องการหรือใช้ provider อื่นที่รองรับได้ โดยยังใช้หน้าจอและ run/artifact model เดียวกัน

การเปลี่ยน setting สร้าง profile revision สำหรับงานใหม่ ประวัติ run เดิมยังอ้างอิงค่าที่ใช้จริง ถ้าต้องการย้าย artifacts เดิม ให้แสดงรายการและผลการย้ายแยกจากการเปลี่ยนค่า ไม่เปลี่ยน link ย้อนหลังให้ดูเหมือนย้ายสำเร็จแล้ว

## 4. การ sync และกู้ข้อมูลที่ต้องตรวจสอบได้

ใช้ project/run/attempt/artifact IDs ร่วมกัน และบันทึกชนิดไฟล์ ขนาด checksum, code commit หรือ source snapshot ที่รวมการแก้ไขที่ยังไม่ commit, model/config revision และตำแหน่งสำเนาที่มีจริง เก็บ Git commit state แยกจาก remote push state; มี local commit ไม่เท่ากับไฟล์ถึง remote แล้ว

ข้อเสนอ workflow:

1. Agent บันทึกโค้ด/config/notebook ใน workspace ของโปรเจกต์ และผูก run กับ code revision ตาม Git policy ที่เลือก
2. Colab รัน experiment; บันทึก checkpoint ที่รองรับและผลของแต่ละรอบไป Drive ตาม mapping ไม่รอให้การทดลองทุกชุดจบก่อนบันทึก
3. รับ artifacts ที่เลือกกลับ Windows ลง staging ตรวจ checksum แล้วจึง register เพื่อใช้ LitServe/replay
4. บันทึก manifest/รายงานที่เหมาะสมเข้า Git และ commit/push ตาม setting ที่ผู้ใช้กำหนด
5. แสดงสถานะครบแต่ละปลายทาง; ถ้า Windows offline หรือ upload/push ล้มเหลว ให้แสดง **Sync pending/Failed** โดยคงผล training ที่สำเร็จแล้วไว้

การอัปโหลดไฟล์ใหญ่ผ่าน Drive API สามารถใช้ resumable upload ได้ แต่ checkpoint ที่ยังเขียนไม่ครบหรืออัปโหลดไม่เสร็จยังไม่ถือว่ากู้ได้ ต้องตรวจเนื้อหาและ manifest ของสำเนานั้นก่อนแสดง **Verified** [Drive upload documentation](https://developers.google.com/workspace/drive/api/guides/manage-uploads)

สำหรับหลาย bot ให้ใช้ workspace/branch ที่แยกการแก้ไขและเก็บ artifact revisions โดยไม่เขียนทับพร้อมกัน โฟลเดอร์ sync ของ Drive ไม่ควรใช้เป็นตัวทำ two-way synchronization ของ `.git` metadata ทั้งชุด ข้อเสนอคือให้ Drive adapter และ Git adapter จัดการหน้าที่ของตนเองผ่านรายการไฟล์ที่เลือก

เมื่อ connection กลับมา ให้ reconcile งานค้างและส่งต่อจากสถานะที่ตรวจได้ ห้ามประกาศว่ามีสำเนาครบจากเพียง path/link หรือไฟล์ชื่อเดียวกัน การกู้ training กลางทางขึ้นกับ checkpoint ของโมเดลนั้น; สำเนาโมเดลที่ fit เสร็จแล้วและผลทดลองของรอบก่อนยังนำกลับมาใช้ได้แยกกัน

## 5. เกณฑ์รับงานที่เสนอ

- ผู้ใช้เลือก Drive folder, Windows path และ Git remote/branch ได้ใน GUI โดยไม่แก้ config ด้วยตนเอง
- ต้นแบบมีโค้ด/notebook/manifest ตาม Git policy พร้อม artifacts ที่ตรวจ checksum ได้บน Drive และ Windows ตาม mapping
- หน้ารายละเอียด run แสดง code revision และสถานะของแต่ละสำเนาได้ตรงกับหลักฐานจริง
- การหลุดระหว่าง upload/download/push แสดงงานค้าง และกลับมาทำต่อได้โดยไม่สร้างผลสำเร็จเทียมหรือเขียนทับคนละเวอร์ชัน
- Restore โมเดลที่เลือกแล้ว LitServe/replay ใช้ artifact revision ที่แสดงไว้จริง
- เปลี่ยน storage profile ของอีกโปรเจกต์ได้โดยไม่แก้ FORGE core และไม่เปลี่ยนประวัติของโปรเจกต์ต้นแบบ

รายการทั้งหมดเป็น requirements และ design ที่เสนอ ยังไม่มี storage adapter, Settings UI หรือ cloud sync ของ workflow นี้ที่ผ่าน acceptance จากเอกสารฉบับนี้
