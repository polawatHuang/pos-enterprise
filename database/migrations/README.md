# Migrations

`schema.sql` คือการติดตั้งครั้งแรก (มี `DROP TABLE` — ห้ามรันซ้ำบนข้อมูลจริง)

การเปลี่ยนโครงสร้างหลังจากนี้จะเพิ่มเป็นไฟล์ `NNN_description.sql` ในโฟลเดอร์นี้ ให้ import ผ่าน phpMyAdmin ทีละไฟล์ตามลำดับเลข
ตรวจว่ารันไฟล์ไหนไปแล้วด้วย `SELECT * FROM schema_migrations;` — ทุกไฟล์จะจบด้วย
`INSERT INTO schema_migrations (version) VALUES ('NNN_description');`
