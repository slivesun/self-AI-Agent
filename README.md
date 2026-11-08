# 个人简历 Agent

> 一个"会说话的个人简历"——面试官打开链接就能对话了解你；你本人有后台维护内容、看访客问了什么。

## 快速启动

```bash
# 1. 安装依赖（已执行过则跳过）
pnpm install

# 2. 启动后端（端口 3001）—— 需要 experimental-sqlite 标志
#    Windows PowerShell:
$env:NODE_OPTIONS="--experimental-sqlite"; pnpm dev:server

# 3. 另开终端启动前端（端口 5173）
pnpm dev:web

# 4. 桌面演示模式（可选，需先启动 web）
pnpm electron
```

## 访问地址

| 入口 | 地址 | 说明 |
|------|------|------|
| 管理后台 | http://localhost:5173/admin | 首次启动 `admin` / `admin123`，登录后必须改密 |
| 访客对话 | http://localhost:5173/c/{slug} | slug 在后台「分享链接」页查看/复制 |

## 项目结构

```
├── apps/
│   ├── web/          # React + Vite + antd 前端（访客对话 + /admin 后台）
│   ├── server/       # Express + SQLite 后端 API
│   └── desktop/      # Electron 桌面演示壳
├── packages/
│   └── shared/       # 前后端共享 TypeScript 类型
└── data/
    └── resume-agent.db  # SQLite 数据库（自动生成）
```

## 打包 Windows 安装包

```bash
pnpm pack        # 前端构建 → 后端构建 → 后端依赖部署 → NSIS 安装包
pnpm pack:dir    # 只产出免安装目录（调试用，出包更快）
```

产物位置（`apps/desktop/dist/`）：

| 产物 | 说明 |
|------|------|
| `AI简历助手-0.1.0-安装包.exe` | NSIS 安装包，双击安装，可选安装目录 |
| `win-unpacked/` | 免安装版目录，双击 `AI简历助手.exe` 直接运行 |

安装包里 `resources/backend/` 是随包运行的后端（不需要用户安装 Node）：

```
resources/backend/
├── dist/index.js      # 后端入口（esbuild 转译后的 JS）
├── node_modules/      # 后端生产依赖（pnpm deploy 物理目录，无符号链接）
├── web/               # 前端构建产物，由后端静态托管
└── .env.example       # 运行时配置模板（不含密钥）
```

运行时数据写在 `%APPDATA%\AI简历助手\data\resume-agent.db`（用户数据目录），
卸载时默认保留（`deleteAppDataOnUninstall: false`）；端口固定 3001。

打包注意：

- 首次打包需要能访问 GitHub（electron-builder 要下载 nsis 工具链），之后走本地缓存；
  国内网络建议先配好代理或镜像，否则可能卡在 download 阶段。
- Windows 普通用户没有创建符号链接的权限，electron-builder 内置 rcedit 依赖的
  winCodeSign 包解压会失败（`Cannot create symbolic link`）。桌面端因此关闭了
  `win.signAndEditExecutable`，改由 `apps/desktop/scripts/after-pack.cjs` 用 rcedit
  在 afterPack 阶段写入图标与版本信息。
- `apps/server/.env` **不会**再被打进安装包（只生成空模板 `.env.example`）。模型 Key 由用户
  在应用内后台「模型设置」填写，存本机数据库；也可以用 `%APPDATA%\AI简历助手\config\.env`。
- 后端构建用 esbuild 逐文件转译，不做 tsc 类型检查（`pnpm build:server`）；
  类型检查单独跑 `pnpm --filter @resume-agent/server run typecheck`（CI 已接入）。
- 冒烟测试：`pnpm --filter @resume-agent/server run smoke`（用临时数据目录起隔离实例，不碰真实数据）。
- 备份：`pnpm --filter @resume-agent/server run backup`（先 checkpoint WAL，再复制到 `data/backups/`）。

## 生产部署检查清单

| 项 | 说明 |
|---|---|
| `HOST` | 默认 `127.0.0.1`；对外提供服务时设 `0.0.0.0`，并放在 Nginx/Caddy 等反向代理后启用 HTTPS |
| `JWT_SECRET` | 生产必须显式设置（≥16 位）；未设置会在数据目录生成 `jwt.secret` |
| `ADMIN_INIT_PASSWORD` | 首次启动管理员口令；不设置则用 `admin123`，并强制首次登录改密 |
| 模型 Key | 在后台「模型设置」填写，存数据库；不再随安装包分发 |
| 数据保留 | `DATA_RETENTION_DAYS`（默认 180）只清理匿名访客会话，注册账号数据保留 |
| 额度 | 访客：5 个会话、每会话 1 问；注册账号每日 `DAILY_MESSAGES_PER_USER`（默认 200） |
| 健康检查 | `GET /api/health` |
| 审计 | 后台「会话分析」同源接口 `GET /api/admin/audit`（最近 100 条写操作） |
| 构建校验 | CI：`.github/workflows/ci.yml`（typecheck + build + smoke + 前端构建） |

## 已实现功能

- [x] **Web 后台**：档案编辑（基本信息/工作经历/项目/技能/教育）、Q&A 库、人设与边界、分享链接管理、会话分析
- [x] **对话**：SSE 流式输出、引用来源标注、打字机效果
- [x] **访客模式**：匿名会话、分享链接（可设访问码/过期/撤销）、限流（每会话每日 30 条）
- [x] **桌面演示**：Electron 壳，全屏隐藏菜单栏，加载 Web 页面
- [x] **反幻觉**：资料没有就明说"资料中没有"，敏感问题按预设话术拒答
- [ ] RN 移动端（最后做，可选）

## 下一步

1. 在后台「档案编辑」录入你的真实简历信息
2. 在「Q&A 库」添加高频问题的标准答案
3. 在「分享链接」复制访客链接，手机打开测试
4. 替换 mock LLM 为真实大模型 API（`apps/server/src/agent.ts`）
