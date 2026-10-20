'use strict';

const db = require('../../db/pool');

/**
 * Create an in-app notification once per ref_key (re-running a check never duplicates it).
 * `permission` limits who sees it (e.g. 'inventory:read'). Returns true when it is new.
 */
async function notify({ orgId, type, severity = 'info', title, body = null, link = null, permission = null, refKey }) {
  const r = await db.query(
    `INSERT IGNORE INTO notifications (org_id, type, severity, title, body, link, permission, ref_key)
     VALUES (:orgId, :type, :severity, :title, :body, :link, :permission, :refKey)`,
    { orgId, type, severity, title: title.slice(0, 191), body, link, permission, refKey: refKey.slice(0, 191) },
  );
  return r.affectedRows === 1;
}

module.exports = { notify };
