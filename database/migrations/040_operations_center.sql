CREATE TABLE operations_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NOT NULL,
  task_date DATE NOT NULL,
  template_code VARCHAR(48) NULL,
  task_type ENUM('checklist','incident','handoff','receiving') NOT NULL DEFAULT 'checklist',
  shift ENUM('morning','day','evening','any') NOT NULL DEFAULT 'any',
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  link VARCHAR(255) NULL,
  priority ENUM('normal','high','urgent') NOT NULL DEFAULT 'normal',
  status ENUM('pending','in_progress','done','skipped','follow_up') NOT NULL DEFAULT 'pending',
  assigned_to BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  due_at DATETIME NULL,
  status_reason VARCHAR(500) NULL,
  handoff_note VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uq_operations_task_template (org_id, branch_id, task_date, template_code),
  KEY idx_operations_tasks_branch_date (org_id, branch_id, task_date, status),
  KEY idx_operations_tasks_assignee (org_id, assigned_to, status, task_date),
  CONSTRAINT fk_operations_task_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_operations_task_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  CONSTRAINT fk_operations_task_assignee FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_operations_task_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE operations_task_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT UNSIGNED NOT NULL,
  org_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(32) NOT NULL,
  from_status VARCHAR(24) NULL,
  to_status VARCHAR(24) NULL,
  note VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_operations_task_events (task_id, created_at),
  CONSTRAINT fk_operations_event_task FOREIGN KEY (task_id) REFERENCES operations_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_operations_event_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_operations_event_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (code, module, description) VALUES
  ('operations:work', 'operations', 'ดูและดำเนินงาน checklist และส่งต่องานของสาขา'),
  ('operations:manage', 'operations', 'มอบหมายและจัดการงานปฏิบัติการของร้าน');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('owner','admin','manager','cashier')
  AND p.code = 'operations:work';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('owner','admin','manager')
  AND p.code = 'operations:manage';

INSERT INTO schema_migrations (version) VALUES ('040_operations_center');
