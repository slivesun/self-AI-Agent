import { useEffect, useMemo, useState } from 'react';
import { desktopBridge } from '../../bridge';
import { DEFAULT_MODEL, MODEL_OPTIONS } from '@resume-agent/shared';
import type { ProAuditRow, ProSettings } from '../types';

/** 每个模型一句人话说明，选型时不用去查文档 */
const MODEL_HINTS: Record<string, string> = {
  'doubao-seed-evolving': '偏推理与长任务，适合写代码、改项目',
  'doubao-seed-2-0-mini-260428': '响应快、便宜，适合短问答',
  'doubao-seed-2-0-lite-260428': '均衡档，日常够用（默认）',
  'kimi-k3-1-pro-261024': '长文档与中文写作见长',
  'glm-5-2-260617': '中文表达稳，适合写稿与总结',
};

export default function SettingsView({
  settings,
  audit,
  auditLoading,
  onSave,
  onAddWorkspace,
  onRemoveWorkspace,
  onLoadAudit,
}: {
  settings: ProSettings | null;
  audit: ProAuditRow[];
  auditLoading: boolean;
  onSave: (patch: {
    permissionMode?: 'readonly' | 'standard';
    searchEnabled?: boolean;
    searchEngine?: 'baidu' | 'bing';
    visionModel?: string;
    imageModel?: string;
    imageApiKey?: string;
    model?: string;
  }) => Promise<void>;
  onAddWorkspace: (path: string, label: string) => Promise<string | null>;
  onRemoveWorkspace: (id: string) => Promise<void>;
  onLoadAudit: () => void;
}) {
  const [wpPath, setWpPath] = useState('');
  const [wpLabel, setWpLabel] = useState('');
  const [wpError, setWpError] = useState('');
  const [wpBusy, setWpBusy] = useState(false);
  const [vision, setVision] = useState(settings?.visionModel || '');
  const [imageModel, setImageModel] = useState(settings?.imageModel || '');
  const [imageKey, setImageKey] = useState('');

  /** 可选模型：优先后端下发的白名单，取不到时用共享常量兜底 */
  const modelList = useMemo(() => {
    const values = settings?.modelOptions?.length
      ? settings.modelOptions
      : MODEL_OPTIONS.map((m) => m.value);
    return values.map((value) => ({
      value,
      label: MODEL_OPTIONS.find((m) => m.value === value)?.label || value,
    }));
  }, [settings?.modelOptions]);

  useEffect(() => {
    setVision(settings?.visionModel || '');
  }, [settings?.visionModel]);

  useEffect(() => {
    setImageModel(settings?.imageModel || '');
  }, [settings?.imageModel]);

  const addWorkspace = async () => {
    const value = wpPath.trim();
    if (!value) {
      setWpError('请填写目录的完整路径');
      return;
    }
    setWpBusy(true);
    setWpError('');
    const err = await onAddWorkspace(value, wpLabel.trim());
    setWpBusy(false);
    if (err) {
      setWpError(err);
      return;
    }
    setWpPath('');
    setWpLabel('');
  };

  const chooseDir = async () => {
    const picker = desktopBridge?.dialog;
    if (!picker) {
      setWpError('当前环境不支持系统选目录，请直接填写完整路径');
      return;
    }
    const res = await picker.chooseDirectory({ title: '选择专业版工作区目录' });
    if (!res.ok) {
      setWpError(res.error || '选择目录失败');
      return;
    }
    if (res.path) {
      setWpPath(res.path);
      setWpError('');
    }
  };

  return (
    <div className="pro-settings">
      <header className="pro-settings-head">
        <h1>专业版设置</h1>
        <p>这些设置只影响专业版窗口，普通版完全不受影响。</p>
      </header>

      <section className="pro-card">
        <div className="pro-card-head">
          <h2>权限模式</h2>
          <span className="pro-card-note">写文件永远需要你点一次授权，模式只决定「只读」时是否直接拒绝</span>
        </div>
        <div className="pro-mode-row">
          {[
            { key: 'standard', title: '标准模式', desc: '读取自动放行；写入 / 执行前弹卡片征得同意（推荐）' },
            { key: 'readonly', title: '只读模式', desc: '任何写操作直接被拒绝，只做查看与分析' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              className={`pro-mode-option${settings?.permissionMode === item.key ? ' active' : ''}`}
              onClick={() => onSave({ permissionMode: item.key as 'standard' | 'readonly' })}
            >
              <span className="pro-mode-title">{item.title}</span>
              <span className="pro-mode-desc">{item.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="pro-card">
        <div className="pro-card-head">
          <h2>工作区</h2>
          <span className="pro-card-note">文件工具只能在这些目录内活动，路径越界会被直接拒绝</span>
        </div>

        <div className="pro-wp-list">
          {settings?.workspaces.length ? (
            settings.workspaces.map((wp) => (
              <div key={wp.id} className="pro-wp-item">
                <div className="pro-wp-main">
                  <div className="pro-wp-label">{wp.label || wp.path}</div>
                  <div className="pro-wp-path">{wp.path}</div>
                </div>
                <button type="button" className="pro-wp-del" onClick={() => onRemoveWorkspace(wp.id)}>
                  移除
                </button>
              </div>
            ))
          ) : (
            <div className="pro-wp-empty">还没有授权任何目录，助手暂时动不了你的文件。</div>
          )}
        </div>

        <div className="pro-wp-form">
          <input
            className="pro-input"
            value={wpPath}
            placeholder="目录完整路径，例如 D:\项目\my-app"
            onChange={(e) => setWpPath(e.target.value)}
            spellCheck={false}
          />
          <input
            className="pro-input small"
            value={wpLabel}
            placeholder="备注名（可选）"
            onChange={(e) => setWpLabel(e.target.value)}
          />
          {desktopBridge?.dialog ? (
            <button type="button" className="pro-btn ghost" onClick={chooseDir} disabled={wpBusy}>
              选择目录…
            </button>
          ) : null}
          <button type="button" className="pro-btn" onClick={addWorkspace} disabled={wpBusy}>
            {wpBusy ? '添加中…' : '添加'}
          </button>
        </div>
        {wpError ? <div className="pro-inline-error">{wpError}</div> : null}
        <div className="pro-card-note mt">
          {desktopBridge?.dialog
            ? '点「选择目录…」会打开系统目录选择框；浏览器里使用时只能手填路径。'
            : '当前在浏览器里使用，只能手填路径；桌面端可以直接点选目录。'}
        </div>
      </section>

      <section className="pro-card">
        <div className="pro-card-head">
          <h2>模型与联网</h2>
          <span className="pro-card-note">模型与 Key 与普通版共用，只做用量分账</span>
        </div>

        <div className="pro-model-block">
          <div className="pro-model-block-head">
            <span className="pro-kv-key">对话模型</span>
            <span className="pro-model-current">
              当前生效 <b>{settings?.model || '—'}</b>
            </span>
          </div>
          <div className="pro-model-grid">
            <button
              type="button"
              className={`pro-model-card inherit${!settings?.modelOverride ? ' active' : ''}`}
              onClick={() => onSave({ model: '' })}
            >
              <span className="pro-model-card-top">
                <span className="pro-model-name">继承普通版</span>
                {!settings?.modelOverride ? <span className="pro-model-check">✓</span> : null}
              </span>
              <span className="pro-model-id">{settings?.inheritedModel || settings?.model || '跟随普通版设置'}</span>
              <span className="pro-model-desc">普通版换模型时，专业版一起跟着变</span>
            </button>

            {modelList.map((item) => {
              const active = settings?.modelOverride === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  className={`pro-model-card${active ? ' active' : ''}`}
                  onClick={() => onSave({ model: item.value })}
                >
                  <span className="pro-model-card-top">
                    <span className="pro-model-name">{item.label}</span>
                    {item.value === DEFAULT_MODEL ? <span className="pro-model-tag">默认</span> : null}
                    {active ? <span className="pro-model-check">✓</span> : null}
                  </span>
                  <span className="pro-model-id">{item.value}</span>
                  <span className="pro-model-desc">{MODEL_HINTS[item.value] || '与普通版共用同一把 Key'}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="pro-card-note">
          专业版单独选模型，普通版保持原样；两者共用同一把 Key，用量仍分开记账。
        </div>

        <div className="pro-kv">
          <span className="pro-kv-key">视觉模型</span>
          <div className="pro-kv-value inline">
            <input
              className="pro-input small"
              value={vision}
              placeholder="留空则用上面的模型"
              onChange={(e) => setVision(e.target.value)}
              spellCheck={false}
            />
            <button type="button" className="pro-btn ghost" onClick={() => onSave({ visionModel: vision.trim() })}>
              保存
            </button>
          </div>
        </div>

        <div className="pro-kv">
          <span className="pro-kv-key">联网搜索</span>
          <div className="pro-kv-value inline">
            <button
              type="button"
              className={`pro-switch${settings?.searchEnabled ? ' on' : ''}`}
              onClick={() => onSave({ searchEnabled: !settings?.searchEnabled })}
              title={settings?.searchEnabled ? '点击关闭联网' : '点击开启联网'}
            >
              <span className="pro-switch-dot" />
            </button>
            <span className="pro-card-note">
              {settings?.searchEnabled
                ? '已开启：输入区的小地球可以按轮关掉；关掉后联网工具不进工具列表'
                : '已关闭：web_search / web_fetch 整轮不可用，模型无法绕过'}
            </span>
          </div>
        </div>

        <div className="pro-kv">
          <span className="pro-kv-key">搜索引擎</span>
          <div className="pro-kv-value inline">
            <select
              className="pro-select small"
              value={settings?.searchEngine || 'baidu'}
              onChange={(e) => onSave({ searchEngine: e.target.value as 'baidu' | 'bing' })}
            >
              <option value="baidu">百度（默认）</option>
              <option value="bing">Bing（百度验证过不去时用）</option>
            </select>
            <span className="pro-card-note">百度命中安全验证时会如实报错，不做验证码自动破解</span>
          </div>
        </div>
      </section>

      <section className="pro-card">
        <div className="pro-card-head">
          <h2>图像生成</h2>
          <span className="pro-card-note">留空 = 未配置，此时画图会直接报错，不会用工位图糊弄</span>
        </div>

        <div className="pro-kv">
          <span className="pro-kv-key">图像模型</span>
          <div className="pro-kv-value inline">
            <input
              className="pro-input small"
              value={imageModel}
              placeholder="方舟里已开通的图像模型 ID，例如 doubao-seedream-…"
              onChange={(e) => setImageModel(e.target.value)}
              spellCheck={false}
            />
            <button type="button" className="pro-btn ghost" onClick={() => onSave({ imageModel: imageModel.trim() })}>
              保存
            </button>
          </div>
        </div>

        <div className="pro-kv">
          <span className="pro-kv-key">图像 API Key</span>
          <div className="pro-kv-value inline">
            <input
              className="pro-input small"
              type="password"
              value={imageKey}
              placeholder={settings?.imageApiKeySet ? '已单独设置，留空表示不改' : '留空则用与对话共用的 Key'}
              onChange={(e) => setImageKey(e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              className="pro-btn ghost"
              onClick={async () => {
                await onSave({ imageApiKey: imageKey.trim() });
                setImageKey('');
              }}
            >
              保存
            </button>
            {settings?.imageApiKeySet ? (
              <button type="button" className="pro-btn ghost" onClick={() => onSave({ imageApiKey: '' })}>
                清空
              </button>
            ) : null}
          </div>
        </div>

        <div className="pro-card-note mt">
          出图走火山方舟的 /images/generations（OpenAI 兼容）。如果保存后仍然报 404 / InvalidEndpointOrModel，
          说明当前账号没开通这个图像模型，请到方舟控制台确认接入点 ID 后重填。
        </div>
      </section>

      <section className="pro-card">
        <div className="pro-card-head">
          <h2>用量分账</h2>
          <span className="pro-card-note">专业版的 token 消耗单独记账，不与普通版混算</span>
        </div>
        <div className="pro-usage">
          <div className="pro-usage-item">
            <span className="pro-usage-num">{settings?.usage.todayRuns ?? 0}</span>
            <span className="pro-usage-label">今日调用</span>
          </div>
          <div className="pro-usage-item">
            <span className="pro-usage-num">{settings?.usage.todayTokens ?? 0}</span>
            <span className="pro-usage-label">今日 tokens</span>
          </div>
          <div className="pro-usage-item">
            <span className="pro-usage-num">{settings?.usage.totalRuns ?? 0}</span>
            <span className="pro-usage-label">累计调用</span>
          </div>
          <div className="pro-usage-item">
            <span className="pro-usage-num">{settings?.usage.totalTokens ?? 0}</span>
            <span className="pro-usage-label">累计 tokens</span>
          </div>
        </div>
      </section>

      <section className="pro-card">
        <div className="pro-card-head">
          <h2>操作审计</h2>
          <button type="button" className="pro-btn ghost" onClick={onLoadAudit} disabled={auditLoading}>
            {auditLoading ? '加载中…' : '刷新'}
          </button>
        </div>
        {audit.length === 0 ? (
          <div className="pro-wp-empty">还没有工具调用记录。</div>
        ) : (
          <div className="pro-audit">
            {audit.map((row) => (
              <div key={row.id} className="pro-audit-row">
                <span className={`pro-audit-status ${row.status}`}>{row.status}</span>
                <span className="pro-audit-tool">{row.tool}</span>
                <span className="pro-audit-args">{row.args}</span>
                <span className="pro-audit-time">{row.created_at}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
