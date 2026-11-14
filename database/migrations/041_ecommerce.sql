CREATE TABLE ecommerce_stores (
  org_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  slug VARCHAR(120) NOT NULL,
  warehouse_id BIGINT UNSIGNED NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ecommerce_store_slug (slug),
  CONSTRAINT fk_ecommerce_store_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ecommerce_store_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ecommerce_order_details (
  sales_order_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  public_token CHAR(43) NOT NULL,
  customer_name VARCHAR(191) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(191) NULL,
  shipping_address TEXT NOT NULL,
  postal_code VARCHAR(12) NOT NULL,
  customer_note VARCHAR(500) NULL,
  payment_status ENUM('pending','paid','expired') NOT NULL DEFAULT 'pending',
  slip_storage_key VARCHAR(500) NULL,
  shipment_evidence_key VARCHAR(500) NULL,
  shipment_note VARCHAR(255) NULL,
  expires_at DATETIME NOT NULL,
  shipped_at DATETIME NULL,
  shipped_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ecommerce_public_token (public_token),
  KEY idx_ecommerce_org_created (org_id, created_at),
  KEY idx_ecommerce_org_expiry (org_id, payment_status, expires_at),
  CONSTRAINT fk_ecommerce_order_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ecommerce_order_sale FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_ecommerce_order_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_ecommerce_shipped_by FOREIGN KEY (shipped_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO ecommerce_stores (org_id, slug, warehouse_id, is_enabled)
SELECT o.id, CONCAT('store-', o.id),
       (SELECT w.id FROM warehouses w WHERE w.org_id = o.id ORDER BY w.id LIMIT 1),
       0
  FROM organizations o;
