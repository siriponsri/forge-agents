# Cloudflare team — เตรียมก่อน deploy ที่บ้าน

**PREPARED / NOT_DEPLOYED**. Owner ยืนยันให้เตรียมไว้ก่อน ชื่อ domain เปลี่ยนทีหลัง
ภาพแนบแสดง zone `ai-cie.com` และ Worker `cwn2026` แต่ไม่ให้ account ID/token
จึงไม่อนุมานทีม, account ID, DNS records หรือสิทธิ์จากภาพ

## แยก public site ออกจากแอปทำงาน

- Public: เฉพาะ `apps/website/dist` ที่ผ่าน static build และ source launcher ZIP
- Private/local: FORGE Node/SQLite, SSH orchestration, credentials, datasets,
  notebooks, models และ logs อยู่ที่เครื่องบ้าน/dr-train
- ไม่เอา `app/server` ไปใส่ Workers ไม่เปิด `/api/*`, MCP, SSH หรือ Jupyter สู่สาธารณะ
- App ปัจจุบันรับ loopback Host/Origin เท่านั้น การต่อ tunnel/public origin ไม่พร้อม
  อย่าแก้ Host/Origin หรือส่ง Owner cookie ข้าม origin เพื่อข้ามข้อจำกัด
  ถ้าต้องการ remote GUI ให้เป็น milestoneแยก: Access JWT verification, identity,
  cookie/CSRF/TLS/proxy trust, authorization และ reconnect tests ก่อนเปิดใช้

## ขั้นตอนบ้าน

1. เข้า Cloudflare ด้วยบัญชี Owner เลือกทีมที่มี `ai-cie.com` ตรวจ account ID และสิทธิ์
   กำหนด Worker **ใหม่** ห้ามใช้/เขียนทับ `cwn2026` หรือเปลี่ยน apex/MX เดิม
2. ดึง main ที่ตรวจแล้ว เก็บ source commit; เว็บไซต์กับ ZIP manifest ต้องอ้าง sourceที่แพ็กจริง
3. ใน `apps/website` ใช้ pinned lock: `npm ci` แล้ว `npm run build`, `npm test`,
   `node scripts/verify-static.mjs`. ข้อความ release/ข้อจำกัด macOS/native ต้องไม่ถูกลบ
4. กำหนด `SITE_URL` เป็น HTTPS origin ที่ Owner เลือกตอนนั้นก่อน build final;
   ห้ามใส่ชื่อที่ยังไม่ตกลงแล้ว deploy ทับ domainเดิม
5. ถ้า source ZIP เก่า ให้สร้างจาก committed main ด้วย
   `node tools/launcher-downloads/generate.mjs --source-root ABSOLUTE_REPO --output-directory NEW_ABSENT_DIRECTORY`
   ตรวจ `--verify`, manifest commit/sha256/bytes แล้วนำทั้งชุดไป public/downloads
   และ build siteใหม่ ไม่แก้ ZIPรายไฟล์ให้ปนrevision
6. ใช้ [Wrangler template](../../tools/cloudflare/wrangler.example.jsonc) เป็นแม่แบบ
   ถ้าคัดลอกไปที่อื่น เปลี่ยน assets.directory เป็น absolute dist ที่ตรวจแล้ว
   ใส่ account_id ผ่าน configส่วนตัว/ช่องทางsecret ไม่ committoken
7. เลือก/pin Wrangler version ที่จะใช้และบันทึกไว้ใน deployment evidence
   ตรวจ `wrangler whoami` ให้ตรงทีม แล้ว `wrangler deploy --dry-run --config ABSOLUTE_CONFIG`
   ขั้นนี้เป็น packaging check ไม่ใช่การเปิดเว็บ และยังไม่ qualify DNS/Access
8. ที่บ้านเท่านั้น หลัง review artifact และบัญชี ให้ deploy Workerใหม่
   templateปิด workers.dev/preview URLs และไม่มี routes จึงยังไม่ผูก publichostname
   Owner เลือก hostname แล้วค่อยตั้ง customdomain/routeเฉพาะเว็บนี้
9. ตรวจจริง HTTPS, TH/EN, 404, CSP/headers, downloadทั้งสองplatform+SHA,
   no remote credentials/data, mobile/keyboard และ linksหลังdomainเปลี่ยน
10. เก็บ deploymentversion/config hash/sourcecommit/assetmanifest และวิธีย้อนกลับ
    ถ้ามีปัญหา rollbackเฉพาะWorkerใหม่นี้ ไม่แก้เว็บอื่นในทีม

ตัวอย่างคำสั่ง CLI ต้องใช้ executableWranglerที่ pinไว้เอง ไม่รัน `npx latest`
แบบเงียบ ไม่มีคำสั่ง deploy ถูกเรียกโดย dependency/app startup

## Acceptance และช่องว่าง

| ตรวจ | สถานะรอบนี้ |
|---|---|
| configuration template ไม่มีtoken/account/DNSmutation | PREPARED |
| account/team/hostnameจริง | HOME_NOT_RUN |
| Workers package dry-run ด้วยWranglerที่เลือก | HOME_NOT_RUN |
| deploy/customdomain/TLS/rollbackจริง | HOME_NOT_RUN |
| app remote authentication/tunnel | IMPLEMENTATION_INCOMPLETE ไม่รวมstaticwebsite |
| Windows/macOS ZIP | source launchers ไม่ใช่ signed installer; macOS runtimeยัง NOT_RUN |

รูปแบบ static assets และ routing อิงเอกสาร primary ที่ตรวจ 26 พ.ย. 2026:
[Workers static assets](https://developers.cloudflare.com/workers/static-assets/),
[SSG routing](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/),
[Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).
ทบทวนข้อจำกัดขนาดไฟล์/จำนวนassets/แผนบริการจริงก่อนอัปโหลดแพ็กเกจ
