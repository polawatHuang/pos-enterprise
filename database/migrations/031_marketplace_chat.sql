-- =====================================================================
-- 031_marketplace_chat — Shopee / TikTok Shop chat in the inbox: per-conversation platform data
-- (e.g. Shopee's buyer id that send_message needs, alongside the conversation id).
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

ALTER TABLE conversations ADD COLUMN platform_meta LONGTEXT NULL COMMENT 'JSON: platform ids needed to reply (Shopee to_id)';
