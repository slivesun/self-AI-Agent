/**
 * 桌面安装包构建编排：前端产物 + 后端独立运行目录 + electron-builder 打包。
 *
 * 产物结构（安装后 resources/ 下）：
 *   resources/backend/dist/index.js   ← 后端入口（esbuild 转译后的 JS）
 *   resources/backend/node_modules/   ← 后端生产依赖（pnpm deploy，物理目录，无符号链接）
 *   resources/backend/web/            ← 前端构建产物（由后端静态托管）
 *   resources/backend/.env            ← 运行时环境变量（火山方舟 Key 等）
 *
 * 用法：
 *   node scripts/package.mjs          # 打 Windows 安装包（NSIS）
 *   node scripts/package.mjs --dir    # 只产出免安装目录 dist/win-unpacked（调试用）
 */

import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const stagingRoot = path.join(desktopRoot, 'build-resources');
const stagingBackend = path.join(stagingRoot, 'backend');
const serverDist = path.join(repoRoot, 'apps', 'server', 'dist');
const serverEnv = path.join(repoRoot, 'apps', 'server', '.env');
const webDist = path.join(repoRoot, 'apps', 'web', 'dist');
const outDir = path.join(desktopRoot, 'dist');

const wantDirOnly = process.argv.includes('--dir');

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`命令执行失败（exit ${result.status}）：${command} ${args.join(' ')}`);
  }
}

function assertInside(child, parent) {
  const rel = path.relative(parent, child);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`拒绝操作工作区之外的路径：${child}`);
  }
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 安装包自检（专业版）：多入口页面、pro 分包、pro 后端模块少一个都不行。
 * 少一个的表现是"主窗口能开、专业版窗口白屏/接口 404"，很难从日志看出来，
 * 所以在打包阶段就硬失败。
 */
async function assertProAssets(backendDir) {
  const web = path.join(backendDir, 'web');
  const dist = path.join(backendDir, 'dist');
  const problems = [];

  if (!(await exists(path.join(web, 'pro.html')))) problems.push('web/pro.html 缺失（专业版入口页面没进包）');

  const assets = await readdir(path.join(web, 'assets')).catch(() => []);
  if (!assets.some((f) => /^pro-.*\.js$/.test(f))) problems.push('web/assets/pro-*.js 缺失（专业版前端分包没进包）');

  const proModules = ['pro/routes.js', 'pro/agent.js', 'pro/search.js', 'pro/system.js', 'pro/todos.js'];
  for (const mod of proModules) {
    if (!(await exists(path.join(dist, mod)))) problems.push(`dist/${mod} 缺失（专业版后端模块没构建进包）`);
  }
  if (problems.length) throw new Error(`专业版资源自检失败：\n  - ${problems.join('\n  - ')}`);
  console.log('  专业版资源自检通过：pro.html + pro 分包 + 5 个 pro 后端模块都在包里');
}

/** 清掉部署目录里不该进安装包的东西（源码、测试脚本、lock 文件） */
async function pruneBackend(dir) {
  const removeList = [
    'src',
    'scripts',
    'tsconfig.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'cleanup.mjs',
    'test-llm.mjs',
    'test-parse.mjs',
    'extracted.txt',
    'test-llm-result.txt',
    '.env',
  ];
  for (const item of removeList) {
    await rm(path.join(dir, item), { recursive: true, force: true });
  }
}

async function main() {
  assertInside(stagingBackend, repoRoot);
  assertInside(outDir, desktopRoot);

  // 0. 清空上次的暂存目录，避免旧依赖残留
  await rm(stagingBackend, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });

  // 1. 前端构建
  console.log('\n[1/5] 构建前端 (apps/web)');
  run('pnpm', ['--filter', '@resume-agent/web', 'run', 'build'], { cwd: repoRoot });
  if (!(await exists(path.join(webDist, 'index.html')))) {
    throw new Error('前端构建产物缺失：apps/web/dist/index.html');
  }

  // 2. 后端构建（esbuild 逐文件转译，不做类型检查）
  console.log('\n[2/5] 构建后端 (apps/server)');
  run('pnpm', ['--filter', '@resume-agent/server', 'run', 'build'], { cwd: repoRoot });
  if (!(await exists(path.join(serverDist, 'index.js')))) {
    throw new Error('后端构建产物缺失：apps/server/dist/index.js');
  }

  // 3. 后端依赖独立部署（--prod + hoisted：纯物理目录，可直接复制进安装包）
  console.log('\n[3/5] 部署后端依赖（pnpm deploy --prod --node-linker=hoisted）');
  run(
    'pnpm',
    [
      '--filter', '@resume-agent/server',
      'deploy', `"${stagingBackend}"`,
      '--prod',
      '--ignore-scripts',
      '--config.node-linker=hoisted',
    ],
    { cwd: repoRoot },
  );

  // 4. 组装可运行目录
  console.log('\n[4/5] 组装 resources/backend');
  await pruneBackend(stagingBackend);

  // 用刚构建的产物覆盖 deploy 带来的旧 dist
  await rm(path.join(stagingBackend, 'dist'), { recursive: true, force: true });
  await cp(serverDist, path.join(stagingBackend, 'dist'), { recursive: true });

  // 前端产物
  await rm(path.join(stagingBackend, 'web'), { recursive: true, force: true });
  await cp(webDist, path.join(stagingBackend, 'web'), { recursive: true });

  // 专业版资源自检：多入口页面 + pro 分包 + pro 后端模块，缺一个就停下
  await assertProAssets(stagingBackend);

  // 运行时环境变量：不再复制 apps/server/.env（含真实 API Key），
  // 只放一份空模板，避免安装包被解包后直接盗用密钥。
  // 模型 Key 在应用内「模型设置」页填写（存本机数据库），或由用户放到
  // %APPDATA%\AI简历助手\config\.env。
  const envTemplate = [
    '# 运行时配置模板（本文件不含任何密钥值）',
    '# 模型 Key 建议在应用内「模型设置」填写；也可填到本文件后',
    '# 复制到 %APPDATA%\\@resume-agent\\desktop\\config\\.env',
    'ARK_API_KEY=',
    'ARK_MODEL=doubao-seed-2-0-lite-260428',
    '# 服务端口与监听地址（默认仅本机）',
    'PORT=3001',
    'HOST=127.0.0.1',
    'JWT_SECRET=',
  ].join('\n') + '\n';
  await writeFile(path.join(stagingBackend, '.env.example'), envTemplate, 'utf8');
  await rm(path.join(stagingBackend, '.env'), { force: true });
  if (await exists(serverEnv)) {
    console.log('  已生成 .env.example（未复制 apps/server/.env，密钥不随包分发）');
  } else {
    console.warn('  ⚠ 未找到 apps/server/.env，已写入空模板 .env.example');
  }

  // deploy 出来的 package.json 仍带 devDependencies，精简成运行时描述
  const pkgPath = path.join(stagingBackend, 'package.json');
  if (await exists(pkgPath)) {
    await writeFile(
      pkgPath,
      JSON.stringify({
        name: '@resume-agent/server',
        version: '0.1.0',
        private: true,
        type: 'module',
        main: 'dist/index.js',
      }, null, 2) + '\n',
      'utf8',
    );
  }

  // 5. electron-builder
  console.log(`\n[5/5] electron-builder 打包（${wantDirOnly ? '仅目录' : 'NSIS 安装包'}）`);
  const args = wantDirOnly ? ['--dir'] : ['--win', 'nsis'];
  run('pnpm', ['exec', 'electron-builder', ...args], { cwd: desktopRoot });

  // 5b. 打完之后再验一次"安装后真正会被加载的那份"
  const unpackedBackend = path.join(outDir, 'win-unpacked', 'resources', 'backend');
  if (await exists(unpackedBackend)) {
    await assertProAssets(unpackedBackend);
  } else {
    console.log('  ⚠ 未找到 win-unpacked/resources/backend，跳过安装后自检');
  }

  // 产物汇报
  const entries = await readdir(outDir).catch(() => []);
  console.log('\n构建完成，产物目录：', outDir);
  for (const name of entries) {
    const full = path.join(outDir, name);
    const info = await stat(full);
    if (info.isFile()) {
      console.log(`  - ${name}  (${(info.size / 1024 / 1024).toFixed(1)} MB)`);
    } else {
      console.log(`  - ${name}/`);
    }
  }
}

main().catch((err) => {
  console.error('\n打包失败：', err && err.message ? err.message : err);
  process.exit(1);
});
