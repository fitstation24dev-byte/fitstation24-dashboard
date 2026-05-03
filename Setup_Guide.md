# คู่มือเซ็ตอัพ FITSTATION 24

ระบบจัดการฟิตเนสบน Google Sheets + Apps Script + LINE OA สำหรับ 2-3 สาขา

---

## สิ่งที่คุณต้องมีก่อนเริ่ม

1. บัญชี Google (Gmail) — ไม่ต้องเสียเงิน
2. LINE Official Account ของฟิตเนส (มีอยู่แล้ว)
   - Channel Access Token (Long-lived) จาก LINE Developers Console
3. LINE Group สำหรับเช็คยอด — เชิญ LINE OA bot เข้าร่วม + รู้ Group ID
4. ไฟล์ที่ผมส่งให้ 3 ไฟล์:
   - `FITSTATION24_System.xlsx` — Workbook
   - `Code.gs` — Apps Script
   - `Setup_Guide.md` — คู่มือ (ไฟล์นี้)

---

## ขั้นตอน

### 1) อัปโหลด Workbook ขึ้น Google Sheets

1. ไปที่ https://drive.google.com
2. ลาก `FITSTATION24_System.xlsx` เข้าไป
3. คลิกขวาที่ไฟล์ → **Open with** → **Google Sheets**
4. ที่เมนู **File** → **Save as Google Sheets** (ระบบจะแปลงเป็น Google Sheets ให้)

### 2) วาง Apps Script

1. ในไฟล์ Google Sheets ที่เปิดอยู่ → เมนู **Extensions** → **Apps Script**
2. ลบโค้ดเปล่า `function myFunction() {}` ออก
3. เปิดไฟล์ `Code.gs` ที่ผมให้ → คัดลอกทั้งหมด → วางในหน้าต่าง Apps Script
4. กด **Save** (ไอคอนรูปแผ่นดิสก์)
5. ตั้งชื่อโปรเจกต์เป็น `FITSTATION24` แล้วบันทึก

### 3) ตั้งค่าใน Settings

กลับไปที่ Google Sheets → ชีต **Settings**

#### A. รายชื่อสาขา (แถวที่ 6-10)

แก้ไขแต่ละแถวให้ครบ:

| ฟิลด์ | ตัวอย่าง |
|---|---|
| รหัส | `BR01` |
| ชื่อสาขา | `FITSTATION 24 - สาขา 1` |
| LINE Channel Access Token | `aBcDeF...` (ยาวมาก จาก LINE Developers) |
| LINE Group ID | `Cxxxxxxxxxxxxxxxx` |
| Manager Email | `manager.br1@fit.com` |
| Manager Password | `BR1Manager#1234` (รหัสที่เมเนเจอร์ใช้ยืนยันการเทรน) |

**วิธีหา Channel Access Token:**
1. https://developers.line.biz/console/ → เข้า provider ของคุณ
2. เลือก channel ที่เป็น Messaging API → แท็บ **Messaging API**
3. เลื่อนลงล่างสุด → **Channel access token (long-lived)** → กด **Issue**
4. คัดลอก token ที่ได้

**วิธีหา Group ID:**
1. เชิญ LINE OA bot ของคุณเข้า LINE Group ที่จะใช้เช็คยอด
2. ใน Group ส่งข้อความอะไรก็ได้
3. ใน Apps Script เพิ่มฟังก์ชันชั่วคราว `function showWebhookEvents() { ... }` หรือใช้วิธีง่ายกว่า:
   - เปิด Webhook URL ของ LINE channel ชี้มาที่ Apps Script Web App ของคุณชั่วคราว แล้ว log `events[0].source.groupId`
   - หรือใช้บริการช่วย เช่น https://line-bot-tools.web.app/ (ใส่ token แล้วดู event ล่าสุด)

#### B. ค่าทั่วไป (แถวที่ 13-18)

ค่า default ตั้งให้แล้ว แก้ได้ตามใจ:

- **Member expiry warning (วัน)** = `15` — แจ้งเตือนล่วงหน้า 15 วัน
- **Trainer hours warning (ครั้ง)** = `3` — แจ้งเตือนเมื่อเหลือ ≤ 3 ครั้ง
- **Daily summary time** = `21:00` — เวลาส่งสรุปยอด

### 4) Run installTriggers (ครั้งเดียว)

1. กลับไปที่ Apps Script
2. ที่เมนูบนสุด เลือกฟังก์ชัน **installTriggers** จาก dropdown
3. กดปุ่ม **Run**
4. Google จะถามอนุญาตสิทธิ์ — กด **Review permissions** → เลือกบัญชี → **Advanced** → **Go to FITSTATION24 (unsafe)** → **Allow**
   - (ปุ่ม "unsafe" ขึ้นเพราะเป็นสคริปต์ที่คุณเขียนเอง ไม่ได้ผ่านการรีวิวของ Google ปลอดภัยใช้งานได้)
5. กด Run อีกครั้ง — จะมีกล่องแจ้ง "ติดตั้ง Trigger เรียบร้อยแล้ว ✓"

### 5) ทดสอบ

#### ทดสอบส่ง LINE
1. กลับไปที่ Google Sheets → กด refresh หน้าเพจ
2. เมนูใหม่ **FITSTATION 24** จะปรากฏข้างๆ Help
3. **FITSTATION 24** → **ทดสอบส่ง LINE (สาขาเลือก)** → พิมพ์ `BR01`
4. ถ้าตั้ง token/group id ถูก จะเห็นข้อความเข้า LINE Group

#### ทดสอบบันทึกยอด + แจ้งเตือนสลิป
1. ชีต **Sales** → เพิ่มแถวใหม่:
   - สาขา: `BR01`
   - EmpID: `E002`
   - ประเภท: `MEM`
   - MemberID: `M0001`
   - ชื่อสมาชิก: `ปกรณ์ สมิธ`
   - จำนวนเงิน: `12000`
   - **สลิป (URL):** ลาก-วางรูปสลิปลงใน Google Drive แล้วคัดลอก link → วางในเซลล์
2. กด Enter → ภายใน 5 วิ ระบบจะ
   - เติม Timestamp อัตโนมัติ
   - ส่งข้อความเข้า LINE Group ของสาขานั้น
   - เปลี่ยนคอลัมน์ `LINE Notify` เป็น `Sent`

#### ทดสอบหักชั่วโมงเทรน
1. ชีต **Trainings** → เพิ่มแถวใหม่:
   - สาขา: `BR01`
   - MemberID: `M0001`
   - TrainerID: `E003`
   - ชื่อเทรนเนอร์: `วิชัย`
   - **Manager Pwd:** ใส่รหัสที่ตั้งใน Settings ของสาขา BR01
2. คอลัมน์ "ตรวจสอบ" จะขึ้น `✓ Verified`
3. ภายใน 5 วิ ชั่วโมงคงเหลือใน Members ของ M0001 จะลด 1 ครั้ง
4. ถ้า ≤ 3 ครั้ง สมาชิกที่มี LINE User ID จะได้รับแจ้งเตือน LINE OA

---

## ระบบ Login + Role

### กลไก
- Google Sheets ใช้สิทธิ์ของ Google โดยตรง — แชร์ไฟล์ผ่านปุ่ม **Share** ที่มุมบนขวา
- Apps Script จะอ่าน `Session.getActiveUser().getEmail()` แล้วเทียบกับชีต `Employees`
- ทุกครั้งที่เปิดไฟล์ จะถูก log ในชีต `Login_Log`

### Role และสิทธิ์ที่แนะนำ

| Role | สิทธิ์ที่ให้ใน Share | หน้าที่ |
|---|---|---|
| Owner | Editor | เจ้าของกิจการ — เห็นทุกชีต |
| Manager | Editor (จำกัดด้วย Protect Range) | ผู้จัดการสาขา — แก้ของสาขาตัวเอง |
| Staff | Editor (จำกัด) | เคาน์เตอร์ — กรอก Sales/Members |
| Trainer | Commenter / Viewer | เทรนเนอร์ — ดูสมาชิกของตน |

### วิธีจำกัดสิทธิ์ระดับชีต/แถว
1. คลิกขวาที่ tab ชีต → **Protect sheet**
2. **Set permissions** → เลือก **Restrict who can edit this range**
3. เพิ่มเฉพาะอีเมลที่ต้องการให้แก้ได้
4. ทำเหมือนกันกับชีต `Settings` (อนุญาตเฉพาะ Owner)

### หมายเหตุสำคัญ
- Google Sheets ไม่มี Role-based UI ที่ "ซ่อนชีต" รายคน — ทำได้แค่ "ห้ามแก้"
- ถ้าต้องการซ่อนชีตจริงจัง ให้แยกเป็น 2 ไฟล์: ไฟล์เต็มสำหรับ Owner/Manager + ไฟล์ย่อย (`IMPORTRANGE`) สำหรับ Staff/Trainer
- ผมช่วยตั้งค่านี้เพิ่มได้ ถ้าต้องการ

---

## การใช้งานประจำวัน

### บันทึกยอด (เคาน์เตอร์)
1. เปิดชีต **Sales**
2. ใส่: สาขา / EmpID / ประเภท / MemberID / ยอด / สลิป
3. กด Enter → ระบบส่ง LINE อัตโนมัติ

### บันทึกการเทรน
1. เปิดชีต **Trainings**
2. ใส่: สาขา / MemberID / TrainerID / Manager Pwd
3. กด Enter → ถ้ารหัสถูก ชั่วโมงจะลด -1 อัตโนมัติ

### ดูภาพรวม
- ชีต **Dashboard** — ยอดวันนี้ทุกสาขา
- ชีต **Daily_Summary** — กราฟ 14 วันล่าสุด
- ชีต **Alerts** — รายการแจ้งเตือนทั้งหมด

---

## ปัญหาที่พบบ่อย

### LINE ไม่ส่ง
- ตรวจ **Channel Access Token** ใน Settings ว่าถูก (เริ่มด้วย ตัวอักษรยาวๆ ไม่มี space)
- ตรวจว่า **bot ถูกเชิญเข้า Group** แล้ว (ไม่งั้นจะส่งไม่ได้)
- เปิด Apps Script → **Executions** → ดู error log

### ชั่วโมงไม่ลด
- ตรวจคอลัมน์ "ตรวจสอบ" ว่าขึ้น `✓ Verified` ไหม
- ถ้าขึ้น `✗ Invalid` แสดงว่ารหัสเมเนเจอร์ผิด — เช็คใน Settings ว่ารหัสตรงสาขาถูกต้องหรือเปล่า
- ดูคอลัมน์ "หมายเหตุ" ของ Trainings — ถ้ามีคำว่า `[deducted]` แสดงว่าหักไปแล้ว

### Trigger ไม่ทำงาน
- Apps Script → **Triggers** (ไอคอนนาฬิกา ทางซ้าย) → ดูว่ามี trigger ครบ 4 ตัวไหม:
  - handleEdit (onEdit)
  - handleOpen (onOpen)
  - runDailyAtMidnight (Time-driven, daily 0:00)
  - sendDailySummaryToGroups (Time-driven, daily 21:00)
- ถ้าไม่ครบ — Run `installTriggers` อีกครั้ง

---

## ส่วนเสริม (เพิ่มภายหลังได้)

- **Form กรอกยอดผ่านมือถือ** — Google Forms → Linked Sheet → Apps Script จะส่ง LINE ต่อให้
- **ระบบ check-in สมาชิกหน้าประตู** — สแกน QR → log เข้าชีต Members
- **Backup อัตโนมัติ** — เพิ่มฟังก์ชันที่ duplicate spreadsheet ทุก 1 อาทิตย์
- **Web App หน้า Login จริง** — ทำเป็น HTML page ผ่าน Apps Script Web App (มี role-based UI ซ่อนเห็นได้)

แจ้งผมได้ ถ้าต้องการเพิ่มฟีเจอร์ไหน
