'use strict';

const db = require('../../db/pool');
const env = require('../../config/env');
const { badRequest, notFound } = require('../../core/errors');

const LOCAL_TODAY = `DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '${env.APP_TZ_OFFSET}'))`;
const EXPIRE_OLD = `UPDATE daily_goals SET status = 'missed'
  WHERE org_id = :orgId AND user_id = :userId AND status = 'pending' AND goal_date < ${LOCAL_TODAY}`;
const selectFields = `id, DATE_FORMAT(goal_date, '%Y-%m-%d') AS goal_date, title, status,
  created_at, completed_at`;

function mapGoal(row) {
  return {
    id: Number(row.id),
    date: row.goal_date,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

async function today({ orgId, userId }) {
  await db.query(EXPIRE_OLD, { orgId, userId });
  const rows = await db.query(
    `SELECT ${selectFields} FROM daily_goals
      WHERE org_id = :orgId AND user_id = :userId AND goal_date = ${LOCAL_TODAY}
      ORDER BY created_at, id`,
    { orgId, userId },
  );
  return rows.map(mapGoal);
}

async function create({ orgId, userId, title }) {
  const count = await db.one(
    `SELECT COUNT(*) AS count FROM daily_goals
      WHERE org_id = :orgId AND user_id = :userId AND goal_date = ${LOCAL_TODAY}`,
    { orgId, userId },
  );
  if (Number(count.count) >= 20) throw badRequest('เพิ่มเป้าหมายได้สูงสุด 20 รายการต่อวัน');
  const result = await db.query(
    `INSERT INTO daily_goals (org_id, user_id, goal_date, title)
      VALUES (:orgId, :userId, ${LOCAL_TODAY}, :title)`,
    { orgId, userId, title },
  );
  const row = await db.one(
    `SELECT ${selectFields} FROM daily_goals
      WHERE id = :id AND org_id = :orgId AND user_id = :userId`,
    { id: result.insertId, orgId, userId },
  );
  return mapGoal(row);
}

async function setStatus({ orgId, userId, id, status }) {
  const result = await db.query(
    `UPDATE daily_goals SET status = :status,
        completed_at = IF(:status = 'completed', UTC_TIMESTAMP(), NULL)
      WHERE id = :id AND org_id = :orgId AND user_id = :userId
        AND goal_date = ${LOCAL_TODAY} AND status <> 'missed'`,
    { id, orgId, userId, status },
  );
  if (!result.affectedRows) throw notFound('ไม่พบเป้าหมายวันนี้ หรือเป้าหมายหมดวันแล้ว');
  const row = await db.one(
    `SELECT ${selectFields} FROM daily_goals
      WHERE id = :id AND org_id = :orgId AND user_id = :userId`,
    { id, orgId, userId },
  );
  return mapGoal(row);
}

async function remove({ orgId, userId, id }) {
  const result = await db.query(
    `DELETE FROM daily_goals WHERE id = :id AND org_id = :orgId AND user_id = :userId
      AND goal_date = ${LOCAL_TODAY}`,
    { id, orgId, userId },
  );
  if (!result.affectedRows) throw notFound('ไม่พบเป้าหมายวันนี้');
}

async function history({ orgId, userId, days }) {
  await db.query(EXPIRE_OLD, { orgId, userId });
  const daysBeforeToday = days - 1;
  const rows = await db.query(
    `SELECT ${selectFields} FROM daily_goals
      WHERE org_id = :orgId AND user_id = :userId
        AND goal_date >= ${LOCAL_TODAY} - INTERVAL :daysBeforeToday DAY AND goal_date <= ${LOCAL_TODAY}
      ORDER BY goal_date DESC, created_at, id`,
    { orgId, userId, daysBeforeToday },
  );
  return rows.map(mapGoal);
}

module.exports = { today, create, setStatus, remove, history };
