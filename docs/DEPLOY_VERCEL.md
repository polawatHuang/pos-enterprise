# Deploy Frontend บน Vercel

## ขั้นตอน

1. Vercel → **Add New → Project** → Import repo `pos-enterprise`
2. **Root Directory:** `frontend` ← สำคัญ (repo มีทั้ง frontend และ backend)
3. Framework Preset: Next.js (ตรวจจับอัตโนมัติ) · Build Command / Output ใช้ค่าเริ่มต้น
4. **Environment Variables** (ตั้งทั้ง *Production* และ *Preview*):

| ตัวแปร | ค่า | หมายเหตุ |
|---|---|---|
| `BACKEND_URL` | `https://api.example.com` | origin ของ backend บน Plesk ไม่มี `/` ท้าย |
| `NEXT_PUBLIC_API_URL` | *(เว้นว่าง)* | ใช้เฉพาะ "direct mode" ด้านล่าง |

5. **Deploy** → เปิด `https://<project>.vercel.app/api/health` ต้องเห็น JSON จาก backend (แปลว่า rewrite ทำงาน)
6. ไปที่ backend (Plesk) เพิ่มโดเมนนี้ใน `CORS_ORIGINS` แล้ว Restart App

> `BACKEND_URL` ถูกอ่านตอน build (อยู่ใน `rewrites()` ของ `next.config.ts`) — เปลี่ยนค่าแล้วต้อง **Redeploy**

## ทำไมใช้ rewrite แทนการเรียก API ข้ามโดเมนตรงๆ

Browser สมัยใหม่ (Safari ITP, Chrome) บล็อก **third-party cookie** ถ้าหน้าเว็บอยู่ที่ `*.vercel.app` แต่ cookie มาจาก `api.example.com` การ login ด้วย httpOnly cookie จะพังแบบสุ่มตาม browser

วิธีที่ใช้: browser เรียก `/api/*` บนโดเมน Vercel เดียวกัน → `next.config.ts` rewrite ไปที่ `BACKEND_URL` → cookie ที่ backend ตั้ง (ไม่มี `Domain`) จึงเป็น **first-party** ของโดเมน frontend ทุก browser รองรับ และยังเป็น REST API ล้วนๆ

```
Browser ── POST https://app.vercel.app/api/auth/login ──► Vercel edge ──► https://api.example.com/api/auth/login
        ◄── Set-Cookie: pe_at, pe_rt (HttpOnly, Secure, SameSite=Lax) ─────────┘
```

## Direct mode (ทางเลือก, ใช้ custom domain)

ถ้าใช้ `app.example.com` (Vercel) + `api.example.com` (Plesk) ซึ่งเป็น *same-site* กัน:
- Frontend: `NEXT_PUBLIC_API_URL=https://api.example.com`
- Backend: `COOKIE_DOMAIN=.example.com`, `COOKIE_SAMESITE=lax`, `CORS_ORIGINS=https://app.example.com`

ข้อดี: ลด hop หนึ่งชั้น · ข้อเสีย: preview deployment (`*.vercel.app`) จะ login ไม่ได้ — โดยทั่วไปแนะนำ rewrite mode

## Custom domain

Vercel → Project → **Settings → Domains** → เพิ่ม `app.example.com` แล้วตั้ง CNAME ตามที่ Vercel แจ้ง อย่าลืมเพิ่มโดเมนใหม่ใน `CORS_ORIGINS` ของ backend

## Checklist ก่อนขึ้น production

- [ ] เปลี่ยนรหัสผ่าน owner แล้ว และลบ/ระงับบัญชีเดโม
- [ ] `JWT_ACCESS_SECRET`, `CRON_SECRET`, `APP_ENCRYPTION_KEY` เป็นค่าสุ่มใหม่ (ไม่ใช้ค่าจากตัวอย่าง)
- [ ] backend เป็น HTTPS และ `COOKIE_SECURE=true`
- [ ] Scheduled Task ทำงาน (ดู Last run ใน Plesk)
- [ ] `/api/health` ผ่านทั้งจาก `api.example.com` และ `<vercel-domain>/api/health`
