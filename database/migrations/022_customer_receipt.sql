-- =====================================================================
-- 022_customer_receipt — the customer's own receipt page (QR on the printed receipt):
--   * sales_orders.receipt_token: unguessable id of a bill in the public link /r/<token>
--   * tax_invoice_requests: a customer's request for a full tax invoice (ใบกำกับภาษีเต็มรูป),
--     typed by the customer; staff review and issue it from the bill
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE sales_orders
  ADD COLUMN receipt_token CHAR(22) NULL COMMENT 'public receipt link id' AFTER order_no,
  ADD UNIQUE KEY uq_order_receipt_token (receipt_token);

CREATE TABLE tax_invoice_requests (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      BIGINT UNSIGNED NOT NULL,
  order_id    BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(191) NOT NULL,
  tax_id      VARCHAR(13) NOT NULL,
  branch_no   VARCHAR(5) NOT NULL DEFAULT '00000',
  address     VARCHAR(1000) NOT NULL,
  email       VARCHAR(191) NULL,
  status      ENUM('pending','issued') NOT NULL DEFAULT 'pending',
  document_id BIGINT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tir_order (order_id),
  KEY idx_tir_org_status (org_id, status),
  CONSTRAINT fk_tir_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_tir_order FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_tir_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (version) VALUES ('022_customer_receipt');
