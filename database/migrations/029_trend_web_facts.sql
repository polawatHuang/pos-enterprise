-- =====================================================================
-- 029_trend_web_facts — "ให้ AI ค้นข้อมูลร้าน/รีวิวจากเว็บ": product/shop facts (rating, reviews,
-- shop rating, chat response, shipping within 48 h, flash sale) that the AI found on the web, each
-- with the page it came from, kept as one more per-product extra.
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

ALTER TABLE trend_product_extras
  MODIFY kind ENUM('detail','analysis','comments','videos','creators','webfacts') NOT NULL;
