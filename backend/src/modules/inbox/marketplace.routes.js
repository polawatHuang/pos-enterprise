'use strict';

const express = require('express');
const { z } = require('zod');
const env = require('../../config/env');
const { validate } = require('../../core/http');
const { authenticate, requirePermission } = require('../../core/auth');
const { audit } = require('../../core/audit');
const shopee = require('../../integrations/shopee');
const tiktokShop = require('../../integrations/tiktok-shop');
const { signState, verifyState, requireEncryption } = require('../social/accounts.service');
const marketplace = require('./marketplace.service');

/**
 * "เชื่อมต่อร้าน Shopee / TikTok Shop" for the inbox. /start needs a session; /callback is the
 * platform's browser redirect, authenticated by the signed state (org + user, 15 minutes).
 * Redirect URLs to register with the platforms: https://<web app>/api/inbox/marketplace/<shopee|tiktok>/callback
 */
const router = express.Router();
const ADAPTERS = { shopee, tiktok: tiktokShop };
const platformParam = z.object({ platform: z.enum(['shopee', 'tiktok']) });
const appUrl = () => (env.APP_PUBLIC_URL || env.corsOrigins.find((o) => !o.includes('*')) || 'http://localhost:3000').replace(/\/+$/, '');

router.get('/:platform/start', authenticate, requirePermission('inbox:manage_ai'), validate({ params: platformParam }), (req, res) => {
  const { platform } = req.valid.params;
  ADAPTERS[platform].requireConfig();
  requireEncryption();
  res.json({ data: { url: ADAPTERS[platform].authUrl(signState({ o: req.user.orgId, u: req.user.id, p: platform, k: 'inbox' })) } });
});

router.get('/:platform/callback', validate({ params: platformParam }), async (req, res) => {
  const { platform } = req.valid.params;
  const back = (params) => res.redirect(`${appUrl()}/inbox/settings?tab=channels&${new URLSearchParams(params)}`);
  const state = verifyState(req.query.state);
  if (!state || state.p !== platform || state.k !== 'inbox') return back({ error: 'ลิงก์เชื่อมต่อหมดอายุหรือไม่ถูกต้อง กรุณาลองใหม่' });
  if (!req.query.code) return back({ error: 'ไม่ได้รับรหัสยืนยันจากแพลตฟอร์ม' });
  try {
    const r =
      platform === 'shopee'
        ? await marketplace.connectShopee(state.o, String(req.query.code), req.query.shop_id ? String(req.query.shop_id) : null)
        : await marketplace.connectTiktok(state.o, String(req.query.code));
    audit({ user: { orgId: state.o, id: state.u }, ip: req.ip }, 'inbox.channel.connect', 'channel', null, { platform, shops: r.connected });
    return back({ connected: platform, count: String(r.connected) });
  } catch (err) {
    return back({ error: String(err.message).slice(0, 200) });
  }
});

module.exports = { router };
