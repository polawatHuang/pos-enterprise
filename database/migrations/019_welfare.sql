-- =====================================================================
-- 019_welfare — employee welfare stock withdrawal (เบิกสินค้าสวัสดิการพนักงาน):
-- a staff member requests products, a manager approves, stock leaves at cost and is booked to
-- 5250 ค่าสวัสดิการพนักงาน. Monthly limit per employee (settings welfare.monthly_limit + per-user override).
-- For databases installed from schema.sql BEFORE this change.
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================

ALTER TABLE users
  ADD COLUMN welfare_monthly_limit DECIMAL(12,2) NULL COMMENT 'welfare withdrawal limit per month at cost; NULL = org default (settings welfare.monthly_limit)' AFTER phone;

ALTER TABLE stock_movements
  MODIFY COLUMN type ENUM('purchase','sale','return','adjustment','transfer_in','transfer_out','opening','count','waste','welfare') NOT NULL;

CREATE TABLE welfare_requests (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  request_no     VARCHAR(40) NOT NULL,
  warehouse_id   BIGINT UNSIGNED NOT NULL,
  employee_id    BIGINT UNSIGNED NOT NULL COMMENT 'the staff member receiving the goods (users.id)',
  status         ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  note           VARCHAR(255) NULL,
  total_cost     DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'at products.cost; re-priced on approval',
  requested_by   BIGINT UNSIGNED NULL,
  requested_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by    BIGINT UNSIGNED NULL COMMENT 'manager who approved or rejected',
  approved_at    DATETIME NULL,
  reject_reason  VARCHAR(255) NULL,
  UNIQUE KEY uq_welfare_no (org_id, request_no),
  KEY idx_welfare_emp_time (employee_id, requested_at),
  KEY idx_welfare_org_status (org_id, status),
  CONSTRAINT fk_welfare_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_welfare_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  CONSTRAINT fk_welfare_emp FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE welfare_request_items (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id       BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NOT NULL,
  quantity         DECIMAL(14,3) NOT NULL,
  unit_cost        DECIMAL(14,2) NOT NULL DEFAULT 0,
  lot_allocations  JSON NULL COMMENT '[{lotId, qty, expiry, cost}] taken FEFO on approval',
  KEY idx_welfare_item_req (request_id),
  CONSTRAINT fk_welfare_item_req FOREIGN KEY (request_id) REFERENCES welfare_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_welfare_item_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Expense account for goods given to staff, in every organization's chart of accounts
INSERT IGNORE INTO chart_of_accounts (org_id, code, name, type)
SELECT id, '5250', 'ค่าสวัสดิการพนักงาน', 'expense' FROM organizations;

-- welfare:request (id 27 on a standard install; the next free id if 27 is already taken)
INSERT IGNORE INTO permissions (id, code, module, description)
SELECT GREATEST(27, COALESCE(MAX(id), 0) + 1), 'welfare:request', 'inventory', 'ขอเบิกสินค้าสวัสดิการพนักงาน'
  FROM permissions
 WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'welfare:request')
HAVING COUNT(*) > 0;
-- every role except viewer (approval itself is inventory:approve)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'welfare:request' WHERE r.code <> 'viewer';

INSERT INTO schema_migrations (version) VALUES ('019_welfare');
