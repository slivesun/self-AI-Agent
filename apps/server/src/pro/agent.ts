import crypto from 'crypto';
import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { getLLMClient, resolveModel } from '../llm.js';
import { findTool, toOpenAITools, TOOL_LIST, WEB_TOOL_NAMES } from './tools/index.js';
import type { PermissionDecision, ToolContext, ToolLevel } from './tools/types.js';
import { truncateOutput } from './tools/types.js';
import { getPermissionMode, getProModel } from './settings.js';
import { getWorkspaceRoots } from './workspace.js';
import { PRO_BACKUPS_DIR, PRO_UPLOADS_DIR, PRO_ARTIFACTS_DIR } from './paths.js';
import { buildHistory } from './context.js';
import { insertProChange, listProChanges } from './db.js';

const MAX_STEPS = 16;
/** 单条回答被 max_tokens 截断后最多自动续写的段数 */
const MAX_CONTINUATIONS = 3;
const TOOL_TIMEOUT_MS = 90_000;
const UI_RESULT_LIMIT = 1200;

export interface AgentToolRecord {
  id: string;
  name: string;
  label: string;
  level: ToolLevel;
  args: string;
  status: 'ok' | 'error' | 'denied';
  result: string;
  durationMs: number;
}

export interface AgentRunInput {
  sessionId: string;
  runId: string;
  userText: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  /** 本轮是否允许联网（总开关 + 单轮开关合并后的结果；false 时联网工具整轮不可用） */
  searchEnabled: boolean;
}

export interface AgentDeps {
  emit: (event: string, data: any) => void;
  /** 请求用户确认；返回 once（允许一次）/ session（本会话允许）/ deny（拒绝） */
  requestPermission: (input: { tool: string; level: ToolLevel; args: any; preview: string }) => Promise<PermissionDecision>;
  /** 本会话内已放行的工具（session 决策的落点） */
  sessionAllowedTools: Set<string>;
  audit: (input: { tool: string; level: string; args: string; status: string; durationMs?: number | null }) => void;
  signal: AbortSignal;
}

export interface AgentResult {
  text: string;
  tools: AgentToolRecord[];
  aborted: boolean;
  model: string;
  inputChars: number;
  outputChars: number;
  /** 本轮实际发生的联网动作（搜索/抓取），用于消息上标注与引用 */
  searches: { query: string; engine: string; items: { title: string; url: string }[] }[];
}

function temperatureFor(model: string): number {
  if (model.startsWith('glm-') || model.startsWith('kimi-')) return 1;
  return 0.5;
}

function buildSystemPrompt(mode: 'readonly' | 'standard', roots: string[], recentChanges: number, searchEnabled: boolean): string {
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  const rootLines = roots.length
    ? roots.map((r) => `- ${r}`).join('\n')
    : '（未授权任何本地目录，文件类工具会报错；提示用户去「设置 → 工作区」添加）';

  return [
    '你是「个人 AI 助手 · 专业版」，运行在用户本机的全能工作助手：读/改代码、跑命令、分析图片、出图出文档。外部事实只能来自工具。',
    '',
    '## 输出风格（先读这条，它决定 token 花多少）',
    '- 第一步先判断任务类型，再决定长度：',
    '  · 闲聊、单点事实、要不要都行的确认 → 极简，一句话到 80 字内。',
    '  · 分析/诊断/改造代码、写文档、出方案、讲解原理 → 该长就长，用标题+条目把结构讲清；不要为了"短"把结论、证据、下一步砍掉，那样反而要用户追问一轮。',
    '- 长回答的篇幅要花在**结论和依据**上，不要花在过程复述：工具已经调过什么，卡片里都有，正文用一句话带过即可。',
    '- 不复述用户的问题，不写开场客套，不写"完成了，总结如下"。',
    '- 改完代码只回：改了哪些文件、改了什么、验证结果（通过/失败）。diff 由界面展示，不贴正文。',
    '- 不主动扩话题：不加"延伸建议""还可以这样""如果需要我可以…"。',
    '- 每条回答必须有一个明确落点：要么做完了、要么明确"这一步到这、还剩什么"。**禁止以"接下来我…""接着改…"这类半句话结束**——话说到一半比话多更糟。',
    '- 用户追问时按追问范围补，不要重启一份完整说明。',
    '- 例外：危险/不可逆/花钱的操作，再短也要一句风险提示。',
    '',
    '## 铁律',
    '1. 需要文件内容、目录结构、命令结果、图片内容，必须真的调用工具；绝不编造。',
    '2. 工具失败如实说明原因，不假装成功，不编一份"结果"。',
    '3. 没做过的操作不要声称做过，只描述工具实际返回的内容。',
    '4. 改文件前用一句话说明要改什么；系统会申请授权，用户拒绝就停，不要绕过。',
    '5. 只引用必要片段，不整段粘贴文件。',
    '6. 不确定就说"不确定"，并说明缺什么信息或需要授权什么。',
    '',
    '## 干活方式',
    '- 超过 2 步的任务：先给 3–5 条编号计划再动手，不要盲改。',
    '- 一步一个可验证动作：定位（fs_glob/fs_grep）→ 局部读（fs_read offset/limit）→ 改（fs_edit）→ 验证（shell_run 跑构建/测试/typecheck）。',
    '- 命令失败先读 stderr 再改，别原样重跑；最多重试一次，仍失败就停下说明卡点。',
    '- 用户说"撤销/回滚"：fs_restore 先 list=true 取 changeId。',
    '',
    '## 当前环境',
    `- 时间：${now}`,
    `- 权限：${mode === 'readonly' ? '只读（写操作与命令一律被拒）' : '标准（读放行，写文件与跑命令需确认）'}`,
    '- 可操作目录：',
    rootLines,
    `- 上传图片只读目录：${PRO_UPLOADS_DIR}`,
    `- 产物目录（回看/改刚生成的图从这里找）：${PRO_ARTIFACTS_DIR}`,
    `- 本会话 ${recentChanges} 条写文件记录，均带备份可回滚`,
    searchEnabled
      ? '- 联网：本轮允许。外部事实用 web_search（百度，≤5 次/轮），读全文用 web_fetch；引用只给工具返回的真实链接。'
      : '- 联网：本轮禁止（用户关了开关，工具不可用）。涉及最新/外部事实就直说"本轮未联网，无法核实"，绝不编造结果或链接。',
    '',
    '## 工具要点（只记差异，不啰嗦）',
    '- 找文件 fs_glob，找内容 fs_grep；大文件 fs_read 分段，不整篇灌上下文。',
    '- 改已有文件用 fs_edit（精确替换），建新文件用 fs_write（整体覆盖，慎用）。',
    '- shell_run 默认 60s 超时：装依赖、构建、测试、git 状态都走它；不要用交互式命令。',
    '- image_generate：prompt 写清主体/风格/构图/光线/配色，多张传 count。模型没配/没开通会直接报错，如实让用户去「设置 → 图像生成」填 ID，不要编"已生成"。',
    '- design_render 交整页内联 HTML，进产物库可预览；交付 Word 用 doc_export（不要只说"复制到 Word"）；读 docx/pdf/md 用 doc_read。',
    '- 用户给图片路径就用 image_analyze 读图，不按文件名猜。',
    '- 联网顺序：web_search 拿标题+链接 → 挑 1–3 条 web_fetch 读正文 → 结论附真实链接（不要 baidu.com/link 跳转链）。命中安全验证就如实说并建议手动验证，别反复重试同一关键词。',
    '- 系统操作：system_info 查机器；system_open 开图/文件夹/网址（路径须在授权目录内）；clipboard_write 粘贴文本；只在需要看屏幕时才 screen_capture，截完可用 image_analyze 读。读剪贴板属隐私操作，仅用户明确要求时做。',
    '- 超过 3 步的任务先 todo_set 拆分，做完一条改 done；没真做就别报"已完成"。',
  ].join('\n');
}

async function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: any;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 执行超时（${Math.round(ms / 1000)} 秒）`)), ms);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeJson(value: any, limit = 400): string {
  try {
    const text = JSON.stringify(value ?? {});
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch {
    return String(value).slice(0, limit);
  }
}

/**
 * Agent 循环：流式输出文本 + 累积 tool_calls → 执行工具（含权限网关）→ 继续。
 * 用的是 OpenAI 兼容接口（与普通版共用同一把 Key / 同一个模型配置）。
 */
export async function runProAgent(input: AgentRunInput, deps: AgentDeps): Promise<AgentResult> {
  const client = getLLMClient();
  const model = getProModel() || resolveModel();
  const mode = getPermissionMode();
  const roots = getWorkspaceRoots();

  const backup = async (absPath: string): Promise<string | null> => {
    if (!fss.existsSync(absPath)) return null;
    const driveRoot = path.parse(absPath).root;
    const rel = path.relative(driveRoot, absPath).replace(/[\\:]/g, (m) => (m === '\\' ? path.sep : '_'));
    const dest = path.join(PRO_BACKUPS_DIR, input.runId, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(absPath, dest);
    return dest;
  };

  const toolCtx: ToolContext = {
    runId: input.runId,
    sessionId: input.sessionId,
    roots,
    extraRoots: [PRO_UPLOADS_DIR, PRO_ARTIFACTS_DIR],
    mode,
    requestPermission: deps.requestPermission,
    backup,
    audit: (record) => deps.audit(record),
    recordChange: (change) => {
      const id = crypto.randomUUID();
      insertProChange({
        id,
        sessionId: input.sessionId,
        runId: input.runId,
        workspace: path.parse(change.filePath).root,
        filePath: change.filePath,
        action: change.action,
        backupPath: change.backupPath,
        diff: change.diff,
      });
      return id;
    },
    emit: (event, data) => deps.emit(event, data),
    searchEnabled: input.searchEnabled,
    recordSearch: (entry) => {
      searches.push(entry);
      deps.emit('search', { query: entry.query, engine: entry.engine, count: entry.items.length, items: entry.items });
    },
  };

  const recentChanges = listProChanges({ sessionId: input.sessionId, limit: 20 }).length;
  const systemPrompt = buildSystemPrompt(mode, roots, recentChanges, input.searchEnabled);

  // 联网关掉时，把联网工具从工具列表里整体摘掉：模型看不到，也就没法调
  const toolFilter = input.searchEnabled
    ? undefined
    : new Set(TOOL_LIST.filter((t) => !WEB_TOOL_NAMES.has(t.name)).map((t) => t.name));
  const searches: AgentResult['searches'] = [];

  const { history, digest } = buildHistory(
    input.history.map((m) => ({ role: m.role, content: String(m.content || '') })),
  );

  const messages: any[] = [
    { role: 'system', content: digest ? `${systemPrompt}\n\n## ${digest}` : systemPrompt },
    ...history,
    { role: 'user', content: input.userText },
  ];

  const inputChars = messages.reduce((sum, m) => sum + String(m.content || '').length, 0);
  const tools: AgentToolRecord[] = [];
  let fullText = '';
  let aborted = false;
  let lastError = '';

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (deps.signal.aborted) {
      aborted = true;
      break;
    }

    let stepText = '';
    let calls: { id: string; name: string; args: string }[] = [];
    let stepSucceeded = false;

    // 最后一步强制收尾：只许输出文字，不许再调工具。
    // 否则模型会在"接着改下一个文件"这种半句话上被步数上限掐断，用户看到的就是"回答被截断"。
    const isLastStep = step === MAX_STEPS - 1;
    if (isLastStep) {
      messages.push({
        role: 'system',
        content:
          '本轮工具调用步数已到上限。这一步不要调用任何工具，直接用文字给用户一个完整的收尾：已经做了什么、结果如何、还剩什么没做（如需要用户下一轮说"继续"）。不要以"接下来我要…"这种半句话结束。',
      });
    }

    // 上游偶发在建立连接后立刻断流（undici 报 TypeError: terminated），
    // 只要还没往界面吐过字就可以安全重试一次，否则不重试以免界面出现重复内容。
    for (let attempt = 0; attempt < 2 && !stepSucceeded; attempt += 1) {
      const emittedBefore = fullText.length;
      stepText = '';
      calls = [];

      try {
        // 单条回答被 max_tokens 截断（finish_reason=length）时自动续写，
        // 否则用户看到的就是"说到一半没了"。最多续 3 段（约 1.6 万 token）。
        for (let segment = 0; segment <= MAX_CONTINUATIONS; segment += 1) {
          let finishReason = '';
          const stream: any = await withTimeout(
            client.chat.completions.create(
              {
                model,
                messages,
                tools: toOpenAITools(toolFilter),
                tool_choice: isLastStep ? 'none' : 'auto',
                temperature: temperatureFor(model),
                max_tokens: 4000,
                stream: true,
              } as any,
              { signal: deps.signal, timeout: 120_000 },
            ),
            TOOL_TIMEOUT_MS,
            '模型调用',
          );

          for await (const chunk of stream) {
            if (deps.signal.aborted) {
              aborted = true;
              break;
            }
            const choice = chunk?.choices?.[0];
            const delta = choice?.delta;
            if (choice?.finish_reason) finishReason = String(choice.finish_reason);
            if (!delta) continue;
            if (typeof delta.content === 'string' && delta.content) {
              stepText += delta.content;
              fullText += delta.content;
              deps.emit('delta', { text: delta.content });
            }
            // 推理模型会先吐思考内容（reasoning_content），这段时间正文是空的。
            // 单独发出去，前端就能显示"正在思考"而不是干等着以为卡死。
            const reasoningPiece = (delta as any).reasoning_content;
            if (typeof reasoningPiece === 'string' && reasoningPiece) {
              deps.emit('thinking', { text: reasoningPiece });
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const piece of delta.tool_calls) {
                const index = Number(piece.index ?? 0);
                if (!calls[index]) calls[index] = { id: '', name: '', args: '' };
                if (piece.id) calls[index].id = String(piece.id);
                if (piece.function?.name) calls[index].name += String(piece.function.name);
                if (piece.function?.arguments) calls[index].args += String(piece.function.arguments);
              }
            }
          }

          if (aborted) break;

          const hasCalls = calls.filter((c) => c && c.name).length > 0;
          if (finishReason === 'length' && !hasCalls && stepText && segment < MAX_CONTINUATIONS) {
            // 把已输出的这半段当作 assistant 消息塞回上下文，要求接着写
            messages.push({ role: 'assistant', content: stepText });
            messages.push({
              role: 'user',
              content: '（接着上文继续输出，直接从断掉的地方往下写，不要重复已输出的内容，也不要重新开头。全部写完后正常结束。）',
            });
            console.warn(`[pro] 输出达到 token 上限，自动续写第 ${segment + 1} 段`);
            continue;
          }
          if (finishReason === 'length' && stepText) {
            // 续写次数也到顶了：明确告诉用户这是被上限截断，而不是话说一半
            const tail = '\n\n…（本轮输出已达上限被截断，需要更长的内容请说「继续」）';
            fullText += tail;
            deps.emit('delta', { text: tail });
          }
          break;
        }

        if (!aborted) stepSucceeded = true;
      } catch (err: any) {
        if (deps.signal.aborted) {
          aborted = true;
          break;
        }
        const canRetry = attempt === 0 && fullText.length === emittedBefore;
        if (!canRetry) {
          throw new Error(
            `模型调用失败（第 ${step + 1} 步，${model}）：${[
              err?.status ? `HTTP ${err.status}` : '',
              err?.name,
              err?.message || String(err),
            ]
              .filter(Boolean)
              .join(' / ')}`,
          );
        }
        console.warn('[pro] 模型流中断，重试一次：', err?.name, err?.message || String(err));
        await new Promise((r) => setTimeout(r, 800));
      }

      if (aborted) break;
    }

    if (aborted) break;

    const validCalls = calls.filter((c) => c && c.name);
    if (!validCalls.length) break;

    messages.push({
      role: 'assistant',
      content: stepText || null,
      tool_calls: validCalls.map((call, index) => ({
        id: call.id || `call_${step}_${index}`,
        type: 'function',
        function: { name: call.name, arguments: call.args || '{}' },
      })),
    });

    for (let i = 0; i < validCalls.length; i += 1) {
      if (deps.signal.aborted) {
        aborted = true;
        break;
      }
      const call = validCalls[i];
      const callId = call.id || `call_${step}_${i}`;
      const tool = findTool(call.name);

      const record: AgentToolRecord = {
        id: callId,
        name: call.name,
        label: tool?.label || call.name,
        level: tool?.level || 'R',
        args: safeJson(call.args),
        status: 'error',
        result: '',
        durationMs: 0,
      };
      tools.push(record);
      deps.emit('tool', { id: callId, name: call.name, label: record.label, level: record.level, args: record.args, status: 'running' });

      if (!tool) {
        record.result = `未知工具：${call.name}`;
        deps.emit('tool', { id: callId, name: call.name, label: record.label, status: 'error', result: record.result });
        messages.push({ role: 'tool', tool_call_id: callId, content: record.result });
        continue;
      }

      // 双保险：即使模型从历史里学到了联网工具名，开关关掉时也不执行
      if (!input.searchEnabled && WEB_TOOL_NAMES.has(call.name)) {
        record.status = 'denied';
        record.result = '本轮联网已被用户关闭，联网工具不可用。请如实说明未联网，不要编造搜索结果。';
        deps.emit('tool', { id: callId, name: call.name, label: record.label, status: 'denied', result: record.result });
        deps.audit({ tool: call.name, level: 'R', args: record.args, status: 'denied', durationMs: 0 });
        messages.push({ role: 'tool', tool_call_id: callId, content: record.result });
        continue;
      }

      let parsedArgs: any = {};
      try {
        parsedArgs = call.args ? JSON.parse(call.args) : {};
      } catch {
        record.result = '工具参数不是合法 JSON，请重新调用并给出合法参数';
        deps.emit('tool', { id: callId, name: call.name, label: record.label, status: 'error', result: record.result });
        messages.push({ role: 'tool', tool_call_id: callId, content: record.result });
        continue;
      }

      // 权限网关：R 级自动放行；其它级别按模式与用户决策决定
      let decision: PermissionDecision = 'once';
      if (tool.level !== 'R') {
        if (mode === 'readonly') {
          decision = 'deny';
          record.status = 'denied';
          record.result = '当前为只读模式，写操作已被系统拒绝。请提示用户切换到「标准」模式后重试。';
          deps.emit('tool', { id: callId, name: call.name, label: record.label, status: 'denied', result: record.result });
          deps.audit({ tool: tool.name, level: tool.level, args: record.args, status: 'denied', durationMs: 0 });
          messages.push({ role: 'tool', tool_call_id: callId, content: record.result });
          continue;
        }
        if (!deps.sessionAllowedTools.has(tool.name)) {
          decision = await deps.requestPermission({
            tool: tool.name,
            level: tool.level,
            args: parsedArgs,
            preview: tool.preview(parsedArgs),
          });
        }
        if (decision === 'deny') {
          record.status = 'denied';
          record.result = '用户拒绝了这次操作，请停止该动作并向用户说明已取消。';
          deps.emit('tool', { id: callId, name: call.name, label: record.label, status: 'denied', result: record.result });
          deps.audit({ tool: tool.name, level: tool.level, args: record.args, status: 'denied', durationMs: 0 });
          messages.push({ role: 'tool', tool_call_id: callId, content: record.result });
          continue;
        }
        if (decision === 'session') deps.sessionAllowedTools.add(tool.name);
      }

      const startedAt = Date.now();
      // 长命令边跑边推给界面
      toolCtx.onOutput = (chunk: string) => deps.emit('tool_output', { id: callId, chunk });
      toolCtx.searchCount = searches.filter((s) => s.engine !== 'fetch').length;
      try {
        const result = await withTimeout(tool.run(parsedArgs, toolCtx), TOOL_TIMEOUT_MS, tool.label);
        const durationMs = Date.now() - startedAt;
        record.status = 'ok';
        record.result = result;
        record.durationMs = durationMs;

        const uiResult = result.length > UI_RESULT_LIMIT ? `${result.slice(0, UI_RESULT_LIMIT)}…` : result;
        deps.emit('tool', { id: callId, name: call.name, label: record.label, status: 'ok', result: uiResult, durationMs });
        deps.audit({ tool: tool.name, level: tool.level, args: record.args, status: 'ok', durationMs });
        messages.push({ role: 'tool', tool_call_id: callId, content: truncateOutput(result) });
        lastError = '';
      } catch (err: any) {
        const durationMs = Date.now() - startedAt;
        const message = err?.message || String(err);
        record.status = 'error';
        record.result = message;
        record.durationMs = durationMs;
        lastError = `${tool.label} 失败：${message}`;

        deps.emit('tool', { id: callId, name: call.name, label: record.label, status: 'error', result: message, durationMs });
        deps.audit({ tool: tool.name, level: tool.level, args: record.args, status: 'error', durationMs });
        messages.push({ role: 'tool', tool_call_id: callId, content: `工具执行失败：${message}` });
        // 失败回填：明确要求先分析再重试，避免模型原样重放同一条失败调用
        messages.push({
          role: 'system',
          content: '刚才这次工具调用失败了。请先根据错误信息判断原因（路径是否存在、参数是否合法、命令是否装好依赖），再决定下一步；不要原样重试同一条调用。若无法解决，向用户说明卡点。',
        });
      } finally {
        toolCtx.onOutput = undefined;
      }
    }

    if (aborted) break;
  }

  return {
    text: fullText.trim(),
    tools: tools.map((t) => ({ ...t, result: t.result.length > UI_RESULT_LIMIT ? `${t.result.slice(0, UI_RESULT_LIMIT)}…` : t.result })),
    aborted,
    model,
    inputChars,
    outputChars: fullText.length,
    searches,
  };
}

export function newRunId(): string {
  return crypto.randomUUID();
}
