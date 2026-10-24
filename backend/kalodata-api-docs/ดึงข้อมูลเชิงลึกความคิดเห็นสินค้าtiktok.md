
ศูนย์เปิด
หน้าหลัก
API
Skill
ราคาแพ็กเกจ

15
เติมเงิน

P


โฟลว์การผสานรวม
1
ไปที่ บัญชี เพื่อสร้าง/จัดการคีย์ API ของคุณ
2
ไปที่ ราคาแพ็กเกจ เพื่อดูกฎการตั้งราคา
3
ทำตาม API ด้านล่างเพื่อเสร็จสิ้นการเชื่อมต่อ
tiktok/วิดีโอ
รับรายละเอียดวิดีโอ
รับรายการอันดับวิดีโอ
ดึง URL วิดีโอ
tiktok/สินค้า
ดึงการวิเคราะห์จุดขายของสินค้า TikTok
ดึงข้อมูลเชิงลึกความคิดเห็นสินค้า TikTok
รับรายละเอียดสินค้า
ดึง URL รูปภาพสินค้า
รับรายการอันดับสินค้า
tiktok/ครีเอเตอร์
ดึง URL รูปภาพโปรไฟล์ของครีเอเตอร์
รับรายละเอียดครีเอเตอร์
รับรายชื่ออันดับครีเอเตอร์
tiktok/ร้านค้า
รับรายละเอียดร้านค้า
รับรายชื่ออันดับร้านค้า
tiktok/ไลฟ์
รับรายละเอียดไลฟ์
รับรายการอันดับไลฟ์
credit
สอบถามยอดเครดิตคงเหลือ
สอบถามบันทึกการใช้เครดิต
tiktok/หมวดหมู่
รับรายละเอียดหมวดหมู่
รับรายการอันดับหมวดหมู่
ดึงข้อมูลเชิงลึกความคิดเห็นสินค้า TikTok
ดึงข้อมูลเชิงลึกความคิดเห็นที่แคชไว้ของสินค้า TikTok จะหัก 1 เครดิตเฉพาะเมื่อมีข้อมูลเชิงลึกและ cached_at ใหม่กว่าการหักครั้งล่าสุดของผู้ใช้และสินค้านี้ ความล้มเหลวและหมดเวลาจะไม่ถูกหัก จำกัด 100 คำขอต่อ 10 วินาที
Post
https://www.kalodata.com/openapi/v1/tiktok/product/comment/insight


วิธีการรวมระบบ
เอ็นด์พอยต์ทั้งหมดใช้ HTTP POST + JSON พร้อมการตรวจสอบสิทธิ์ด้วย secret-key ในส่วนหัว ฟิลด์ทั่วไป: region / language / currency / date_range คุณสามารถใช้พารามิเตอร์คำขอคงที่ด้านล่างสำหรับการดีบักในเครื่องและดูตัวอย่าง mock response
ขีดจำกัดอัตรา API
มากที่สุด
100
คำขอ /10 วินาที
พารามิเตอร์คำขอ

ฟิลด์	ประเภท	คำอธิบาย	ตัวอย่าง	ข้อมูลที่จำเป็นต้องกรอก
product_id	string	
ID สินค้า TikTok
1729383749752951276	ใช่
country_code	string	
รหัสประเทศ
us	ใช่
พารามิเตอร์การตอบกลับ

ฟิลด์	ประเภท	คำอธิบาย	ตัวอย่าง
success	boolean	
data	object	
product_id	string	
ID สินค้า TikTok
country_code	string	
รหัสประเทศ
cached_at	string	
เวลาการสร้างข้อมูลเชิงลึก (ISO8601)
comment_summary	object	
สรุปความคิดเห็น
original_comments	array<object>	
ความคิดเห็นต้นฉบับที่ใช้สร้างข้อมูลเชิงลึก
pain_points	array<object>	
จุดที่ต้องปรับปรุง
positive_points	array<object>	
จุดเด่นที่ได้รับคำชม
usage_scenarios	array<object>	
สถานการณ์การใช้งาน
message	string	
debug	object	
cached	boolean	
code	string	
ดีบัก API

พารามิเตอร์คำขอคงที่


{
  "product_id": "1729383749752951276",
  "country_code": "us"
}
การตอบกลับจำลอง (JSON)


{
  "success": false,
  "data": {
    "product_id": "string",
    "country_code": "string",
    "cached_at": "string",
    "original_comments": [],
    "pain_points": [],
    "positive_points": [],
    "usage_scenarios": []
  },
  "message": "string",
  "cached": false,
  "code": "string"
}
