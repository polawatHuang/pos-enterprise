'use strict';

const db = require('../db/pool');
const logger = require('./logger');

/** Fire-and-forget audit entry. Never throws into the request path. */
async function audit(req, action, entityType, entityId, metadata) {
  try {
    await db.query(
      `INSERT INTO audit_logs (org_id, user_id, action, entity_type, entity_id, metadata, ip)
       VALUES (:orgId, :userId, :action, :entityType, :entityId, :metadata, :ip)`,
      {
        orgId: req.user?.orgId ?? null,
        userId: req.user?.id ?? null,
        action,
        entityType: entityType ?? null,
        entityId: entityId != null ? String(entityId) : null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        ip: req.ip ?? null,
      },
    );
  } catch (err) {
    logger.warn({ err, action }, 'audit write failed');
  }
}

module.exports = { audit };
