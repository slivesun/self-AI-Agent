import fs from 'fs/promises';
import path from 'path';
import type { ToolDef } from './types.js';
import { truncateOutput } from './types.js';
import { resolveToolPath } from './path-safe.js';
import { generateImages } from '../image-gen.js';
import { saveArtifact, mimeFor } from '../artifacts.js';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * 出图（P3）。产物直接进产物库（pro/artifacts/image），会话里出现产物卡。
 * 账号没开通图像模型时不编造，把上游的错误原样回给模型/用户。
 */
export const imageGenerate: ToolDef = {
  name: 'image_generate',
  label: '生成图片',
  description:
    '用文生图生成图片（可一次多张），支持传参考图做图生图。生成的图片会自动存进产物库并出现在会话里。适合海报、插画、配图、风格稿。注意：需要账号已开通图像模型。',
  level: 'W',
  schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '画面描述（越具体越好：主体、风格、构图、光线、配色）' },
      size: { type: 'string', description: '尺寸，例如 1024x1024 / 1536x1024 / 1024x1536，默认 1024x1024' },
      count: { type: 'number', description: '生成张数，默认 1，最多 4' },
      reference: {
        type: 'array',
        items: { type: 'string' },
        description: '参考图路径（工作区内或用户上传目录里的图片），有则按图生图',
      },
    },
    required: ['prompt'],
  },
  preview: (args) => {
    const count = Math.max(1, Math.min(4, Number(args?.count) || 1));
    const size = String(args?.size || '1024x1024');
    return `生成 ${count} 张图片（${size}）：${String(args?.prompt || '').slice(0, 60)}`;
  },
  async run(args, ctx) {
    const prompt = String(args?.prompt || '').trim();
    if (!prompt) throw new Error('prompt 不能为空');
    if (prompt.length > 2000) throw new Error('prompt 过长（超过 2000 字符）');

    const count = Math.max(1, Math.min(4, Number(args?.count) || 1));
    const refs: string[] = [];
    for (const item of Array.isArray(args?.reference) ? args.reference : []) {
      const target = resolveToolPath(String(item), ctx.roots, ctx.extraRoots, { mustExist: true });
      const ext = path.extname(target.abs).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) throw new Error(`参考图只支持 png/jpg/webp：${target.abs}`);
      const buf = await fs.readFile(target.abs);
      if (buf.length > 10 * 1024 * 1024) throw new Error(`参考图过大（超过 10MB）：${target.abs}`);
      refs.push(`data:${mime};base64,${buf.toString('base64')}`);
    }

    ctx.emit('tool_output', { chunk: `正在生成 ${count} 张图片…\n` });
    const images = await generateImages({ prompt, size: String(args?.size || '1024x1024'), reference: refs }, count);

    const saved: any[] = [];
    for (let i = 0; i < images.length; i += 1) {
      const img = images[i];
      const artifact = await saveArtifact({
        sessionId: ctx.sessionId,
        runId: ctx.runId,
        kind: 'image',
        title: `${prompt.slice(0, 24)}-${i + 1}`,
        ext: img.ext,
        data: img.buffer,
        mime: img.mime || mimeFor(`x${img.ext}`),
        meta: { prompt, size: args?.size || '1024x1024', sourceUrl: img.sourceUrl || null },
      });
      saved.push(artifact);
      ctx.emit('artifact', {
        id: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        filePath: artifact.filePath,
        mime: artifact.mime,
        size: artifact.size,
        url: `/api/pro/artifacts/${artifact.id}/file`,
      });
    }

    const lines = saved.map(
      (a, i) => `${i + 1}. ${a.title}（${Math.round(a.size / 1024)}KB）→ /api/pro/artifacts/${a.id}/file`,
    );
    return truncateOutput(`已生成 ${saved.length} 张图片，已存入产物库：\n${lines.join('\n')}\n\n提示词：${prompt}`);
  },
};
