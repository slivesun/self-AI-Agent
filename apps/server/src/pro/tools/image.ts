import fs from 'fs/promises';
import path from 'path';
import { getLLMClient, resolveModel } from '../../llm.js';
import { getVisionModel } from '../settings.js';
import type { ToolDef } from './types.js';
import { resolveToolPath } from './path-safe.js';
import { truncateOutput } from './types.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

/**
 * 读图：把本地图片转成 base64 传给多模态模型。
 * 模型 ID 由设置里的 vision_model 决定，留空时回退共用对话模型（该模型若不支持图片会明确报错）。
 */
export const imageAnalyze: ToolDef = {
  name: 'image_analyze',
  label: '读图片',
  description:
    '分析一张本地图片的内容（只读）：可以描述画面、识别图中文字、读出图表数据、指出可改进的地方。支持 png/jpg/webp/gif/bmp，单张不超过 10MB。',
  level: 'R',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '图片路径（用户上传的图片会给到具体路径）' },
      question: { type: 'string', description: '希望从图片里了解什么；不填则做整体描述' },
    },
    required: ['path'],
  },
  preview: (args) => `分析图片 ${args?.path || ''}`,
  async run(args, ctx) {
    const target = resolveToolPath(args?.path, ctx.roots, ctx.extraRoots, { mustExist: true });
    const ext = path.extname(target.abs).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) throw new Error(`不支持的图片格式：${ext || '（无扩展名）'}，支持 png/jpg/webp/gif/bmp`);

    const stat = await fs.stat(target.abs);
    if (stat.size > MAX_IMAGE_BYTES) throw new Error(`图片过大（${(stat.size / 1024 / 1024).toFixed(1)}MB），请压缩后再试`);

    const base64 = (await fs.readFile(target.abs)).toString('base64');
    const model = getVisionModel() || resolveModel();
    const question = String(args?.question || '').trim() || '请描述这张图片的内容；如果有文字或数据，请一并读出来。';

    let answer: string;
    try {
      const res: any = await getLLMClient().chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: question },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 1500,
      });
      answer = String(res?.choices?.[0]?.message?.content || '').trim();
    } catch (err: any) {
      const message = err?.message || String(err);
      if (/model|vision|image|unsupported|not support/i.test(message)) {
        throw new Error(`读图失败（当前模型可能不支持图片输入）：${message}。可在「设置 → 视觉模型」里填写账号可用的多模态模型 ID。`);
      }
      throw new Error(`读图失败：${message}`);
    }

    if (!answer) throw new Error('模型没有返回图片分析结果');
    return truncateOutput(`图片：${target.abs}\n\n${answer}`);
  },
};
