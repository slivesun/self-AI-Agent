import type { ToolDef } from './types.js';
import { truncateOutput } from './types.js';
import { searchWeb, fetchPageText } from '../search.js';
import { getSearchEngine } from '../settings.js';

/**
 * 联网工具（P4）：百度搜索 + 网页正文抓取。
 *
 * 开关是**硬约束**：总开关关掉时这两个工具根本不会出现在工具列表里（agent 层过滤），
 * 这里再兜一层，任何绕过路径都直接报错。
 */
function assertSearchAllowed(ctx: { searchEnabled?: boolean }) {
  if (!ctx.searchEnabled) throw new Error('联网搜索已被关闭（设置里的总开关或本轮开关关闭），本轮不允许访问网络。请如实告知用户，不要编造网络内容。');
}

export const webSearch: ToolDef = {
  name: 'web_search',
  label: '联网搜索',
  description:
    '用百度（或设置里指定的 Bing）搜索公开网页，返回标题、摘要、来源域名与**可直接引用的真实链接**。需要最新信息、事实核查、外部资料时用。一次最多 10 条结果；单轮最多搜 5 次。',
  level: 'R',
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词，直接用用户的问题或关键实体' },
      limit: { type: 'number', description: '返回条数，默认 6，最多 10' },
      engine: { type: 'string', enum: ['baidu', 'bing'], description: '搜索引擎，默认跟随设置（百度）' },
    },
    required: ['query'],
  },
  preview: (args) => `联网搜索「${String(args?.query || '').slice(0, 40)}」`,
  async run(args, ctx) {
    assertSearchAllowed(ctx);
    const query = String(args?.query || '').trim();
    if (!query) throw new Error('query 不能为空');
    const limit = Math.max(1, Math.min(10, Number(args?.limit) || 6));
    // 单轮搜索上限 5 次：防止模型对着同一个关键词反复刷
    if ((ctx.searchCount || 0) >= 5) {
      throw new Error('本轮搜索次数已用完（上限 5 次）。请直接根据已有结果作答，或如实说明信息不足。');
    }
    const engineArg = args?.engine === 'bing' || args?.engine === 'baidu' ? args.engine : getSearchEngine();

    const outcome = await searchWeb(query, { engine: engineArg, limit });

    if (outcome.blocked === 'verify') {
      throw new Error(outcome.note || '百度需要人工完成验证');
    }
    if (outcome.blocked) {
      throw new Error(`${outcome.note || '搜索失败'}${outcome.blocked === 'no-results' ? '（可以换关键词，或让设置里把引擎切成 Bing）' : ''}`);
    }

    ctx.recordSearch?.({
      query,
      engine: outcome.engine,
      items: outcome.items.map((item) => ({ title: item.title, url: item.url, site: item.site })),
    });

    const lines = outcome.items.map(
      (item, index) =>
        `${index + 1}. ${item.title}\n   来源：${item.site || '未知'}｜${item.url}\n${item.snippet ? `   摘要：${item.snippet}` : ''}`,
    );

    return truncateOutput(
      [
        `搜索「${query}」（${outcome.engine}）共 ${outcome.items.length} 条：`,
        '',
        lines.join('\n\n'),
        '',
        '提示：引用时请用上面的真实链接（不要引用 baidu.com/link 跳转链）；需要全文就用 web_fetch 抓取。',
      ].join('\n'),
    );
  },
};

export const webFetch: ToolDef = {
  name: 'web_fetch',
  label: '抓网页',
  description:
    '抓取一个网页的正文（纯文本，去掉脚本/样式），用于把搜到的资料读全。只支持 http/https 页面；单页最多返回 8000 字符。',
  level: 'R',
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要抓取的网页地址（用搜索返回的真实链接）' },
      limit: { type: 'number', description: '最多返回字符数，默认 6000' },
    },
    required: ['url'],
  },
  preview: (args) => `抓取网页 ${String(args?.url || '').slice(0, 70)}`,
  async run(args, ctx) {
    assertSearchAllowed(ctx);
    const url = String(args?.url || '').trim();
    if (!url) throw new Error('url 不能为空');
    const limit = Math.max(1000, Math.min(8000, Number(args?.limit) || 6000));

    const page = await fetchPageText(url);
    const text = page.text.length > limit ? `${page.text.slice(0, limit)}\n…（正文共 ${page.text.length} 字符，已截断）` : page.text;

    ctx.recordSearch?.({
      query: url,
      engine: 'fetch',
      items: [{ title: page.title || url, url: page.url }],
    });

    return truncateOutput(`网页：${page.title || '（无标题）'}\n地址：${page.url}\n\n${text}`);
  },
};
