import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { requireAuth, requirePasswordChanged, signStreamToken, verifyStreamToken, verifyToken } from '../auth.js';
import { db } from '../db.js';
import { rateLimit } from '../rateLimit.js';
import { resolveModel, isAllowedModel, ALLOWED_MODELS } from '../llm.js';
import { fixFilename } from '../utils.js';
import {
  initProDb,
  listProSessions,
  createProSession,
  updateProSession,
  deleteProSession,
  sessionExists,
  listProMessages,
  insertProMessage,
  recordProAudit,
  recordProUsage,
  usageSummary,
  proDb,
  listProChanges,
  listProChangesByRun,
  listProArtifacts,
  listProArtifactsByRun,
  getProArtifact,
  deleteProArtifact,
  insertProArtifact,
} from '../pro/db.js';
import { PRO_UPLOADS_DIR, PRO_ARTIFACTS_DIR } from '../pro/paths.js';
import { getProSetting, setProSetting, getPermissionMode, isSearchEnabled, getSearchEngine, getProModel } from '../pro/settings.js';
import { listWorkspaces, addWorkspace, removeWorkspace } from '../pro/workspace.js';
import { runProAgent } from '../pro/agent.js';
import { scanProject } from '../pro/project.js';
import { rollbackChange } from '../pro/changes.js';
import { commandRisks } from '../pro/tools/shell.js';
import type { PermissionDecision } from '../pro/tools/types.js';
import { listTodos, addTodo, updateTodo, deleteTodo, todoStats } from '../pro/todos.js';

initProDb();

const router = Router();
const MAX_MESSAGE_LENGTH = 4000;

// 专业版接口与普通版共用登录态：管理员 token 与"普通版聊天页登录的注册账号"token 都接受，
// 但匿名访客（token 为 anonymous）仍然拒绝。
// 例外一：SSE 事件流用不了 Authorization 头，改用发送消息时下发的短时 streamToken（绑定 runId+sessionId）。
// 例外二：<img>/iframe 也带不了请求头，产物文件允许用 ?token= 已登录账号 JWT 访问（仅限 /artifacts/:id/file 这一条读接口）。
const ARTIFACT_FILE_PATH = /^\/artifacts\/[^/]+\/file$/;

/** 从 Authorization 里取出并校验账号身份；返回 payload 或错误描述 */
function readAccount(req: any): { payload?: any; status?: number; code?: string; error?: string } {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return { status: 401, code: 'UNAUTHORIZED', error: '未登录' };
  const payload = verifyToken(header.slice(7));
  if (!payload) return { status: 401, code: 'UNAUTHORIZED', error: 'token 无效或已过期' };

  if (payload.role === 'admin') {
    const row = db.prepare('SELECT id, must_change_password FROM users WHERE id = ?').get(Number(payload.sub)) as
      { id: number; must_change_password: number } | undefined;
    if (!row) return { status: 401, code: 'UNAUTHORIZED', error: '账号不存在' };
    return { payload, ...(row.must_change_password ? { status: 403, code: 'PASSWORD_CHANGE_REQUIRED', error: '请先修改默认密码' } : {}) };
  }

  if (payload.role === 'visitor') {
    // 普通版聊天页登录的是注册会员（visitor_users），共用同一个登录态
    const row = db.prepare('SELECT id FROM visitor_users WHERE id = ?').get(String(payload.sub));
    if (!row) return { status: 401, code: 'UNAUTHORIZED', error: '账号不存在' };
    return { payload };
  }

  return { status: 403, code: 'FORBIDDEN', error: '无权访问' };
}

const requireProAccount = (req: any, res: any, next: any) => {
  if (/^\/runs\/[^/]+\/events$/.test(req.path)) return next();
  if (ARTIFACT_FILE_PATH.test(req.path)) {
    const proof = verifyToken(String(req.query.token || ''));
    if (proof && (proof.role === 'admin' || proof.role === 'visitor')) return next();
  }
  const account = readAccount(req);
  if (!account.payload) return res.status(account.status || 401).json({ ok: false, code: account.code, error: account.error });
  req.user = account.payload;
  next();
};
router.use(requireProAccount);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req: any, _file: any, cb: (error: Error | null, dir: string) => void) => cb(null, PRO_UPLOADS_DIR),
    filename: (_req: any, file: any, cb: (error: Error | null, name: string) => void) => {
      const ext = path.extname(file?.originalname || '').toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const messageLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: '发送过于频繁，请稍后再试' });

// ===== 运行态（内存）：待执行的 run + 权限等待队列 =====

interface PermissionGate {
  request(input: { tool: string; level: string; args: any; preview: string }): Promise<PermissionDecision>;
  decide(requestId: string, decision: PermissionDecision): boolean;
  cancelAll(): void;
}

interface PendingRun {
  sessionId: string;
  userMsgId: string;
  content: string;
  createdAt: number;
  allowedTools: Set<string>;
  gate: PermissionGate;
  consumed: boolean;
  /** 本轮是否允许联网（总开关 + 单轮开关合并后的结果） */
  searchEnabled: boolean;
}

const pendingRuns = new Map<string, PendingRun>();

setInterval(() => {
  const now = Date.now();
  for (const [key, run] of pendingRuns) {
    if (now - run.createdAt > 10 * 60 * 1000) {
      run.gate.cancelAll();
      pendingRuns.delete(key);
    }
  }
}, 60_000).unref?.();

function createGate(emit: (event: string, data: any) => void): PermissionGate {
  const waiters = new Map<string, (decision: PermissionDecision) => void>();

  return {
    request(input) {
      const requestId = crypto.randomUUID();
      let preview = '';
      try { preview = JSON.stringify(input.args ?? {}).slice(0, 500); } catch { preview = ''; }
      emit('permission', {
        requestId,
        tool: input.tool,
        level: input.level,
        preview: input.preview,
        args: preview,
      });
      return new Promise<PermissionDecision>((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(requestId);
          resolve('deny');
        }, 120_000);
        waiters.set(requestId, (decision) => {
          clearTimeout(timer);
          waiters.delete(requestId);
          resolve(decision);
        });
      });
    },
    decide(requestId, decision) {
      const waiter = waiters.get(requestId);
      if (!waiter) return false;
      waiter(decision);
      return true;
    },
    cancelAll() {
      for (const [, waiter] of waiters) waiter('deny');
      waiters.clear();
    },
  };
}

// ===== 会话 =====

router.get('/whoami', (req, res) => {
  const user = (req as any).user || {};
  res.json({ ok: true, data: { name: user.name || '本机用户', username: user.name || '本机用户', role: user.role || 'admin' } });
});

router.get('/sessions', (_req, res) => {
  // 前端读 data.list（与其它列表接口保持一致；sessions 保留给老调用方）
  const list = listProSessions();
  res.json({ ok: true, data: { list, sessions: list } });
});

router.post('/sessions', (req, res) => {
  const id = crypto.randomUUID();
  const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 60) : '新会话';
  createProSession(id, title);
  // 返回完整会话对象：前端会把返回值直接塞进列表渲染，缺 updatedAt 会让列表组件崩
  const created = listProSessions().find((s) => s.id === id);
  res.json({ ok: true, data: created || { id, title } });
});

router.patch('/sessions/:id', (req, res) => {
  const ok = updateProSession(req.params.id, {
    title: typeof req.body?.title === 'string' ? req.body.title : undefined,
    pinned: typeof req.body?.pinned === 'boolean' ? req.body.pinned : undefined,
  });
  if (!ok) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true, data: { id: req.params.id } });
});

router.delete('/sessions/:id', (req, res) => {
  deleteProSession(req.params.id);
  res.json({ ok: true, data: {} });
});

router.get('/sessions/:id/messages', (req, res) => {
  if (!sessionExists(req.params.id)) return res.status(404).json({ ok: false, error: '会话不存在' });
  const messages = listProMessages(req.params.id).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    meta: m.meta,
    createdAt: m.createdAt,
  }));
  res.json({ ok: true, data: { list: messages, messages } });
});

// 发送消息：只落用户消息 + 准备一次 run，真正的模型调用在 SSE 连接里进行
router.post('/sessions/:id/messages', messageLimiter, (req, res) => {
  const sessionId = req.params.id;
  const content = String(req.body?.content || '').trim();
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments.slice(0, 5) : [];
  // 单轮联网开关：只有总开关开着、且本轮没被显式关掉，才允许联网
  const globalSearch = isSearchEnabled();
  const searchEnabled = globalSearch && req.body?.search !== false;

  if (!sessionExists(sessionId)) return res.status(404).json({ ok: false, error: '会话不存在' });
  if (!content && !attachments.length) return res.status(400).json({ ok: false, error: '请输入内容' });
  if (content.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ ok: false, error: `内容过长，最多 ${MAX_MESSAGE_LENGTH} 字` });
  }

  const userMsgId = crypto.randomUUID();
  const attachmentMeta = attachments
    .filter((a: any) => a && typeof a.path === 'string')
    .map((a: any) => ({
      name: String(a.name || path.basename(a.path)).slice(0, 120),
      path: String(a.path),
      size: Number(a.size || 0),
      mime: String(a.mime || ''),
    }));

  insertProMessage({
    id: userMsgId,
    sessionId,
    role: 'user',
    content,
    meta: { ...(attachmentMeta.length ? { attachments: attachmentMeta } : {}), searchEnabled },
  });

  // 首条消息自动作为会话标题，方便右侧列表辨认
  const existing = listProMessages(sessionId).filter((m) => m.role === 'user');
  if (existing.length === 1) {
    const title = (content || attachmentMeta[0]?.name || '图片会话').replace(/\s+/g, ' ').slice(0, 30);
    updateProSession(sessionId, { title });
  }

  const runId = crypto.randomUUID();
  const prompt = attachmentMeta.length
    ? `${content || '请分析我上传的图片。'}\n\n[用户上传的图片]\n${attachmentMeta.map((a: any) => `- ${a.name}：${a.path}`).join('\n')}`
    : content;

  pendingRuns.set(runId, {
    sessionId,
    userMsgId,
    content: prompt,
    createdAt: Date.now(),
    allowedTools: new Set<string>(),
    gate: createGate(() => {}), // 占位：SSE 连接建立后会被替换为带 emit 的 gate
    consumed: false,
    searchEnabled,
  });

  res.json({ ok: true, data: { runId, streamToken: signStreamToken(runId, sessionId), userMsgId } });
});

// 权限决策：SSE 里发出的 permission.request 由此回来
router.post('/runs/:runId/permission', (req, res) => {
  const run = pendingRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ ok: false, error: '运行已结束' });
  const requestId = String(req.body?.requestId || '');
  const decision = req.body?.decision;
  if (!requestId || !['once', 'session', 'deny'].includes(decision)) {
    return res.status(400).json({ ok: false, error: '参数不合法' });
  }
  const accepted = run.gate.decide(requestId, decision as PermissionDecision);
  if (!accepted) return res.status(404).json({ ok: false, error: '该授权请求已失效' });
  recordProAudit({
    sessionId: run.sessionId,
    runId: req.params.runId,
    tool: 'permission',
    level: 'W',
    args: requestId,
    status: decision,
    durationMs: 0,
  });
  res.json({ ok: true, data: { decision } });
});

// ===== SSE 运行 =====

/** 落库用：改动清单裁成前端需要的字段 */
const metaChange = (c: any) => ({
  id: c.id,
  filePath: c.filePath,
  action: c.action,
  diff: c.diff,
  backupPath: c.backupPath,
  rolledBackAt: c.rolledBackAt,
  createdAt: c.createdAt,
});

/** 落库用：产物裁成前端需要的字段 */
const metaArtifact = (a: any) => ({
  id: a.id,
  kind: a.kind,
  title: a.title,
  mime: a.mime,
  size: a.size,
  filePath: a.filePath,
  createdAt: a.createdAt,
  url: `/api/pro/artifacts/${a.id}/file`,
});

/** 落库用：本轮联网痕迹（气泡上标"已联网搜索 N 次"+ 引用链接） */
const metaSearch = (enabled: boolean, searches: any[] = []) => ({
  enabled,
  count: searches.filter((s) => s.engine !== 'fetch').length,
  fetches: searches.filter((s) => s.engine === 'fetch').length,
  links: searches.flatMap((s) => (Array.isArray(s.items) ? s.items : [])).slice(0, 15),
});

router.get('/runs/:runId/events', async (req, res) => {
  const runId = req.params.runId;
  const token = String(req.query.token || '');
  const proof = verifyStreamToken(token);
  if (!proof || proof.runId !== runId) {
    return res.status(401).json({ ok: false, error: '流式凭证无效或已过期' });
  }

  const run = pendingRuns.get(runId);
  if (!run || run.sessionId !== proof.sessionId) return res.status(404).end();
  if (run.consumed) return res.status(409).json({ ok: false, error: '该运行已被接管' });
  run.consumed = true;

  const history = listProMessages(run.sessionId)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(0, -1); // 去掉刚插入的这条用户消息（下面会作为本轮输入单独传）

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let seq = 0;
  let finished = false;
  const controller = new AbortController();

  // SSE 心跳：模型思考/工具执行期间可能几十秒没有事件，
  // 没有心跳时中间层或浏览器会把连接判死，前端就表现为"回答说到一半卡住"。
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      /* 连接已断，忽略 */
    }
  }, 15_000);

  const writeEvent = (event: string, data: any) => {
    if (finished && event !== 'done') return;
    try {
      res.write(`id: ${seq++}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* 客户端已断开，忽略写入失败 */
    }
  };

  writeEvent('start', { runId, searchEnabled: run.searchEnabled });

  // 用带上 emit 的 gate 替换占位 gate（权限请求需要写进同一条 SSE 流）
  run.gate = createGate(writeEvent);

  res.on('close', () => {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);
    controller.abort();
    run.gate.cancelAll();
  });

  try {
    const result = await runProAgent(
      {
        sessionId: run.sessionId,
        runId,
        userText: run.content,
        history,
        searchEnabled: run.searchEnabled,
      },
      {
        emit: writeEvent,
        requestPermission: (input) => run.gate.request({ ...input, level: input.level }),
        sessionAllowedTools: run.allowedTools,
        audit: (record) =>
          recordProAudit({
            sessionId: run.sessionId,
            runId,
            tool: record.tool,
            level: record.level,
            args: record.args,
            status: record.status,
            durationMs: record.durationMs,
          }),
        signal: controller.signal,
      },
    );

    if (finished) {
      // 客户端中途关闭：仍把已产出的内容落库，并标记被停止
      const assistantId = crypto.randomUUID();
      insertProMessage({
        id: assistantId,
        sessionId: run.sessionId,
        role: 'assistant',
        content: result.text || '（已停止）',
        meta: {
          tools: result.tools,
          changes: listProChangesByRun(runId).map(metaChange),
          artifacts: listProArtifactsByRun(runId).map(metaArtifact),
          search: metaSearch(run.searchEnabled, result.searches),
          stopped: true,
        },
      });
      // 中途停止也消耗了 token，照实记账
      recordProUsage({
        sessionId: run.sessionId,
        runId,
        model: result.model,
        inputChars: result.inputChars,
        outputChars: result.outputChars,
      });
      pendingRuns.delete(runId);
      return;
    }

    const text = result.text || '（没有生成内容，请换个说法再试）';
    const assistantId = crypto.randomUUID();

    const estTokens = recordProUsage({
      sessionId: run.sessionId,
      runId,
      model: result.model,
      inputChars: result.inputChars,
      outputChars: result.outputChars,
    });

    insertProMessage({
      id: assistantId,
      sessionId: run.sessionId,
      role: 'assistant',
      content: text,
      meta: {
        tools: result.tools,
        changes: listProChangesByRun(runId).map(metaChange),
        artifacts: listProArtifactsByRun(runId).map(metaArtifact),
        search: metaSearch(run.searchEnabled, result.searches),
        usage: { estTokens, model: result.model },
      },
    });

    writeEvent('usage', { estTokens, model: result.model });
    writeEvent('done', { messageId: assistantId, stopped: result.aborted });
    finished = true;
    clearInterval(heartbeat);
    res.end();
    pendingRuns.delete(runId);
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error('[pro] 运行失败:', message, err?.status ? `(status=${err.status})` : '', err?.stack ? `\n${err.stack}` : '');

    if (!finished) {
      const assistantId = crypto.randomUUID();
      insertProMessage({
        id: assistantId,
        sessionId: run.sessionId,
        role: 'assistant',
        content: `运行失败：${message}`,
        meta: { error: message },
      });
      writeEvent('run_error', { message });
      finished = true;
      clearInterval(heartbeat);
      res.end();
    }
    pendingRuns.delete(runId);
  }
});

// ===== 设置 / 工作区 / 用量 =====

router.get('/settings', (_req, res) => {
  res.json({
    ok: true,
    data: {
      permissionMode: getPermissionMode(),
      searchEnabled: isSearchEnabled(),
      searchEngine: getSearchEngine(),
      visionModel: getProSetting('vision_model') || '',
      imageModel: getProSetting('image_model') || '',
      imageApiKeySet: Boolean(getProSetting('image_api_key')),
      // 专业版可选模型：model = 实际生效的；modelOverride = 专业版自己选的（空=继承普通版）
      model: getProModel() || resolveModel(),
      modelOverride: getProModel(),
      inheritedModel: resolveModel(),
      modelOptions: ALLOWED_MODELS,
      workspaces: listWorkspaces(),
      usage: usageSummary(),
    },
  });
});

router.put('/settings', (req, res) => {
  const { permissionMode, searchEnabled, searchEngine, visionModel, imageModel, imageApiKey, model } = req.body || {};
  if (model !== undefined) {
    const next = String(model || '').trim();
    if (next && !isAllowedModel(next)) {
      return res.status(400).json({ ok: false, error: `模型不在可选列表里：${next}` });
    }
    setProSetting('model', next);
  }
  if (permissionMode !== undefined) {
    if (!['readonly', 'standard'].includes(permissionMode)) {
      return res.status(400).json({ ok: false, error: '权限模式不合法' });
    }
    setProSetting('permission_mode', permissionMode);
  }
  if (searchEnabled !== undefined) {
    if (typeof searchEnabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'searchEnabled 必须是布尔值' });
    }
    setProSetting('search_enabled', searchEnabled ? '1' : '0');
  }
  if (searchEngine !== undefined) {
    if (!['baidu', 'bing'].includes(searchEngine)) {
      return res.status(400).json({ ok: false, error: '搜索引擎只支持 baidu / bing' });
    }
    setProSetting('search_engine', searchEngine);
  }
  if (visionModel !== undefined) {
    setProSetting('vision_model', String(visionModel || '').trim().slice(0, 80));
  }
  if (imageModel !== undefined) {
    setProSetting('image_model', String(imageModel || '').trim().slice(0, 120));
  }
  if (imageApiKey !== undefined) {
    // 传空字符串 = 清空（回落到与对话共用的 Key）
    setProSetting('image_api_key', String(imageApiKey || '').trim().slice(0, 200));
  }
  res.json({
    ok: true,
    data: {
      permissionMode: getPermissionMode(),
      searchEnabled: isSearchEnabled(),
      searchEngine: getSearchEngine(),
      visionModel: getProSetting('vision_model') || '',
      imageModel: getProSetting('image_model') || '',
      imageApiKeySet: Boolean(getProSetting('image_api_key')),
      model: getProModel() || resolveModel(),
      modelOverride: getProModel(),
      inheritedModel: resolveModel(),
      modelOptions: ALLOWED_MODELS,
    },
  });
});

router.get('/workspaces', (_req, res) => {
  res.json({ ok: true, data: { list: listWorkspaces() } });
});

router.post('/workspaces', (req, res) => {
  try {
    const workspace = addWorkspace(String(req.body?.path || ''), String(req.body?.label || ''));
    res.json({ ok: true, data: workspace });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || '添加失败' });
  }
});

router.delete('/workspaces/:id', (req, res) => {
  removeWorkspace(req.params.id);
  res.json({ ok: true, data: {} });
});

router.get('/audit', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const rows = proDb
    .prepare('SELECT id, session_id, run_id, tool, level, args, status, duration_ms, created_at FROM pro_audit_logs ORDER BY id DESC LIMIT ?')
    .all(limit) as any[];
  res.json({ ok: true, data: { list: rows } });
});

// ===== 项目视图（P2）：扫描已授权目录 =====

router.get('/workspaces/:id/scan', async (req, res) => {
  const workspace = listWorkspaces().find((w) => w.id === req.params.id);
  if (!workspace) return res.status(404).json({ ok: false, error: '工作区不存在' });
  if (!fs.existsSync(workspace.path)) {
    return res.status(400).json({ ok: false, error: '目录已不存在或不可访问，请重新授权' });
  }
  try {
    const scan = await scanProject(workspace.path);
    res.json({ ok: true, data: { ...scan, workspaceId: workspace.id, label: workspace.label } });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || '扫描失败' });
  }
});

// ===== 改动清单 + 一键回滚（P2）=====

router.get('/changes', (req, res) => {
  const sessionId = String(req.query.sessionId || '') || undefined;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const list = listProChanges({ sessionId, limit }).map((c) => ({
    id: c.id,
    sessionId: c.sessionId,
    runId: c.runId,
    filePath: c.filePath,
    action: c.action,
    diff: c.diff,
    backupPath: c.backupPath,
    rolledBackAt: c.rolledBackAt,
    createdAt: c.createdAt,
  }));
  res.json({ ok: true, data: { list } });
});

router.post('/changes/:id/rollback', async (req, res) => {
  try {
    const result = await rollbackChange(req.params.id);
    res.json({ ok: true, data: result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || '回滚失败' });
  }
});

// 命令预检：给前端在提交前显示高危提示（真正的确认仍在权限卡上）
router.post('/shell/risk', (req, res) => {
  const command = String(req.body?.command || '');
  res.json({ ok: true, data: { risks: commandRisks(command) } });
});

// ===== 产物库（P3）=====

router.get('/artifacts', (req, res) => {
  const sessionId = String(req.query.sessionId || '') || undefined;
  const kind = String(req.query.kind || '') || undefined;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
  const list = listProArtifacts({ sessionId, kind, limit }).map((a) => ({
    id: a.id,
    sessionId: a.sessionId,
    runId: a.runId,
    kind: a.kind,
    title: a.title,
    mime: a.mime,
    size: a.size,
    filePath: a.filePath,
    meta: a.meta,
    createdAt: a.createdAt,
    url: `/api/pro/artifacts/${a.id}/file`,
  }));
  res.json({ ok: true, data: { list } });
});

/** 读产物文件：只允许读 pro/artifacts 目录内的文件（防止被拼路径读全盘） */
router.get('/artifacts/:id/file', (req, res) => {
  const artifact = getProArtifact(req.params.id);
  if (!artifact) return res.status(404).json({ ok: false, error: '产物不存在' });
  const abs = path.resolve(artifact.filePath);
  const rel = path.relative(path.resolve(PRO_ARTIFACTS_DIR), abs);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(abs)) {
    return res.status(404).json({ ok: false, error: '产物文件已不存在' });
  }
  res.setHeader('Content-Type', artifact.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  if (!/^image\//.test(artifact.mime)) {
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(artifact.title)}`);
  }
  res.sendFile(abs);
});

router.delete('/artifacts/:id', (req, res) => {
  const artifact = getProArtifact(req.params.id);
  if (!artifact) return res.status(404).json({ ok: false, error: '产物不存在' });
  try {
    const abs = path.resolve(artifact.filePath);
    const rel = path.relative(path.resolve(PRO_ARTIFACTS_DIR), abs);
    if (!rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* 文件删不掉也把记录清掉，避免画廊卡住 */
  }
  deleteProArtifact(req.params.id);
  res.json({ ok: true, data: {} });
});

/** 把工作区里的文件收进产物库（"把这个存成产物"用） */
router.post('/artifacts/import', (req, res) => {
  try {
    const source = path.resolve(String(req.body?.path || ''));
    const roots = listWorkspaces().map((w) => path.resolve(w.path));
    const inside = roots.some((root) => !path.relative(root, source).startsWith('..'));
    if (!inside) return res.status(400).json({ ok: false, error: '只能导入已授权工作区里的文件' });
    if (!fs.existsSync(source)) return res.status(404).json({ ok: false, error: '文件不存在' });

    const ext = path.extname(source).toLowerCase();
    const kind = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)
      ? 'image'
      : ext === '.html'
        ? 'html'
        : ext === '.docx'
          ? 'doc'
          : ext === '.pdf'
            ? 'pdf'
            : 'text';
    const id = crypto.randomUUID();
    const destDir = path.join(PRO_ARTIFACTS_DIR, kind);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, `${id.slice(0, 8)}-${path.basename(source)}`);
    fs.copyFileSync(source, dest);
    const stat = fs.statSync(dest);
    insertProArtifact({
      id,
      kind: kind as any,
      title: path.basename(source),
      filePath: dest,
      mime: '',
      size: stat.size,
      meta: { importedFrom: source },
    });
    res.json({ ok: true, data: { id, url: `/api/pro/artifacts/${id}/file` } });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || '导入失败' });
  }
});

// ===== 上传（图片分析用）=====

router.post('/uploads', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: '请选择文件' });
  const fixedName = fixFilename(req.file.originalname || req.file.filename);
  res.json({
    ok: true,
    data: {
      name: fixedName,
      path: path.join(PRO_UPLOADS_DIR, req.file.filename),
      size: req.file.size,
      mime: req.file.mimetype || '',
    },
  });
});

// 供渲染层预览已上传图片（只读本机上传目录，文件名做了路径收敛）
router.get('/uploads/:filename', (req, res) => {
  const filename = path.basename(String(req.params.filename || ''));
  const abs = path.join(PRO_UPLOADS_DIR, filename);
  if (!abs.startsWith(PRO_UPLOADS_DIR) || !fs.existsSync(abs)) {
    return res.status(404).json({ ok: false, error: '文件不存在' });
  }
  res.sendFile(abs);
});

// ===== 任务面板（P4）=====

router.get('/todos', (req, res) => {
  const status = String(req.query?.status || '');
  const limit = Number(req.query?.limit) || 100;
  const list = listTodos({ status: ['pending', 'doing', 'done'].includes(status) ? (status as any) : undefined, limit });
  res.json({ ok: true, data: { list, stats: todoStats() } });
});

router.post('/todos', (req, res) => {
  try {
    const todo = addTodo({
      title: String(req.body?.title || ''),
      note: req.body?.note ? String(req.body.note) : '',
      status: req.body?.status,
    });
    res.json({ ok: true, data: { todo, list: listTodos({ limit: 100 }), stats: todoStats() } });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || '新增任务失败' });
  }
});

router.patch('/todos/:id', (req, res) => {
  const updated = updateTodo(String(req.params.id), {
    title: req.body?.title !== undefined ? String(req.body.title) : undefined,
    status: req.body?.status,
    note: req.body?.note !== undefined ? String(req.body.note) : undefined,
    sort: req.body?.sort !== undefined ? Number(req.body.sort) : undefined,
  });
  if (!updated) return res.status(404).json({ ok: false, error: '任务不存在' });
  res.json({ ok: true, data: { todo: updated, list: listTodos({ limit: 100 }), stats: todoStats() } });
});

router.delete('/todos/:id', (req, res) => {
  const removed = deleteTodo(String(req.params.id));
  if (!removed) return res.status(404).json({ ok: false, error: '任务不存在' });
  res.json({ ok: true, data: { list: listTodos({ limit: 100 }), stats: todoStats() } });
});

export default router;
