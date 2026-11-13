'use strict';

const db = require('../../db/pool');
const env = require('../../config/env');
const { notFound, badRequest } = require('../../core/errors');
const { localDate } = require('../../utils/dates');

const LOCAL_TODAY = `DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '${env.APP_TZ_OFFSET}'))`;

const DEFAULT_TASKS = [
  { code: 'opening-cash', type: 'checklist', shift: 'morning', title: 'ตรวจเงินเปิดกะและความพร้อมหน้าเคาน์เตอร์', link: '/pos' },
  { code: 'opening-store', type: 'checklist', shift: 'morning', title: 'ตรวจความสะอาดและความพร้อมของร้าน' },
  { code: 'receive-delivery', type: 'receiving', shift: 'morning', title: 'ตรวจรับสินค้าเทียบใบสั่งซื้อ (ถ้ามีสินค้าเข้าส่ง)', link: '/purchasing?tab=orders' },
  { code: 'shelf-restock', type: 'checklist', shift: 'day', title: 'ตรวจเติมสินค้าและจัดเรียงชั้นวาง', link: '/inventory' },
  { code: 'expiry-check', type: 'checklist', shift: 'day', title: 'ตรวจสินค้าหมดอายุและล็อตใกล้หมดอายุ', link: '/inventory/expiry' },
  { code: 'promotion-check', type: 'checklist', shift: 'day', title: 'ตรวจป้ายราคาและโปรโมชั่นหน้าร้าน', link: '/promotions' },
  { code: 'rush-hour', type: 'checklist', shift: 'evening', title: 'เตรียมร้านและทีมให้พร้อมก่อนช่วงลูกค้าเยอะ' },
  { code: 'shift-handoff', type: 'handoff', shift: 'evening', title: 'สรุปงานค้างและบรีฟส่งต่อกะถัดไป' },
];

const TASK_SELECT = `t.id, t.branch_id, b.name AS branch_name, DATE_FORMAT(t.task_date, '%Y-%m-%d') AS task_date, t.task_type, t.shift,
  t.title, t.description, t.link, t.priority, t.status, t.assigned_to, assignee.full_name AS assignee_name,
  creator.full_name AS creator_name, t.due_at, t.status_reason, t.handoff_note, t.created_at, t.updated_at,
  t.completed_at`;

function mapTask(row) {
  return {
    id: Number(row.id),
    branchId: Number(row.branch_id),
    branchName: row.branch_name,
    date: row.task_date,
    type: row.task_type,
    shift: row.shift,
    title: row.title,
    description: row.description,
    link: row.link,
    priority: row.priority,
    status: row.status,
    assignedTo: row.assigned_to == null ? null : Number(row.assigned_to),
    assigneeName: row.assignee_name,
    createdByName: row.creator_name,
    dueAt: row.due_at,
    statusReason: row.status_reason,
    handoffNote: row.handoff_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    overdue: row.status !== 'done' && row.status !== 'skipped' && (row.overdue === true || Number(row.overdue) === 1),
  };
}

async function seedDaily({ orgId, userId, branchId }) {
  const date = localDate();
  for (const task of DEFAULT_TASKS) {
    await db.query(
      `INSERT IGNORE INTO operations_tasks
        (org_id, branch_id, task_date, template_code, task_type, shift, title, link, created_by)
       VALUES (:orgId, :branchId, :date, :code, :type, :shift, :title, :link, :userId)`,
      { orgId, branchId, userId, date, ...task, link: task.link ?? null },
    );
  }
}

async function list({ orgId, userId, branchId, managed }) {
  if (!branchId) throw badRequest('กรุณาเลือกสาขา');
  const branch = await db.one('SELECT id FROM branches WHERE id = :branchId AND org_id = :orgId AND is_active = 1', { branchId, orgId });
  if (!branch) throw notFound('ไม่พบสาขาหรือสาขาถูกปิดใช้งาน');
  await seedDaily({ orgId, userId, branchId });
  const rows = await db.query(
    `SELECT ${TASK_SELECT},
        (t.task_date < ${LOCAL_TODAY} OR (t.due_at IS NOT NULL AND t.due_at < UTC_TIMESTAMP())) AS overdue
       FROM operations_tasks t
       JOIN branches b ON b.id = t.branch_id AND b.org_id = t.org_id
       LEFT JOIN users assignee ON assignee.id = t.assigned_to AND assignee.org_id = t.org_id
       JOIN users creator ON creator.id = t.created_by AND creator.org_id = t.org_id
      WHERE t.org_id = :orgId AND t.branch_id = :branchId
        AND (t.task_date = ${LOCAL_TODAY} OR (t.task_date < ${LOCAL_TODAY} AND t.status NOT IN ('done','skipped')))
        AND (:managed = 1 OR t.assigned_to IS NULL OR t.assigned_to = :userId)
      ORDER BY FIELD(t.priority, 'urgent','high','normal'), t.task_date, t.due_at IS NULL, t.due_at, t.created_at, t.id
      LIMIT 200`,
    { orgId, branchId, userId, managed: managed ? 1 : 0 },
  );
  return rows.map(mapTask);
}

async function team({ orgId, branchId }) {
  const rows = await db.query(
    `SELECT id, full_name FROM users
      WHERE org_id = :orgId AND status = 'active' AND (branch_id IS NULL OR branch_id = :branchId)
      ORDER BY full_name LIMIT 200`,
    { orgId, branchId },
  );
  return rows.map((row) => ({ id: Number(row.id), fullName: row.full_name }));
}

async function load(taskId, orgId, branchId, conn = null) {
  const one = conn
    ? (sql, params) => conn.query(sql, params).then(([rows]) => rows[0] ?? null)
    : db.one;
  const task = await one(
    `SELECT ${TASK_SELECT} FROM operations_tasks t
      JOIN branches b ON b.id = t.branch_id AND b.org_id = t.org_id
      LEFT JOIN users assignee ON assignee.id = t.assigned_to AND assignee.org_id = t.org_id
      JOIN users creator ON creator.id = t.created_by AND creator.org_id = t.org_id
      WHERE t.id = :taskId AND t.org_id = :orgId AND t.branch_id = :branchId`,
    { taskId, orgId, branchId },
  );
  if (!task) throw notFound('ไม่พบงานของสาขานี้');
  return task;
}

async function insertEvent(conn, { taskId, orgId, userId, action, fromStatus = null, toStatus = null, note = null }) {
  await conn.query(
    `INSERT INTO operations_task_events (task_id, org_id, user_id, action, from_status, to_status, note)
     VALUES (:taskId, :orgId, :userId, :action, :fromStatus, :toStatus, :note)`,
    { taskId, orgId, userId, action, fromStatus, toStatus, note },
  );
}

async function create({ orgId, userId, branchId, task }) {
  const date = localDate();
  return db.tx(async (conn) => {
    if (task.assignedTo != null) {
      const [assignees] = await conn.query(
        `SELECT id FROM users WHERE id = :id AND org_id = :orgId AND status = 'active'
          AND (branch_id IS NULL OR branch_id = :branchId)`,
        { id: task.assignedTo, orgId, branchId },
      );
      if (!assignees.length) throw badRequest('ผู้รับผิดชอบต้องเป็นผู้ใช้ที่เปิดใช้งานในองค์กรและสาขานี้');
    }
    const [result] = await conn.query(
      `INSERT INTO operations_tasks
        (org_id, branch_id, task_date, task_type, shift, title, description, priority, assigned_to, created_by, due_at, handoff_note)
       VALUES (:orgId, :branchId, :date, :type, :shift, :title, :description, :priority, :assignedTo, :userId, :dueAt, :handoffNote)`,
      {
        orgId, userId, branchId, date,
        type: task.type ?? 'checklist',
        shift: task.shift ?? 'any',
        title: task.title,
        description: task.description ?? null,
        priority: task.priority ?? 'normal',
        assignedTo: task.assignedTo ?? null,
        dueAt: task.dueAt ? new Date(task.dueAt) : null,
        handoffNote: task.handoffNote ?? null,
      },
    );
    await insertEvent(conn, { taskId: result.insertId, orgId, userId, action: 'created', toStatus: 'pending', note: task.handoffNote ?? task.description });
    const row = await load(result.insertId, orgId, branchId, conn);
    return mapTask(row);
  });
}

async function update({ orgId, userId, branchId, taskId, changes, manager }) {
  return db.tx(async (conn) => {
    const current = await load(taskId, orgId, branchId, conn);
    if (!manager && current.assigned_to != null && Number(current.assigned_to) !== userId) throw notFound('ไม่พบงานที่มอบหมายให้คุณ');
    const nextStatus = changes.status ?? current.status;
    if (!manager && nextStatus === 'pending' && nextStatus !== current.status) {
      throw badRequest('ไม่มีสิทธิ์ย้อนสถานะงานนี้');
    }
    if (!manager && ['done', 'skipped'].includes(current.status) && nextStatus !== current.status) {
      throw badRequest('งานที่ปิดแล้วต้องให้ผู้จัดการเป็นผู้เปิดใหม่');
    }
    if (changes.status === 'skipped' && !changes.reason?.trim()) throw badRequest('กรุณาระบุเหตุผลที่ข้ามงาน');
    if (changes.status === 'follow_up' && !changes.reason?.trim() && !changes.note?.trim()) throw badRequest('กรุณาระบุสาเหตุและสิ่งที่ต้องติดตาม');
    if (changes.status === 'done' && current.status === 'done') throw badRequest('งานนี้เสร็จแล้ว');

    if (changes.assignedTo !== undefined) {
      if (changes.assignedTo != null) {
        const assignee = await conn.query(
          `SELECT id FROM users WHERE id = :id AND org_id = :orgId AND status = 'active'
            AND (branch_id IS NULL OR branch_id = :branchId)`,
          { id: changes.assignedTo, orgId, branchId },
        );
        if (!assignee[0].length) throw badRequest('ผู้รับผิดชอบต้องเป็นผู้ใช้ที่เปิดใช้งานในองค์กรและสาขานี้');
      }
    }

    await conn.query(
      `UPDATE operations_tasks SET
        status = :status,
        assigned_to = IF(:hasAssignee = 1, :assignedTo, assigned_to),
        priority = IF(:hasPriority = 1, :priority, priority),
        status_reason = IF(:hasStatusReason = 1, :reason, status_reason),
        handoff_note = IF(:hasNote = 1, :note, handoff_note),
        completed_at = CASE WHEN :status = 'done' THEN UTC_TIMESTAMP() WHEN :status IN ('pending','in_progress','follow_up','skipped') THEN NULL ELSE completed_at END
       WHERE id = :taskId AND org_id = :orgId AND branch_id = :branchId`,
      {
        taskId, orgId, branchId, status: nextStatus,
        hasAssignee: changes.assignedTo !== undefined ? 1 : 0,
        assignedTo: changes.assignedTo ?? null,
        hasPriority: changes.priority !== undefined ? 1 : 0,
        priority: changes.priority ?? current.priority,
        hasStatusReason: changes.reason !== undefined || (changes.status !== undefined && !['follow_up', 'skipped'].includes(nextStatus)) ? 1 : 0,
        reason: changes.reason?.trim() || null,
        hasNote: changes.note !== undefined ? 1 : 0,
        note: changes.note?.trim() || null,
      },
    );
    const assigneeChanged = changes.assignedTo !== undefined && Number(changes.assignedTo ?? 0) !== Number(current.assigned_to ?? 0);
    const statusChanged = nextStatus !== current.status;
    const note = changes.reason?.trim() || changes.note?.trim() || null;
    if (statusChanged) {
      await insertEvent(conn, { taskId, orgId, userId, action: 'status_changed', fromStatus: current.status, toStatus: nextStatus, note });
    }
    if (assigneeChanged) {
      await insertEvent(conn, { taskId, orgId, userId, action: 'assigned', fromStatus: current.status, toStatus: nextStatus, note });
    }
    if (!statusChanged && !assigneeChanged) {
      await insertEvent(conn, { taskId, orgId, userId, action: 'updated', fromStatus: current.status, toStatus: nextStatus, note });
    }
    const row = await load(taskId, orgId, branchId, conn);
    return mapTask(row);
  });
}

async function events({ orgId, userId, branchId, taskId, manager }) {
  const task = await load(taskId, orgId, branchId);
  if (!manager && task.assigned_to != null && Number(task.assigned_to) !== userId) throw notFound('ไม่พบงานที่มอบหมายให้คุณ');
  const rows = await db.query(
    `SELECT e.id, e.action, e.from_status, e.to_status, e.note, e.created_at, u.full_name
       FROM operations_task_events e
       JOIN users u ON u.id = e.user_id AND u.org_id = e.org_id
      WHERE e.org_id = :orgId AND e.task_id = :taskId
      ORDER BY e.id DESC LIMIT 50`,
    { orgId, taskId },
  );
  return rows.map((row) => ({
    id: Number(row.id),
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    createdAt: row.created_at,
    userName: row.full_name,
  }));
}

module.exports = { list, team, create, update, events, DEFAULT_TASKS };
