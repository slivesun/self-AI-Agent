import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { generateSlug } from '../utils.js';
import type { ShareLink } from '@resume-agent/shared';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM share_links ORDER BY created_at DESC').all() as any[];
  const list: ShareLink[] = rows.map(r => ({
    id: r.id, slug: r.slug, label: r.label, ref: r.ref,
    requireCode: !!r.require_code, code: r.code, expiresAt: r.expires_at,
    enabled: !!r.enabled, createdAt: r.created_at
  }));
  res.json({ ok: true, data: { list } });
});

router.post('/', requireAuth, (req, res) => {
  const { label = '', ref = '', requireCode = false, code = null, expiresAt = null } = req.body;
  const slug = generateSlug();
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO share_links (id, slug, label, ref, require_code, code, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, slug, label, ref, requireCode ? 1 : 0, code, expiresAt);
  res.json({ ok: true, data: { id, slug } });
});

router.put('/:id', requireAuth, (req, res) => {
  const { label, ref, requireCode, code, expiresAt, enabled } = req.body;
  db.prepare('UPDATE share_links SET label=?, ref=?, require_code=?, code=?, expires_at=?, enabled=? WHERE id=?')
    .run(label, ref, requireCode ? 1 : 0, code, expiresAt, enabled ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM share_links WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
