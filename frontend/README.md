# POSWITHAI — Frontend (Next.js 16)

Deploy บน **Vercel** · ดูคู่มือเต็มที่ [`../docs/DEPLOY_VERCEL.md`](../docs/DEPLOY_VERCEL.md)

```bash
cp .env.example .env.local      # BACKEND_URL=http://localhost:4000
npm install
npm run dev                     # http://localhost:3000
npm run lint && npm run build   # ตรวจก่อน push
```

## โครงสร้าง

```
src/
  app/(auth)/login          หน้าเข้าสู่ระบบ
  app/(app)/                ทุกหน้าที่ต้อง login (AppShell + AuthProvider)
    dashboard/              Smart Dashboard
    settings/{users,integrations,account,appearance,reports}
    pos, products, inventory, accounting, inbox, trends, videos, social   ← โมดูลเฟสถัดไป
  proxy.ts                  route guard (Next 16 ใช้ proxy.ts แทน middleware.ts)
  lib/api.ts                REST client: same-origin /api + auto refresh token
  config/nav.ts             เมนู + permission ของแต่ละหน้า (เพิ่มโมดูลใหม่ที่นี่)
  config/appearance.ts      ตัวเลือกสีธีมและคีย์บันทึกการแสดงผล
  components/ui             UI primitives (Radix + Tailwind v4)
```

หมายเหตุ Next 16: เปิด `cacheComponents` + `partialPrefetching` ไว้ (ค่าเริ่มต้นของ create-next-app 16.4) และหน้าต่างๆ ถูกเก็บไว้ด้วย React `<Activity>` ตอนเปลี่ยนหน้า จึงใช้ full reload ตอน logout เพื่อล้าง state ทั้งหมด

หน้าแอปออกแบบให้ใช้งานบนมือถือได้: เมนูหลักเปิดเป็น drawer, ตารางที่ใช้ `table-cards` จะแสดงเป็นรายการการ์ดบนหน้าจอเล็ก และแถบคำสั่งที่ติดขอบจอรองรับ safe area ของอุปกรณ์
