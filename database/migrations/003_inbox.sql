-- =====================================================================
-- 003_inbox — Phase 4 (unified inbox, AI agent, returns & disputes)
-- For databases installed from schema.sql BEFORE phase 4.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE conversations
  ADD COLUMN handoff_reason VARCHAR(255) NULL COMMENT 'why the AI handed this chat to a human' AFTER mode,
  ADD COLUMN ai_lock_until DATETIME NULL COMMENT 'claim so only one worker replies at a time' AFTER handoff_reason,
  ADD COLUMN last_ai_reply_at DATETIME NULL AFTER last_customer_message_at;

ALTER TABLE messages ADD KEY idx_msg_external (external_message_id);

ALTER TABLE returns
  ADD COLUMN resolution_note TEXT NULL AFTER resolution,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

ALTER TABLE disputes
  ADD COLUMN resolution_note TEXT NULL AFTER status;

INSERT INTO schema_migrations (version) VALUES ('003_inbox');
