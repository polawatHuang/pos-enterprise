'use strict';

const db = require('../../db/pool');
const logger = require('../../core/logger');
const metaSocial = require('../../integrations/meta-social');
const { saveChannelToken } = require('./inbox.service');

/**
 * Facebook Login for the inbox: every page the user manages becomes a Messenger channel, and its
 * linked Instagram professional account an Instagram Direct channel, each with the page token.
 * The page is subscribed to the app's webhook so messages arrive without manual setup per page.
 * @param {{id, name, token, instagram?: {id, username}}[]} pages from metaSocial.listPages
 * @returns {{connected:number, warnings:string[]}}
 */
async function connectInboxPages(orgId, pages) {
  let connected = 0;
  const warnings = [];
  for (const page of pages) {
    const targets = [{ platform: 'facebook', externalId: page.id, name: page.name }];
    if (page.instagram)
      targets.push({
        platform: 'instagram',
        externalId: page.instagram.id,
        name: page.instagram.username ? `@${page.instagram.username}` : `${page.name} (IG)`,
      });
    for (const t of targets) {
      await db.query(
        `INSERT INTO channels (org_id, platform, name, external_id, ai_enabled, is_active) VALUES (:orgId, :platform, :name, :externalId, 1, 1)
         ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
        { orgId, ...t },
      );
      await saveChannelToken(
        { org_id: orgId, platform: t.platform, external_id: t.externalId },
        page.token,
        t.platform === 'instagram' ? { pageId: page.id } : {},
      );
      connected += 1;
    }
    try {
      await metaSocial.subscribeMessages(page.id, page.token);
    } catch (err) {
      // Usually a missing pages_manage_metadata / pages_messaging permission on the app
      logger.warn({ err: err.message, pageId: page.id }, 'subscribe page to webhook failed');
      warnings.push(`เพจ ${page.name}: รับข้อความอัตโนมัติไม่ได้ (${err.message})`);
    }
  }
  return { connected, warnings };
}

module.exports = { connectInboxPages };
