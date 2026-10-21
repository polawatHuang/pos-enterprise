# API keys และสิทธิ์ที่ต้องขอเอง

ทุกคีย์อยู่ฝั่ง **backend** เท่านั้น (ห้ามใส่ใน Vercel/frontend) ตั้งได้จากเมนู **ตั้งค่า → การเชื่อมต่อ API** หรือเป็น environment variable บน Plesk (ดูหัวข้อถัดไป)
โค้ดเชื่อมต่อแต่ละเจ้าอยู่ใน `backend/src/integrations/<provider>.js` ทุกไฟล์มีโครงเดียวกัน (meta, `isConfigured()`, `requireConfig()`, method ของบริการนั้น) ถ้าจะเปลี่ยนผู้ให้บริการ ให้เขียน adapter ใหม่ไฟล์เดียว

> ⏱️ **เริ่มขอสิทธิ์ตั้งแต่วันนี้** — TikTok audit, Meta App Review และ Shopee Open Platform อาจใช้เวลาหลายวันถึงหลายสัปดาห์ และต้องมีเว็บไซต์ / privacy policy / วิดีโอสาธิตประกอบการขอ

## ตั้งคีย์จากหน้าเว็บ หรือจาก .env

ตั้งได้ 2 ทาง ระบบเลือกค่าตามลำดับนี้
1. **หน้า ตั้งค่า → การเชื่อมต่อ API → ปุ่ม "ตั้งค่า"** ของแต่ละบริการ
   - ค่าที่บันทึกตรงนี้ใช้ก่อน และมีผลทันทีโดยไม่ต้อง Restart App
   - เก็บในตาราง `app_config` แบบเข้ารหัส (AES-256-GCM ด้วย `APP_ENCRYPTION_KEY`)
   - ระบบแสดงแค่ 4 ตัวท้ายของคีย์
2. **Environment variables** บน Plesk (หรือ `backend/.env`) เป็นค่าเริ่มต้น เมื่อไม่ได้ตั้งจากหน้าเว็บ
   - กด "ใช้ค่าจาก .env" ในหน้าเว็บเพื่อลบค่าที่บันทึกไว้และกลับไปใช้ค่านี้

ข้อควรรู้
- ต้องตั้ง `APP_ENCRYPTION_KEY` ก่อน และ**ห้ามเปลี่ยนค่า** ไม่อย่างนั้นคีย์ที่บันทึกไว้จะถอดรหัสไม่ได้ ต้องกรอกใหม่
- แก้จากหน้าเว็บได้เฉพาะคีย์ของบริการในหน้านี้ (และ `AI_PROVIDER`)
  - ค่าของระบบ เช่น `DB_*`, `JWT_ACCESS_SECRET`, `CRON_SECRET`, `APP_ENCRYPTION_KEY` ตั้งได้บนเซิร์ฟเวอร์เท่านั้น
- ทุกการแก้ไขถูกบันทึกใน audit log (เก็บแค่ชื่อคีย์ ไม่เก็บค่า)
- ใช้สิทธิ์ `integrations:manage` (owner ตามค่าเริ่มต้น)

## สรุป

| บริการ | ใช้ในโมดูล (เฟส) | ตัวแปร | ขอที่ | ต้องรอ review? |
|---|---|---|---|---|
| **MiniMax API** (ค่าเริ่มต้นของ AI ทุกส่วน) | AI แชตปิดการขาย (4), AI อ่านใบเสร็จ (3), สคริปต์/เสียง/วิดีโอ (6), AI ค้นหาสินค้าขายดี (ค้นเว็บ, 5), AI ปกคลิป (สร้างภาพ `image-01`) | `MINIMAX_API_KEY`, `MINIMAX_MODEL`, `MINIMAX_BASE_URL` (`AI_PROVIDER=minimax`) | platform.minimax.io | ไม่ |
| Anthropic Claude API (ทางเลือก) | ใช้แทน MiniMax ได้ทุกจุดเมื่อตั้ง `AI_PROVIDER=anthropic` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | console.anthropic.com | ไม่ |
| **TikTok for Developers** — Login Kit + Content Posting API | ตั้งเวลาโพสต์ (7) | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` | developers.tiktok.com | **ใช่** — ต้องผ่าน audit จึงโพสต์แบบ public ได้ |
| **TikTok Shop Partner** | สินค้า/ออร์เดอร์/แชต (2, 4, 5) | `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET` | partner.tiktokshop.com | ใช่ (ต้องเป็น seller/partner) |
| **Shopee Open Platform** | สต๊อก/ออร์เดอร์/แชต (2, 4) | `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_REDIRECT_URL` | open.shopee.com | ใช่ |
| **Shopee Affiliate Open API** | สินค้าเทรนด์ + affiliate link (5, 7) | `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_SECRET` | affiliate.shopee.co.th | ใช่ (ต้องเป็น affiliate ที่ได้รับอนุมัติ) |
| **Meta (Facebook/Instagram)** | แชต Messenger/IG (4), โพสต์ Reels (7) | `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_REDIRECT_URI` (+ Page access token ต่อเพจ ใส่ในหน้า ตั้งค่า AI แชต หรือ `META_PAGE_ACCESS_TOKEN`) | developers.facebook.com | **ใช่** — App Review + Business Verification |
| **LINE Messaging API** | แชต LINE OA (4) | `LINE_CHANNEL_SECRET` (+ Channel access token ใส่ในหน้า ตั้งค่า AI แชต หรือ `LINE_CHANNEL_ACCESS_TOKEN`) | developers.line.biz | ไม่ |
| HeyGen (ทางเลือกในอนาคต) | AI avatar รีวิวสินค้า (ยังไม่ได้เชื่อม) | `HEYGEN_API_KEY` | app.heygen.com | ไม่ (ต้องมีแพ็กเกจ API) |
| ElevenLabs (ทางเลือก) | เสียงพากย์แทน MiniMax (6) — ต้องมี R2 | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | elevenlabs.io | ไม่ |
| **Shotstack** | ประกอบคลิป 9:16 + ซับ (6) | `SHOTSTACK_API_KEY`, `SHOTSTACK_ENV` | shotstack.io | ไม่ (`stage` ฟรี มีลายน้ำ) |
| **Cloudflare R2** | เก็บไฟล์วิดีโอ/เสียงถาวร (6–7) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | dash.cloudflare.com | ไม่ |
| **Apify** (สำรอง) | scrape หน้าเว็บที่ไม่มี API (5) | `APIFY_TOKEN` | apify.com | ไม่ |

## เหตุผลที่เลือกแต่ละบริการ

- **MiniMax (ค่าเริ่มต้น)** — AI ทุกส่วนของระบบเรียกผ่าน `backend/src/integrations/ai.js` จุดเดียว ซึ่งใช้ MiniMax เป็นค่าเริ่มต้น ระบบเรียก MiniMax ผ่าน **Anthropic-compatible endpoint** (`https://api.minimax.io/anthropic`, โมเดล `MiniMax-M3`) ด้วย SDK ตัวเดียวกับ Claude จึงใช้ข้อความ รูปภาพ และ tool use (ค้นสินค้า เช็กออร์เดอร์ ออกคูปองภายในเพดาน) ได้เหมือนกัน
  - บัญชีที่สมัครฝั่งจีนแผ่นดินใหญ่ให้ตั้ง `MINIMAX_BASE_URL=https://api.minimaxi.com/anthropic`
  - **AI ค้นหาสินค้าขายดี** ใช้เครื่องมือค้นเว็บฝั่งเซิร์ฟเวอร์ของ MiniMax (`web_search`, ยังเป็น beta) ด้วย key เดิม ไม่ต้องตั้งค่าเพิ่ม มีค่าใช้จ่ายราว $0.01 ต่อการค้น + token ถ้า key/รุ่นที่ใช้ยังไม่เปิดการค้นเว็บ รอบนั้นจะล้มเหลวพร้อมข้อความอธิบาย
  - MiniMax ยังไม่มี structured output แบบ JSON schema ระบบจึงบังคับให้ตอบผ่าน tool ตัวเดียว (`tool_choice`) แทน และถ้าโมเดลตอบเป็นข้อความ ก็มีตัวแยก JSON สำรองไว้
  - MiniMax ยังรับไฟล์ PDF ไม่ได้ ถ้าจะให้ AI อ่านใบเสร็จ ต้องถ่ายรูปหรือแคปหน้าจอ (ระบบตอบ 400 พร้อมบอกวิธี)
  - ระบบตัดบล็อก `<think>…</think>` (ส่วนที่โมเดลใช้คิด) ออกก่อนส่งข้อความให้ลูกค้าเสมอ
  - เฟส 6 (วิดีโอ) ใช้ key เดียวกันเรียก MiniMax Speech (`/v1/t2a_v2`) และ Hailuo (`/v1/video_generation`) ผ่าน native API (`MINIMAX_API_HOST`)
  - เลือกเสียงได้จากปุ่ม "เลือกเสียง" ในหน้าโปรเจกต์วิดีโอ (ดึงรายการจาก `/v1/get_voice` ของบัญชี รวมเสียงที่โคลนไว้) หรือตั้ง `MINIMAX_VOICE_ID` เป็นค่าเริ่มต้น ส่วนคุณภาพการออกเสียงภาษาไทย**ยังไม่ได้ทดสอบกับ key จริง**
    - MiniMax ระบุว่ารองรับภาษาไทย แต่ควรลองฟังก่อนใช้งานจริง
    - ถ้าไม่พอใจ ให้สลับเสียงพากย์เป็น ElevenLabs ได้ในแต่ละโปรเจกต์
  - Hailuo แบบ text-to-video ให้ภาพแนวนอนเป็นค่าเริ่มต้น ระบบจึงให้ Shotstack ครอปเป็น 9:16
    - ฉากที่ใช้รูปสินค้าเป็นเฟรมแรก สัดส่วนภาพจะตามรูปสินค้า
  - เอกสารอ้างอิง: [Anthropic API compatible](https://platform.minimax.io/docs/api-reference/text-anthropic-api), [Tool use](https://platform.minimax.io/docs/guides/text-m3-function-call)
- **Claude (ทางเลือก)** — ตั้ง `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` เพื่อสลับทุกฟีเจอร์ไปใช้ Claude ได้โดยไม่ต้องแก้โค้ด
  - ฝั่ง Claude ใช้ structured output (JSON schema) ของจริง และรองรับ PDF
  - เปิด server-side refusal fallback ไว้ ถ้าโมเดลปฏิเสธคำขอ ระบบจะลองโมเดลสำรองในการเรียกครั้งเดียวกัน
- **ฐานความรู้สินค้า** — ใช้ MySQL FULLTEXT บนตาราง `products` + `product_knowledge` แล้วส่งผลค้นหาเข้า prompt ไม่ต้องมี vector database เพิ่ม ซึ่งรันบน shared hosting ได้ และอัปเกรดเป็น embeddings ภายหลังได้
- **ไปป์ไลน์วิดีโอ: MiniMax (สคริปต์ + เสียง + คลิป) → Shotstack (ประกอบ) → R2 (เก็บ)**
  - แยกหน้าที่แต่ละขั้น เปลี่ยนผู้ให้บริการได้ทีละส่วน
  - ทุกขั้นทำงานบนคลาวด์ จึงไม่ต้องใช้ ffmpeg หรือ GPU บน Plesk
  - ถ้ายังไม่ได้ตั้ง Shotstack ระบบจะให้ชิ้นส่วน (เสียงแต่ละฉาก, คลิป, ไฟล์ซับ .srt) ไปตัดต่อใน CapCut แทน
- **Shotstack** — `SHOTSTACK_ENV=stage` ใช้ฟรีแต่มีลายน้ำ ใช้งานจริงให้ตั้งเป็น `v1` และใช้ key แบบ production
  - `VIDEO_SCENE_AI` (ค่าเริ่มต้น `shotstack`) — โหมด "AI วิดีโอจากภาพฉาก" ใช้ Shotstack Edit API `/generate`: สร้างภาพฉากที่ขาดด้วย `SHOTSTACK_IMAGE_MODEL` (ค่าเริ่มต้น `nano-banana-2`) และทำภาพเป็นคลิปด้วย `SHOTSTACK_VIDEO_MODEL` (ค่าเริ่มต้น `seedance-2.0-image-to-video`) ใช้เครดิต Shotstack และแพ็กเกจต้องรวม AI generation · ตั้งเป็น `minimax` เพื่อใช้ image-01 + Hailuo แทน
- **Cloudflare R2** — ลิงก์ไฟล์จาก MiniMax และ Shotstack หมดอายุภายในประมาณ 24 ชั่วโมง ระบบจึงคัดลอกไฟล์ไปเก็บใน R2 (อัปโหลดด้วย S3 SigV4 โดยไม่ต้องติดตั้ง SDK) ไม่มีค่า egress เหมาะกับวิดีโอที่ต้องให้ TikTok/Meta ดึงไฟล์ไป (`PULL_FROM_URL`) และอัปโหลดตรงจาก browser ได้โดยไม่ผ่านโฮสต์
- **Shopee/TikTok official API ก่อน scraping** — เสถียรกว่า ไม่ผิดข้อตกลง และไม่โดนบล็อก

## ข้อควรระวังด้านข้อกำหนดการใช้งาน

**Scraping**
- ข้อตกลงการใช้งานของ Shopee และ TikTok **ห้าม** scrape ด้วยบอทโดยไม่ได้รับอนุญาต และทั้งสองแพลตฟอร์มมีระบบ anti-bot ที่อาจแบนบัญชี/IP ได้ ระบบนี้จึงใช้ **API ทางการเป็นหลัก** (Affiliate API, Shop API)
- Apify/HTTP fetch มีไว้เป็นทางเลือกสำหรับเว็บที่อนุญาตเท่านั้น เคารพ `robots.txt`, rate limit และอย่าเก็บข้อมูลส่วนบุคคลของผู้ขาย/ผู้ซื้อ
- แหล่งแบบ "หน้าเว็บ (JSON-LD)" ตรวจ `robots.txt` ทุกครั้ง และ**ปฏิเสธโดเมน Shopee, TikTok และ Lazada ในโค้ด**
- TikTok Shop Partner API และ Shopee Open Platform ให้ข้อมูลเฉพาะร้านตัวเอง ไม่มีข้อมูลสินค้าขายดีของทั้งตลาด
  - ข้อมูลเทรนด์ฝั่ง TikTok ให้ใช้ **นำเข้า CSV** จากไฟล์ export ของเครื่องมือวิเคราะห์ที่คุณมีสิทธิ์ใช้
  - ตรวจข้อตกลงของเครื่องมือนั้นเรื่องการนำข้อมูลออกด้วย

**Shopee Affiliate Open API (เฟส 5)**
- สมัครที่ affiliate.shopee.co.th → เมนู Open API (ต้องเป็น affiliate ที่ได้รับอนุมัติแล้ว) จะได้ App ID และ Secret
- ระบบเรียก GraphQL `productOfferV2` (สินค้าขายดี/ค่าคอมสูง) และ `generateShortLink` (ลิงก์ affiliate พร้อม sub id ต่อแคมเปญ)
- ลงลายเซ็นด้วย `SHA256(AppId + Timestamp + Payload + Secret)`
- โค้ดนี้เขียนตามเอกสารของ Shopee แต่**ยังไม่ได้ทดสอบกับ key จริง**
  - ถ้า Shopee เปลี่ยนชื่อฟิลด์ ให้แก้ที่ `backend/src/integrations/shopee-affiliate.js` ไฟล์เดียว
  - endpoint เปลี่ยนได้ด้วย `SHOPEE_AFFILIATE_ENDPOINT`

**การเชื่อมบัญชีโซเชียล (เฟส 7)**
- ตั้ง `APP_PUBLIC_URL=https://<โดเมนเว็บบน Vercel>` และลงทะเบียน Redirect URI ในแอปของแต่ละแพลตฟอร์มให้ตรงตัวอักษร:
  - TikTok: `https://<เว็บ>/api/social/oauth/tiktok/callback` (เท่ากับค่า `TIKTOK_REDIRECT_URI`)
  - Facebook Login: `https://<เว็บ>/api/social/oauth/meta/callback` (เท่ากับค่า `META_REDIRECT_URI`)
  - หน้า **บัญชีโซเชียล** มีปุ่มคัดลอก URL ทั้งสองให้
- callback วิ่งผ่าน rewrite ของ Vercel ไปที่ backend
  - ระบบยืนยันคำขอด้วย state ที่ลงลายเซ็นและหมดอายุใน 15 นาที
  - เข้ารหัส token ด้วย `APP_ENCRYPTION_KEY` ก่อนเก็บ
- Facebook Login ขอสิทธิ์ `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`, `instagram_basic`, `instagram_content_publish`
  - สิทธิ์เหล่านี้ต้องผ่าน App Review ก่อนใช้กับเพจของคนที่ไม่ได้มีบทบาทในแอป
- **ไฟล์วิดีโอต้องเป็นลิงก์สาธารณะที่ไม่หมดอายุ** (แนะนำ R2) เพราะทั้ง TikTok (`PULL_FROM_URL`) และ Meta จะดึงไฟล์จากลิงก์เอง

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
- การส่งบทสนทนาไปประมวลผลที่ผู้ให้บริการ AI ต่างประเทศ (MiniMax/Anthropic) ควรระบุไว้ในนโยบายความเป็นส่วนตัว

**LINE OA**
- ระบบตอบด้วย reply token ก่อน (ฟรี ใช้ได้ราว 1 นาที) ถ้าหมดอายุจะเปลี่ยนไปใช้ push message ซึ่งนับโควตาข้อความรายเดือนของแพ็กเกจ OA

**Shopee / TikTok Shop Chat**
- API แชตของสองแพลตฟอร์มนี้ต้องได้สิทธิ์เฉพาะจาก partner program ระบบเตรียมช่องทางและตารางไว้แล้ว แต่ยังไม่รับ-ส่งข้อความจริงจนกว่าจะได้สิทธิ์

**ภาษี**
- แบบ ภ.พ.30 / ภ.ง.ด.3/53 ที่ระบบสร้างเป็นร่างเพื่อช่วยงาน ควรให้ผู้ทำบัญชีตรวจทานก่อนยื่น
