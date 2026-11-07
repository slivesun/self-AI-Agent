import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('../data/resume-agent.db');
const r = db.prepare("DELETE FROM visitor_sessions WHERE id NOT IN (SELECT DISTINCT session_id FROM visitor_messages)").run();
console.log('清理空会话:', r.changes);
const rows = db.prepare('SELECT id, visitor_id, created_at FROM visitor_sessions ORDER BY created_at DESC').all();
console.log('剩余会话:', rows.length);
rows.forEach(row => console.log(' ', row.id.slice(0, 8), row.created_at));
