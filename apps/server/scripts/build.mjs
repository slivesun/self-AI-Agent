/**
 * 后端构建脚本：把 src/**\/*.ts 逐文件转译成 dist/**\/*.js。
 *
 * 为什么不用 tsc：
 *   tsc 会做全量类型检查，而本仓库（尤其是 @resume-agent/shared 未构建、
 *   express/multer 的类型声明缺失）目前过不了类型检查；但 dev 模式用的是 tsx
 *   （只转译不检查），生产构建只需要等价的可运行 JS，所以这里用 esbuild 逐文件
 *   转译，保持源码里的 './xx.js' 相对导入不变（服务端依赖仍从 node_modules 解析）。
 *
 * 不做 bundle：pdf-parse 依赖 @napi-rs/canvas 这类带原生二进制的包，
 * 打包成单文件反而容易在运行时找不到 .node 文件。
 */

import { readdir, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(serverRoot, 'src');
const outDir = path.join(serverRoot, 'dist');

async function listTsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listTsFiles(full)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

async function main() {
  const files = await listTsFiles(srcDir);
  if (files.length === 0) throw new Error(`未找到待构建的源码：${srcDir}`);

  await rm(outDir, { recursive: true, force: true });

  for (const file of files) {
    const rel = path.relative(srcDir, file);
    const target = path.join(outDir, rel.replace(/\.ts$/, '.js'));
    const source = await readFile(file, 'utf8');

    const result = await esbuild.transform(source, {
      loader: 'ts',
      format: 'esm',
      target: 'node22',
      sourcefile: rel,
      sourcemap: false,
      legalComments: 'none',
    });

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, result.code, 'utf8');
  }

  console.log(`[server] 构建完成：${files.length} 个文件 -> ${path.relative(process.cwd(), outDir)}`);
}

main().catch((err) => {
  console.error('[server] 构建失败：', err);
  process.exit(1);
});
