-- =====================================================================
-- 034_drama_tie_in — ละคร AI product tie-in: the shop's product (photo + what to say about it) is
-- woven into every episode; the shots where a character presents it are marked.
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

ALTER TABLE drama_projects
  ADD COLUMN tie_in            TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN product_name      VARCHAR(191) NULL,
  ADD COLUMN product_pitch     TEXT NULL COMMENT 'what the characters should say about the product',
  ADD COLUMN product_image_key VARCHAR(80)  NULL;

ALTER TABLE drama_shots ADD COLUMN is_product TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'a character presents the tie-in product';
