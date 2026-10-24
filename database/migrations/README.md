# Migrations

`schema.sql` คือการติดตั้งครั้งแรก (มี `DROP TABLE` — ห้ามรันซ้ำบนข้อมูลจริง)

การเปลี่ยนโครงสร้างหลังจากนี้จะเพิ่มเป็นไฟล์ `NNN_description.sql` ในโฟลเดอร์นี้ ทุกไฟล์จบด้วย
`INSERT INTO schema_migrations (version) VALUES ('NNN_description');`

## อัปเดตอัตโนมัติ (ค่าเริ่มต้น)
backend จะรันไฟล์ที่ยังไม่อยู่ใน `schema_migrations` ให้เองตามลำดับเลขทุกครั้งที่แอปเริ่ม (กด **Restart App** ใน Plesk หลัง deploy)
- ต้องมีโฟลเดอร์ `database/` อยู่ข้างโฟลเดอร์ `backend/` (deploy ด้วย Git มีให้อยู่แล้ว; ถ้าอัปโหลดด้วย FTP ให้อัปโหลด `database/migrations` ไปด้วย หรือตั้ง `MIGRATIONS_DIR`)
- ไฟล์ที่ import ไปแล้วบางส่วน ระบบจะข้ามส่วนที่มีอยู่แล้วและทำต่อจนครบ
- ดูผลได้ที่ `/api/health` → `schema` (`pending` = ยังค้าง, `error` = สาเหตุที่หยุด)
- ปิดได้ด้วย `AUTO_MIGRATE=false` แล้ว import เองผ่าน phpMyAdmin ทีละไฟล์ตามลำดับเลขเหมือนเดิม

ตรวจว่ารันไฟล์ไหนไปแล้วด้วย `SELECT * FROM schema_migrations;`
