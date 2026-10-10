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

## บัญชี เอกสาร และภาษี (เฟส 3)

**บัญชีคู่อัตโนมัติ:** ทุกธุรกรรมลงบัญชีผ่าน `postJournal()` ใน `backend/src/modules/accounting/ledger.service.js` ภายใน transaction เดียวกับธุรกรรมต้นทาง ระบบตรวจว่าเดบิตเท่ากับเครดิตทุกครั้ง การยกเลิกจะไม่ลบรายการเดิม แต่สร้างรายการกลับ (reversal) ที่ลงวันที่เดียวกับรายการเดิม ยอดที่ยกเลิกจึงหายไปจากงบของงวดนั้นอย่างถูกต้อง และยังตรวจย้อนหลัง (audit) ได้

| ธุรกรรม | เดบิต | เครดิต |
|---|---|---|
| ขาย POS | 1100 เงินสด / 1110 ธนาคาร, 5100 ต้นทุนขาย | 4100 รายได้ขาย, 2200 ภาษีขาย, 1300 สินค้าคงเหลือ |
| รายจ่าย (VAT + หัก ณ ที่จ่าย) | ค่าใช้จ่ายตามหมวด, 1400 ภาษีซื้อ | 1110/1100 (ยอดจ่ายจริง), 2210 ภาษีหัก ณ ที่จ่ายค้างจ่าย |
| รายรับอื่น | 1110/1100, 1410 ภาษีถูกหัก ณ ที่จ่าย | รายได้ตามหมวด, 2200 ภาษีขาย |
| ออกใบแจ้งหนี้/ใบกำกับภาษี | 1200 ลูกหนี้ | 4100, 2200 |
| รับชำระ | 1110/1100 | 1200 |
| ใบกำกับภาษี/ใบเสร็จ (ขายสด) | 1110/1100 | 4100, 2200 |
| ใบลดหนี้ | 4100, 2200 | 1200 |

**เลขที่เอกสาร:** รันต่อเนื่องแยกตามประเภทและเดือน (`TI202610-0001`) ด้วยคำสั่ง upsert แบบ atomic บนตาราง `document_sequences` เลขที่จะไม่ซ้ำแม้ออกพร้อมกันหลายคน ฉบับร่างยังไม่ได้เลขที่ เอกสารที่ออกแล้วแก้ไขไม่ได้ ต้องยกเลิก (เลขที่ยังอยู่พร้อมสถานะยกเลิก) แล้วออกใหม่ เพื่อไม่ให้เลขขาดช่วงตามหลักของกรมสรรพากร

**ราคา:** เอกสาร B2B ใช้ราคาก่อน VAT ส่วน POS ใช้ราคารวม VAT (เมื่อดึงสินค้าลงเอกสาร ระบบถอด VAT ให้อัตโนมัติ) ภาษีหัก ณ ที่จ่ายคำนวณจากฐานก่อน VAT เสมอ

**ภาษี:** ภ.พ.30 = ภาษีขาย (ออร์เดอร์ทุกช่องทาง + ใบกำกับภาษีที่ออก + รายได้อื่นที่มี VAT − ใบลดหนี้) − ภาษีซื้อ (เฉพาะรายจ่ายที่มีใบกำกับเต็มรูป) ส่วน ภ.ง.ด.3 และ 53 แยกตามประเภทผู้ถูกหัก (บุคคลธรรมดา/นิติบุคคล) ส่งออก CSV (UTF-8 BOM, ป้องกัน formula injection) และบันทึกสถานะการยื่นพร้อม snapshot ตัวเลขใน `tax_reports`

**เอกสารพิมพ์:** หน้าเอกสาร A4 พิมพ์หรือบันทึกเป็น PDF ผ่านเบราว์เซอร์ (`@page a4`) ภาษาไทยแสดงถูกต้องแน่นอนกว่าการสร้าง PDF บนเซิร์ฟเวอร์ และไม่ใช้ทรัพยากรของ Plesk

**AI อ่านใบเสร็จ:** `POST /api/accounting/ai/extract-receipt`
- ส่งรูปที่ย่อฝั่ง browser ให้ไม่เกิน 2000px ไปที่ AI ผ่าน `ai.extractStructured()`
  - MiniMax: บังคับให้ตอบผ่าน tool
  - Claude: ใช้ JSON schema
- ผลที่ได้ใช้กรอกฟอร์มให้ผู้ใช้ตรวจก่อน ระบบไม่บันทึกเอง
- ถ้ายังไม่ได้ตั้ง key ของผู้ให้บริการ AI ที่เลือกไว้ จะตอบ 503 และให้ผู้ใช้กรอกเอง

## AI provider

ฟีเจอร์ AI ทุกตัวเรียกผ่าน `backend/src/integrations/ai.js`
- ค่าเริ่มต้นคือ `AI_PROVIDER=minimax` ใช้ Anthropic-compatible endpoint ของ MiniMax
- ตั้ง `anthropic` เพื่อใช้ Claude แทนได้
- ทั้งสองเจ้าใช้รูปแบบ Messages API เดียวกัน (รวมถึง tool use) agent loop และรูปแบบข้อความจึงใช้โค้ดชุดเดียว
- ความต่างของแต่ละเจ้า (structured output, การรองรับ PDF) ถูกเก็บไว้ใน `capabilities` ของ adapter

## Unified Inbox + AI Agent (เฟส 4)

```
LINE / Messenger / IG ──webhook (ตรวจ HMAC จาก raw body)──► /webhooks/{line,meta}
        │ ตอบ 200 ทันที
        ▼
ingestInbound()  (idempotent ด้วย external_message_id, สร้างลูกค้า + แชต)
        │
        ├─ ตอบทันทีใน process เดิม (LINE reply token มีอายุ ~1 นาที)
        └─ คิวงาน inbox.ai_reply สำรองที่ +90 วินาที (กรณี Passenger recycle)
                 │
                 ▼
replyToConversation()  ── claim lock (ai_lock_until) กันตอบซ้ำ
   ├─ ข้ามถ้าโหมด human / ข้อความล่าสุดไม่ใช่ของลูกค้า
   ├─ คำสำคัญส่งต่อ (handoff_keywords) → ส่งให้แอดมินทันที
   ├─ system prompt: บุคลิก + กฎการขาย + เพดานส่วนลด + ฐานความรู้ร้าน
   └─ tool loop ≤ 6 รอบ: search_products · get_product_details · lookup_orders ·
      create_discount_code · open_return_request · escalate_to_human
```

**ขอบเขตของ AI**

- ทุก tool ถูกจำกัดให้ใช้ได้แค่ร้านและลูกค้าของแชตนั้น
- ส่วนลดไม่เกินเพดาน: AI ออกโค้ดใช้ครั้งเดียว อายุ 14 วัน ได้ 1 ครั้งต่อแชต
- ส่วนลดเกินเพดาน: บันทึกเป็น `ai_offers` สถานะ `needs_approval` ให้ผู้จัดการอนุมัติที่หน้า **คืนสินค้า & ข้อเสนอ**
- AI ไม่เห็นข้อมูลส่วนบุคคลจากออร์เดอร์

**แอดมินกับ AI**

- เมื่อแอดมินพิมพ์ตอบ แชตนั้นจะเปลี่ยนเป็นโหมด human และ AI หยุดตอบ จนกว่าจะกด "ให้ AI ตอบ"
- หน้า Inbox ดึงข้อมูลใหม่ทุก 5 วินาที (polling) เพราะ shared hosting ทำ WebSocket ค้างไว้ไม่ได้

**ข้อจำกัดของแต่ละแพลตฟอร์ม**

- Meta: ตอบได้ภายใน 24 ชั่วโมงหลังข้อความล่าสุดของลูกค้าเท่านั้น ถ้าเกิน ระบบบันทึกข้อความเป็น "ส่งไม่สำเร็จ" แทนการส่ง
- LINE: ใช้ reply token ก่อน ถ้าหมดอายุจึงใช้ push

**การทดสอบ:** หน้า **ตั้งค่า AI แชต → ทดลองคุย** ให้คุยกับ AI ในฐานะลูกค้าผ่านช่องทาง website ภายใน ไม่ต้องมี key ของแพลตฟอร์มแชต

## Roadmap

| เฟส | โมดูล | เหตุผลของลำดับ |
|---|---|---|
| 1 ✅ | รากฐาน: โครงสองโปรเจกต์, schema ครบทุกโมดูล, auth + RBAC, layout, Smart Dashboard, คู่มือ deploy | ทุกโมดูลใช้ร่วมกัน |
| 2 ✅ | สินค้า + สต๊อก + POS | สินค้าเป็นข้อมูลกลางของทุกโมดูล (AI ใช้เป็นฐานความรู้, วิดีโอใช้เป็นวัตถุดิบ) |
| 3 ✅ | บัญชี + เอกสาร + ภาษี + AI อ่านใบเสร็จ | รับข้อมูลขายจากเฟส 2 ไปลงบัญชีอัตโนมัติ |
| 4 ✅ | Unified Inbox + AI Agent + Return/Dispute | ต้องมีสินค้า สต๊อก ออร์เดอร์ และคูปองให้ AI ใช้ |
| 5 | Data Scraping / สินค้าเทรนด์ | ป้อนสินค้าให้การทำคอนเทนต์ |
| 6 | AI Video | ใช้สินค้าจากเฟส 2/5 |
| 7 | Auto-post + Affiliate | ใช้วิดีโอจากเฟส 6 + ลิงก์จากเฟส 5 |
