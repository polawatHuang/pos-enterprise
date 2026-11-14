CREATE TABLE ecommerce_customer_identities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  line_user_id VARCHAR(191) NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  picture_url VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ecommerce_line_user (line_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ecommerce_customer_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  identity_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ecommerce_customer_session_expiry (expires_at),
  CONSTRAINT fk_ecommerce_customer_session_identity
    FOREIGN KEY (identity_id) REFERENCES ecommerce_customer_identities(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ecommerce_line_login_states (
  state_hash CHAR(64) NOT NULL PRIMARY KEY,
  store_slug VARCHAR(120) NOT NULL,
  code_verifier VARCHAR(128) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ecommerce_line_login_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ecommerce_customer_addresses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  identity_id BIGINT UNSIGNED NOT NULL,
  org_id BIGINT UNSIGNED NOT NULL,
  recipient_name VARCHAR(191) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(191) NULL,
  address TEXT NOT NULL,
  postal_code VARCHAR(12) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ecommerce_customer_address (org_id, identity_id, is_default),
  CONSTRAINT fk_ecommerce_address_identity
    FOREIGN KEY (identity_id) REFERENCES ecommerce_customer_identities(id) ON DELETE CASCADE,
  CONSTRAINT fk_ecommerce_address_org
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ecommerce_order_details
  ADD COLUMN customer_identity_id BIGINT UNSIGNED NULL AFTER org_id,
  ADD KEY idx_ecommerce_customer_orders (org_id, customer_identity_id, created_at),
  ADD CONSTRAINT fk_ecommerce_order_customer_identity
    FOREIGN KEY (customer_identity_id) REFERENCES ecommerce_customer_identities(id) ON DELETE SET NULL;

CREATE TABLE ecommerce_product_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  sales_order_id BIGINT UNSIGNED NOT NULL,
  sales_order_item_id BIGINT UNSIGNED NOT NULL,
  customer_identity_id BIGINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  review_text VARCHAR(2000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ecommerce_review_order_item (sales_order_item_id),
  KEY idx_ecommerce_product_reviews (org_id, product_id, created_at),
  CONSTRAINT fk_ecommerce_review_org
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ecommerce_review_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_ecommerce_review_order
    FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_ecommerce_review_item
    FOREIGN KEY (sales_order_item_id) REFERENCES sales_order_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_ecommerce_review_identity
    FOREIGN KEY (customer_identity_id) REFERENCES ecommerce_customer_identities(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
