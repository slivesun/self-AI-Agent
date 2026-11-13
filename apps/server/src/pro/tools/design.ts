import type { ToolDef } from './types.js';
import { saveArtifact } from '../artifacts.js';

/**
 * 设计稿：把一整页 HTML 存成产物，前端用 iframe 渲染预览。
 * 选 HTML 而不是图片的原因：可迭代、可导出源码、可直接贴进项目里。
 */
export const designRender: ToolDef = {
  name: 'design_render',
  label: '生成设计稿',
  description:
    '把一页完整的 HTML（含内联 CSS/必要的少量 JS）存成可预览的设计稿，进入产物库并在会话里出现预览卡。适合落地页、卡片、海报版式、组件视觉稿。HTML 里不要引用外部 CDN 脚本；图片尽量用 data URL 或保留占位。',
  level: 'W',
  schema: {
    type: 'object',
    properties: {
      html: { type: 'string', description: '完整 HTML 文档（<!DOCTYPE html> 开头，样式内联）' },
      title: { type: 'string', description: '设计稿名称，默认「设计稿」' },
    },
    required: ['html'],
  },
  preview: (args) => `生成设计稿：${args?.title || '设计稿'}（${String(args?.html || '').length} 字符 HTML）`,
  async run(args, ctx) {
    const html = String(args?.html || '').trim();
    if (!html) throw new Error('html 不能为空');
    if (html.length > 300_000) throw new Error('HTML 过大（超过 30 万字符）');
    if (!/<html|<!doctype/i.test(html)) throw new Error('请给出完整的 HTML 文档（包含 <html> 或 <!DOCTYPE html>）');

    const title = String(args?.title || '设计稿').trim() || '设计稿';
    const artifact = await saveArtifact({
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      kind: 'html',
      title,
      ext: '.html',
      data: html,
      mime: 'text/html; charset=utf-8',
      meta: { chars: html.length },
    });

    ctx.emit('artifact', {
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      filePath: artifact.filePath,
      mime: artifact.mime,
      size: artifact.size,
      url: `/api/pro/artifacts/${artifact.id}/file`,
    });

    return `设计稿已生成：${artifact.title}（${Math.round(artifact.size / 1024)}KB）\n预览地址：/api/pro/artifacts/${artifact.id}/file\n本地路径：${artifact.filePath}`;
  },
};
