# สถาปัตยกรรม

## องค์ประกอบ

| ส่วน | เทคโนโลยี | โฮสต์ | เหตุผล |
|---|---|---|---|
| Frontend | Next.js 16 (App Router, React 19), TypeScript, Tailwind CSS v4, Radix UI, TanStack Query, Recharts, react-hook-form + zod | Vercel | Next 16 deploy บน Vercel ได้ทันที · Radix ให้ UI ที่เข้าถึงได้ (a11y) โดยไม่ผูกกับ design ใด · TanStack Query จัดการ cache/refetch ของ dashboard |
| Backend | Node.js 22, Express 5 (CommonJS), mysql2, zod, jsonwebtoken, bcryptjs, helmet, pino | Plesk (Atom Hosting) | CommonJS + `app.js` เข้ากับ Passenger ของ Plesk ตรงๆ · ใช้แต่ dependency ที่เป็น pure JS (ไม่ต้อง compile native module บน shared host) |
| Database | MySQL 8 / MariaDB 10.6+ | Plesk + phpMyAdmin | schema เป็นไฟล์ SQL ล้วน import ผ่าน phpMyAdmin ได้ ไม่ต้องใช้ ORM/migration tool บนเซิร์ฟเวอร์ |
| คิวงาน | ตาราง `jobs` + Plesk Scheduled Task | Plesk | ไม่มี Redis/worker ถาวรบน shared hosting |
| ไฟล์ | Cloudflare R2 | Cloudflare | ไม่มีค่า egress, รองรับ presigned upload |

## การสื่อสารและ authentication

```
[Browser] --same-origin /api/*--> [Vercel: next.config rewrites] --HTTPS--> [Plesk: Express /api/*] --> [MySQL]
```

- **Access token:** JWT อายุ 15 นาที (httpOnly cookie `pe_at`, หรือ `Authorization: Bearer` สำหรับ client อื่น) เก็บ roles/permissions ไว้ใน token จึงไม่ต้องค้น DB ทุก request
- **Refresh token:** สุ่ม 48 ไบต์ เก็บเป็น SHA-256 ใน `refresh_tokens` (httpOnly cookie `pe_rt`, path `/api/auth`) หมุนทุกครั้งที่ใช้ ถ้ามีการใช้ token เก่าซ้ำ (บ่งชี้ว่าถูกขโมย) จะยกเลิกทั้ง family
- **`pe_session`:** cookie บอกใบ้ (ไม่มีความลับ) ให้ `proxy.ts` ของ Next ใช้ redirect ไปหน้า login การตรวจสิทธิ์จริงทำที่ backend ทุก request
- **ป้องกัน brute force:** rate limit ที่ `/auth/login` + ล็อกบัญชี 15 นาทีหลังใส่ผิด 5 ครั้ง
- **เปลี่ยนรหัสผ่าน / ระงับผู้ใช้:** revoke refresh token ทั้งหมดของผู้ใช้ทันที
- **CORS:** allow-list จาก `CORS_ORIGINS` (รองรับ wildcard `https://*-team.vercel.app`) ใช้เมื่อ browser เรียก API ตรง (direct mode)

## RBAC

`roles` ←→ `role_permissions` ←→ `permissions` (`module:action`) · ผู้ใช้มีได้หลายบทบาท

| บทบาท | ใช้กับ |
|---|---|
| owner / admin | ทุกสิทธิ์ (เฉพาะ owner จัดการบัญชี owner ได้) |
| manager | ขาย สต๊อก การตลาด แชต ดูบัญชี |
| accountant | บัญชี เอกสาร ภาษี |
| cashier | POS |
| marketer | วิดีโอ AI โพสต์ สินค้าเทรนด์ |
| support | แชตลูกค้า คืนสินค้า |
| viewer | ดูอย่างเดียว |

- Backend: `requirePermission('inventory:write')` ทุก route
- Frontend: เมนูกรองตาม permission (`config/nav.ts`) + `<RequirePermission>` ทุกหน้า + หน้าแรกหลัง login เลือกตามสิทธิ์

## โครงสร้างโมดูล (เพิ่มโมดูลใหม่ตามแบบนี้)

```
backend/src/modules/<module>/
  <module>.routes.js      # Express router + zod validation + requirePermission
  <module>.service.js     # business logic (เมื่อซับซ้อน)
  <module>.repo.js        # SQL
backend/src/integrations/<provider>.js   # adapter ของบริการภายนอก
backend/src/jobs/handlers/index.js       # ลงทะเบียน job type ใหม่
frontend/src/app/(app)/<module>/page.tsx
frontend/src/config/nav.ts               # เพิ่มเมนู + permission
```

ในเฟส 1 โมดูลที่ยังไม่ทำจะใช้ `moduleStub()` ซึ่งตอบ `501 NOT_IMPLEMENTED` แต่ผ่าน auth/RBAC แล้ว URL และสิทธิ์จึงคงที่ตั้งแต่วันแรก

## ข้อตกลงของ API

- สำเร็จ: `{ "data": ... }` (+ `meta` สำหรับรายการที่แบ่งหน้า)
- ผิดพลาด: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }`
- เวลาเก็บเป็น UTC ทั้งหมด รายงานรายวัน/รายเดือนแปลงเป็นเวลาไทยด้วย `APP_TZ_OFFSET` (ใช้ `CONVERT_TZ` แบบ offset จึงไม่ต้องมี timezone table ของ MySQL)
- เงิน: `DECIMAL(14,2)`, ราคาขายรวม VAT, กำไรขั้นต้น = ยอดรวม − ค่าส่ง − VAT − ต้นทุน − ค่าธรรมเนียมแพลตฟอร์ม

## Smart Dashboard API

| Endpoint | ข้อมูล |
|---|---|
| `GET /api/dashboard/summary?branchId=` | KPI วันนี้/เดือนนี้ (เทียบช่วงเดียวกันก่อนหน้า), แชต, สต๊อกต่ำ, โพสต์, วิดีโอ, กำไรสุทธิ |
| `GET /api/dashboard/sales-trend?days=7\|30\|90` | ยอดขาย/ออร์เดอร์/กำไรรายวัน (เติมวันที่ไม่มีขายเป็น 0) |
| `GET /api/dashboard/channel-mix?days=` | สัดส่วนยอดขายตามช่องทาง |
| `GET /api/dashboard/top-products?days=&limit=` | สินค้าขายดี |
| `GET /api/dashboard/cashflow?months=` | รายรับ–รายจ่ายรายเดือน |
| `GET /api/dashboard/low-stock` · `/inbox` · `/trending` · `/activity` | แผงสรุปจากแต่ละโมดูล |

## สินค้า สต๊อก และ POS (เฟส 2)

**ความถูกต้องของสต๊อก:** ทุกการเปลี่ยนแปลงสต๊อก (ขาย, รับเข้า, ปรับยอด, โอน, ยกเลิกบิล) ผ่านฟังก์ชันเดียว `applyMovement()` ใน `backend/src/modules/inventory/inventory.service.js` ซึ่งล็อกแถว `stock_levels` ด้วย `SELECT ... FOR UPDATE` ภายใน transaction และบันทึก `stock_movements` ทุกครั้ง POS หลายเครื่องจึงขายสินค้าชิ้นเดียวกันพร้อมกันได้โดยไม่ขายเกินสต๊อก ถ้ารายการใดในบิลสต๊อกไม่พอ ทั้งบิลจะ rollback

**ราคาและภาษี:** ราคาขายรวม VAT (แบบร้านค้าปลีกไทย) และ server คำนวณราคาจากฐานข้อมูลทุกครั้ง (ไม่เชื่อราคาจาก client) VAT ถอดจากเฉพาะสินค้า `vat7` หลังกระจายส่วนลดท้ายบิลตามสัดส่วน ต้นทุนใช้แบบถัวเฉลี่ยเคลื่อนที่ (moving average) เมื่อรับสินค้าเข้า

**การควบคุมแคชเชียร์:** ต้องเปิดกะก่อนขาย · การแก้ราคาและส่วนลดเกิน `pos.max_discount_pct` (ค่าเริ่มต้น 20%) ต้องมีสิทธิ์ `pos:manage` · การยกเลิกบิลต้องมีสิทธิ์ `pos:manage` และระบบจะคืนสต๊อกพร้อมบันทึกยอดเงินติดลบ · ตอนปิดกะระบบคำนวณเงินสดที่ควรมี (เงินทอนเริ่มต้น + เงินสดรับ − เงินสดคืน) แล้วเทียบกับยอดที่นับได้

**PromptPay:** `backend/src/utils/promptpay.js` สร้าง payload ตามมาตรฐาน EMVCo/ธปท. (CRC16-CCITT) พร้อมยอดเงิน แล้ว frontend แสดงเป็น QR ตั้งหมายเลขได้ที่ปุ่ม "ตั้งค่า POS" (ผู้จัดการ)

| Endpoint | สิทธิ์ |
|---|---|
| `GET/POST/PATCH /api/products`, `/api/products/:id`, `/api/products/categories`, `/api/products/:id/knowledge` | `products:read` / `products:write` |
| `GET /api/inventory/{warehouses,levels,movements,suppliers}` | `inventory:read` |
| `POST /api/inventory/{receive,adjust,transfer}` | `inventory:write` |
| `GET /api/pos/{catalog,lookup,settings,promptpay,shift,orders,orders/:id}`, `POST /api/pos/{shift/open,shift/close,checkout}` | `pos:sell` |
| `PUT /api/pos/settings`, `POST /api/pos/orders/:id/void` | `pos:manage` |

## Roadmap

| เฟส | โมดูล | เหตุผลของลำดับ |
|---|---|---|
| 1 ✅ | รากฐาน: โครงสองโปรเจกต์, schema ครบทุกโมดูล, auth + RBAC, layout, Smart Dashboard, คู่มือ deploy | ทุกโมดูลใช้ร่วมกัน |
| 2 ✅ | สินค้า + สต๊อก + POS | สินค้าเป็นข้อมูลกลางของทุกโมดูล (AI ใช้เป็นฐานความรู้, วิดีโอใช้เป็นวัตถุดิบ) |
| 3 | บัญชี + เอกสาร + ภาษี + AI อ่านใบเสร็จ + R2 | รับข้อมูลขายจากเฟส 2 ไปลงบัญชีอัตโนมัติ |
| 4 | Unified Inbox + AI Agent + Return/Dispute | ต้องมีสินค้า สต๊อก ออร์เดอร์ และคูปองให้ AI ใช้ |
| 5 | Data Scraping / สินค้าเทรนด์ | ป้อนสินค้าให้การทำคอนเทนต์ |
| 6 | AI Video | ใช้สินค้าจากเฟส 2/5 |
| 7 | Auto-post + Affiliate | ใช้วิดีโอจากเฟส 6 + ลิงก์จากเฟส 5 |
