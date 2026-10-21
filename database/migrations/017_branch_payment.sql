-- 017: each branch can receive payments into its own PromptPay / bank account.
-- NULL = use the shop-wide account from POS settings.
ALTER TABLE branches
  ADD COLUMN promptpay_id VARCHAR(20) NULL AFTER address,
  ADD COLUMN bank_account LONGTEXT NULL COMMENT 'JSON {bank,type,number,name}' AFTER promptpay_id;

INSERT INTO schema_migrations (version) VALUES ('017_branch_payment');
