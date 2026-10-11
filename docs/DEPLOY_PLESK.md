# Deploy Backend + MySQL บน Plesk (Atom Hosting)

> คู่มือนี้อิงกับ Plesk Obsidian ที่มี **Node.js extension** (Phusion Passenger), **Databases + phpMyAdmin** และ **Scheduled Tasks** ซึ่งเป็นแพ็กเกจ Node hosting ของ Atom Hosting ถ้าเมนูในแผงของคุณไม่ตรงกัน ให้ถามฝ่ายซัพพอร์ตว่าเปิดใช้ Node.js extension ให้โดเมนแล้วหรือยัง

## ภาพรวม

```
Browser ──► Vercel (Next.js) ──rewrite /api/*──► https://api.example.com (Plesk: nginx → Passenger → app.js) ──► MySQL/MariaDB
                                                     ▲
Plesk Scheduled Task (ทุก 1 นาที) ── /internal/cron/tick ┘   (คิวงาน: โพสต์ตามเวลา, เรนเดอร์วิดีโอ, sync ฯลฯ)
Webhooks (Meta / LINE / TikTok) ─────────────────────┘   (วิ่งเข้า backend ตรง ไม่ผ่าน Vercel)
```

## สิ่งที่ต้องมี

- โดเมนย่อยสำหรับ API เช่น `api.example.com` (Websites & Domains → Add Subdomain)
- Node.js **20.11+** (แนะนำ 22 LTS) ใน Node.js extension
- MySQL **8.0.1+** หรือ MariaDB **10.6+** (ต้องรองรับ `SKIP LOCKED`; เช็กเวอร์ชันได้ที่หน้า phpMyAdmin)

---

## ขั้นที่ 1 — สร้างฐานข้อมูลและ import schema ผ่าน phpMyAdmin

1. Plesk → **Databases → Add Database**
   - ชื่อฐานข้อมูล เช่น `pos_enterprise` (Plesk อาจเติม prefix ให้ เช่น `user_pos_enterprise`)
   - สร้าง database user + รหัสผ่านที่เดายาก จดไว้ใช้ใน env
2. กด **phpMyAdmin** ที่ฐานข้อมูลนั้น → เลือกฐานข้อมูลทางซ้าย
3. แท็บ **Import** → เลือกไฟล์ `database/schema.sql` → Character set `utf-8` → **Import**
4. ทำซ้ำกับ `database/seed.sql` (ข้อมูลอ้างอิง + ข้อมูลตัวอย่าง)

**อัปเกรดจากเวอร์ชันก่อน (ติดตั้งไว้ตั้งแต่เฟส 1–2):** ห้าม import `schema.sql` ซ้ำ ให้ import ไฟล์ใน `database/migrations/` ที่ยังไม่เคยรันทีละไฟล์ตามลำดับเลขแทน เช่น `002_accounting.sql` สำหรับเฟส 3 `003_inbox.sql` สำหรับเฟส 4 `004_trends.sql` สำหรับเฟส 5 `005_video.sql` สำหรับเฟส 6 `006_social.sql` สำหรับเฟส 7 และ `007_trend_lifecycle.sql` สำหรับระบบ Phase/เช็กลิสต์สินค้าเทรนด์ ตรวจว่ารันไฟล์ไหนไปแล้วได้ด้วย `SELECT * FROM schema_migrations;` (การติดตั้งใหม่ที่ใช้ `schema.sql` ปัจจุบันมี migration ครบแล้ว)

> ⚠️ `schema.sql` มี `DROP TABLE IF EXISTS` อยู่ด้านบน — **import ซ้ำ = ข้อมูลหายหมด** ใช้กับการติดตั้งครั้งแรกเท่านั้น การเปลี่ยนโครงสร้างในอนาคตจะมาเป็นไฟล์ `database/migrations/NNN_*.sql` ให้ import ทีละไฟล์ตามลำดับ
>
> ไฟล์ seed ขนาด ~0.7 MB ถ้าเกิน "Max upload size" ของ phpMyAdmin ให้ zip ไฟล์ก่อน (phpMyAdmin รับ `.zip` / `.gz`) หรือแยกนำเข้าเฉพาะส่วน reference data

หลัง import จะมีบัญชี:

| อีเมล | รหัสผ่าน | หมายเหตุ |
|---|---|---|
| `admin@example.com` | `Admin@1234` | owner — ระบบบังคับเปลี่ยนรหัสผ่านตอน login ครั้งแรก |
| `manager@` `accountant@` `cashier@` `marketer@` `support@` `viewer@example.com` | `Admin@1234` | บัญชีเดโมแต่ละบทบาท — **ลบหรือระงับก่อนใช้งานจริง** |

ลบข้อมูลเดโม (เก็บ reference data ไว้) ได้ด้วย SQL ใน phpMyAdmin:
```sql
DELETE FROM users WHERE id BETWEEN 2 AND 7;
DELETE FROM sales_orders; DELETE FROM transactions; DELETE FROM conversations;
DELETE FROM scheduled_posts; DELETE FROM video_projects; DELETE FROM trending_products;
```

## ขั้นที่ 2 — อัปโหลดโค้ด backend

เลือกวิธีใดวิธีหนึ่ง:

**A. Git (แนะนำ)** — Websites & Domains → `api.example.com` → **Git**
- Repository: `https://github.com/<you>/pos-enterprise.git` (private repo ให้ใช้ SSH deploy key ที่ Plesk สร้างให้ แล้วเพิ่มใน GitHub → Settings → Deploy keys)
- Deployment mode: Automatic, deploy path เช่น `/httpdocs` (repo ทั้งก้อนจะอยู่ใน `httpdocs/`, backend อยู่ที่ `httpdocs/backend`)

**B. File Manager / FTP** — อัปโหลดเฉพาะโฟลเดอร์ `backend/` (ไม่ต้องรวม `node_modules`)

## ขั้นที่ 3 — ตั้งค่า Node.js app

Websites & Domains → `api.example.com` → **Node.js**

| ช่อง | ค่า |
|---|---|
| Node.js Version | 22.x |
| Package Manager | npm |
| Document Root | `/httpdocs/backend/public` (สร้างโฟลเดอร์ `public` ว่างไว้ — Plesk ต้องการ document root ที่อยู่ใต้ application root) |
| Application Mode | `production` |
| Application Root | `/httpdocs/backend` |
| Application Startup File | `app.js` |

จากนั้น:
1. กด **Enable Node.js**
2. กด **NPM install** (ติดตั้ง dependencies จาก `package.json`)
3. **Custom environment variables** → เพิ่มทุกตัวจาก `backend/.env.example` อย่างน้อย:

```
NODE_ENV=production
DB_HOST=localhost
DB_PORT=3306
DB_USER=<user ที่สร้างในขั้นที่ 1>
DB_PASSWORD=<รหัสผ่าน>
DB_NAME=<ชื่อฐานข้อมูลรวม prefix>
DB_CONNECTION_LIMIT=5
JWT_ACCESS_SECRET=<สุ่มอย่างน้อย 32 ตัว>
CRON_SECRET=<สุ่มอย่างน้อย 16 ตัว>
APP_ENCRYPTION_KEY=<32 ไบต์ base64>
CORS_ORIGINS=https://your-app.vercel.app,https://*-your-team.vercel.app,https://app.example.com
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
TRUST_PROXY=1
JOB_RUNNER=cron
APP_TZ_OFFSET=+07:00
# AI (MiniMax เป็นค่าเริ่มต้น)
AI_PROVIDER=minimax
MINIMAX_API_KEY=<key จาก platform.minimax.io>
# Inbox webhooks
PUBLIC_API_URL=https://api.example.com
LINE_CHANNEL_SECRET=<ถ้าใช้ LINE OA>
META_APP_SECRET=<ถ้าใช้ Messenger/IG>
META_WEBHOOK_VERIFY_TOKEN=<ตั้งเองแล้วใส่ค่าเดียวกันใน Meta App>
```
   สร้าง secret ได้ด้วย `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` (หรือ `npm run gen-secret` บนเครื่องตัวเอง)
   และ `APP_ENCRYPTION_KEY` ด้วย `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
4. กด **Restart App**
5. ทดสอบ: เปิด `https://api.example.com/api/health` ต้องได้ `{"data":{"status":"ok","database":"ok",...}}`

> **ไม่ต้องตั้ง `PORT`** — Passenger กำหนดให้เอง
> ไม่ต้องสร้างไฟล์ `.env` บนเซิร์ฟเวอร์ ใช้ env ใน Plesk แทน (ถ้ามี `.env` อยู่ ระบบจะโหลดเป็นค่าเสริม แต่ค่าใน Plesk มาก่อน)

## ขั้นที่ 4 — SSL

Websites & Domains → `api.example.com` → **SSL/TLS Certificates** → ติดตั้ง **Let's Encrypt** และเปิด "Redirect from HTTP to HTTPS"
(cookie ใช้ `Secure` ใน production — ต้องเป็น HTTPS เท่านั้น)

## ขั้นที่ 5 — Scheduled Task (ตัวขับคิวงานเบื้องหลัง)

**ทำไมต้องมี:** Passenger จะหยุด Node app เมื่อไม่มี request สักพัก ทำให้ตัวตั้งเวลาในโปรเซส (`setInterval`, `node-cron`) ไว้ใจไม่ได้ ระบบจึงเก็บงานไว้ในตาราง `jobs` แล้วให้ Plesk ปลุกทุกนาทีเพื่อประมวลผลงานที่ถึงเวลา

Tools & Settings (หรือ Websites & Domains) → **Scheduled Tasks → Add Task**

ตัวเลือก 1 — **Run a command** (แนะนำ, secret ไม่โผล่ใน URL log):
```
curl -fsS -X POST -H "X-Cron-Secret: <CRON_SECRET>" https://api.example.com/internal/cron/tick
```
ตัวเลือก 2 — **Fetch a URL** (ถ้าแผงไม่ให้รันคำสั่ง):
```
https://api.example.com/internal/cron/tick?key=<CRON_SECRET>
```
- Run: **Cron style** `* * * * *` (ทุก 1 นาที)
- Notify: เฉพาะเมื่อ error

แต่ละ tick ทำงานได้สูงสุด ~45 วินาที / 20 งาน แล้วคืนผล งานที่ล้มเหลวจะ retry อัตโนมัติแบบ backoff (1, 4, 9, 16 นาที)

## ขั้นที่ 5.1 — Webhook แชต (เฟส 4)

ให้ webhook ชี้ไปที่ **โดเมน API บน Plesk โดยตรง** ไม่ต้องผ่าน Vercel เพื่อลดจุดที่อาจแก้ไข body (ลายเซ็น HMAC ตรวจจาก body ต้นฉบับ) และตอบทันอายุ reply token ของ LINE

- LINE Developers → Messaging API → Webhook URL: `https://api.example.com/webhooks/line` แล้วเปิด **Use webhook**
- Meta App → Webhooks → Page/Instagram: Callback URL `https://api.example.com/webhooks/meta` และใช้ Verify token เดียวกับ `META_WEBHOOK_VERIFY_TOKEN`
  - subscribe field `messages`
- ใส่ access token ของแต่ละเพจ/OA ในหน้า **ตั้งค่า AI แชต → ช่องทางแชต** (ระบบเข้ารหัสด้วย `APP_ENCRYPTION_KEY` ก่อนเก็บ)
  - ID ของช่องทางต้องตรงกับ Page ID / LINE Bot user ID

## ขั้นที่ 6 — เชื่อมกับ Vercel

ตั้ง `BACKEND_URL=https://api.example.com` ในโปรเจกต์ Vercel (ดู [`DEPLOY_VERCEL.md`](./DEPLOY_VERCEL.md)) และให้ `CORS_ORIGINS` ฝั่ง backend มีโดเมน Vercel ของคุณ

---

## ข้อจำกัดของ shared/Node hosting ที่กระทบฟีเจอร์ และทางออก

| ข้อจำกัด | กระทบ | ทางออกที่ใช้ในโปรเจกต์นี้ |
|---|---|---|
| Passenger หยุดแอปเมื่อ idle, ไม่มี process ค้างถาวร | ตั้งเวลาโพสต์, sync ออร์เดอร์, ดึงเทรนด์ | คิวงานใน MySQL + Scheduled Task ทุก 1 นาที (ขั้นที่ 5) |
| ไม่มีสิทธิ์ root / ไม่มี ffmpeg / ไม่มี GPU, CPU-RAM จำกัด | เรนเดอร์วิดีโอ AI, TTS, avatar | ส่งงานไปบริการคลาวด์ (HeyGen, ElevenLabs, Shotstack) แล้ว poll สถานะผ่านคิวงาน |
| ดิสก์/แบนด์วิดท์จำกัด | เก็บวิดีโอ รูป เอกสาร | Cloudflare R2 (S3-compatible, ไม่มีค่า egress) อัปโหลดตรงจาก browser ด้วย presigned URL |
| ติดตั้ง Chromium/Playwright ไม่ได้ | scrape หน้าเว็บแบบ headless | ใช้ API ทางการเป็นหลัก, สำรองด้วย Apify |
| Request timeout ของ proxy (~60 วินาที) | งาน AI ยาว | งานยาวทั้งหมดเป็น async job, frontend poll สถานะ |
| จำกัดจำนวน connection MySQL ต่อ user | API ล่มเมื่อ traffic สูง | `DB_CONNECTION_LIMIT=5` (ปรับตามแพ็กเกจ) |
| ไม่มี Redis | rate limit/cache แบบกระจาย | rate limit แบบ in-memory ต่อ process (พอสำหรับโปรเซสเดียว) |

**เมื่อธุรกิจโตขึ้น:** ย้าย backend ไป VPS/Cloud Server (Atom มีให้) แล้วตั้ง `JOB_RUNNER=inprocess` + รันด้วย PM2 — โค้ดไม่ต้องแก้

## Troubleshooting

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| หน้า 502 / "Web application could not be started" | ดู log ที่ Node.js → **Logs** หรือไฟล์ `logs/` ของโดเมน; ส่วนใหญ่คือ env ไม่ครบ (แอปจะพิมพ์ชื่อตัวแปรที่ขาด) |
| `/api/health` ได้ `database: error` | ตรวจ `DB_NAME` (รวม prefix), `DB_USER`, `DB_HOST=localhost` |
| login สำเร็จแต่เด้งกลับหน้า login | `COOKIE_SECURE=true` แต่ใช้ http, หรือเรียก API ตรงโดยไม่ได้ตั้ง `COOKIE_DOMAIN` — ใช้ rewrite ของ Vercel ตามค่าเริ่มต้น |
| CORS error ใน console | เพิ่มโดเมน frontend ใน `CORS_ORIGINS` แล้ว Restart App |
| แก้โค้ดแล้วไม่เปลี่ยน | กด **Restart App** หลัง deploy ทุกครั้ง (หรือ `touch tmp/restart.txt` ในโฟลเดอร์ backend) |
| ลืมรหัส owner | บนเครื่องตัวเอง: `node scripts/hash-password.js 'NewPass123'` แล้ว `UPDATE users SET password_hash='<hash>', failed_login_count=0, locked_until=NULL WHERE email='...'` ใน phpMyAdmin |
