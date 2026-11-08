/**
 * 后端冒烟测试：用临时数据目录起一个隔离实例，验证关键安全/运维行为后退出。
 * 不读写仓库内 apps/data 的真实数据库。
 *
 * 用法：pnpm --filter @resume-agent/server run smoke
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.SMOKE_PORT || 4099);
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'ra-smoke-'));

process.env.PORT = String(PORT);
process.env.RESUME_DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
delete process.env.ARK_API_KEY; // 强制走"未配置 Key"分支

const base = `http://127.0.0.1:${PORT}`;
const results = [];
let failed = 0;

function check(name, passed, detail) {
  results.push(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
  if (!passed) failed += 1;
}

async function waitForServer(timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function call(method, url, { token, body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

try {
  await import('../dist/index.js');
  const up = await waitForServer();
  check('服务启动 + /api/health', up);
  if (!up) throw new Error('服务未启动');

  const login = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  check('默认口令可登录', login.status === 200 && !!login.json?.data?.token, `status=${login.status}`);
  check('登录返回 mustChangePassword=true', login.json?.data?.mustChangePassword === true);
  const token = login.json?.data?.token;

  const before = await call('GET', '/api/admin/profile', { token });
  check('改密前访问后台被拒(403)', before.status === 403 && before.json?.code === 'PASSWORD_CHANGE_REQUIRED', `status=${before.status}`);

  const change = await call('POST', '/api/auth/change-password', { token, body: { oldPassword: 'admin123', newPassword: 'Test123456' } });
  check('修改密码成功', change.status === 200 && change.json?.ok === true, `status=${change.status}`);

  const after = await call('GET', '/api/admin/profile', { token });
  check('改密后可访问后台', after.status === 200 && after.json?.ok === true, `status=${after.status}`);

  const weak = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  check('旧口令登录被拒', weak.status === 401, `status=${weak.status}`);
  const relogin = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'Test123456' } });
  check('新口令登录成功且不再强制改密', relogin.status === 200 && relogin.json?.data?.mustChangePassword === false);

  const visitorReg = await call('POST', '/api/auth/visitor/register', { body: { nickname: 'smoke', username: 'smokeuser', password: 'pwd12345' } });
  const visitorToken = visitorReg.json?.data?.token;
  const crossRole = await call('GET', '/api/admin/profile', { token: visitorToken });
  check('访客 token 访问后台被拒(403)', crossRole.status === 403, `status=${crossRole.status}`);

  const link = await call('GET', '/api/default-link');
  const slug = link.json?.data?.slug;
  const visitorId = crypto.randomUUID();
  const session = await call('POST', `/api/c/${slug}/session`, { body: { visitorId } });
  const sessionId = session.json?.data?.sessionId;
  check('访客会话创建', session.status === 200 && !!sessionId, `status=${session.status}`);

  const noOwner = await call('POST', `/api/c/${slug}/messages`, { body: { sessionId, content: '你好' } });
  check('不带 visitorId 发消息被拒(403)', noOwner.status === 403, `status=${noOwner.status}`);

  const owned = await call('POST', `/api/c/${slug}/messages`, { body: { sessionId, visitorId, content: '你好' } });
  check('带正确 visitorId 发消息成功', owned.status === 200 && !!owned.json?.data?.runId);
  check('返回短时 streamToken', typeof owned.json?.data?.streamToken === 'string');

  const readOther = await call('GET', `/api/c/${slug}/sessions/${sessionId}/messages`);
  check('不带 visitorId 读历史被拒(403)', readOther.status === 403, `status=${readOther.status}`);

  const sseNoToken = await call('GET', `/api/runs/${owned.json?.data?.runId}/events?sessionId=${sessionId}`);
  check('SSE 无 token 被拒(401)', sseNoToken.status === 401, `status=${sseNoToken.status}`);

  const notFound = await call('GET', '/api/not-exist');
  check('API 404 返回 JSON', notFound.status === 404 && notFound.json?.ok === false, `status=${notFound.status}`);

  check('JWT 密钥持久化到数据目录', existsSync(path.join(dataDir, 'jwt.secret')));

  const settings = await call('GET', '/api/admin/settings/llm', { token });
  check('模型设置接口可读且未配置 Key', settings.status === 200 && settings.json?.data?.hasApiKey === false, `status=${settings.status}`);
} catch (err) {
  check('冒烟测试执行', false, err?.message || String(err));
} finally {
  console.log(results.join('\n'));
  console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  process.exit(failed === 0 ? 0 : 1);
}
