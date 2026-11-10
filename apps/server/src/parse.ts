import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import crypto from 'crypto';
import type { Profile } from '@resume-agent/shared';
import { getLLMClient, resolveModel } from './llm.js';

// 解析 PDF 文件 buffer，返回纯文本
export async function parsePdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text;
}

// 解析 .docx 文件 buffer，返回纯文本
export async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// 从纯文本中提取结构化档案（针对中文简历格式优化）
export function extractProfileFromText(text: string): Partial<Profile> {
  const profile: Partial<Profile> = {
    basics: { name: '', title: '', city: '', email: '', phone: '', links: [] },
    summary: '',
    experiences: [],
    projects: [],
    skills: [],
    education: [],
  };

  // 清理多余空格和页码标记
  const clean = text
    .replace(/\t/g, ' ')
    .replace(/[ \u00a0]+/g, ' ')
    .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '')
    .trim();
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);

  // ===== 基本信息 =====
  for (const line of lines) {
    // 姓名
    const nameMatch = line.match(/姓\s*名[：:]\s*(\S+)/);
    if (nameMatch) profile.basics!.name = nameMatch[1].trim();

    // 职位
    const titleMatch = line.match(/职\s*位[：:]\s*(\S+)/);
    if (titleMatch) profile.basics!.title = titleMatch[1].trim();

    // 电话
    const phoneMatch = line.match(/电\s*话[：:]\s*(\d{11})/);
    if (phoneMatch) profile.basics!.phone = phoneMatch[1];

    // 邮箱
    const emailMatch = line.match(/[\w.-]+@[\w.-]+\.\w+/);
    if (emailMatch && !profile.basics!.email) profile.basics!.email = emailMatch[0];

    // 毕业学校 + 专业
    const eduMatch = line.match(/毕业学校[：:]\s*(\S+)\s+专业[：:]\s*(\S+)/);
    if (eduMatch) {
      profile.education!.push({ school: eduMatch[1], degree: '本科', major: eduMatch[2], period: '' });
    }
  }

  // ===== 分段 =====
  const skillSection = extractSection(clean, ['IT 技能', '专业技能', '技能']);
  const workSection = extractSection(clean, ['工作经历及项目经验', '工作经历', '工作经验', '项目经验']);
  const selfEvalSection = extractSection(clean, ['自我评价', '个人简介', '个人总结']);

  // ===== 技能 =====
  if (skillSection) {
    profile.skills = parseSkills(skillSection);
  }

  // ===== 工作经历 + 项目 =====
  if (workSection) {
    const { experiences, projects } = parseWorkAndProjects(workSection);
    profile.experiences = experiences;
    profile.projects = projects;
  }

  // ===== 自我评价 → 简介 =====
  if (selfEvalSection) {
    profile.summary = selfEvalSection.replace(/\n/g, ' ').slice(0, 300);
  }

  return profile;
}

// 按标题提取段落
function extractSection(text: string, headers: string[]): string | null {
  for (const header of headers) {
    // 精确匹配标题行
    const regex = new RegExp(`^\\s*${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
    const m = text.match(regex);
    if (m && m.index !== undefined) {
      const start = m.index + m[0].length;
      // 找下一个已知标题作为结束
      const allHeaders = ['IT 技能', '专业技能', '工作经历及项目经验', '工作经历', '工作经验', '项目经验', '自我评价', '个人简介', '个人总结', '教育经历', '教育'];
      let end = text.length;
      for (const h of allHeaders) {
        const hr = new RegExp(`^\\s*${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
        const hm = text.slice(start).match(hr);
        if (hm && hm.index !== undefined && hm.index > 0) {
          end = start + hm.index;
          break;
        }
      }
      return text.slice(start, end).trim();
    }
  }
  return null;
}

// 过滤掉非技术词
const NOISE_WORDS = new Set(['and', 'the', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'did', 'let', 'say', 'she', 'too', 'use', 'Code', 'Rules', 'Skills', 'Review', 'W3C', 'ES6', 'CUI', 'IM', 'H5', 'API', 'RESTful', 'Topic']);

// 解析技能段
function parseSkills(text: string): any[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const allItems: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    // 去掉行首的符号
    const cleaned = line.replace(/^[•·\-–—\s]+/, '').trim();
    if (!cleaned || cleaned.length < 2) continue;

    // 提取技术关键词（英文单词、框架名等）
    const techMatches = cleaned.match(/[A-Za-z][A-Za-z0-9.+#/]*[A-Za-z0-9+#]*/g);
    if (techMatches) {
      for (let t of techMatches) {
        t = t.trim();
        if (t.length < 2 || t.length > 30) continue;
        if (NOISE_WORDS.has(t)) continue;
        // 去重（不区分大小写）
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        allItems.push(t);
      }
    }
  }

  if (allItems.length === 0) return [];

  // 分组
  const groups: any[] = [];
  const frontend = allItems.filter(t => /react|vue|webpack|vite|typescript|javascript|html|css|sass|less|tailwind|redux|router|ant|element|echarts|taro|microapp/i.test(t));
  const backend: string[] = [];
  const ai: string[] = [];
  const other: string[] = [];
  for (const t of allItems) {
    if (frontend.includes(t)) continue;
    if (/node|python|java/i.test(t)) backend.push(t);
    else if (/llm|agent|rag|mcp|cursor|claude|codex|trae|sse/i.test(t)) ai.push(t);
    else other.push(t);
  }

  if (frontend.length) groups.push({ group: '前端', items: frontend.map(name => ({ name, level: 5 })) });
  if (backend.length) groups.push({ group: '后端', items: backend.map(name => ({ name, level: 3 })) });
  if (ai.length) groups.push({ group: 'AI/工程化', items: ai.map(name => ({ name, level: 4 })) });
  if (other.length) groups.push({ group: '其他', items: other.map(name => ({ name, level: 3 })) });

  return groups;
}

// 解析工作经历和项目
function parseWorkAndProjects(text: string): { experiences: any[]; projects: any[] } {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const experiences: any[] = [];
  const projects: any[] = [];

  let currentExp: any = null;
  let currentProj: any = null;

  for (const line of lines) {
    // 匹配公司行：公司名 | 职位 | 时间
    // 例如：微微科技 | 前端工程师 · AI 全栈 | 2023.04 - 2026.04
    const companyMatch = line.match(/^(.+?)\s*[|｜]\s*(.+?)\s*[|｜]\s*(\d{4}[.\-/]\d{1,2})\s*[-—~]\s*(\d{4}[.\-/]\d{1,2}|至今|present)/i);
    if (companyMatch) {
      // 保存上一个项目
      if (currentProj) { projects.push(currentProj); currentProj = null; }
      // 保存上一个经历
      if (currentExp) experiences.push(currentExp);

      currentExp = {
        id: crypto.randomUUID(),
        company: companyMatch[1].trim(),
        role: companyMatch[2].trim(),
        start: companyMatch[3].trim(),
        end: companyMatch[4].toLowerCase() === 'present' || companyMatch[4] === '至今' ? null : companyMatch[4].trim(),
        highlights: [],
        stack: [],
        visibility: 'public'
      };
      continue;
    }

    // 匹配项目行：项目：xxx 或 项目一：xxx
    const projMatch = line.match(/^项目[一二三四五六七八九十]*[：:]\s*(.+)/);
    if (projMatch && currentExp) {
      if (currentProj) projects.push(currentProj);
      currentProj = {
        id: crypto.randomUUID(),
        name: projMatch[1].trim(),
        role: currentExp.role,
        period: `${currentExp.start} - ${currentExp.end || '至今'}`,
        background: '',
        challenge: '',
        solution: '',
        result: '',
        stack: [],
        links: [],
        visibility: 'public'
      };
      continue;
    }

    // 技术栈行
    if (line.match(/^技术栈[：:]/) || line.match(/^技\s*术\s*栈[：:]/)) {
      const stackStr = line.replace(/^技术栈[：:]/, '').trim();
      const techs = stackStr.split(/[\/、,，]/).map(s => s.trim()).filter(Boolean);
      if (currentProj) {
        currentProj.stack = techs;
      } else if (currentExp) {
        currentExp.stack = techs;
      }
      continue;
    }

    // 官网/链接行
    if (line.match(/https?:\/\//)) {
      const urlMatch = line.match(/https?:\/\/[^\s，。]+/);
      if (urlMatch && currentProj) {
        currentProj.links.push({ label: '官网', url: urlMatch[0] });
      }
      continue;
    }

    // 其他行：作为工作亮点或项目描述
    const cleaned = line.replace(/^[•·\-–—\s]+/, '').trim();
    if (!cleaned || cleaned.length < 5) continue;

    // 跳过页码行
    if (cleaned.match(/^--\s*\d+\s*of\s*\d+\s*--$/)) continue;

    if (currentProj) {
      currentProj.solution += (currentProj.solution ? ' ' : '') + cleaned;
    } else if (currentExp) {
      currentExp.highlights.push(cleaned);
    }
  }

  if (currentProj) projects.push(currentProj);
  if (currentExp) experiences.push(currentExp);

  return { experiences, projects };
}

// ===== 规则结果与大模型结果的合并 =====
export type LLMFailureCode = 'no_key' | 'quota' | 'timeout' | 'network' | 'invalid_json' | 'truncated' | 'unknown';

export interface LLMParseError {
  code: LLMFailureCode;
  message: string;
}

export interface LLMParseResult {
  profile: Partial<Profile> | null;
  error: LLMParseError | null;
}

// 输出上限：一份中文简历的结构化 JSON 实测要 5000~8000 字符（且该模型带思考过程，
// 会先消耗大量 token），2000 时必然在数组中间被截断，整份 JSON 解析失败。
const MAX_OUTPUT_TOKENS = 8000;

function isNonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

/**
 * 规则解析打底，大模型结果只覆盖「非空」字段。
 * 避免模型返回空值/空数组时把规则已经抓到的内容抹掉。
 */
export function mergeProfile(rule: Partial<Profile>, llm: Partial<Profile>): Partial<Profile> {
  const out: any = { ...rule };
  for (const key of Object.keys(llm) as (keyof Partial<Profile>)[]) {
    const lv: any = (llm as any)[key];
    if (!isNonEmpty(lv)) continue;
    if (key === 'basics') {
      out.basics = { ...(out.basics || {}) };
      for (const field of Object.keys(lv)) {
        if (isNonEmpty(lv[field])) out.basics[field] = lv[field];
      }
      continue;
    }
    if (key === 'experiences' || key === 'projects') {
      const keyOf = key === 'experiences'
        ? (x: any) => String(x?.company || '').replace(/\s+/g, '')
        : (x: any) => String(x?.name || '').replace(/\s+/g, '');
      out[key] = unionList(Array.isArray(out[key]) ? out[key] : [], lv as any[], keyOf);
      continue;
    }
    out[key] = lv;
  }
  return out;
}

/**
 * 规则与大模型都抓到同一条经历/项目时，不能只留一份：
 * 以字段更全的大模型结果为主，规则结果里非空的字段再补进去；两边独有的一条都保留。
 */
function unionList(ruleList: any[], llmList: any[], keyOf: (x: any) => string): any[] {
  const merged = new Map<string, any>();
  for (const item of ruleList) {
    const k = keyOf(item);
    if (!k) continue;
    merged.set(k, item);
  }
  for (const item of llmList) {
    const k = keyOf(item);
    if (!k) {
      merged.set(`__llm_${merged.size}`, item);
      continue;
    }
    const existing = merged.get(k);
    if (!existing) {
      merged.set(k, item);
      continue;
    }
    const combined: any = { ...item };
    for (const field of Object.keys(existing)) {
      if (!isNonEmpty(combined[field]) && isNonEmpty(existing[field])) combined[field] = existing[field];
    }
    merged.set(k, combined);
  }
  return [...merged.values()];
}

/** 从被截断的模型输出里尽力恢复出一个完整 JSON 对象 */
function repairTruncatedJson(raw: string): { value: any; repaired: boolean } | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  const s = raw.slice(start);

  // 1) 原样解析（正常情况走这里）
  try {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) return { value: JSON.parse(m[0]), repaired: false };
  } catch {
    /* 进入修复流程 */
  }

  // 2) 扫描出所有「安全切点」（逗号之后 / 括号闭合之后），从后往前补全括号
  const checkpoints: Array<{ end: number; closers: string }> = [];
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { stack.push('}'); continue; }
    if (c === '[') { stack.push(']'); continue; }
    if (c === '}' || c === ']') {
      if (stack[stack.length - 1] === c) stack.pop();
      checkpoints.push({ end: i + 1, closers: [...stack].reverse().join('') });
      continue;
    }
    if (c === ',' && stack.length) {
      checkpoints.push({ end: i, closers: [...stack].reverse().join('') });
    }
  }

  for (let i = checkpoints.length - 1; i >= 0 && i > checkpoints.length - 300; i--) {
    const cp = checkpoints[i];
    const body = s.slice(0, cp.end).replace(/[,\s]+$/, '');
    try {
      return { value: JSON.parse(body + cp.closers), repaired: true };
    } catch {
      /* 继续往前找更短的切点 */
    }
  }
  return null;
}

function classifyLLMError(e: any): LLMParseError {
  const msg = String(e?.message || e || '').slice(0, 200);
  const status = e?.status ?? e?.response?.status;
  if (msg.includes('未配置大模型 API Key')) {
    return { code: 'no_key', message: '未配置大模型 API Key，请在后台「模型设置」中填写' };
  }
  if (status === 429 || /429|usage limit|rate limit|quota|exceeded/i.test(msg)) {
    return { code: 'quota', message: '大模型调用额度或频率已达上限，可稍后重试或在「模型设置」更换模型' };
  }
  if (/timeout|timed out|ETIMEDOUT|aborted/i.test(msg)) {
    return { code: 'timeout', message: '大模型响应超时' };
  }
  if (/fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(msg)) {
    return { code: 'network', message: '无法连接大模型服务，请检查网络' };
  }
  return { code: 'unknown', message: msg || '大模型调用失败' };
}

// 用 LLM 从简历文本提取结构化档案（兜底/增强）
// 失败时不再静默返回 null，而是把原因带出去，让上层能提示用户
export async function parseResumeWithLLM(rawText: string): Promise<LLMParseResult> {
  let client;
  try {
    // 复用统一的客户端：Key 来源为环境变量或后台「模型设置」
    client = getLLMClient();
  } catch (e: any) {
    return { profile: null, error: classifyLLMError(e) };
  }
  const model = resolveModel();

  const prompt = `你是简历解析助手。从以下简历文本中提取结构化信息，严格输出 JSON（不要其他文字）。
格式：
{
  "basics": {"name":"","title":"","city":"","email":"","phone":""},
  "summary": "",
  "experiences": [{"company":"","role":"","start":"","end":"","highlights":[],"stack":[]}],
  "projects": [{"name":"","role":"","period":"","background":"","solution":"","result":"","stack":[]}],
  "skills": [{"group":"","items":[{"name":"","level":3}]}],
  "education": [{"school":"","degree":"","major":"","period":""}]
}

简历文本：
${rawText.slice(0, 4000)}`;

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: MAX_OUTPUT_TOKENS,
    });
    const text = res.choices[0]?.message?.content || '';
    if (!text.trim()) {
      return { profile: null, error: { code: 'invalid_json', message: '大模型返回内容为空' } };
    }
    const repaired = repairTruncatedJson(text);
    if (!repaired) {
      return { profile: null, error: { code: 'invalid_json', message: '大模型返回的不是可解析的 JSON' } };
    }
    if (repaired.repaired) {
      return {
        profile: repaired.value as Partial<Profile>,
        error: { code: 'truncated', message: '大模型输出被截断，已恢复部分内容，请核对是否缺项' },
      };
    }
    return { profile: repaired.value as Partial<Profile>, error: null };
  } catch (e: any) {
    console.error('LLM 解析失败:', e?.message || e);
    return { profile: null, error: classifyLLMError(e) };
  }
}
