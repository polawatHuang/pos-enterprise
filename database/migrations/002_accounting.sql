-- =====================================================================
-- 002_accounting — Phase 3 (accounting, documents, tax)
-- For databases installed from schema.sql BEFORE phase 3.
-- (Fresh installs of the current schema.sql already include these changes.)
-- Import once via phpMyAdmin > Import. Compatible with MySQL 8 / MariaDB 10.6+.
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE transactions
  ADD COLUMN counterparty_type ENUM('individual','company') NULL COMMENT 'PND3 = individual, PND53 = company' AFTER counterparty_tax_id,
  ADD COLUMN wht_income_type VARCHAR(10) NULL COMMENT 'Revenue Code section, e.g. 40(2), 40(5), 40(8)' AFTER wht_rate,
  ADD COLUMN vat_claimable TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = has a full tax invoice, input VAT can be claimed' AFTER vat_amount,
  ADD COLUMN status ENUM('posted','void') NOT NULL DEFAULT 'posted' AFTER ai_extracted,
  ADD COLUMN document_id BIGINT UNSIGNED NULL AFTER ref_id,
  ADD KEY idx_txn_wht (org_id, txn_date, wht_amount);

-- Gap-free document numbering per type and month (Revenue Department requires sequential numbers)
CREATE TABLE document_sequences (
  org_id    BIGINT UNSIGNED NOT NULL,
  doc_type  VARCHAR(40) NOT NULL,
  period    CHAR(6) NOT NULL COMMENT 'YYYYMM',
  last_no   INT NOT NULL DEFAULT 0 COMMENT 'last number issued',
  PRIMARY KEY (org_id, doc_type, period),
  CONSTRAINT fk_docseq_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE documents
  ADD COLUMN paid_at DATETIME NULL AFTER status,
  ADD COLUMN payment_method VARCHAR(30) NULL AFTER paid_at,
  ADD COLUMN transaction_id BIGINT UNSIGNED NULL COMMENT 'source transaction for WHT certificates' AFTER order_id;

ALTER TABLE journal_lines ADD KEY idx_jl_account (account_id);
ALTER TABLE journal_entries ADD KEY idx_je_ref (org_id, ref_type, ref_id), ADD KEY idx_je_date (org_id, entry_date);

INSERT INTO schema_migrations (version) VALUES ('002_accounting');
