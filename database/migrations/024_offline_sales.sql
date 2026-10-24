-- =====================================================================
-- 024_offline_sales — sell cash while the internet is down:
--   * sales_orders.client_ref: the id the till gave a bill made offline, so sending it again
--     (after a dropped connection) never creates the sale twice
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE sales_orders
  ADD COLUMN client_ref CHAR(36) NULL COMMENT 'till-made id of a bill sold offline (idempotent sync)' AFTER receipt_token,
  ADD UNIQUE KEY uq_order_client_ref (org_id, client_ref);

INSERT INTO schema_migrations (version) VALUES ('024_offline_sales');
