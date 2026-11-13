import { useState } from 'react';
import type { ProArtifact, ProSettings } from '../types';
import ArtifactCard from './ArtifactCard';

const SAMPLES: Record<string, string> = {
  image: '画一张 3:4 的深色高级感海报，主题是「AI 助手专业版」，留出标题区，整体克制有质感。',
  design: '做一个 SaaS 产品的落地页首屏设计稿：左侧主标题与副标题、右侧产品截图占位，深色背景 + 渐变高光，给出完整 HTML。',
  doc: '把下面的内容整理成一份正式的 Markdown 文档，然后用 doc_export 导出成 Word：\n\n（在这里贴你的素材）',
};

/** 创作工坊（P3）：画图 / 设计稿 / Word 文档，都是"把需求发进会话让助手动手" */
export default function CreateView({
  settings,
  artifacts,
  onAsk,
  onOpenArtifact,
  onGotoSettings,
}: {
  settings: ProSettings | null;
  artifacts: ProArtifact[];
  onAsk: (text: string) => void;
  onOpenArtifact: (artifact: ProArtifact) => void;
  onGotoSettings: () => void;
}) {
  const [tab, setTab] = useState<'image' | 'design' | 'doc'>('image');
  const [prompt, setPrompt] = useState('');

  const imageReady = Boolean(settings?.imageModel);
  const recent = artifacts.filter((a) => a.kind === (tab === 'image' ? 'image' : tab === 'design' ? 'html' : 'doc')).slice(0, 6);

  const submit = () => {
    const text = prompt.trim() || SAMPLES[tab];
    onAsk(text);
    setPrompt('');
  };

  return (
    <div className="pro-create">
      <header className="pro-project-head">
        <div>
          <h1>创作</h1>
          <p>画图、做设计稿、导出 Word。产物自动进「素材」，随时能回来接着改。</p>
        </div>
      </header>

      <div className="pro-create-tabs">
        {[
          { key: 'image', label: '画图', hint: '文生图 / 图生图' },
          { key: 'design', label: '设计稿', hint: 'HTML 版式，可预览可导出' },
          { key: 'doc', label: 'Word 文档', hint: 'Markdown → docx' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            className={`pro-create-tab${tab === item.key ? ' active' : ''}`}
            onClick={() => {
              setTab(item.key as any);
              setPrompt('');
            }}
          >
            <span className="pro-create-tab-label">{item.label}</span>
            <span className="pro-create-tab-hint">{item.hint}</span>
          </button>
        ))}
      </div>

      {tab === 'image' && !imageReady ? (
        <div className="pro-create-warn">
          还没配置图像模型，现在出图会失败。
          <button type="button" className="pro-btn ghost" onClick={onGotoSettings}>
            去设置里填
          </button>
        </div>
      ) : null}

      <section className="pro-card">
        <div className="pro-card-head">
          <h2>{tab === 'image' ? '画什么' : tab === 'design' ? '做个什么样的设计稿' : '要导出什么文档'}</h2>
          <span className="pro-card-note">不填就用下面的示例</span>
        </div>
        <textarea
          className="pro-create-input"
          value={prompt}
          rows={5}
          placeholder={SAMPLES[tab]}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="pro-create-actions">
          <button type="button" className="pro-btn" onClick={submit}>
            交给助手做
          </button>
          <button type="button" className="pro-btn ghost" onClick={() => setPrompt(SAMPLES[tab])}>
            填入示例
          </button>
        </div>
      </section>

      {recent.length ? (
        <section className="pro-card">
          <div className="pro-card-head">
            <h2>最近的{tab === 'image' ? '图片' : tab === 'design' ? '设计稿' : '文档'}</h2>
            <span className="pro-card-note">共 {recent.length} 个，点开可预览</span>
          </div>
          <div className="artifact-grid">
            {recent.map((item) => (
              <ArtifactCard key={item.id} artifact={item} onOpen={onOpenArtifact} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
