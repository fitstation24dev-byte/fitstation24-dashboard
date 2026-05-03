# คู่มือ Deploy FITSTATION 24 ขึ้น GitHub + Vercel

ทำครั้งเดียว — หลังจากนั้นแก้ไฟล์บน GitHub แล้ว Vercel จะ deploy ใหม่ให้อัตโนมัติ

---

## สรุปสั้น

```
ไฟล์ในเครื่อง  →  GitHub repo  →  Vercel  →  URL ใช้งาน (เช่น fitstation24.vercel.app)
```

ใช้เวลาทั้งหมด ~10 นาที ฟรีทั้งหมด

---

## เตรียมไฟล์ก่อน

ในโฟลเดอร์ `FITSTATION24` มีไฟล์ `index.html` พร้อมแล้ว (Vercel ต้องการชื่อไฟล์นี้เพื่อแสดงเป็นหน้าแรก)

ไฟล์อื่นๆ (Code.gs, Setup_Guide.md, ฯลฯ) ลบทิ้งได้ — ไม่ใช้กับ web app นี้

---

## ขั้นตอน

### ส่วนที่ 1 · GitHub (5 นาที)

#### 1.1 สมัคร GitHub
1. ไปที่ https://github.com/signup
2. ใส่อีเมล รหัสผ่าน และ username (เช่น `aofsen`)
3. ยืนยันอีเมล

#### 1.2 สร้าง Repository ใหม่
1. หลังล็อกอิน → กดปุ่ม **+** มุมขวาบน → **New repository**
2. ตั้งค่า:
   - **Repository name:** `fitstation24-dashboard`
   - **Description:** `FITSTATION 24 management dashboard`
   - เลือก **Private** (แนะนำ — เพราะมีรหัสตัวอย่าง demo)
   - ติ๊ก **Add a README file**
3. กด **Create repository**

#### 1.3 อัปโหลดไฟล์ index.html
1. ที่หน้า repo ที่เพิ่งสร้าง → กดปุ่ม **Add file** → **Upload files**
2. ลาก `index.html` จาก `Desktop\FITSTATION24\` ลงในกรอบที่ขึ้น
3. ที่ช่อง commit ด้านล่าง พิมพ์ `Initial dashboard upload`
4. กด **Commit changes**

เสร็จขั้นตอน GitHub — repo พร้อมแล้ว

---

### ส่วนที่ 2 · Vercel (5 นาที)

#### 2.1 สมัคร Vercel ด้วย GitHub
1. ไปที่ https://vercel.com/signup
2. กด **Continue with GitHub** (วิธีนี้จะเชื่อมกับ GitHub ให้อัตโนมัติ)
3. กด **Authorize Vercel** เพื่อให้สิทธิ์
4. เลือกแพ็กเกจ **Hobby — Free**

#### 2.2 Import Project
1. หน้า dashboard Vercel → กด **Add New...** → **Project**
2. ในช่อง **Import Git Repository** จะเห็นรายชื่อ repo ของ GitHub
   - ถ้าไม่เห็น repo `fitstation24-dashboard` กด **Adjust GitHub App Permissions** → เลือกให้ Vercel เข้าถึง repo
3. กด **Import** ข้างชื่อ `fitstation24-dashboard`
4. หน้าตั้งค่า project:
   - **Framework Preset:** `Other`
   - **Root Directory:** `.` (default)
   - **Build Command:** เว้นว่าง (ไม่ต้องกรอก)
   - **Output Directory:** เว้นว่าง
5. กด **Deploy**

รอ ~30 วินาที — จะเห็นข้อความ **Congratulations!** พร้อมหน้าจอ preview

#### 2.3 ได้ URL แล้ว
- URL จะมีรูปแบบ `https://fitstation24-dashboard-xxxx.vercel.app`
- เปิดได้ทันที ใช้งานทุกฟังก์ชัน

---

## วิธีอัปเดตไฟล์ทีหลัง

### วิธีที่ 1 — แก้บน GitHub โดยตรง (ง่ายที่สุด)

1. เข้า repo บน GitHub → กดที่ไฟล์ `index.html`
2. กดไอคอน **ดินสอ** (Edit this file) มุมขวาบน
3. แก้โค้ดได้เลย → กด **Commit changes**
4. Vercel จะ deploy ใหม่ภายใน 30 วินาที (เห็น notification ที่แท็บ Deployments)

### วิธีที่ 2 — อัปโหลดไฟล์ใหม่ทับ

1. ที่ repo → ลบไฟล์ `index.html` เก่า (กดไฟล์ → ไอคอนถังขยะ)
2. **Add file** → **Upload files** → ลากไฟล์ใหม่
3. Commit → Vercel auto-deploy

### วิธีที่ 3 — ใช้ Git CLI (สำหรับนักพัฒนา)

```bash
git clone https://github.com/<USERNAME>/fitstation24-dashboard.git
cd fitstation24-dashboard
# แก้ index.html
git add index.html
git commit -m "Update dashboard"
git push
```

---

## Custom Domain (ถ้ามีโดเมน)

ถ้าซื้อโดเมนของฟิตเนสไว้ (เช่น `fitstation24.com`):

1. Vercel dashboard → เลือกโปรเจกต์ → **Settings** → **Domains**
2. ใส่โดเมน เช่น `dash.fitstation24.com`
3. Vercel จะแสดง DNS records ที่ต้องเพิ่มในผู้ให้บริการโดเมน
4. ไปแก้ DNS ที่ผู้ให้บริการ (Cloudflare/GoDaddy/etc.) → รอ 5-30 นาที
5. เสร็จ — เปิดด้วยโดเมนตัวเองได้

---

## ข้อควรรู้

### ความปลอดภัย
- เลือก **Private repo** บน GitHub ไม่ให้คนนอกเห็นโค้ด
- เปลี่ยนรหัสผ่าน demo ทั้งหมดในไฟล์ก่อน deploy โปรดักชัน
  - ค้นหาในโค้ด: `pwd: 'admin123'` แล้วเปลี่ยน
  - ค้นหาในโค้ด: `managerPwd: 'mgr#1234'` แล้วเปลี่ยน
- หลังแก้แล้ว upload ทับเหมือนเดิม

### ข้อจำกัด
- **ข้อมูลเก็บแยกแต่ละเบราว์เซอร์/เครื่อง** — เปิดอีกเครื่องจะเป็นข้อมูลเริ่มต้นใหม่
  - แก้ด้วย: ใช้ Export JSON แล้ว Import ที่อีกเครื่อง
- **ไม่มี backend** — ส่ง LINE OA จริงไม่ได้ (แสดงแต่ข้อความที่จะส่ง)
- **ใครเข้า URL ได้ก็เข้าได้** — มีแค่ Login กรองที่หน้าเข้าระบบ ไม่มี protection ระดับ network

### ค่าใช้จ่าย
- GitHub: ฟรี (private repos ไม่จำกัด)
- Vercel: ฟรี (Hobby plan — bandwidth 100GB/เดือน, เกินพอสำหรับใช้ภายใน)

---

## ถ้าต้องการ backend จริง (อนาคต)

เมื่อพร้อมจะอัปเกรดเป็นระบบมีฐานข้อมูลกลาง:

1. **Supabase** (แนะนำ) — ฟรี database + auth + storage
2. **Firebase** — Google ecosystem
3. **Vercel + Postgres** — รวมหมดในที่เดียว

ตอนนั้นต้องเขียนโค้ดเชื่อม API เพิ่ม — บอกผมได้ ถ้าจะทำต่อ
