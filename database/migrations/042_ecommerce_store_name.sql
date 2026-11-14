ALTER TABLE ecommerce_stores
  ADD COLUMN store_name VARCHAR(191) NOT NULL DEFAULT 'ร้านค้าออนไลน์' AFTER slug;
