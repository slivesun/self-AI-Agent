import { resolveApiKey } from '../llm.js';
import { getImageModel, getImageBaseUrl, getImageApiKey } from './settings.js';

/**
 * 图像生成（P3）：走火山方舟 OpenAI 兼容的 /images/generations。
 *
 * 重要：当前账号未必开通了图像模型。未配置或账号无权限时，这里**直接抛出明确错误**，
 * 由工具层如实回填给模型/用户，绝不拿占位图冒充。
 */

export interface GenerateImageInput {
  prompt: string;
  /** 例：1024x1024 / 2K / 2048x2048；默认 1024x1024 */
  size?: string;
  /** 参考图 URL 或本地图片（data URL）；有则走图生图 */
  reference?: string[];
  signal?: AbortSignal;
}

export interface GeneratedImage {
  buffer: Buffer;
  ext: string;
  mime: string;
  /** 模型返回的原始 URL（若有），便于追溯 */
  sourceUrl?: string;
}

const SIZE_RE = /^(\d{2,4})x(\d{2,4})$|^(1K|2K|4K)$/i;

export function normalizeSize(size?: string): string {
  const value = String(size || '').trim();
  if (!value) return '1024x1024';
  if (!SIZE_RE.test(value)) throw new Error(`尺寸格式不对：${value}（用 1024x1024 这类写法）`);
  return value;
}

export async function generateImages(
  input: GenerateImageInput,
  count = 1,
): Promise<GeneratedImage[]> {
  const model = getImageModel();
  if (!model) {
    throw new Error(
      '专业版还没配置图像模型：请到「设置 → 图像生成」填写你在方舟开通的图像模型 ID（例如你的 Seedream 接入点或模型名），再让我出图。',
    );
  }
  const key = getImageApiKey(resolveApiKey());
  if (!key) throw new Error('未配置大模型 API Key，无法调用图像接口');

  const url = `${getImageBaseUrl()}/images/generations`;
  const size = normalizeSize(input.size);
  const results: GeneratedImage[] = [];

  for (let i = 0; i < Math.max(1, Math.min(4, count)); i += 1) {
    const body: any = {
      model,
      prompt: input.prompt,
      size,
      response_format: 'url',
      watermark: false,
    };
    if (input.reference?.length) {
      body.image = input.reference.length === 1 ? input.reference[0] : input.reference;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: input.signal,
    });
    const json: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      const code = json?.error?.code || '';
      const msg = String(json?.error?.message || JSON.stringify(json)).slice(0, 300);
      if (code === 'InvalidEndpointOrModel.NotFound' || res.status === 404) {
        throw new Error(
          `图像模型「${model}」在当前账号不可用（${code || '404'}）：${msg}。请到方舟控制台确认已开通该图像模型，或在「设置 → 图像生成」改成你账号里实际可用的模型 ID。`,
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`图像接口鉴权失败（${res.status}）：请检查 API Key 权限。${msg}`);
      }
      if (res.status === 429) throw new Error(`图像接口限流（429）：稍后再试。${msg}`);
      throw new Error(`图像生成失败（HTTP ${res.status}）：${msg}`);
    }

    const item = json?.data?.[0];
    if (!item) throw new Error('图像接口返回里没有图片数据');

    if (item.b64_json) {
      results.push({ buffer: Buffer.from(item.b64_json, 'base64'), ext: '.png', mime: 'image/png' });
      continue;
    }
    if (!item.url) throw new Error('图像接口没有返回图片地址');

    // URL 有时效：立刻下载落盘，产物库只存自己的副本
    const fileRes = await fetch(item.url, { signal: input.signal });
    if (!fileRes.ok) throw new Error(`下载生成的图片失败（HTTP ${fileRes.status}）`);
    const contentType = fileRes.headers.get('content-type') || 'image/png';
    const ext = contentType.includes('jpeg') ? '.jpg' : contentType.includes('webp') ? '.webp' : '.png';
    results.push({
      buffer: Buffer.from(await fileRes.arrayBuffer()),
      ext,
      mime: contentType,
      sourceUrl: item.url,
    });
  }

  return results;
}
