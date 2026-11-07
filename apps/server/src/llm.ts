import OpenAI from 'openai';
import { getPublicProfile, getPersona, getEnabledQA, getKnowledgeDocs } from './agent.js';
import type { Profile, Persona, QAPair } from '@resume-agent/shared';

const client = new OpenAI({
  apiKey: process.env.ARK_API_KEY,
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
});

const MODEL = process.env.ARK_MODEL || 'doubao-seed-2-0-mini-260428';

// 从档案数据构建 System Prompt
export function buildSystemPrompt(profile: Profile, persona: Persona, qaList: QAPair[] = []): string {
  const lines: string[] = [];
  const basics = profile.basics || {} as any;
  const experiences = profile.experiences || [];
  const projects = profile.projects || [];
  const skills = profile.skills || [];
  const education = profile.education || [];

  lines.push(`你是${basics.name}的个人简历助手，代表${basics.name}回答面试官的问题。`);
  if (persona?.tone) lines.push(`语气要求：${persona.tone}`);
  lines.push('');
  lines.push('## 回答规则');
  lines.push('1. 只能基于以下提供的简历资料和预设问答回答，不要编造经历或数据。');
  if (persona?.hardConstraint) {
    lines.push(`2. ${persona.hardConstraint}`);
  } else {
    lines.push('2. 如果资料里没有相关信息，直接说"这个问题我不太清楚，建议直接问本人"。');
  }
  lines.push('3. 回答要具体、有技术细节，避免空话套话。');
  lines.push('4. 不要暴露你是 AI 或机器人。');
  lines.push('5. 技术问题以口头解释为主，不要主动贴大段代码；只有面试官明确要求"写个例子/给段代码/写个demo"时，才用 markdown 代码块给出简洁的代码示例。');
  lines.push('6. 如果回答内容参考了"补充知识文档"，在句末标注来源，格式为 [来源:文档名]。只标注你实际用到的文档，不要标注所有文档。');
  if (persona?.refusalTopics?.length) {
    lines.push(`6. 遇到以下话题礼貌拒绝：${persona.refusalTopics.join('、')}。`);
  }
  lines.push('');

  lines.push('## 基本信息');
  lines.push(`姓名：${basics.name || '未填写'}`);
  lines.push(`职位：${basics.title || '未填写'}`);
  if (basics.city) lines.push(`城市：${basics.city}`);
  lines.push('');

  lines.push('## 个人简介');
  lines.push(profile.summary || '暂无');
  lines.push('');

  lines.push('## 工作经历');
  for (const exp of experiences) {
    lines.push(`### ${exp.company} | ${exp.role} | ${exp.start} - ${exp.end || '至今'}`);
    for (const h of (exp.highlights || [])) lines.push(`- ${h}`);
    if ((exp.stack || []).length) lines.push(`技术栈：${exp.stack.join('、')}`);
    lines.push('');
  }

  lines.push('## 项目经历');
  for (const proj of projects) {
    lines.push(`### ${proj.name}（${proj.period || ''}）`);
    if (proj.background) lines.push(`背景：${proj.background}`);
    if (proj.challenge) lines.push(`挑战：${proj.challenge}`);
    if (proj.solution) lines.push(`方案：${proj.solution}`);
    if (proj.result) lines.push(`成果：${proj.result}`);
    if ((proj.stack || []).length) lines.push(`技术栈：${proj.stack.join('、')}`);
    lines.push('');
  }

  lines.push('## 技能');
  for (const g of skills) {
    lines.push(`${g.group}：${(g.items || []).map((i: any) => i.name).join('、')}`);
  }
  lines.push('');

  lines.push('## 教育背景');
  for (const edu of education) {
    lines.push(`${edu.school} | ${edu.degree} | ${edu.major} | ${edu.period || ''}`);
  }

  // 预设问答（Q&A 库）
  if (qaList.length) {
    lines.push('');
    lines.push('## 预设问答（优先使用这些回答）');
    for (const qa of qaList) {
      lines.push(`### Q：${qa.question}`);
      if (qa.variants?.length) lines.push(`相似问法：${qa.variants.join('、')}`);
      lines.push(`A：${qa.answer}`);
      lines.push('');
    }
  }

  // 补充知识文档（RAG 分块：每个文档取前 1500 字符，总量不超过 6000 字符）
  const knowledgeDocs = getKnowledgeDocs();
  if (knowledgeDocs.length) {
    lines.push('');
    lines.push('## 补充知识文档（简历未覆盖时可参考）');
    let totalChars = 0;
    const MAX_TOTAL = 6000;
    for (const doc of knowledgeDocs) {
      const chunk = doc.content.slice(0, 1500);
      if (totalChars + chunk.length > MAX_TOTAL) break;
      totalChars += chunk.length;
      lines.push(`### ${doc.filename}${doc.tags?.length ? `（标签：${doc.tags.join('、')}）` : ''}`);
      lines.push(chunk);
      lines.push('');
    }
  }

  return lines.join('\n');
}

async function buildMessages(query: string, history: { role: string; content: string }[]) {
  const profile = getPublicProfile();
  const persona = getPersona();
  if (!profile || !persona) throw new Error('系统未配置档案');
  const qaList = getEnabledQA();
  const systemPrompt = buildSystemPrompt(profile, persona, qaList);
  return [
    { role: 'system' as const, content: systemPrompt },
    ...history.slice(-10),
    { role: 'user' as const, content: query },
  ];
}

// 不同模型对 temperature 的要求不同
function getTemperature(model: string): number | undefined {
  // GLM、Kimi 系列只允许 temperature=1
  if (model.startsWith('glm-') || model.startsWith('kimi-')) return 1;
  return 0.7;
}

// 调用 LLM（流式，通过回调逐 token 输出）
export async function streamChatWithLLM(
  query: string,
  history: { role: string; content: string }[] = [],
  onToken: (token: string) => void,
  modelOverride?: string,
): Promise<void> {
  const messages = await buildMessages(query, history);
  const model = modelOverride || MODEL;
  const temperature = getTemperature(model);

  const stream = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: 5000,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) onToken(delta.content);
  }
}
