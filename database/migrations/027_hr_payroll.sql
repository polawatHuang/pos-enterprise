-- =====================================================================
-- 027_hr_payroll — staff records, payroll and leave:
--   * employees: who works here (optionally linked to a login), pay, social security, tax details
--   * payroll_runs (+payroll_items): one run per month; each line works out social security and
--     the ภ.ง.ด.1 withholding; approving books the salary expense, paying books the transfer
--   * payroll_remittances: paying the withheld tax (ภ.ง.ด.1) and social security (สปส.1-10)
--   * leave_requests: ใบลา, approved by a manager
--   * accounts 2220 / 2230 / 2240 / 5210 and permissions hr:manage, leave:request, leave:approve
-- For databases installed from schema.sql BEFORE this change.
-- Applied automatically when the backend starts (AUTO_MIGRATE), or import once via phpMyAdmin.
-- =====================================================================

CREATE TABLE employees (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id               BIGINT UNSIGNED NOT NULL,
  user_id              BIGINT UNSIGNED NULL COMMENT 'login of this person, if any',
  emp_code             VARCHAR(20) NOT NULL,
  title                VARCHAR(20) NULL COMMENT 'นาย / นาง / นางสาว',
  full_name            VARCHAR(191) NOT NULL,
  national_id          CHAR(13) NULL,
  birth_date           DATE NULL,
  address              TEXT NULL,
  phone                VARCHAR(50) NULL,
  email                VARCHAR(191) NULL,
  branch_id            BIGINT UNSIGNED NULL,
  position             VARCHAR(100) NULL,
  department           VARCHAR(100) NULL,
  pay_type             ENUM('monthly','daily') NOT NULL DEFAULT 'monthly',
  base_salary          DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'monthly salary, or the daily wage when pay_type = daily',
  start_date           DATE NOT NULL,
  end_date             DATE NULL,
  status               ENUM('active','resigned') NOT NULL DEFAULT 'active',
  sso_enrolled         TINYINT(1) NOT NULL DEFAULT 1,
  sso_number           VARCHAR(20) NULL COMMENT 'usually the national id',
  tax_extra_deductions DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'yearly allowances beyond personal / expense / social security',
  bank_name            VARCHAR(100) NULL,
  bank_account         VARCHAR(30) NULL,
  annual_leave_days    DECIMAL(4,1) NOT NULL DEFAULT 6,
  note                 VARCHAR(255) NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_code (org_id, emp_code),
  UNIQUE KEY uq_emp_user (org_id, user_id),
  KEY idx_emp_status (org_id, status),
  CONSTRAINT fk_emp_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_emp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_emp_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payroll_runs (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id             BIGINT UNSIGNED NOT NULL,
  run_no             VARCHAR(40) NOT NULL,
  period             CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  pay_date           DATE NOT NULL,
  status             ENUM('draft','approved','paid','void') NOT NULL DEFAULT 'draft',
  total_gross        DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_sso_employee DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_sso_employer DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_wht          DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_deductions   DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_net          DECIMAL(14,2) NOT NULL DEFAULT 0,
  payment_method     VARCHAR(30) NULL,
  note               VARCHAR(255) NULL,
  created_by         BIGINT UNSIGNED NULL,
  approved_by        BIGINT UNSIGNED NULL,
  approved_at        DATETIME NULL,
  paid_at            DATETIME NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_run_no (org_id, run_no),
  KEY idx_run_period (org_id, period),
  CONSTRAINT fk_run_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payroll_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id        BIGINT UNSIGNED NOT NULL,
  employee_id   BIGINT UNSIGNED NOT NULL,
  days_worked   DECIMAL(5,2) NULL COMMENT 'daily-paid staff',
  base_pay      DECIMAL(12,2) NOT NULL DEFAULT 0,
  overtime      DECIMAL(12,2) NOT NULL DEFAULT 0,
  allowance     DECIMAL(12,2) NOT NULL DEFAULT 0,
  bonus         DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_income  DECIMAL(12,2) NOT NULL DEFAULT 0,
  gross         DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'taxable income of the month (40(1))',
  sso_base      DECIMAL(12,2) NOT NULL DEFAULT 0,
  sso_employee  DECIMAL(12,2) NOT NULL DEFAULT 0,
  sso_employer  DECIMAL(12,2) NOT NULL DEFAULT 0,
  wht           DECIMAL(12,2) NOT NULL DEFAULT 0,
  wht_manual    TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'the withholding was typed, not computed',
  deduction     DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'unpaid leave, absence, lateness (reduces the pay)',
  net           DECIMAL(12,2) NOT NULL DEFAULT 0,
  note          VARCHAR(255) NULL,
  UNIQUE KEY uq_item_emp (run_id, employee_id),
  CONSTRAINT fk_item_run FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_emp FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payroll_remittances (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id         BIGINT UNSIGNED NOT NULL,
  kind           ENUM('pnd1','sso') NOT NULL,
  period         CHAR(7) NOT NULL,
  remit_date     DATE NOT NULL,
  amount         DECIMAL(14,2) NOT NULL,
  payment_method VARCHAR(30) NOT NULL DEFAULT 'transfer',
  reference      VARCHAR(100) NULL,
  status         ENUM('posted','void') NOT NULL DEFAULT 'posted',
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_remit_period (org_id, kind, period),
  CONSTRAINT fk_remit_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE leave_requests (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id        BIGINT UNSIGNED NOT NULL,
  leave_no      VARCHAR(40) NOT NULL,
  employee_id   BIGINT UNSIGNED NOT NULL,
  leave_type    ENUM('sick','personal','vacation','maternity','other') NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  days          DECIMAL(4,1) NOT NULL,
  reason        VARCHAR(255) NULL,
  status        ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  requested_by  BIGINT UNSIGNED NULL,
  requested_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by    BIGINT UNSIGNED NULL,
  decided_at    DATETIME NULL,
  reject_reason VARCHAR(255) NULL,
  UNIQUE KEY uq_leave_no (org_id, leave_no),
  KEY idx_leave_emp (org_id, employee_id, start_date),
  CONSTRAINT fk_leave_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_leave_emp FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payroll accounts in every organization's chart of accounts
INSERT IGNORE INTO chart_of_accounts (org_id, code, name, type)
SELECT id, '2220', 'ภาษีหัก ณ ที่จ่ายค้างนำส่ง (ภ.ง.ด.1)', 'liability' FROM organizations;
INSERT IGNORE INTO chart_of_accounts (org_id, code, name, type)
SELECT id, '2230', 'เงินประกันสังคมค้างนำส่ง', 'liability' FROM organizations;
INSERT IGNORE INTO chart_of_accounts (org_id, code, name, type)
SELECT id, '2240', 'เงินเดือนค้างจ่าย', 'liability' FROM organizations;
INSERT IGNORE INTO chart_of_accounts (org_id, code, name, type)
SELECT id, '5210', 'เงินสมทบประกันสังคม (ส่วนนายจ้าง)', 'expense' FROM organizations;

-- Permissions: payroll and staff records / asking for leave / approving leave
INSERT IGNORE INTO permissions (code, module, description) VALUES
  ('hr:manage', 'hr', 'ข้อมูลพนักงาน เงินเดือน และรายงาน ภ.ง.ด.1 / ประกันสังคม'),
  ('leave:request', 'hr', 'ยื่นใบลา'),
  ('leave:approve', 'hr', 'อนุมัติใบลา');
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'hr:manage' WHERE r.code IN ('owner', 'admin', 'accountant');
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'leave:request' WHERE r.code <> 'viewer';
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'leave:approve' WHERE r.code IN ('owner', 'admin', 'manager');

INSERT INTO schema_migrations (version) VALUES ('027_hr_payroll');
