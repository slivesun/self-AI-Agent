import { db } from './db.js';
import type { Profile, QAPair, Persona } from '@resume-agent/shared';

// 读取已发布的公开档案（过滤 private）
export function getPublicProfile(): Profile | null {
  const row = db.prepare('SELECT data FROM published_profiles WHERE id = 1').get() as { data: string } | undefined;
  if (!row) return null;
  const profile = JSON.parse(row.data) as Profile;
  profile.experiences = (profile.experiences || []).filter(e => e.visibility !== 'private');
  profile.projects = (profile.projects || []).filter(p => p.visibility !== 'private');
  profile.skills = profile.skills || [];
  profile.education = profile.education || [];
  profile.summary = profile.summary || '';
  profile.basics = profile.basics || {} as any;
  profile.basics.email = '';
  profile.basics.phone = '';
  return profile;
}

export function getPersona(): Persona | null {
  const row = db.prepare('SELECT data FROM personas WHERE id = 1').get() as { data: string } | undefined;
  return row ? JSON.parse(row.data) as Persona : null;
}

export function getEnabledQA(): QAPair[] {
  const rows = db.prepare('SELECT * FROM qa_pairs WHERE enabled = 1').all() as any[];
  return rows.map(r => {
    let variants: string[] = [];
    let tags: string[] = [];
    try {
      const v = JSON.parse(r.variants);
      variants = Array.isArray(v) ? v : String(v || '').split(/[,，\n]/).filter(Boolean);
    } catch { variants = String(r.variants || '').split(/[,，\n]/).filter(Boolean); }
    try {
      const t = JSON.parse(r.tags);
      tags = Array.isArray(t) ? t : [];
    } catch { tags = []; }
    return {
      id: r.id, question: r.question, answer: r.answer,
      variants, tags, enabled: !!r.enabled
    };
  });
}

// 获取补充知识文档内容
export function getKnowledgeDocs(): { filename: string; content: string; tags: string[] }[] {
  const rows = db.prepare('SELECT filename, content, tags FROM knowledge_docs ORDER BY created_at DESC').all() as any[];
  return rows.map(r => {
    let tags: string[] = [];
    try { tags = JSON.parse(r.tags || '[]'); } catch {}
    return { filename: r.filename, content: r.content, tags };
  });
}
