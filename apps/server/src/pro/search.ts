/**
 * 联网搜索（P4）：百度网页搜索 + 链接还原 + 网页正文抓取。
 *
 * 约束（用户口径）：
 * - 走百度；设置页可切 Bing 作为兜底。
 * - 遇到百度安全验证**不硬刚**：如实返回 blocked，让上层提示用户手动处理。
 * - 不引爬虫框架，原生 fetch + 自己写的规则解析。
 */

export type SearchEngine = 'baidu' | 'bing';

export interface SearchItem {
  title: string;
  /** 还原后的真实 URL（不是 baidu.com/link 跳转链） */
  url: string;
  snippet: string;
  site: string;
}

export interface SearchOutcome {
  engine: SearchEngine;
  query: string;
  items: SearchItem[];
  /** 命中了验证/反爬：此时 items 为空，需要用户人工介入 */
  blocked?: 'verify' | 'no-results' | 'http-error';
  note?: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
};

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

export function decodeEntities(text: string): string {
  return String(text || '')
    .replace(/&#(\d{1,6});/g, (_, code) => {
      const n = Number(code);
      return n >= 32 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, code) => {
      const n = parseInt(code, 16);
      return n >= 32 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** 去掉标签拿纯文本（用于摘要/正文） */
export function stripTags(html: string): string {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 只留域名，用于结果里的来源标识 */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 百度跳转链（baidu.com/link?url=…）跟随 302 拿真实地址，最多 3 跳 */
export async function resolveRealUrl(url: string, signal?: AbortSignal): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return '';
  let current = url;
  for (let hop = 0; hop < 3; hop += 1) {
    if (!/(?:^https?:\/\/(?:www\.)?baidu\.com\/link\?|^https?:\/\/www\.bing\.com\/ck\/a|^https?:\/\/www\.baidu\.com\/baidu\.php\?)/i.test(current)) return current;
    const res = await fetch(current, { method: 'GET', redirect: 'manual', headers: BASE_HEADERS, signal });
    const location = res.headers.get('location');
    if (!location) return current;
    current = new URL(location, current).toString();
  }
    return current;
}

function looksBlocked(html: string): boolean {
  return /百度安全验证|请输入验证码|网络不给力|wappass\.baidu\.com\/static|captcha/i.test(html) && !/class="result/.test(html);
}

interface RawBlock {
  title: string;
  link: string;
  snippet: string;
  site: string;
}

function parseBaidu(html: string, limit: number): RawBlock[] {
  const blocks: RawBlock[] = [];
  // 结果标题统一是 <h3 ...><a href="http://www.baidu.com/link?url=...">标题</a></h3>
  const re = /<h3[^>]*>[\s\S]{0,300}?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi;
  const titlePositions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) titlePositions.push(m.index);

  for (let i = 0; i < titlePositions.length && blocks.length < limit; i += 1) {
    const start = titlePositions[i];
    const end = titlePositions[i + 1] ?? Math.min(html.length, start + 3000);
    re.lastIndex = start;
    const hit = re.exec(html);
    if (!hit || hit.index !== start) continue;

    const link = decodeEntities(hit[1]);
    const title = stripTags(hit[2]).replace(/\s+/g, ' ').trim();
    if (!title || !/^https?:\/\//i.test(link)) continue;
    // 过滤掉"扫码下载百度App""百度热榜"这类非结果块
    if (/扫码下载|百度App|百度热榜|听语音|相关搜索/.test(title)) continue;
    // 推广位（baidu.php 广告跳转）不当作搜索结果，避免把广告当事实来源
    if (/baidu\.php|baidu\.com\/ecom/i.test(link)) continue;

    const blockHtml = html.slice(start, end);
    const abstractMatch =
      blockHtml.match(/<div[^>]*class="[^"]*(?:c-abstract|content-right_[^"]*|content-line_[^"]*)[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
      blockHtml.match(/<span[^>]*class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    let snippet = abstractMatch ? stripTags(abstractMatch[1]) : '';
    if (!snippet) {
      const rest = blockHtml.slice(blockHtml.indexOf('</h3>') + 5);
      snippet = stripTags(rest);
    }
    snippet = snippet
      .replace(/\s+/g, ' ')
      .replace(/百度快照|查看更多|展开全部|广告/g, '')
      .trim()
      .slice(0, 220);

    blocks.push({ title, link, snippet, site: siteOf(link) });
  }
  return blocks;
}

function parseBing(html: string, limit: number): RawBlock[] {
  const blocks: RawBlock[] = [];
  const re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && blocks.length < limit) {
    const link = decodeEntities(m[1]);
    const title = stripTags(m[2]).replace(/\s+/g, ' ').trim();
    const snippet = stripTags(m[3]).replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!title || !link) continue;
    blocks.push({ title, link, snippet, site: siteOf(link) });
  }
  return blocks;
}

/** 百度对"裸奔请求"会返回安全验证页；先用首页拿一份 BAIDUID Cookie 再搜，就能拿到正常结果页 */
let baiduCookie = { value: '', at: 0 };
const BAIDU_COOKIE_TTL = 10 * 60 * 1000;

async function getBaiduCookie(signal?: AbortSignal): Promise<string> {
  if (baiduCookie.value && Date.now() - baiduCookie.at < BAIDU_COOKIE_TTL) return baiduCookie.value;
  try {
    const res = await fetch('https://www.baidu.com/', { headers: BASE_HEADERS, signal });
    const setCookie = (res.headers as any).getSetCookie?.() || [];
    const raw = res.headers.get('set-cookie') || '';
    const value = [...setCookie, raw]
      .filter(Boolean)
      .map((c: string) => String(c).split(';')[0])
      .filter(Boolean)
      .join('; ');
    baiduCookie = { value, at: Date.now() };
    return value;
  } catch {
    return '';
  }
}

export async function searchWeb(
  query: string,
  options: { engine?: SearchEngine; limit?: number; signal?: AbortSignal } = {},
): Promise<SearchOutcome> {
  const q = String(query || '').trim();
  if (!q) throw new Error('query 不能为空');
  const engine: SearchEngine = options.engine === 'bing' ? 'bing' : 'baidu';
  const limit = Math.max(1, Math.min(10, options.limit || 10));
  const url =
    engine === 'baidu'
      ? `https://www.baidu.com/s?wd=${encodeURIComponent(q)}&rn=${limit}&ie=utf-8`
      : `https://cn.bing.com/search?q=${encodeURIComponent(q)}&count=${limit}`;

  const runOnce = async (cookie: string) => {
    const headers = engine === 'baidu' && cookie ? { ...BASE_HEADERS, Cookie: cookie } : BASE_HEADERS;
    const res = await fetch(url, { headers, signal: options.signal });
    const html = await res.text();
    return { status: res.status, ok: res.ok, html };
  };

  let cookie = engine === 'baidu' ? await getBaiduCookie(options.signal) : '';
  let attempt = await runOnce(cookie);
  // 验证页/空结果：换一份新 Cookie 再试一次（不做任何验证码破解）
  if (engine === 'baidu' && attempt.ok && (looksBlocked(attempt.html) || !parseBaidu(attempt.html, 1).length)) {
    baiduCookie = { value: '', at: 0 };
    cookie = await getBaiduCookie(options.signal);
    if (cookie) attempt = await runOnce(cookie);
  }

  if (!attempt.ok) {
    return { engine, query: q, items: [], blocked: 'http-error', note: `HTTP ${attempt.status}` };
  }
  if (engine === 'baidu' && looksBlocked(attempt.html)) {
    return {
      engine,
      query: q,
      items: [],
      blocked: 'verify',
      note: '百度返回了安全验证页（带 Cookie 也过不去）。需要你在本机浏览器里打开百度、手动完成验证后再试；我不会尝试绕过验证码。也可以把设置里的搜索引擎切成 Bing。',
    };
  }

  const raw = engine === 'baidu' ? parseBaidu(attempt.html, limit) : parseBing(attempt.html, limit);
  if (!raw.length) {
    return {
      engine,
      query: q,
      items: [],
      blocked: 'no-results',
      note: '没有解析到结果（可能是页面结构变化或反爬），可以换个关键词，或改用 Bing。',
    };
  }

  const items: SearchItem[] = [];
  for (const block of raw) {
    const real = await resolveRealUrl(block.link, options.signal).catch(() => block.link);
    items.push({
      title: block.title,
      url: real,
      snippet: block.snippet,
      site: siteOf(real) || block.site,
    });
  }
  return { engine, query: q, items };
}

/** 抓网页正文：只取文字，截断交给上层 */
export async function fetchPageText(url: string, signal?: AbortSignal): Promise<{ url: string; title: string; text: string }> {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) throw new Error('只支持 http/https 链接');
  const res = await fetch(target, { headers: { ...BASE_HEADERS, Accept: 'text/html,*/*' }, signal, redirect: 'follow' });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`);
  if (!/text\/html|text\/plain|application\/(xhtml|json)/i.test(type) && type) {
    throw new Error(`这个链接不是网页文本（${type}），没法按正文抓取`);
  }
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]).replace(/\s+/g, ' ').trim() : '';
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const text = stripTags(bodyMatch ? bodyMatch[1] : html);
  if (!text) throw new Error('这个页面没有抓到可用文字（可能是纯脚本渲染的页面）');
  return { url: res.url || target, title, text };
}
