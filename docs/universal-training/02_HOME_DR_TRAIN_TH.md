# ขั้นตอนเครื่องบ้าน: dr-train, MCP และ compute lifecycle

สถานะรอบเตรียม: **LIVE_NOT_RUN / HOME_UAT_NOT_RUN**. Owner เลือก SSH แล้ว
ยังไม่ทราบ host/user/port/fingerprint ของ dr-train ไม่เก็บค่าลับในเอกสารนี้

## 1. เตรียมเครื่องควบคุมและ SSH

1. บน Windows บ้าน เก็บงาน Git ค้างก่อน แล้ว `git switch main` และ
   `git pull --ff-only origin main`; จด `git rev-parse HEAD` เปิด `Start-FORGE.cmd`
2. ตั้ง SSH key ของเครื่องบ้านตามนโยบาย server ใช้ passphrase/agent ตามเหมาะสม
   อย่าคัดลอก vault, provider sessions หรือ private key จากเครื่องทำงาน
3. ตรวจ fingerprint ของ dr-train จากช่องทางผู้ดูแลที่เชื่อถือได้ก่อนบันทึก known_hosts
   `ssh-keyscan` เพียงอย่างเดียวไม่ยืนยันตัวตน ห้ามปิด StrictHostKeyChecking
4. ตัวอย่าง alias ใน **ไฟล์ SSH config ส่วนตัว** (แทน placeholders ก่อนใช้):

```sshconfig
Host dr-train
    HostName ACTUAL_HOST
    User ACTUAL_USER
    Port 22
    IdentityFile ~/.ssh/id_ed25519_dr_train
    IdentitiesOnly yes
    StrictHostKeyChecking yes
    ForwardAgent no
```

5. `ssh dr-train` แล้วตรวจ OS/Python/disk/CPU และ `nvidia-smi` เฉพาะถ้ามี GPU
   ไม่ sudo/install/update driver อัตโนมัติ บันทึกผลที่ไม่มี credentials
6. สร้าง workspace เฉพาะ user เช่น `/home/USER/forge-projects` แยก source,
   dataset cache, run outputs และ env store ไม่ใช้ system Python ติดตั้ง dependencies

**สำคัญ:** FORGE SSH adapter ใช้ `-F none`, `BatchMode=yes`, strict known-hosts
และ host/user/port แบบ explicit จึงไม่อ่าน alias `dr-train` จาก SSH config อัตโนมัติ
ใช้ alias สำหรับ operator preflight แล้วตั้งค่า connection ใน GUI ด้วยค่าที่ resolve
จริงและ file references ของ known-hosts/identity; อย่าใส่ alias ถ้ามันไม่ใช่ DNS host
ระบบต้องตรวจ machineId จาก health แล้ว pin `expectedMachineId` ก่อน execution
ไม่มี interactive password หรือ sudo ใน adapter นี้

## 2. Environment แยกชุด

เครื่องบ้าน/remote ต้องมี Python 3.11 หรือ 3.12 พร้อม venv/ensurepip อยู่แล้ว
ดู [คำสั่งและข้อจำกัดจริง](../worker-training-env.md). ทุกตัวอย่างข้างล่างรัน **บน dr-train**
หลัง clone source และอนุมัติ package download; แทน USER/interpreter path ให้ตรงเครื่อง:

```sh
python3.12 tools/training-env/manage.py profiles
python3.12 tools/training-env/manage.py prepare --root /home/USER/forge-envs --profile tabular --version cpu-001 --python /usr/bin/python3.12 --allow-network
python3.12 tools/training-env/manage.py create --root /home/USER/forge-envs --profile tabular --version cpu-001
python3.12 tools/training-env/manage.py verify --root /home/USER/forge-envs --profile tabular --version cpu-001
python3.12 tools/training-env/manage.py activate --root /home/USER/forge-envs --profile tabular --version cpu-001
```

Default profile ไม่ได้มี WFDB/pyarrow/pytest ให้เตรียม requirements input ที่ตรวจแล้ว
สำหรับ AHE และส่ง `--requirements ABSOLUTE_FILE --smoke-import wfdb ...` ใน prepare
input file เป็น plain package constraints ไม่ใช่ generated hashed lock
การ upgrade ต้อง version ใหม่และ explicit activate; งานเดิมยัง pin path/lock เดิม
ห้าม copy Windows venv ไป Linux และห้ามแก้ env ที่กำลังรัน

**ช่องว่างที่ต้อง implement ก่อน no-code training:** CLI นี้ยังไม่ถูกผูกกับ Compute GUI
และ SSH worker เรียก `python3` แบบคงที่ ยังไม่มี validated environment selection ใน job
ห้ามเปลี่ยน PATH/systempython เพื่อทำให้ดูเหมือนเลือก env ได้
เพิ่ม host-only interpreter/env receipt binding + final admission แล้วทดสอบก่อนใช้
CLI บน server โดยตรงเป็น operator verification ไม่ใช่การผ่าน FORGE GUI journey

## 3. SSH qualification (ไม่ใช้ clinical data)

| ขั้น | ทำ | หลักฐานที่ผ่าน |
|---|---|---|
| Readiness | ตรวจ host key, health, machineId, Pythonและdisk | identity ตรง selected connection; mismatch ปฏิเสธ |
| Tiny job | สร้าง notebook ที่พิมพ์ตัวเลข/เขียน JSON เล็กใน owned workspace | job/run IDs, source hash, actual exit, receipt |
| Result | นำ JSON กลับด้วยช่องทางที่ implement และตรวจ hash | bytes เท่ากันทั้ง remote/local; logไม่ใช่ไฟล์ผลลัพธ์ |
| Cancel | งานรอสั้นที่สร้างเพื่อทดสอบ Stop | exact owned process/session หยุด ไม่ kill งานอื่น |
| Disconnect | ตัดการสังเกตแล้ว reconcile เดิม | ไม่ execute ซ้ำ; unknown คงอยู่จนยืนยันได้ |
| Restart | restart FORGE แล้วเปิด job เดิม | restored IDs, ไม่มี redispatch |

Remote artifact download ยังต้องตรวจ adapter ที่เลือกเป็นรายชนิด ไม่มีสิทธิ์อ้างว่า
SSH/Jupyter ทุกแบบส่ง model bytes กลับได้จากการได้ stdout สำเร็จเพียงอย่างเดียว

## 4. RunPod และ Vast ผ่าน MCP + compute adapter

สองทางนี้คนละ contract: Compute adapter มี **start/stop ของ existing ID**;
MCP ต้อง discover tool schemas จริงและอนุมัติเฉพาะ operation/resource ก่อนเรียก
ไม่อ้างว่าการต่อ generic MCP เท่ากับสร้าง/ลบ instance ผ่าน GUI ได้ครบแล้ว

ก่อนเปิดเงินจริง Owner อนุมัติ quote ที่เห็นจริง: provider, accelerator/count,
image digest, region, storage, rate, expiry, ระยะเวลา, total cap, resource ownership
ข้อเสนอ 30 นาที/US$3 ต่อเจ้า รวม US$6 ต้องยืนยันก่อนใช้ ไม่เปิดทั้งสองพร้อมกัน

1. ตั้ง secret ใน FORGE Secret Manager ตาม purpose และ reference ไม่ใส่ token ใน prompt
2. เชื่อม official/ตรวจ provenance MCP server, discovery แล้วเก็บ server version,
   tool names/schema hash; ตรวจ health แบบ read-only ก่อน ห้ามเรียก toolที่ไม่รู้ผลข้างเคียง
3. เลือก disposable resource ใหม่สำหรับรอบนี้ ถ้า create ยังไม่รองรับ ให้ Owner สร้าง
   ผ่าน provider UI แล้วนำ exact ID มา configure ไม่ประดิษฐ์ MCP success
4. บันทึก ID ก่อน effect, start แล้ว observe จน running; timeout เก็บ UNKNOWN
   และ lookup ID เดิม ไม่ create ใหม่อัตโนมัติ
5. ผูก SSH/Jupyter endpointกับ resourceที่สังเกตจริง รัน synthetic smoke 60 วินาที
   รับไฟล์กลับตรวจ hash ไม่ส่งข้อมูล restricted
6. Stop job แล้ว stop resource รอสถานะจริง; ทดสอบ start/stop เดิมหนึ่งรอบถ้ายังอยู่ในงบ
7. Exportไฟล์ที่ต้องเก็บ ตรวจว่าเป็น disposable owned resource แล้ว terminate/destroy
   ผ่าน operation ที่อนุมัติ ตรวจ volumes/instance list/billing อีกครั้ง
8. เก็บ receipt ทั้ง accepted request และ observed terminal; API 200 ไม่ใช่ deleted

RunPod มี storage ที่คิดค่าบริการต่อแม้ stop; Vast ก็เช่นกัน การลบถาวรทำข้อมูลหาย
จึงต้องเก็บไฟล์ก่อน ไม่ใช้ชื่อ/ลิสต์ทั้งหมดแทน exact ID. แหล่งอ้างอิง:
[RunPod billing](https://contact.runpod.io/hc/en-us/articles/57370686866707-Why-You-re-Still-Being-Charged-After-Stopping-Pods-and-Services),
[Vast instance management](https://docs.vast.ai/guides/instances/manage-instances).

## 5. Colab runtime ไม่เท่ากับ session

ใช้ official [Colab MCP API](https://developers.google.com/colab/api/reference/mcp)
ที่ `https://colaboratory.googleapis.com/mcp`; แยกจาก browser notebook bridge
ตรวจ eligible runtime specs และบัญชีจริงก่อนสร้าง runtime; creation อาจช้า/จำกัด quota
การลบ session หยุด kernel ของ session แต่ runtime และไฟล์ยังอยู่ การลบ runtime
ลบไฟล์และsessionsถาวร จึงทำได้เฉพาะ test runtime ที่สร้าง/อนุมัติรอบนี้

FORGE ปัจจุบันผูก **existing runtime** และ owned sessions; create/delete runtime
ผ่าน MCP ยังต้อง qualify แยก อย่าเรียก `delete_session` แล้วรายงานว่า runtime ปิดแล้ว
ทดสอบ tiny execution, file round-trip, session stop และ runtime cleanup ตามลำดับ
MCP execute timeout ไม่พิสูจน์ว่า code หยุด; reconcile receipt ก่อน retry
โค้ดรันยาวต้อง checkpoint/poll ไม่กด execute_code ใหม่เพื่อถามสถานะ

## 6. Evidence / cleanup checklist

เก็บรายงานแยก provider มี start/end UTC, exact IDs, redacted tool schema/receipt,
source/env/data hashes, file counts, exit, Stop/restart/reconcile และ billing observed
ห้ามเก็บ bearer, SSH key, proxy token หรือ raw connectionInfo
เมื่อ stop/delete ไม่ทราบผล ให้ขึ้น `CLEANUP_UNKNOWN` และแจ้ง Owner พร้อม ID
อย่าปล่อย loop retryไม่จำกัด และอย่าปิด FORGEก่อนเก็บ registry/วิธีติดตาม cleanup

Windows private native Guarded ยังรองรับ Windows x64 เท่านั้น; dr-train Linux
เป็น compute target ผ่าน SSH ไม่ใช่การติดตั้ง Windows runtime บน Linux
