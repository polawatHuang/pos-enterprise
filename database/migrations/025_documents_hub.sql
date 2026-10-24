-- =====================================================================
-- 025_documents_hub — one place for every business document:
--   * documents.doc_type 'billing_note' (ใบวางบิล) and billing_note_items: the invoices,
--     debit notes and credit notes a billing note collects (it posts nothing to the ledger)
--   * stock_documents: a numbered header for goods receipts (GR), stock adjustments (AJ) and
--     write-offs (WS); stock_movements.stock_document_id points to it
-- For databases installed from schema.sql BEFORE this change.
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

ALTER TABLE documents
  MODIFY COLUMN doc_type ENUM('quotation','invoice','tax_invoice','receipt','tax_invoice_receipt','credit_note','debit_note','wht_certificate','purchase_order','expense_voucher','billing_note') NOT NULL;

CREATE TABLE billing_note_items (
  billing_note_id BIGINT UNSIGNED NOT NULL,
  document_id     BIGINT UNSIGNED NOT NULL,
  amount          DECIMAL(14,2) NOT NULL COMMENT 'signed: credit notes are negative',
  settled         TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'paid by this billing note (undone if it is voided)',
  PRIMARY KEY (billing_note_id, document_id),
  KEY idx_bni_doc (document_id),
  CONSTRAINT fk_bni_note FOREIGN KEY (billing_note_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_bni_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_documents (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id            BIGINT UNSIGNED NOT NULL,
  doc_type          ENUM('goods_receipt','adjustment','waste') NOT NULL,
  doc_no            VARCHAR(40) NOT NULL,
  doc_date          DATE NOT NULL,
  warehouse_id      BIGINT UNSIGNED NOT NULL,
  supplier_id       BIGINT UNSIGNED NULL,
  purchase_order_id BIGINT UNSIGNED NULL,
  reference         VARCHAR(100) NULL COMMENT 'supplier delivery note / invoice no.',
  reason            VARCHAR(100) NULL,
  note              VARCHAR(255) NULL,
  total_cost        DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_by        BIGINT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stock_doc_no (org_id, doc_type, doc_no),
  KEY idx_stock_doc_date (org_id, doc_date),
  CONSTRAINT fk_sdoc_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_sdoc_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_sdoc_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_sdoc_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE stock_movements
  ADD COLUMN stock_document_id BIGINT UNSIGNED NULL COMMENT 'GR / AJ / WS this movement belongs to' AFTER ref_id,
  ADD KEY idx_sm_stock_doc (stock_document_id);

INSERT INTO schema_migrations (version) VALUES ('025_documents_hub');
