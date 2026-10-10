# POS Enterprise

ระบบบริหารร้านค้าแบบครบวงจรสำหรับองค์กร ครอบคลุม POS, สต๊อก, บัญชีและภาษี, Unified Inbox พร้อม AI ปิดการขาย, AI Video, ตั้งเวลาโพสต์ + Affiliate และ Smart Dashboard

| โปรเจกต์ | Stack | Deploy |
|---|---|---|
| [`frontend/`](frontend) | Next.js 16 · React 19 · Tailwind v4 · TanStack Query | **Vercel** |
| [`backend/`](backend) | Node.js 22 · Express 5 · MySQL | **Plesk (Atom Hosting)** |
| [`database/`](database) | `schema.sql` + `seed.sql` | import ผ่าน **phpMyAdmin** |

สองฝั่งเป็นโปรเจกต์อิสระ (ไม่มี shared code) และคุยกันผ่าน REST API เท่านั้น

## เอกสาร

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — สถาปัตยกรรม, auth ข้ามโดเมน, RBAC, roadmap
- [`docs/DEPLOY_PLESK.md`](docs/DEPLOY_PLESK.md) — deploy backend + MySQL บน Plesk, Scheduled Task, ข้อจำกัดของโฮสต์และทางออก
- [`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md) — deploy frontend บน Vercel, environment variables
- [`docs/API_KEYS.md`](docs/API_KEYS.md) — key ที่ต้องขอเอง, เหตุผลที่เลือกแต่ละบริการ, ข้อควรระวังด้าน ToS/PDPA

## รันบนเครื่อง (local)

ต้องมี Node.js 20.11+ และ MySQL 8 / MariaDB 10.6+

```bash
# 1) Database
mysql -u root -e "CREATE DATABASE pos_enterprise CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql -u root pos_enterprise < database/schema.sql
mysql -u root pos_enterprise < database/seed.sql

# 2) Backend  → http://localhost:4000/api/health
cd backend
cp .env.example .env        # แก้ DB_* ให้ตรงเครื่อง
npm install
npm run dev

# 3) Frontend → http://localhost:3000
cd ../frontend
cp .env.example .env.local  # BACKEND_URL=http://localhost:4000
npm install
npm run dev
```

เข้าสู่ระบบด้วย `admin@example.com` / `Admin@1234` (ระบบบังคับเปลี่ยนรหัสผ่านครั้งแรก) หรือบัญชีเดโมตามบทบาท `manager@`, `accountant@`, `cashier@`, `marketer@`, `support@`, `viewer@example.com` (รหัสผ่านเดียวกัน)

## ตรวจสอบคุณภาพ

```bash
cd backend  && npm run lint && npm test          # integration tests (ต้องมี DB ที่ import seed แล้ว)
cd frontend && npm run lint && npx tsc --noEmit && npm run build
```

สร้าง `seed.sql` ใหม่ (ข้อมูลเดโมใช้เวลาแบบ relative จึงแสดง "วันนี้" ถูกต้องเสมอ): `node database/tools/generate-seed.js`

## สถานะ

**เฟส 1 (ส่งมอบแล้ว):** โครงสร้างทั้งสองฝั่ง · schema ครบทุกโมดูล · auth + RBAC 8 บทบาท · จัดการผู้ใช้ · layout responsive + dark mode · Smart Dashboard · คิวงานเบื้องหลัง · adapter สำหรับ API ภายนอกทุกเจ้า · คู่มือ deploy

**เฟสถัดไป:** 2 สินค้า/สต๊อก/POS → 3 บัญชี/ภาษี → 4 Unified Inbox + AI → 5 Data Scraping → 6 AI Video → 7 Auto-post + Affiliate
