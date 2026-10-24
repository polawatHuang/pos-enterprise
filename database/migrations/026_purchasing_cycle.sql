-- =====================================================================
-- 026_purchasing_cycle — the buying side from request to payment:
--   * purchase_requests (+items): ใบขอซื้อ, approved by a manager into a purchase order
--   * supplier_bills: ตั้งหนี้ผู้ขาย from the supplier's invoice / tax invoice (Dr stock or
--     expense + input VAT / Cr accounts payable), and the supplier's credit notes (negative)
--   * payment_vouchers (+items): ใบสำคัญจ่าย paying a supplier's bills (Dr AP / Cr bank or cash,
--     Cr withholding tax), feeding ภ.ง.ด.3/53
--   * documents.doc_type 'substitute_receipt': ใบรับรองแทนใบเสร็จรับเงิน for an expense paid to
--     someone who gives no receipt
--   * petty cash: account 1105 เงินสดย่อย, and petty_cash_topups (เติมวงเงินเงินสดย่อย)
-- For databases installed from schema.sql BEFORE this change.
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

ALTER TABLE documents
  MODIFY COLUMN doc_type ENUM('quotation','invoice','tax_invoice','receipt','tax_invoice_receipt','credit_note','debit_note','wht_certificate','purchase_order','expense_voucher','billing_note','substitute_receipt') NOT NULL;

ALTER TABLE documents
  ADD COLUMN payment_voucher_id BIGINT UNSIGNED NULL COMMENT 'source payment voucher for WHT certificates' AFTER transaction_id;

CREATE TABLE purchase_requests (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id            BIGINT UNSIGNED NOT NULL,
  pr_no             VARCHAR(40) NOT NULL,
  warehouse_id      BIGINT UNSIGNED NOT NULL,
  supplier_id       BIGINT UNSIGNED NULL COMMENT 'suggested supplier',
  needed_by         DATE NULL,
  reason            VARCHAR(255) NULL,
  status            ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  requested_by      BIGINT UNSIGNED NULL,
  requested_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by        BIGINT UNSIGNED NULL,
  decided_at        DATETIME NULL,
  reject_reason     VARCHAR(255) NULL,
  purchase_order_id BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_pr_no (org_id, pr_no),
  KEY idx_pr_status (org_id, status),
  CONSTRAINT fk_pr_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_pr_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_pr_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_pr_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_request_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id    BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NOT NULL,
  quantity      DECIMAL(14,3) NOT NULL,
  est_unit_cost DECIMAL(14,2) NULL,
  KEY idx_pri_req (request_id),
  CONSTRAINT fk_pri_req FOREIGN KEY (request_id) REFERENCES purchase_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_pri_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supplier_bills (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id            BIGINT UNSIGNED NOT NULL,
  kind              ENUM('bill','credit_note') NOT NULL DEFAULT 'bill',
  bill_no           VARCHAR(40) NOT NULL COMMENT 'our running number (AP...)',
  supplier_id       BIGINT UNSIGNED NOT NULL,
  supplier_doc_no   VARCHAR(60) NULL COMMENT 'the supplier''s invoice / tax invoice number',
  bill_date         DATE NOT NULL,
  due_date          DATE NULL,
  account_code      VARCHAR(10) NOT NULL DEFAULT '1300' COMMENT 'debited: stock (1300) or an expense',
  amount            DECIMAL(14,2) NOT NULL COMMENT 'before VAT',
  vat_amount        DECIMAL(14,2) NOT NULL DEFAULT 0,
  vat_claimable     TINYINT(1) NOT NULL DEFAULT 1,
  total             DECIMAL(14,2) NOT NULL,
  purchase_order_id BIGINT UNSIGNED NULL,
  stock_document_id BIGINT UNSIGNED NULL COMMENT 'goods receipt it pays for',
  status            ENUM('unpaid','paid','void') NOT NULL DEFAULT 'unpaid',
  note              VARCHAR(255) NULL,
  created_by        BIGINT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bill_no (org_id, bill_no),
  KEY idx_bill_supplier (org_id, supplier_id, status),
  CONSTRAINT fk_bill_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_bill_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_bill_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_bill_gr FOREIGN KEY (stock_document_id) REFERENCES stock_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payment_vouchers (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id          BIGINT UNSIGNED NOT NULL,
  pv_no           VARCHAR(40) NOT NULL,
  supplier_id     BIGINT UNSIGNED NOT NULL,
  pay_date        DATE NOT NULL,
  payment_method  VARCHAR(30) NOT NULL,
  payee_type      ENUM('company','individual') NOT NULL DEFAULT 'company' COMMENT 'PND53 / PND3',
  gross           DECIMAL(14,2) NOT NULL COMMENT 'bills less credit notes',
  wht_base        DECIMAL(14,2) NOT NULL DEFAULT 0,
  wht_rate        DECIMAL(5,2) NULL,
  wht_income_type VARCHAR(20) NULL,
  wht_amount      DECIMAL(14,2) NOT NULL DEFAULT 0,
  net_paid        DECIMAL(14,2) NOT NULL,
  reference       VARCHAR(100) NULL COMMENT 'cheque / transfer reference',
  status          ENUM('posted','void') NOT NULL DEFAULT 'posted',
  note            VARCHAR(255) NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pv_no (org_id, pv_no),
  KEY idx_pv_date (org_id, pay_date),
  CONSTRAINT fk_pv_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_pv_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payment_voucher_items (
  voucher_id BIGINT UNSIGNED NOT NULL,
  bill_id    BIGINT UNSIGNED NOT NULL,
  amount     DECIMAL(14,2) NOT NULL COMMENT 'signed: credit notes are negative',
  PRIMARY KEY (voucher_id, bill_id),
  KEY idx_pvi_bill (bill_id),
  CONSTRAINT fk_pvi_voucher FOREIGN KEY (voucher_id) REFERENCES payment_vouchers(id) ON DELETE CASCADE,
  CONSTRAINT fk_pvi_bill FOREIGN KEY (bill_id) REFERENCES supplier_bills(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE petty_cash_topups (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  topup_no       VARCHAR(40) NOT NULL,
  topup_date     DATE NOT NULL,
  amount         DECIMAL(14,2) NOT NULL,
  from_method    VARCHAR(30) NOT NULL DEFAULT 'transfer' COMMENT 'cash (safe) or bank',
  note           VARCHAR(255) NULL,
  status         ENUM('posted','void') NOT NULL DEFAULT 'posted',
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_topup_no (org_id, topup_no),
  CONSTRAINT fk_topup_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Petty cash in every organization's chart of accounts
INSERT IGNORE INTO chart_of_accounts (org_id, code, name, type)
SELECT id, '1105', 'เงินสดย่อย', 'asset' FROM organizations;

INSERT INTO schema_migrations (version) VALUES ('026_purchasing_cycle');
