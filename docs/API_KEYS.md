# API keys และสิทธิ์ที่ต้องขอเอง

ทุกคีย์ตั้งเป็น environment variable ของ **backend บน Plesk** เท่านั้น (ห้ามใส่ใน Vercel/frontend) ดูสถานะได้ที่เมนู **ตั้งค่า → การเชื่อมต่อ API** (เห็นแค่ว่าตั้งแล้วหรือยัง ไม่แสดงค่าคีย์)
โค้ดเชื่อมต่อแต่ละเจ้าอยู่ใน `backend/src/integrations/<provider>.js` ทุกไฟล์มีโครงเดียวกัน (meta, `isConfigured()`, `requireConfig()`, method ของบริการนั้น) ถ้าจะเปลี่ยนผู้ให้บริการ ให้เขียน adapter ใหม่ไฟล์เดียว

> ⏱️ **เริ่มขอสิทธิ์ตั้งแต่วันนี้** — TikTok audit, Meta App Review และ Shopee Open Platform อาจใช้เวลาหลายวันถึงหลายสัปดาห์ และต้องมีเว็บไซต์ / privacy policy / วิดีโอสาธิตประกอบการขอ

## สรุป

| บริการ | ใช้ในโมดูล (เฟส) | ตัวแปร | ขอที่ | ต้องรอ review? |
|---|---|---|---|---|
| **Anthropic Claude API** | Inbox AI (4), บัญชี AI (3), สคริปต์วิดีโอ (6) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | console.anthropic.com | ไม่ |
| **TikTok for Developers** — Login Kit + Content Posting API | ตั้งเวลาโพสต์ (7) | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` | developers.tiktok.com | **ใช่** — ต้องผ่าน audit จึงโพสต์แบบ public ได้ |
| **TikTok Shop Partner** | สินค้า/ออร์เดอร์/แชต (2, 4, 5) | `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET` | partner.tiktokshop.com | ใช่ (ต้องเป็น seller/partner) |
| **Shopee Open Platform** | สต๊อก/ออร์เดอร์/แชต (2, 4) | `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_REDIRECT_URL` | open.shopee.com | ใช่ |
| **Shopee Affiliate Open API** | สินค้าเทรนด์ + affiliate link (5, 7) | `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_SECRET` | affiliate.shopee.co.th | ใช่ (ต้องเป็น affiliate ที่ได้รับอนุมัติ) |
| **Meta (Facebook/Instagram)** | แชต Messenger/IG (4), โพสต์ Reels (7) | `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | developers.facebook.com | **ใช่** — App Review + Business Verification |
| **LINE Messaging API** | แชต LINE OA (4) | `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` | developers.line.biz | ไม่ |
| **HeyGen** | AI avatar รีวิวสินค้า (6) | `HEYGEN_API_KEY` | app.heygen.com | ไม่ (ต้องมีแพ็กเกจ API) |
| **ElevenLabs** | เสียงพากย์ไทย + timestamp ซับ (6) | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | elevenlabs.io | ไม่ |
| **Shotstack** | ประกอบคลิป 9:16 + ซับ (6) | `SHOTSTACK_API_KEY`, `SHOTSTACK_ENV` | shotstack.io | ไม่ (`stage` ฟรี มีลายน้ำ) |
| **Cloudflare R2** | เก็บไฟล์ทั้งหมด (2–7) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | dash.cloudflare.com | ไม่ |
| **Apify** (สำรอง) | scrape หน้าเว็บที่ไม่มี API (5) | `APIFY_TOKEN` | apify.com | ไม่ |

## เหตุผลที่เลือกแต่ละบริการ

- **Claude (Anthropic)** — สำหรับแชตขายของภาษาไทยที่ต้องเป็นธรรมชาติและต้องเรียกเครื่องมือ (ค้นสินค้า, เช็กสต๊อก, ออกคูปองภายในเพดาน) ได้แม่นยำ ค่าเริ่มต้นใช้ `claude-opus-5-5` ซึ่งเปลี่ยนได้ทาง `ANTHROPIC_MODEL` adapter เปิด **server-side refusal fallback** (`fallbacks: "default"`) ไว้ ถ้าโมเดลปฏิเสธคำขอ ลูกค้าจะยังได้คำตอบจากโมเดลสำรองในการเรียกครั้งเดียวกัน
- **ฐานความรู้สินค้า** — ใช้ MySQL FULLTEXT บนตาราง `products` + `product_knowledge` แล้วส่งผลค้นหาเข้า prompt ไม่ต้องมี vector database เพิ่ม ซึ่งรันบน shared hosting ได้ และอัปเกรดเป็น embeddings ภายหลังได้
- **HeyGen + ElevenLabs + Shotstack** — แยกหน้าที่ (avatar / เสียง / ประกอบคลิป) ทำให้เปลี่ยนทีละส่วนได้ ทั้งหมดเรนเดอร์บนคลาวด์ จึงไม่ต้องใช้ ffmpeg/GPU บน Plesk ส่วน ElevenLabs ให้ timestamp ระดับตัวอักษร จึงทำซับไตเติลไทยได้ตรงจังหวะ
- **Cloudflare R2** — ไม่มีค่า egress เหมาะกับวิดีโอที่ต้องให้ TikTok/Meta ดึงไฟล์ไป (`PULL_FROM_URL`) และอัปโหลดตรงจาก browser ได้โดยไม่ผ่านโฮสต์
- **Shopee/TikTok official API ก่อน scraping** — เสถียรกว่า ไม่ผิดข้อตกลง และไม่โดนบล็อก

## ข้อควรระวังด้านข้อกำหนดการใช้งาน

**Scraping**
- ข้อตกลงการใช้งานของ Shopee และ TikTok **ห้าม** scrape ด้วยบอทโดยไม่ได้รับอนุญาต และทั้งสองแพลตฟอร์มมีระบบ anti-bot ที่อาจแบนบัญชี/IP ได้ ระบบนี้จึงใช้ **API ทางการเป็นหลัก** (Affiliate API, Shop API)
- Apify/HTTP fetch มีไว้เป็นทางเลือกสำหรับเว็บที่อนุญาตเท่านั้น เคารพ `robots.txt`, rate limit และอย่าเก็บข้อมูลส่วนบุคคลของผู้ขาย/ผู้ซื้อ

**TikTok Content Posting API**
- ก่อนผ่าน audit โพสต์ได้เฉพาะแบบ `SELF_ONLY` (ส่วนตัว)
- ต้องเรียก `creator_info/query` ก่อนโพสต์ทุกครั้ง และ UI ต้องให้ผู้ใช้เลือก privacy ได้เอง
- คลิปที่สร้างด้วย AI ต้องติดป้าย AI-generated content (มี field `is_ai_generated` ใน `scheduled_posts`)
- `PULL_FROM_URL` ต้องใช้โดเมนที่ verify กับ TikTok แล้ว (เช่น custom domain ของ R2)

**Meta (Messenger / Instagram)**
- ตอบลูกค้าได้ภายใน **24 ชั่วโมง** หลังข้อความล่าสุดของลูกค้า (standard messaging window) นอกช่วงนี้ต้องใช้ message tag ที่ถูกประเภท ห้ามใช้ส่งโปรโมชัน (ระบบเก็บ `last_customer_message_at` ไว้ตรวจ)
- ต้องเปิดเผยว่าผู้ตอบเป็น AI เมื่อเหมาะสม และมีทางส่งต่อให้คนจริง (ระบบมี `handoff_keywords` + mode `human`)
- สิทธิ์ที่ต้องขอ: `pages_messaging`, `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_messages`, `instagram_content_publish`

**Affiliate**
- ต้องเปิดเผยว่าเป็นลิงก์ affiliate ในโพสต์ตามแนวทางของ สคบ./แพลตฟอร์ม
- Shopee Affiliate ห้ามใช้ลิงก์กับโฆษณาแบบ keyword bidding ของ Shopee เอง และห้ามสร้างคำสั่งซื้อปลอม

**ข้อมูลส่วนบุคคล (PDPA)**
- ข้อมูลแชตและลูกค้าเป็นข้อมูลส่วนบุคคล ต้องมีนโยบายความเป็นส่วนตัว และเก็บความยินยอมก่อนส่งการตลาด (`customers.consent_marketing`)
- การส่งบทสนทนาไปประมวลผลที่ผู้ให้บริการ AI ต่างประเทศ ควรระบุไว้ในนโยบายความเป็นส่วนตัว

**ภาษี**
- แบบ ภ.พ.30 / ภ.ง.ด.3/53 ที่ระบบสร้างเป็นร่างเพื่อช่วยงาน ควรให้ผู้ทำบัญชีตรวจทานก่อนยื่น
