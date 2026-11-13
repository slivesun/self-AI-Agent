import { proDb } from './db.js';

/**
 * 专业版自有配置。
 * 注意：模型 Key / 模型名**不在这里**——按用户口径两版共用 app_settings 里的那套，
 * 这里只放专业版独有的行为开关（权限模式、联网开关等）。
 */
export type PermissionMode = 'readonly' | 'standard';

const DEFAULTS: Record<string, string> = {
  permission_mode: 'standard',
  search_enabled: '1',
  // 专业版选用的对话模型：留空 = 继承普通版（两版共用同一把 Key，只是可以各选一个模型）
  model: '',
  // 视觉模型：留空则回退到共用的对话模型（账号实际可用的多模态模型 ID 由用户在设置里填）
  vision_model: '',
  // 图像生成模型：留空表示"未配置"，工具会如实报错而不是假装出图（P3）
  image_model: '',
  // 图像生成接口地址，默认火山方舟（OpenAI 兼容）
  image_base_url: 'https://ark.cn-beijing.volces.com/api/v3',
  // 搜索引台：默认百度（用户口径），可切 Bing 兜底
  search_engine: 'baidu',
};

export function getProSetting(key: string): string | null {
  const row = proDb.prepare('SELECT value FROM pro_settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (row) return String(row.value);
  return DEFAULTS[key] ?? null;
}

export function setProSetting(key: string, value: string | null) {
  if (value === null || value === '') {
    proDb.prepare('DELETE FROM pro_settings WHERE key = ?').run(key);
    return;
  }
  proDb
    .prepare('INSERT INTO pro_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function getPermissionMode(): PermissionMode {
  return getProSetting('permission_mode') === 'readonly' ? 'readonly' : 'standard';
}

/** 联网总开关：关掉后联网工具不进工具列表，工具层也拒绝执行（硬约束，不是提示词约束） */
export function isSearchEnabled(): boolean {
  return getProSetting('search_enabled') !== '0';
}

/** 搜索引擎：baidu（默认）/ bing（兜底） */
export function getSearchEngine(): 'baidu' | 'bing' {
  return getProSetting('search_engine') === 'bing' ? 'bing' : 'baidu';
}

export function getVisionModel(): string {
  return (getProSetting('vision_model') || '').trim();
}

/** 专业版选定的对话模型（空字符串表示继承普通版的模型） */
export function getProModel(): string {
  return (getProSetting('model') || '').trim();
}

export function getImageModel(): string {
  return (getProSetting('image_model') || '').trim();
}

export function getImageBaseUrl(): string {
  return (getProSetting('image_base_url') || '').trim().replace(/\/+$/, '') || 'https://ark.cn-beijing.volces.com/api/v3';
}

/** 图像接口的 Key：单独配置优先，否则回落到与对话共用的那把（不重复存 Key，由调用方传入共用 Key） */
export function getImageApiKey(sharedKey: string): string {
  const own = (getProSetting('image_api_key') || '').trim();
  return own || sharedKey;
}
