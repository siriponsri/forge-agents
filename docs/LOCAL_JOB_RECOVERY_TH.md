# ตรวจและกู้สถานะงาน Python ในเครื่อง

การเชื่อมต่อกลับไม่ส่งโค้ดซ้ำ และไม่ใช้ PID ที่เก็บไว้สั่งฆ่า process
งานเดิม Local runner รุ่นปัจจุบันเขียน receipt หลัง cleanup ต้นไม้ process
ที่เป็นเจ้าของเสร็จแล้ว พร้อมผูก job ID และ SHA-256 ของ source ที่รันจริง

1. เปิดโปรเจกต์เดิม แล้วไป **Compute targets / เป้าหมายคำนวณ**
2. กด **Reconcile existing work / ตรวจงานที่มีอยู่**
3. หากพบ receipt ที่ตรงกับ attempt และ source snapshot สถานะ/exit code/log
   จะคืนจากหลักฐานนั้น โดยไม่เรียก Python อีกครั้ง งานที่เสร็จจริงจึงกลับไปใช้
  ขั้นตอนเริ่ม attempt ใหม่ตามปกติได้
4. หากไม่มี receipt หรือ bytes/ตัวตนไม่ตรง งานยังเป็น `interrupted` และยังกัน
   writer ใน workspace เดิม การโหลดหน้า, กดตรวจซ้ำ หรือส่ง operation ID เดิม
   ไม่ได้สร้างหลักฐานว่า process หยุดแล้ว และไม่ทำงานซ้ำ

งานเก่าที่ไม่มี receipt รุ่น `forge-local-cleanup/1` จะไม่ถูกเปลี่ยนเป็นสำเร็จ
อัตโนมัติ ให้ Owner ตรวจ process และ partial outputs ในเครื่องเดิมก่อน
ใช้โปรเจกต์/โฟลเดอร์ใหม่สำหรับงานอิสระเมื่อต้องทำต่อ โดยเก็บประวัติงานไม่แน่นอน
ไว้ ไม่ลบฐานข้อมูลหรือแก้สถานะเป็นสำเร็จเพื่อปลดล็อก writer

หลักฐานนี้เป็น process lifecycle ของ local runner ไม่ใช่ QA หรือการรับงาน
เงื่อนไขของผลลัพธ์ยังต้องผ่านการตรวจและ Owner acceptance ตามเดิม
Remote compute ใช้ receipt/identity ของ adapter เป้าหมายนั้น ไม่ใช้ local proof

Developer checks บน Windows: jobs lifecycle, compute adapters และ production
context/compute รวม **20 PASS** รวม Python จริง, Stop/timeout/crash, recovery
จาก receipt, source/receipt tamper และไม่รันซ้ำ `HOME_UAT_NOT_RUN`.
