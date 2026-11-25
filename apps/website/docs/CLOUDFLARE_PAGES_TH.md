# เตรียมเผยแพร่ FORGE ด้วย Cloudflare Pages Free

เอกสารนี้เป็นคู่มือเตรียมการ ยังไม่ได้ deploy ไม่ได้เชื่อมบัญชี ไม่ได้ซื้อโดเมน
และไม่ได้ตั้ง production branch บนบริการ ต้องรอเจ้าของอนุมัติการเผยแพร่และชื่อ
branch ที่แน่นอนก่อนทำขั้นตอนที่สร้างเว็บไซต์สาธารณะ

## ตรวจในเครื่องก่อน

1. ให้ผู้พัฒนารันจากโฟลเดอร์ `apps/website`: `npm ci --include=dev`,
   `npm run build` และ `npm run test:browser` แล้วส่งผลให้เจ้าของตรวจ
2. เปิด `npm run preview` ตาม URL ที่แสดง ตรวจ `/th/` และ `/en/`, ธีมสว่าง/มืด,
   Docs, Install, Changelog, GitHub และสถานะ Windows download
3. public release snapshot อยู่ที่ `public/releases.json` ผู้พัฒนาสั่ง
   `npm run releases:refresh` แล้วตรวจ diff ก่อน commit การ build ปกติไม่เรียก GitHub
4. ณ snapshot 25 พ.ย. 2026: GitHub Releases API แบบไม่ใช้บัญชีตอบ HTTP 200
   และไม่มี release จึงไม่มีลิงก์ดาวน์โหลด Windows; source archive ไม่ใช่ signed installer
   macOS native และ Home UAT ยังไม่ได้ทดสอบ
5. ตรวจ GitHub API วันที่ 25 พ.ย. 2026: source พื้นฐาน `01ee779` และ Office เป็น
   สาธารณะแล้ว ส่วน main เป็น `4e8ebd3` แต่ integration ใหม่ยังไม่เผยแพร่ ภาพจริง
   บนเว็บเป็นรุ่นพื้นฐานวันที่ 24 พ.ย. ก่อน integration ใหม่ ดูหลักฐานใน `ASSETS.md`
   ก่อนเผยแพร่จริง lead ต้องตรวจ copy และ metadata กับ revision ที่อนุมัติอีกครั้ง

## ค่าที่เตรียมไว้ให้กรอกในหน้าเว็บ Cloudflare

| ช่อง | ค่า |
|---|---|
| Product | Pages, static site; ใช้ Free โดยไม่เพิ่มบริการเสียเงิน |
| Git repository | `siriponsri/forge-agents` |
| Root directory | `apps/website` |
| Framework preset | None หรือ React (Vite), แล้วตรวจค่าด้านล่าง |
| Build command | `npm run build:pages` |
| Build output directory | `dist` (สัมพันธ์กับ root directory ข้างต้น) |
| Node version | ตั้ง `NODE_VERSION` เป็น `24.19.0` ที่ตรวจ build แล้ว |
| Development dependencies | ให้ติดตั้ง dev dependencies; หากตั้ง `NODE_ENV=production` ให้ยกเลิกค่านั้นระหว่าง build |
| Production branch | **ชื่อจริงที่เจ้าของอนุมัติเท่านั้น** — ยังไม่กำหนด |
| Automatic production deployments | เปิดเฉพาะเมื่อเจ้าของอนุมัติการเผยแพร่ |
| Preview branch deployments | เลือก None เพื่อไม่เผยแพร่ branch งานหรือข้อมูลก่อนอนุมัติ |
| `FORGE_APPROVED_PRODUCTION_BRANCH` | กรอกชื่อเดียวกับ Production branch ทุกตัวอักษร |
| `SITE_URL` | HTTPS origin ของเว็บที่เจ้าของอนุมัติ ไม่มี path/query เช่น origin ที่ Pages ให้หลังอนุมัติ หรือ custom domain ของเจ้าของ |

ตัวแปรสองตัวท้ายมีตัวอย่างช่องว่างใน `.env.example` ไม่ใช่ secret
ห้ามใส่ localhost API, token, private database, memory หรือ credential ของ FORGE
ใน environment ของเว็บ และไม่ต้องตั้ง Functions, Workers, KV, D1, R2 หรือ paid feature

## ขั้นตอนใน Dashboard หลังได้รับอนุมัติ

1. เจ้าของเปิด Cloudflare Dashboard → Workers & Pages → Create application → Pages
   แล้วเลือกเชื่อม GitHub repository ที่ได้รับอนุมัติ ขอบเขตสิทธิ์ให้เท่าที่จำเป็น
2. กรอกค่าตามตาราง ตรวจชื่อ production branch และปิด preview branches
   ก่อนกดปุ่มที่เริ่ม deploy อย่าเลือก branch ตามค่าเริ่มต้นโดยไม่ตรวจ
3. ตั้ง environment variables ของ production: `NODE_VERSION`, `SITE_URL` และ
   `FORGE_APPROVED_PRODUCTION_BRANCH` โดย `SITE_URL` ต้องเป็น origin ที่อนุมัติ
4. เมื่ออนุมัติให้เผยแพร่แล้วจึง Save and Deploy ตรวจ build log ให้เห็น typecheck,
   Vite build และ prerender 12 localized pages สำเร็จ
5. ใน Settings → Builds & deployments ตรวจ branch และ automatic deployment อีกครั้ง
   ต่อจากนี้ commit ที่ push สู่ branch นั้นจะเริ่ม deploy อัตโนมัติ การ push ยังอยู่ใน
   release authorization ของเจ้าของ ไม่ใช่สิทธิ์ที่คู่มือนี้ให้เพิ่ม
6. Build watch paths สามารถรวม `apps/website/*` และทุกไฟล์ย่อยของเว็บ เพื่อลดการ build
   จากการเปลี่ยน core app; ตรวจ syntax ที่หน้า Dashboard รองรับก่อนบันทึก

`build:pages` หยุดถ้าไม่มี branch ที่อนุมัติ, `CF_PAGES_BRANCH` ไม่ตรง หรือไม่มี
`SITE_URL` แต่ guard นี้ไม่ได้ตั้ง production branch ให้ Cloudflare การตั้งค่าใน
Dashboard ตามข้อ 2 และ 5 ยังจำเป็น

## Custom domain และ SEO

ใช้ `pages.dev` ที่ได้รับอนุมัติได้โดยไม่ซื้อ domain หากเจ้าของมี domain อยู่แล้วและ
อนุมัติ ให้ไปหน้า Pages project → Custom domains → Set up a custom domain แล้วทำ
DNS ตามคำแนะนำ Cloudflare ห้ามซื้อ domain หรือเปลี่ยน DNS ของบริการอื่นโดยเดาเอง

อัปเดต `SITE_URL` เป็น HTTPS origin ที่ต้องการใช้เป็น canonical แล้ว rebuild
build จะสร้าง canonical, hreflang TH/EN/x-default, Open Graph, Twitter metadata,
robots และ sitemap ให้ตรง origin นั้น ถ้าไม่ตั้ง `SITE_URL` จะเป็น noindex และ
robots disallow ทั้งเว็บ เพื่อให้ local review ไม่มี canonical ที่แต่งขึ้น

ไฟล์ `dist/_headers` และ `dist/_redirects` ถูกสร้างอัตโนมัติ ห้ามใส่ wildcard
rewrite `/* /index.html 200` เพราะแต่ละภาษาและคู่มือมี HTML จริงและมี `404.html`
โค้ดเว็บไม่มี backend Functions และไม่เปิด CORS ไปหาเครื่องผู้ใช้

## ตรวจหลัง deploy โดยเจ้าของ

- หน้า TH/EN และทุก route เปิดตรง/refresh ได้; URL ผิดตอบ 404
- ตรวจด้วยมือถือ 320/375 และจอ 768/1440, keyboard Tab/ลูกศร/Escape,
  focus, reduced motion, light/dark และภาพจริงโหลดครบ
- ดู Network/Console ว่าไม่มี error และไม่มี localhost/private API request
- ตรวจ response headers มี CSP, nosniff, frame-ancestors และ Referrer-Policy
- เปิด `/robots.txt`, `/sitemap.xml`; canonical และ alternate language ตรง domain
- ไม่มีปุ่ม download ที่ชี้ไฟล์ไม่มีจริง ข้อมูล release ต้องสัมพันธ์กับ GitHub snapshot
- การแก้ deployment ย้อนหลังใช้ rollback ใน Pages Dashboard ตาม revision ที่เจ้าของอนุมัติ

การตรวจนี้ยังเป็น `DEPLOYMENT_NOT_RUN`; การทดสอบเว็บไม่ใช่ Home UAT ของแอป,
การรับรอง provider หรือการตรวจ macOS native

## เอกสารทางการที่ตรวจประกอบ 24 พ.ย. 2026

- [Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
  ระบุ React Vite ใช้ build output `dist` และตั้ง environment ใน Dashboard
- [Branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)
  ระบุ automatic production branch และการปิด preview deployment
- [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Headers](https://developers.cloudflare.com/pages/configuration/headers/)
- [Redirects](https://developers.cloudflare.com/pages/configuration/redirects/)

ชื่อเมนู Cloudflare อาจเปลี่ยน ให้ยึดเอกสารทางการของ Pages และขอบเขตการอนุมัติของเจ้าของ
