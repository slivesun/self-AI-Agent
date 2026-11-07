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
| 管理后台 | http://localhost:5173/admin | 默认账号 `admin` / `admin123` |
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
