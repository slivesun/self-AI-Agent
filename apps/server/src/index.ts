import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb, db } from './db.js';
import { requireAuth, requirePasswordChanged } from './auth.js';
import { auditAdminMutations } from './audit.js';
import { scheduleGuestDataCleanup } from './cleanup.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import knowledgeRoutes from './routes/knowledge.js';
import linksRoutes from './routes/links.js';
import visitorRoutes from './routes/visitor.js';
import visitorAuthRoutes from './routes/visitorAuth.js';
import proRoutes from './pro/routes.js';

initDb();
// 访客数据按保留期清理（默认 180 天，只清匿名访客）
scheduleGuestDataCleanup();

const app = express();
const PORT = Number(process.env.PORT || 3001);
// 默认只监听回环地址：桌面端/本地开发用不到 0.0.0.0；
// 部署到服务器时显式设置 HOST=0.0.0.0，并放在反向代理（HTTPS）之后。
const HOST = process.env.HOST || '127.0.0.1';

if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

app.disable('x-powered-by');

// 基础安全响应头（无第三方依赖）
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3001', 'http://127.0.0.1:5173', 'http://127.0.0.1:3001'],
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// 请求日志：方法、路径、状态、耗时（不打印 query，避免把访问码/凭证写进日志）
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path.startsWith('/api')) {
      console.log(`[http] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// 健康检查：给部署/运维探活用（不依赖鉴权）
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, data: { status: 'up', uptime: Math.round(process.uptime()) } });
  } catch (e: any) {
    res.status(503).json({ ok: false, error: '数据库不可用' });
  }
});

// 路由挂载
app.use('/api/auth', authRoutes);
app.use('/api/auth/visitor', visitorAuthRoutes);
// 后台接口统一先过鉴权 + 强制改密校验（改密前只放行 /api/auth 下的改密接口）
app.use('/api/admin', auditAdminMutations, requireAuth, requirePasswordChanged, adminRoutes);
app.use('/api/admin/knowledge', auditAdminMutations, requireAuth, requirePasswordChanged, knowledgeRoutes);
app.use('/api/admin/links', auditAdminMutations, requireAuth, requirePasswordChanged, linksRoutes);
// 专业版：独立路由树 + 独立数据库，只认管理员身份（与普通版共用账号，不共用数据）
app.use('/api/pro', proRoutes);
app.use('/api', visitorRoutes);

// API 未命中：返回 JSON 404，不要掉进前端 index.html
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: '接口不存在' });
});

// 生产环境：托管前端静态文件
// 桌面安装包里的后端是独立目录，前端产物位置由 WEB_DIST_DIR 指定；
// 源码直跑时回退到仓库内的 apps/web/dist。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = process.env.WEB_DIST_DIR
  ? path.resolve(process.env.WEB_DIST_DIR)
  : path.resolve(__dirname, '../../web/dist');
console.log('Static dist path:', webDist, 'exists:', fs.existsSync(webDist));

if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, {
    index: 'index.html',
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/[\\/]assets[\\/]/.test(filePath)) {
        // Vite 产物带内容 hash，可长期缓存
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.json')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  // SPA 兜底：只处理 GET 且客户端接受 html，避免把缺失的静态资源也返回 index.html
  app.get(/^\/(?!api).*/, (req, res, next) => {
    if (!req.accepts('html')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

// 统一错误处理：日志 + JSON，避免把堆栈直接返回给调用方
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[error]', req.method, req.path, err?.message || err);
  if (res.headersSent) return next(err);
  const status = Number(err?.status) || (err?.type === 'entity.too.large' ? 413 : 500);
  res.status(status).json({ ok: false, error: status === 413 ? '请求体过大' : '服务异常，请稍后再试' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

server.on('error', (err: any) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`[fatal] 端口 ${PORT} 已被占用，请关闭占用进程或设置 PORT 环境变量后重试`);
    process.exit(1);
  }
  console.error('[fatal] HTTP 服务启动失败:', err?.message || err);
  process.exit(1);
});

// ---- 进程兜底与优雅退出 ----
let shuttingDown = false;
function shutdown(reason: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${reason}，正在关闭服务…`);
  server.close(() => {
    try { db.close(); } catch {}
    console.log('[shutdown] 已完成，退出');
    process.exit(exitCode);
  });
  // 兜底：10 秒内没关完就强退，避免进程挂死
  setTimeout(() => process.exit(exitCode), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('收到 SIGTERM'));
process.on('SIGINT', () => shutdown('收到 SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  shutdown('未捕获异常', 1);
});
