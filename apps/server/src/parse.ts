import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import crypto from 'crypto';
import type { Profile } from '@resume-agent/shared';

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

// 用 LLM 从简历文本提取结构化档案（兜底/增强）
export async function parseResumeWithLLM(rawText: string): Promise<Partial<Profile> | null> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({
    apiKey: process.env.ARK_API_KEY,
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  });
  const model = process.env.ARK_MODEL || 'doubao-seed-2-0-mini-260428';

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
      max_tokens: 2000,
    });
    const text = res.choices[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as Partial<Profile>;
  } catch (e) {
    console.error('LLM 解析失败:', e);
  }
  return null;
}
