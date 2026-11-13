/**
 * P4 联网自检：直接打百度（默认）/ Bing，验证解析规则与链接还原是真的能用的。
 * 用法：npx tsx scripts/pro-search-check.mjs "关键词" [baidu|bing]
 */

import { searchWeb, fetchPageText } from '../src/pro/search.ts';

const query = process.argv[2] || 'electron 是什么';
const engine = process.argv[3] === 'bing' ? 'bing' : 'baidu';

try {
  const outcome = await searchWeb(query, { engine, limit: 5 });
  console.log(`ENGINE=${outcome.engine} QUERY=${outcome.query} BLOCKED=${outcome.blocked || 'no'} ITEMS=${outcome.items.length}`);
  if (outcome.note) console.log(`NOTE=${outcome.note}`);
  for (const item of outcome.items) {
    console.log(`- ${item.title}`);
    console.log(`  ${item.site} | ${item.url}`);
    if (item.snippet) console.log(`  摘要：${item.snippet.slice(0, 80)}`);
  }

  const redirectLeft = outcome.items.filter((i) => /baidu\.com\/link/.test(i.url)).length;
  if (outcome.items.length && redirectLeft) {
    console.log(`CHECK_FAIL 还有 ${redirectLeft} 条是跳转链未还原`);
    process.exit(1);
  }

  const fetchTarget = outcome.items.find((i) => !/(^|\.)baidu\.com$/.test(i.site)) || outcome.items[0];
  if (fetchTarget) {
    try {
      const page = await fetchPageText(fetchTarget.url);
      console.log(`FETCH_OK title=${page.title.slice(0, 40)} chars=${page.text.length}`);
      console.log(`HEAD=${page.text.slice(0, 120).replace(/\s+/g, ' ')}`);
    } catch (err) {
      // 目标站点反爬（403 等）不算搜索失败，只记录，别让整条链路的结论失真
      console.log(`FETCH_WARN ${fetchTarget.site} ${err?.message || err}`);
    }
  }
  if (!outcome.items.length) {
    console.log('NO_ITEMS');
    process.exit(outcome.blocked === 'verify' ? 2 : 1);
  }
} catch (err) {
  console.log(`CHECK_FAIL ${err?.message || err}`);
  process.exit(1);
}
