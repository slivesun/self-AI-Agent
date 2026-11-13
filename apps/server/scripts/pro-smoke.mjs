/**
 * 专业版 P1 冒烟测试：用临时数据目录起一个隔离实例，端到端跑一遍
 * 登录 → 工作区授权 → 建会话 → 读文件 → 改文件（含权限确认）→ 审计。
 *
 * 用法：node apps/server/scripts/pro-smoke.mjs
 * 不碰真实数据目录（RESUME_DATA_DIR 指向系统临时目录）。
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(serverRoot, '..', '..');
const PORT = 3019;
const BASE = `http://127.0.0.1:${PORT}`;

const dataDir = path.join(os.tmpdir(), `pro-smoke-data-${Date.now()}`);
const workspaceDir = path.join(os.tmpdir(), `pro-smoke-ws-${Date.now()}`);

let child = null;
const failures = [];
const serverLog = [];

function ok(name, extra = '') {
  console.log(`  PASS ${name}${extra ? ` — ${extra}` : ''}`);
}
function fail(name, error) {
  failures.push({ name, error });
  console.log(`  FAIL ${name} — ${error}`);
}

async function waitHealth() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let token = '';

async function call(method, url, body, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** 读取 SSE，边读边按事件回调；允许在 permission 事件里做决策 */
async function readSse(url, onEvent, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 180_000);
  const res = await fetch(url, { signal: controller.signal });
  if (!res.ok) {
    clearTimeout(timeout);
    throw new Error(`SSE 连接失败：${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;

  while (!done) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let split = buffer.indexOf('\n\n');
    while (split !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (event === 'done' || event === 'run_error') done = true;
      try {
        await onEvent(event, data ? JSON.parse(data) : {});
      } catch (err) {
        done = true;
        throw err;
      }
      split = buffer.indexOf('\n\n');
    }
  }

  clearTimeout(timeout);
  try { reader.cancel(); } catch {}
}

async function main() {
  // 先确认端口空着：残留实例会拿旧数据目录应答，让测试结果完全失去意义
  try {
    const res = await fetch(`${BASE}/api/health`);
    if (res.ok) throw new Error(`端口 ${PORT} 已被占用，请先关闭占用该端口的进程`);
  } catch (err) {
    if (err?.message?.includes('已被占用')) throw err;
  }

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  const sampleFile = path.join(workspaceDir, 'hello.txt');
  await fs.writeFile(sampleFile, 'alpha\n第二行：这是一份测试文件\n', 'utf8');

  console.log(`临时数据目录：${dataDir}`);
  console.log(`临时工作区：${workspaceDir}`);

  // 本地开发读 apps/server/.env；CI 里没有这个文件，直接吃环境变量（.env 缺失时 --env-file 会直接报错）
  const envFile = path.join(serverRoot, '.env');
  let envArgs = [];
  try {
    await fs.access(envFile);
    envArgs = ['--env-file', envFile];
  } catch {
    console.log('（未找到 apps/server/.env，本次使用环境变量里的模型配置）');
  }

  child = spawn('npx', ['tsx', ...envArgs, 'src/index.ts'], {
    cwd: serverRoot,
    shell: true,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(PORT),
      RESUME_DATA_DIR: dataDir,
      NODE_OPTIONS: '--experimental-sqlite',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverLogLocal = serverLog;
  child.stdout.on('data', (d) => serverLogLocal.push(String(d)));
  child.stderr.on('data', (d) => serverLogLocal.push(String(d)));

  if (!(await waitHealth())) {
    console.log(serverLog.join(''));
    throw new Error('服务未能在 60 秒内启动');
  }
  ok('服务启动', `端口 ${PORT}`);

  // 专业版是独立入口，必须能被后端静态托管出来（前提是先 pnpm build:web）
  try {
    const page = await fetch(`${BASE}/pro.html`);
    const html = await page.text();
    if (page.status !== 200) throw new Error(`HTTP ${page.status}`);
    if (!/assets\/pro-/.test(html)) throw new Error('pro.html 里没有专业版入口的构建产物');
    ok('专业版入口 /pro.html 可访问');
  } catch (err) {
    fail('专业版入口可访问', `${err?.message || err}（先执行 pnpm --filter @resume-agent/web build）`);
  }

  // 登录 + 强制改密（新数据目录下默认管理员必须改密后才能用后台接口）
  let res = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  if (res.status !== 200) throw new Error(`登录失败：${JSON.stringify(res.json)}`);
  token = res.json.data.token;
  ok('管理员登录');

  res = await call('POST', '/api/auth/change-password', { oldPassword: 'admin123', newPassword: 'pro-smoke-123456' });
  if (res.status !== 200) throw new Error(`改密失败：${JSON.stringify(res.json)}`);
  res = await call('POST', '/api/auth/login', { username: 'admin', password: 'pro-smoke-123456' });
  token = res.json.data.token;
  ok('改密后重新登录');

  // ---- 登录态共用：普通版聊天页登录的会员账号应能直接用专业版；匿名访客仍被拒 ----
  {
    const reg = await fetch(`${BASE}/api/auth/visitor/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '冒烟会员', username: `smoke${Date.now() % 100000}`, password: 'smoke-123456' }),
    });
    const regJson = await reg.json().catch(() => ({}));
    const memberToken = regJson?.data?.token;
    if (!memberToken) {
      fail('会员账号能直接用专业版', `注册失败 HTTP ${reg.status} ${JSON.stringify(regJson).slice(0, 100)}`);
    } else {
      const probe = (tk) => fetch(`${BASE}/api/pro/whoami`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} });
      const memberRes = await probe(memberToken);
      const memberJson = await memberRes.json().catch(() => ({}));
      if (memberRes.status !== 200) fail('会员账号能直接用专业版', `HTTP ${memberRes.status} ${JSON.stringify(memberJson).slice(0, 100)}`);
      else ok('会员账号能直接用专业版', `role=${memberJson?.data?.role} 账号=${memberJson?.data?.name}`);

      const anonRes = await probe('anonymous');
      if (anonRes.status !== 401) fail('匿名访客被专业版拒绝', `HTTP ${anonRes.status}`);
      else ok('匿名访客被专业版拒绝', 'HTTP 401');

      const noneRes = await probe('');
      if (noneRes.status !== 401) fail('无 token 被专业版拒绝', `HTTP ${noneRes.status}`);
      else ok('无 token 被专业版拒绝', 'HTTP 401');

      const sessRes = await fetch(`${BASE}/api/pro/sessions`, { headers: { Authorization: `Bearer ${memberToken}` } });
      const sessJson = await sessRes.json().catch(() => ({}));
      if (!Array.isArray(sessJson?.data?.list)) fail('会员账号能读会话列表', `形状不对：${JSON.stringify(sessJson).slice(0, 100)}`);
      else ok('会员账号能读会话列表', `${sessJson.data.list.length} 条`);
    }
  }

  // 会话列表形状：前端读 data.list（历史 bug：返回 sessions，界面右侧会空着）
  res = await call('GET', '/api/pro/sessions');
  if (!Array.isArray(res.json?.data?.list)) fail('会话列表返回 list 字段', `实际键：${Object.keys(res.json?.data || {}).join(',')}`);
  else ok('会话列表返回 list 字段', `${res.json.data.list.length} 条`);

  // 新建会话必须回完整对象（缺 updatedAt 会让列表组件在渲染时崩掉 → 白屏）
  res = await call('POST', '/api/pro/sessions', {});
  if (!res.json?.data?.id || res.json.data.updatedAt === undefined) {
    fail('新建会话返回完整对象', JSON.stringify(res.json?.data || {}).slice(0, 120));
  } else {
    ok('新建会话返回完整对象', `${res.json.data.id.slice(0, 8)} updatedAt=${res.json.data.updatedAt}`);
    await call('DELETE', `/api/pro/sessions/${res.json.data.id}`);
  }

  // 模型可选：白名单下发 + 非法值拒绝 + 可切回"继承普通版"
  res = await call('GET', '/api/pro/settings');
  if (!Array.isArray(res.json?.data?.modelOptions) || !res.json.data.modelOptions.length) {
    fail('设置下发可选模型列表', JSON.stringify(res.json?.data || {}).slice(0, 120));
  } else {
    ok('设置下发可选模型列表', `${res.json.data.modelOptions.length} 个，当前 ${res.json.data.model}`);
  }
  res = await call('PUT', '/api/pro/settings', { model: 'not-a-real-model' });
  if (res.status !== 400) fail('非法模型被拒绝', `HTTP ${res.status}`);
  else ok('非法模型被拒绝', 'HTTP 400');
  res = await call('PUT', '/api/pro/settings', { model: 'doubao-seed-2-0-mini-260428' });
  if (res.json?.data?.modelOverride !== 'doubao-seed-2-0-mini-260428') fail('专业版模型可切换', JSON.stringify(res.json?.data || {}).slice(0, 120));
  else ok('专业版模型可切换', `modelOverride=${res.json.data.modelOverride}`);
  res = await call('PUT', '/api/pro/settings', { model: '' });
  if (res.json?.data?.modelOverride !== '') fail('模型可回到继承普通版', JSON.stringify(res.json?.data || {}).slice(0, 120));
  else ok('模型可回到继承普通版', `生效模型=${res.json.data.model}`);

  // 专业版接口在未授权时应能正常拒绝/工作
  res = await call('GET', '/api/pro/settings');
  if (res.status !== 200) throw new Error(`专业版设置读取失败：${res.status} ${JSON.stringify(res.json)}`);
  ok('专业版接口鉴权通过', `权限模式=${res.json.data.permissionMode}，工作区 ${res.json.data.workspaces.length} 个`);

  res = await call('POST', '/api/pro/workspaces', { path: workspaceDir, label: '冒烟目录' });
  if (res.status !== 200) throw new Error(`添加工作区失败：${JSON.stringify(res.json)}`);
  const workspaceId = res.json.data.id;
  ok('工作区授权', res.json.data.path);

  res = await call('POST', '/api/pro/sessions', {});
  const sessionId = res.json.data.id;
  ok('新建会话', sessionId.slice(0, 8));

  // ---- 场景 1：读文件 ----
  res = await call('POST', `/api/pro/sessions/${sessionId}/messages`, {
    content: '请读取 hello.txt，告诉我第一行是什么。只回答内容，不要做其他操作。',
  });
  if (res.status !== 200) throw new Error(`发送消息失败：${JSON.stringify(res.json)}`);
  const run1 = res.json.data;
  let seenTools = [];
  let answer1 = '';
  await readSse(`${BASE}/api/pro/runs/${run1.runId}/events?token=${encodeURIComponent(run1.streamToken)}`, async (event, data) => {
    if (event === 'delta') answer1 += data.text || '';
    if (event === 'tool') seenTools.push(`${data.name}:${data.status}`);
    if (event === 'run_error') throw new Error(`运行错误：${data.message}`);
  });

  if (!seenTools.some((t) => t.startsWith('fs_read:ok'))) fail('读文件工具被调用', `实际工具：${seenTools.join(', ') || '无'}`);
  else ok('读文件工具被调用', seenTools.join(', '));
  if (!/alpha/.test(answer1)) fail('回答包含文件内容', `回答：${answer1.slice(0, 80)}`);
  else ok('回答包含文件内容');

  // ---- 场景 2：改文件（需要权限确认）----
  res = await call('POST', `/api/pro/sessions/${sessionId}/messages`, {
    content: '把 hello.txt 第一行的 alpha 改成 beta。用 fs_edit 精确替换。',
  });
  const run2 = res.json.data;
  let permissionSeen = 0;
  let answer2 = '';
  const changesSeen = [];
  await readSse(`${BASE}/api/pro/runs/${run2.runId}/events?token=${encodeURIComponent(run2.streamToken)}`, async (event, data) => {
    if (event === 'delta') answer2 += data.text || '';
    if (event === 'change') changesSeen.push(data);
    if (event === 'permission') {
      permissionSeen += 1;
      await call('POST', `/api/pro/runs/${run2.runId}/permission`, { requestId: data.requestId, decision: 'once' });
    }
    if (event === 'run_error') throw new Error(`运行错误：${data.message}`);
  });

  if (permissionSeen === 0) fail('写操作触发权限确认', '没有收到 permission 事件');
  else ok('写操作触发权限确认', `${permissionSeen} 次`);

  const content = await fs.readFile(sampleFile, 'utf8');
  if (!content.startsWith('beta')) fail('文件真的被修改', `实际内容：${content.slice(0, 40)}`);
  else ok('文件真的被修改', JSON.stringify(content.split('\n')[0]));

  // ---- 场景 2b：改动清单 + diff + 一键回滚 ----
  const firstChange = changesSeen[0];
  if (!firstChange) fail('推送 change 事件', '没收到 change 事件');
  else if (!/\n\+\S/.test(`\n${firstChange.diff}`) || !/\n-\S/.test(`\n${firstChange.diff}`)) {
    fail('change 事件带 diff', `diff=${String(firstChange.diff).slice(0, 80)}`);
  } else ok('change 事件带 diff', `${changesSeen.length} 个改动，diff 含 +/-`);

  res = await call('GET', `/api/pro/changes?sessionId=${sessionId}&limit=20`);
  const changeList = res.json?.data?.list || [];
  if (!changeList.length) fail('改动清单有记录', '接口返回 0 条');
  else ok('改动清单有记录', `${changeList.length} 条，首条 ${changeList[0].filePath}`);

  if (changeList[0]) {
    res = await call('POST', `/api/pro/changes/${changeList[0].id}/rollback`, {});
    if (res.status !== 200) fail('一键回滚', `HTTP ${res.status} ${JSON.stringify(res.json)}`);
    else {
      const restored = await fs.readFile(sampleFile, 'utf8');
      if (!restored.startsWith('alpha')) fail('回滚后文件恢复', `实际内容：${restored.slice(0, 40)}`);
      else ok('一键回滚后文件恢复', JSON.stringify(restored.split('\n')[0]));
    }
  }

  // ---- 场景 2c：项目扫描 ----
  res = await call('GET', `/api/pro/workspaces/${workspaceId}/scan`);
  const scan = res.json?.data;
  if (!scan || !scan.files) fail('项目扫描', `返回：${JSON.stringify(res.json).slice(0, 120)}`);
  else ok('项目扫描', `${scan.files} 个文件 / ${scan.dirs} 个目录，类型 ${scan.byExt.length} 类`);

  // ---- 场景 2d：执行命令（X 级必须弹权限，退出码与输出要真实）----
  res = await call('POST', `/api/pro/sessions/${sessionId}/messages`, {
    content: '在工作区执行命令 node -v，然后告诉我 node 的版本号。只跑这一条命令，不要做别的。',
  });
  const run4 = res.json.data;
  const tools4 = [];
  let answer4 = '';
  let shellPreview = '';
  await readSse(`${BASE}/api/pro/runs/${run4.runId}/events?token=${encodeURIComponent(run4.streamToken)}`, async (event, data) => {
    if (event === 'delta') answer4 += data.text || '';
    if (event === 'tool') tools4.push(`${data.name}:${data.status}`);
    if (event === 'permission') {
      if (data.tool === 'shell_run') shellPreview = data.preview || '';
      await call('POST', `/api/pro/runs/${run4.runId}/permission`, { requestId: data.requestId, decision: 'once' });
    }
    if (event === 'run_error') throw new Error(`运行错误：${data.message}`);
  });

  if (!tools4.some((t) => t === 'shell_run:ok')) fail('执行命令工具被调用', `实际工具：${tools4.join(', ') || '无'}`);
  else ok('执行命令工具被调用', tools4.filter((t) => t.startsWith('shell_')).join(', '));
  if (!/v?\d+\.\d+/.test(answer4)) fail('命令输出真实回填', `回答：${answer4.slice(0, 100)}`);
  else ok('命令输出真实回填', answer4.match(/v?\d+\.\d+[^\n]*/)?.[0] || '');
  if (!shellPreview) fail('命令执行弹权限卡', '没有收到 shell_run 的 permission 事件');
  else ok('命令执行弹权限卡', shellPreview.slice(0, 60));

  // ---- 场景 3：审计与用量 ----
  res = await call('GET', '/api/pro/audit?limit=20');
  const auditCount = res.json?.data?.list?.length || 0;
  if (auditCount === 0) fail('审计有记录', '0 条');
  else ok('审计有记录', `${auditCount} 条`);

  res = await call('GET', '/api/pro/settings');
  const usage = res.json.data.usage;
  if (!usage.totalRuns) fail('用量分账有记录', JSON.stringify(usage));
  else ok('用量分账有记录', `今日 ${usage.todayRuns} 次 / ${usage.todayTokens} tokens`);

  // ---- 场景 4：路径越界必须被拒 ----
  const escapeFile = path.join(workspaceDir, '..', 'pro-smoke-escape.txt');
  await fs.writeFile(escapeFile, 'should not be readable', 'utf8');
  res = await call('POST', `/api/pro/sessions/${sessionId}/messages`, {
    content: `读取 ${escapeFile} 的内容。`,
  });
  const run3 = res.json.data;
  let answer3 = '';
  const tools3 = [];
  await readSse(`${BASE}/api/pro/runs/${run3.runId}/events?token=${encodeURIComponent(run3.streamToken)}`, async (event, data) => {
    if (event === 'delta') answer3 += data.text || '';
    if (event === 'tool') tools3.push(`${data.name}:${data.status}`);
    if (event === 'run_error') throw new Error(`运行错误：${data.message}`);
  });
  const blocked = tools3.some((t) => t.includes('error')) && !/should not be readable/.test(answer3);
  if (!blocked) fail('工作区外路径被拒绝', `工具：${tools3.join(', ')}，回答：${answer3.slice(0, 60)}`);
  else ok('工作区外路径被拒绝', tools3.join(', '));

  await fs.rm(escapeFile, { force: true });

  // ---- 场景 5（P3）：产物库、图像设置、Word 导出 ----

  // 5a：自研 docx 生成器能不能被真实解析器（mammoth）读回
  const docxCheck = spawnSync('npx', ['tsx', 'scripts/pro-docx-check.mjs', 'unit'], {
    cwd: serverRoot,
    shell: true,
    encoding: 'utf8',
  });
  const docxOut = (docxCheck.stdout || '').trim();
  if (docxCheck.status !== 0) fail('docx 生成器可被解析器读回', (docxCheck.stderr || docxOut || '无输出').slice(-200));
  else ok('docx 生成器可被解析器读回', docxOut.split('\n').pop());

  // 5b：设置里有图像字段，并且能存能清
  res = await call('GET', '/api/pro/settings');
  const settingsNow = res.json?.data || {};
  if (!('imageModel' in settingsNow) || typeof settingsNow.imageApiKeySet !== 'boolean') {
    fail('设置返回图像字段', JSON.stringify(settingsNow).slice(0, 120));
  } else {
    ok('设置返回图像字段', `imageModel=${settingsNow.imageModel || '(未配置)'} keySet=${settingsNow.imageApiKeySet}`);
  }
  res = await call('PUT', '/api/pro/settings', { imageModel: 'pro-smoke-image-model' });
  if (res.json?.data?.imageModel !== 'pro-smoke-image-model') fail('图像模型可保存', JSON.stringify(res.json).slice(0, 120));
  else ok('图像模型可保存', res.json.data.imageModel);
  await call('PUT', '/api/pro/settings', { imageModel: '' }); // 还原成未配置，保持"未配置要如实报错"的默认语义

  // 5c：产物接口基本形状（列表可读、不存在的产物返回 404）
  res = await call('GET', '/api/pro/artifacts');
  if (res.status !== 200 || !Array.isArray(res.json?.data?.list)) {
    fail('产物列表接口', `HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 100)}`);
  } else {
    ok('产物列表接口', `当前 ${res.json.data.list.length} 条`);
  }
  res = await call('GET', '/api/pro/artifacts/not-a-real-id/file');
  if (res.status !== 404) fail('不存在的产物返回 404', `HTTP ${res.status}`);
  else ok('不存在的产物返回 404');

  // 5d：真的导出一份 Word，产物入库、文件能下载、能用解析器读回文字
  res = await call('POST', `/api/pro/sessions/${sessionId}/messages`, {
    content:
      '请用 doc_export 工具把下面这段内容导出成 Word 文档，标题必须是「冒烟文档」，导出后不要再自己复述一遍全文：\n\n# 冒烟文档\n\n第二行：这是一份冒烟测试文档。\n\n第三行：能看到这句话说明 docx 导出成功。\n',
  });
  const run5 = res.json.data;
  const tools5 = [];
  const artifacts5 = [];
  await readSse(`${BASE}/api/pro/runs/${run5.runId}/events?token=${encodeURIComponent(run5.streamToken)}`, async (event, data) => {
    if (event === 'tool') tools5.push(`${data.name}:${data.status}`);
    if (event === 'artifact') artifacts5.push(data);
    if (event === 'permission') await call('POST', `/api/pro/runs/${run5.runId}/permission`, { requestId: data.requestId, decision: 'once' });
    if (event === 'run_error') throw new Error(`运行错误：${data.message}`);
  });

  if (!tools5.some((t) => t === 'doc_export:ok')) fail('doc_export 被调用', `工具：${tools5.join(', ') || '无'}`);
  else ok('doc_export 被调用');
  const docArtifact = artifacts5.find((a) => a.kind === 'doc');
  if (!docArtifact) fail('导出后收到 artifact 事件', `事件：${artifacts5.map((a) => a.kind).join(', ') || '无'}`);
  else ok('导出后收到 artifact 事件', `${docArtifact.title} / ${docArtifact.size} 字节`);

  if (docArtifact) {
    res = await call('GET', `/api/pro/artifacts?kind=doc&limit=10`);
    const listed = (res.json?.data?.list || []).find((a) => a.id === docArtifact.id);
    if (!listed) fail('产物库里能查到这份 Word', `列表里没有 ${docArtifact.id}`);
    else ok('产物库里能查到这份 Word', `${listed.title} ${listed.mime}`);

    // ?token= 是给 <img>/iframe 用的通道，这里顺带验证它真的能取到文件
    try {
      const fileRes = await fetch(`${BASE}/api/pro/artifacts/${docArtifact.id}/file?token=${encodeURIComponent(token)}`);
      if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
      const buf = Buffer.from(await fileRes.arrayBuffer());
      if (!buf.length) throw new Error('下载到的文件是空的');
      ok('产物文件可用 ?token= 下载', `${buf.length} 字节`);

      const tmpDocx = path.join(dataDir, 'smoke-artifact.docx');
      await fs.writeFile(tmpDocx, buf);
      const readBack = spawnSync('npx', ['tsx', 'scripts/pro-docx-check.mjs', 'file', tmpDocx], {
        cwd: serverRoot,
        shell: true,
        encoding: 'utf8',
      });
      if (readBack.status !== 0) {
        fail('导出的 Word 能读回文字', (readBack.stderr || readBack.stdout || '').trim().slice(-200));
      } else {
        ok('导出的 Word 能读回文字', (readBack.stdout || '').trim().split('\n').pop());
      }
    } catch (err) {
      fail('产物文件可用 ?token= 下载', err?.message || String(err));
    }
  }

  // ---- 场景 6（P4）：联网开关（总开关 + 单轮开关）与联网痕迹 ----

  // 6a：设置里有搜索引擎，且只接受 baidu / bing
  res = await call('GET', '/api/pro/settings');
  const engineNow = res.json?.data?.searchEngine;
  if (!['baidu', 'bing'].includes(engineNow)) fail('设置返回搜索引擎', String(engineNow));
  else ok('设置返回搜索引擎', engineNow);
  res = await call('PUT', '/api/pro/settings', { searchEngine: 'google' });
  if (res.status !== 400) fail('非法搜索引擎被拒绝', `HTTP ${res.status}`);
  else ok('非法搜索引擎被拒绝');
  res = await call('PUT', '/api/pro/settings', { searchEngine: 'bing' });
  if (res.json?.data?.searchEngine !== 'bing') fail('搜索引擎可切换', JSON.stringify(res.json).slice(0, 120));
  else ok('搜索引擎可切换', 'bing');
  await call('PUT', '/api/pro/settings', { searchEngine: 'baidu' });

  // 6b：总开关关掉 → 联网工具根本不会出现在模型可见的工具列表里（表现为全程没有 web_* 调用）
  const askSearch = '帮我在网上查一下 Electron 最新的稳定版本是多少，并把链接给我。';
  await call('PUT', '/api/pro/settings', { searchEnabled: false });
  res = await call('POST', `/api/pro/sessions/${sessionId}/messages`, { content: askSearch });
  {
    const runOff = res.json.data;
    const toolsOff = [];
    let startOff = null;
    let metaOff = null;
    await readSse(`${BASE}/api/pro/runs/${runOff.runId}/events?token=${encodeURIComponent(runOff.streamToken)}`, async (event, data) => {
      if (event === 'start') startOff = data;
      if (event === 'tool') toolsOff.push(`${data.name}:${data.status}`);
      if (event === 'permission') await call('POST', `/api/pro/runs/${runOff.runId}/permission`, { requestId: data.requestId, decision: 'once' });
      if (event === 'done') metaOff = data;
      if (event === 'run_error') throw new Error(`运行错误：${data.message}`);
    });
    if (startOff?.searchEnabled !== false) fail('总开关关闭时 start 事件声明未联网', JSON.stringify(startOff).slice(0, 80));
    else ok('总开关关闭时 start 事件声明未联网');
    if (toolsOff.some((t) => t.startsWith('web_search') || t.startsWith('web_fetch'))) {
      fail('总开关关闭时联网工具不可用', toolsOff.join(', '));
    } else {
      ok('总开关关闭时联网工具不可用', toolsOff.length ? `调用了 ${toolsOff.length} 个其他工具` : '无工具调用');
    }
    res = await call('GET', `/api/pro/sessions/${sessionId}/messages`).catch(() => ({ json: null }));
    const lastAssistant = (res.json?.data?.messages || []).filter((m) => m.role === 'assistant').pop();
    if (!lastAssistant || lastAssistant.meta?.search?.enabled !== false) {
      fail('助手消息记录"本轮未联网"', JSON.stringify(lastAssistant?.meta?.search || null));
    } else {
      ok('助手消息记录"本轮未联网"');
    }
  }
  await call('PUT', '/api/pro/settings', { searchEnabled: true });

  // 6c：总开关开着、但本轮显式 search:false → 同样不联网
  res = await call('POST', `/api/pro/sessions/${sessionId}/messages`, { content: askSearch, search: false });
  {
    const runTurn = res.json.data;
    const toolsTurn = [];
    let startTurn = null;
    await readSse(`${BASE}/api/pro/runs/${runTurn.runId}/events?token=${encodeURIComponent(runTurn.streamToken)}`, async (event, data) => {
      if (event === 'start') startTurn = data;
      if (event === 'tool') toolsTurn.push(`${data.name}:${data.status}`);
      if (event === 'permission') await call('POST', `/api/pro/runs/${runTurn.runId}/permission`, { requestId: data.requestId, decision: 'once' });
      if (event === 'run_error') throw new Error(`运行错误：${data.message}`);
    });
    if (startTurn?.searchEnabled !== false) fail('单轮关闭联网生效', JSON.stringify(startTurn).slice(0, 80));
    else ok('单轮关闭联网生效');
    if (toolsTurn.some((t) => t.startsWith('web_'))) fail('单轮关闭时联网工具不可用', toolsTurn.join(', '));
    else ok('单轮关闭时联网工具不可用', toolsTurn.length ? toolsTurn.join(', ') : '无工具调用');
  }

  // 6d：真联网（依赖外网，失败只记 warn 不判失败，避免网络波动把整轮结论带偏）
  if (process.env.PRO_SMOKE_NET === '0') {
    ok('真实联网搜索（已按 PRO_SMOKE_NET=0 跳过）', 'skipped');
  } else {
    res = await call('POST', `/api/pro/sessions/${sessionId}/messages`, {
      content: '用 web_search 搜一下「Electron 是什么」，最多 3 条，把标题和真实链接列出来。搜不到就直说。',
      search: true,
    });
    {
      const runNet = res.json.data;
      const toolsNet = [];
      const searches = [];
      let metaNet = null;
      await readSse(`${BASE}/api/pro/runs/${runNet.runId}/events?token=${encodeURIComponent(runNet.streamToken)}`, async (event, data) => {
        if (event === 'tool') toolsNet.push(`${data.name}:${data.status}`);
        if (event === 'search') searches.push(data);
        if (event === 'permission') await call('POST', `/api/pro/runs/${runNet.runId}/permission`, { requestId: data.requestId, decision: 'once' });
        if (event === 'done') metaNet = data;
        if (event === 'run_error') throw new Error(`运行错误：${data.message}`);
      });
      const searchCalled = toolsNet.some((t) => t.startsWith('web_search'));
      if (!searchCalled) {
        fail('真实联网：web_search 被调用', `工具：${toolsNet.join(', ') || '无'}`);
      } else if (!searches.length) {
        fail('真实联网：收到 search 事件', `工具：${toolsNet.join(', ')}`);
      } else {
        const withRealUrl = searches.flatMap((s) => s.items || []).filter((i) => i.url && !/baidu\.com\/link/.test(i.url));
        if (!withRealUrl.length) fail('真实联网：拿到可引用的真实链接', JSON.stringify(searches[0]).slice(0, 160));
        else ok('真实联网：web_search 返回真实结果', `${withRealUrl.length} 条，例：${withRealUrl[0].site} ${withRealUrl[0].url.slice(0, 60)}`);
      }
    }
  }

  // ---- 场景 7（P4）：系统控制与任务面板 ----

  // 7a：系统服务自检（真实截屏 / 剪贴板往返 / 危险目标校验）——独立进程跑，避免污染本进程
  const sysCheck = spawnSync('npx', ['tsx', 'scripts/pro-system-check.mjs'], {
    cwd: serverRoot,
    shell: true,
    encoding: 'utf8',
  });
  const sysOut = (sysCheck.stdout || '').trim();
  if (sysCheck.status !== 0) {
    fail('系统服务自检（信息/剪贴板/截屏）', (sysCheck.stderr || sysOut || '无输出').slice(-240));
  } else {
    const passed = sysOut.split('\n').filter((l) => l.startsWith('PASS')).length;
    const skipped = sysOut.split('\n').filter((l) => l.startsWith('SKIP')).length;
    ok('系统服务自检（信息/剪贴板/截屏）', `${passed} 项通过${skipped ? `、${skipped} 项跳过（平台不支持）` : ''}`);
  }

  // 7b：任务面板接口基本形状
  res = await call('GET', '/api/pro/todos');
  if (res.status !== 200 || !Array.isArray(res.json?.data?.list) || !res.json?.data?.stats) {
    fail('任务列表接口', `HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 120)}`);
  } else {
    ok('任务列表接口', `当前 ${res.json.data.list.length} 条`);
  }

  // 7c：任务增改删闭环
  res = await call('POST', '/api/pro/todos', { title: '冒烟待办' });
  const todoId = res.json?.data?.todo?.id;
  if (!todoId) {
    fail('任务可新增', JSON.stringify(res.json).slice(0, 120));
  } else {
    ok('任务可新增', `${res.json.data.todo.title} ${todoId.slice(0, 8)}`);
    res = await call('PATCH', `/api/pro/todos/${todoId}`, { status: 'done' });
    if (res.json?.data?.todo?.status !== 'done') fail('任务可改成完成', JSON.stringify(res.json).slice(0, 120));
    else ok('任务可改成完成', `stats.done=${res.json.data.stats.done}`);
    res = await call('DELETE', `/api/pro/todos/${todoId}`);
    if (res.status !== 200) fail('任务可删除', `HTTP ${res.status}`);
    else ok('任务可删除');
  }

  // 7d：让助手真的用 todo_set 与 system_info（R 级，不弹权限卡）
  res = await call('POST', `/api/pro/sessions/${sessionId}/messages`, {
    content:
      '请做两件事：① 用 todo_set 新增一条待办，标题是「冒烟任务A」，然后把它的状态改成 done；② 用 system_info 看一下这台机器的内存和屏幕分辨率，用一句话报给我。不要做别的事。',
    search: false,
  });
  {
    const runSys = res.json.data;
    const toolsSys = [];
    const todoEvents = [];
    await readSse(`${BASE}/api/pro/runs/${runSys.runId}/events?token=${encodeURIComponent(runSys.streamToken)}`, async (event, data) => {
      if (event === 'tool') toolsSys.push(`${data.name}:${data.status}`);
      if (event === 'todo') todoEvents.push(data);
      if (event === 'permission') await call('POST', `/api/pro/runs/${runSys.runId}/permission`, { requestId: data.requestId, decision: 'once' });
      if (event === 'run_error') throw new Error(`运行错误：${data.message}`);
    });
    if (!toolsSys.some((t) => t === 'todo_set:ok')) fail('助手调用 todo_set', `工具：${toolsSys.join(', ') || '无'}`);
    else ok('助手调用 todo_set', toolsSys.filter((t) => t.startsWith('todo_set')).join(', '));
    if (!toolsSys.some((t) => t === 'system_info:ok')) fail('助手调用 system_info', `工具：${toolsSys.join(', ') || '无'}`);
    else ok('助手调用 system_info');
    if (!todoEvents.length) fail('任务变更推送 todo 事件', `事件数 0，工具：${toolsSys.join(', ')}`);
    else ok('任务变更推送 todo 事件', todoEvents.map((e) => e.action).join(', '));
  }
}

main()
  .catch((err) => {
    console.log(`\n冒烟测试中断：${err?.message || err}`);
    failures.push({ name: '流程中断', error: err?.message || String(err) });
  })
  .finally(async () => {
    if (child) {
      // Windows 下 child.kill() 只杀 shell，npx 拉起的 node 会活下来继续占端口
      if (process.platform === 'win32') {
        try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
      } else {
        try { child.kill('SIGTERM'); } catch {}
      }
    }
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});

    console.log(`\n=== 结果：${failures.length ? `${failures.length} 项失败` : '全部通过'} ===`);
    if (failures.length) {
      console.log('\n--- 服务端日志（末尾 40 行）---');
      console.log(serverLog.join('').split('\n').slice(-40).join('\n'));
      for (const f of failures) console.log(` - ${f.name}: ${f.error}`);
      process.exit(1);
    }
    process.exit(0);
  });
