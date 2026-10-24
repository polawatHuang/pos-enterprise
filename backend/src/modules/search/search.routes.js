'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/pool');
const { validate } = require('../../core/http');
const { authenticate } = require('../../core/auth');

/**
 * Global search (top bar / Ctrl+K). One request fans out to every module the user may see and
 * returns small groups, exact codes (barcode, SKU, document no.) ranked first. Each hit carries
 * the page to open, so the palette is a launcher as much as a search.
 */
const router = express.Router();
router.use(authenticate);

const PER_GROUP = 5;
const r2 = (n) => Math.round(Number(n) * 100) / 100;

const GROUPS = [
  {
    key: 'products',
    label: 'สินค้า',
    permission: 'products:read',
    async run({ orgId, like, exact, digits }) {
      const rows = await db.query(
        `SELECT p.id, p.name, p.sku, p.barcode, p.price, p.status,
                COALESCE((SELECT SUM(sl.quantity) FROM stock_levels sl WHERE sl.product_id = p.id), 0) AS on_hand,
                (p.barcode = :exact OR p.sku = :exact
                  OR EXISTS (SELECT 1 FROM product_units u WHERE u.product_id = p.id AND u.barcode = :exact)) AS exact_hit
           FROM products p
          WHERE p.org_id = :orgId AND p.status <> 'archived'
            AND (p.name LIKE :like OR p.sku LIKE :like OR p.barcode LIKE :like
                 OR (:digits <> '' AND EXISTS (SELECT 1 FROM product_units u WHERE u.product_id = p.id AND u.barcode = :exact)))
          ORDER BY exact_hit DESC, p.status = 'active' DESC, p.name LIMIT ${PER_GROUP}`,
        { orgId, like, exact, digits },
      );
      return rows.map((r) => ({
        id: `p${r.id}`,
        title: r.name,
        subtitle: `${r.sku}${r.barcode ? ` · ${r.barcode}` : ''} · คงเหลือ ${Number(r.on_hand)}`,
        meta: `฿${r2(r.price).toLocaleString('th-TH')}`,
        href: `/products/${r.id}`,
        exact: Boolean(r.exact_hit),
        badge: r.status === 'draft' ? 'ร่าง' : Number(r.on_hand) <= 0 ? 'หมด' : null,
      }));
    },
  },
  {
    key: 'customers',
    label: 'ลูกค้า / สมาชิก',
    permission: ['pos:sell', 'inbox:read'],
    async run({ orgId, like, exact, digits, user }) {
      const rows = await db.query(
        `SELECT c.id, c.name, c.phone, c.member_no, c.points, c.total_spent,
                (SELECT cv.id FROM conversations cv WHERE cv.customer_id = c.id ORDER BY cv.last_message_at DESC LIMIT 1) AS conversation_id
           FROM customers c
          WHERE c.org_id = :orgId
            AND (c.name LIKE :like OR c.member_no = :exact OR c.email LIKE :like
                 OR (:digits <> '' AND LENGTH(:digits) >= 3 AND REPLACE(REPLACE(c.phone, '-', ''), ' ', '') LIKE :digitsLike))
          ORDER BY c.member_no = :exact DESC, c.order_count DESC LIMIT ${PER_GROUP}`,
        { orgId, like, exact, digits, digitsLike: `%${digits}%` },
      );
      const inbox = user.permissions.includes('inbox:read');
      return rows.map((r) => ({
        id: `c${r.id}`,
        title: r.name,
        subtitle: [r.member_no, r.phone, `${Number(r.points)} แต้ม`].filter(Boolean).join(' · '),
        meta: `ซื้อแล้ว ฿${r2(r.total_spent).toLocaleString('th-TH')}`,
        href: inbox && r.conversation_id ? `/inbox?c=${r.conversation_id}` : null,
        exact: r.member_no === exact,
      }));
    },
  },
  {
    key: 'chats',
    label: 'แชตลูกค้า',
    permission: 'inbox:read',
    async run({ orgId, like }) {
      const rows = await db.query(
        `SELECT cv.id, cv.customer_name, cv.status, ch.platform, cv.last_message_at
           FROM conversations cv JOIN channels ch ON ch.id = cv.channel_id
          WHERE cv.org_id = :orgId AND cv.customer_name LIKE :like
          ORDER BY cv.last_message_at DESC LIMIT ${PER_GROUP}`,
        { orgId, like },
      );
      return rows.map((r) => ({ id: `cv${r.id}`, title: r.customer_name, subtitle: `${r.platform} · ${r.status}`, href: `/inbox?c=${r.id}` }));
    },
  },
  {
    key: 'documents',
    label: 'เอกสารบัญชี',
    permission: 'accounting:read',
    async run({ orgId, like, exact }) {
      const rows = await db.query(
        `SELECT id, doc_type, doc_no, party_name, total, status, DATE_FORMAT(doc_date, '%Y-%m-%d') AS doc_date
           FROM documents WHERE org_id = :orgId AND (doc_no LIKE :like OR party_name LIKE :like OR party_tax_id = :exact)
          ORDER BY doc_no = :exact DESC, id DESC LIMIT ${PER_GROUP}`,
        { orgId, like, exact },
      );
      const TYPE = {
        quotation: 'ใบเสนอราคา',
        invoice: 'ใบแจ้งหนี้',
        tax_invoice: 'ใบกำกับภาษี',
        receipt: 'ใบเสร็จ',
        tax_invoice_receipt: 'ใบกำกับ/ใบเสร็จ',
        credit_note: 'ใบลดหนี้',
        debit_note: 'ใบเพิ่มหนี้',
        billing_note: 'ใบวางบิล',
        wht_certificate: '50 ทวิ',
      };
      return rows.map((r) => ({
        id: `d${r.id}`,
        title: `${r.doc_no} · ${r.party_name ?? '-'}`,
        subtitle: `${TYPE[r.doc_type] ?? r.doc_type} · ${r.doc_date}`,
        meta: `฿${r2(r.total).toLocaleString('th-TH')}`,
        href: `/accounting/documents/${r.id}`,
        exact: r.doc_no === exact,
        badge: r.status === 'void' ? 'ยกเลิก' : r.status === 'draft' ? 'ร่าง' : null,
      }));
    },
  },
  {
    key: 'purchasing',
    label: 'ใบสั่งซื้อ / โอนย้าย / ตรวจนับ',
    permission: 'inventory:read',
    async run({ orgId, like, exact, user }) {
      const pos = await db.query(
        `SELECT po.id, po.po_no, po.status, po.total, s.name AS supplier FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
          WHERE po.org_id = :orgId AND (po.po_no LIKE :like OR s.name LIKE :like) ORDER BY po.po_no = :exact DESC, po.id DESC LIMIT 4`,
        { orgId, like, exact },
      );
      const trs = await db.query(
        `SELECT t.id, t.transfer_no, t.status, f.name AS f, w.name AS w FROM stock_transfers t
           JOIN warehouses f ON f.id = t.from_warehouse_id JOIN warehouses w ON w.id = t.to_warehouse_id
          WHERE t.org_id = :orgId AND t.transfer_no LIKE :like ORDER BY t.id DESC LIMIT 3`,
        { orgId, like },
      );
      const counts = user.permissions.includes('inventory:count')
        ? await db.query(`SELECT id, count_no, status FROM stock_counts WHERE org_id = :orgId AND count_no LIKE :like ORDER BY id DESC LIMIT 3`, {
            orgId,
            like,
          })
        : [];
      const PO = { draft: 'ร่าง', ordered: 'รอของ', partial: 'รับบางส่วน', received: 'รับครบ', cancelled: 'ยกเลิก' };
      return [
        ...pos.map((r) => ({
          id: `po${r.id}`,
          title: `${r.po_no} · ${r.supplier ?? 'ไม่ระบุผู้ขาย'}`,
          subtitle: `ใบสั่งซื้อ · ${PO[r.status]}`,
          meta: `฿${r2(r.total).toLocaleString('th-TH')}`,
          href: `/purchasing/orders/${r.id}`,
          exact: r.po_no === exact,
        })),
        ...trs.map((r) => ({
          id: `tr${r.id}`,
          title: r.transfer_no,
          subtitle: `โอนย้าย ${r.f} → ${r.w}`,
          href: '/purchasing?tab=transfers',
          exact: r.transfer_no === exact,
        })),
        ...counts.map((r) => ({ id: `sc${r.id}`, title: r.count_no, subtitle: 'รอบตรวจนับ', href: `/inventory/counts/${r.id}`, exact: r.count_no === exact })),
      ].slice(0, PER_GROUP + 2);
    },
  },
  {
    key: 'suppliers',
    label: 'ผู้ขาย',
    permission: 'inventory:read',
    async run({ orgId, like, exact }) {
      const rows = await db.query(
        `SELECT id, name, phone, lead_time_days FROM suppliers WHERE org_id = :orgId AND (name LIKE :like OR tax_id = :exact OR phone LIKE :like) ORDER BY name LIMIT 3`,
        { orgId, like, exact },
      );
      return rows.map((r) => ({
        id: `s${r.id}`,
        title: r.name,
        subtitle: `${r.phone ?? ''} · ส่งของ ${r.lead_time_days} วัน`,
        href: '/purchasing?tab=suppliers',
      }));
    },
  },
  {
    key: 'videos',
    label: 'AI Video / ปกคลิป',
    permission: 'video:create',
    async run({ orgId, like }) {
      const v = await db.query(`SELECT id, title, status FROM video_projects WHERE org_id = :orgId AND title LIKE :like ORDER BY id DESC LIMIT 3`, {
        orgId,
        like,
      });
      const c = await db.query(`SELECT id, headline, orientation FROM cover_projects WHERE org_id = :orgId AND headline LIKE :like ORDER BY id DESC LIMIT 3`, {
        orgId,
        like,
      });
      return [
        ...v.map((r) => ({ id: `v${r.id}`, title: r.title, subtitle: `วิดีโอ · ${r.status}`, href: `/videos/${r.id}` })),
        ...c.map((r) => ({
          id: `cv${r.id}`,
          title: r.headline,
          subtitle: `ปกคลิป · ${r.orientation === 'portrait' ? 'แนวตั้ง' : 'แนวนอน'}`,
          href: `/covers/${r.id}`,
        })),
      ];
    },
  },
  {
    key: 'trends',
    label: 'สินค้าเทรนด์',
    permission: 'scraping:read',
    async run({ orgId, like }) {
      const rows = await db.query(
        `SELECT id, title, platform, price, trend_score FROM trending_products WHERE org_id = :orgId AND title LIKE :like ORDER BY trend_score DESC LIMIT 4`,
        { orgId, like },
      );
      return rows.map((r) => ({
        id: `t${r.id}`,
        title: r.title,
        subtitle: `${r.platform} · คะแนนเทรนด์ ${Math.round(Number(r.trend_score ?? 0))}`,
        meta: r.price == null ? null : `฿${r2(r.price).toLocaleString('th-TH')}`,
        href: `/trends?q=${encodeURIComponent(r.title.slice(0, 60))}`,
      }));
    },
  },
];

const allowed = (user, p) => (Array.isArray(p) ? p.some((x) => user.permissions.includes(x)) : user.permissions.includes(p));

router.get('/', validate({ query: z.object({ q: z.string().trim().min(1).max(100) }) }), async (req, res) => {
  const q = req.valid.query.q;
  // LIKE wildcards typed by the user are matched literally
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const ctx = { orgId: req.user.orgId, user: req.user, like, exact: q, digits: q.replace(/\D/g, '') };
  const groups = await Promise.all(
    GROUPS.filter((g) => allowed(req.user, g.permission)).map(async (g) => ({ key: g.key, label: g.label, items: await g.run(ctx) })),
  );
  const nonEmpty = groups.filter((g) => g.items.length);
  // A group holding an exact code match (scanned barcode, document no.) goes first
  nonEmpty.sort((a, b) => Number(b.items.some((i) => i.exact)) - Number(a.items.some((i) => i.exact)));
  res.json({ data: { q, groups: nonEmpty } });
});

module.exports = { router };
