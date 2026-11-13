import { useEffect, useState } from 'react';
import { proApi } from '../api';
import type { ProProjectScan, ProWorkspace } from '../types';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

/** 项目视图（P2）：选一个已授权目录，扫描出结构规模、语言分布、顶层条目与 npm 脚本 */
export default function ProjectView({
  workspaces,
  onGotoSettings,
  onAsk,
}: {
  workspaces: ProWorkspace[];
  onGotoSettings: () => void;
  onAsk: (text: string) => void;
}) {
  const [currentId, setCurrentId] = useState(workspaces[0]?.id || '');
  const [scan, setScan] = useState<ProProjectScan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentId && workspaces[0]) setCurrentId(workspaces[0].id);
  }, [workspaces, currentId]);

  const runScan = async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await proApi.scanWorkspace(id);
      setScan(data);
    } catch (err: any) {
      setScan(null);
      setError(err?.message || '扫描失败');
    } finally {
      setLoading(false);
    }
  };

  if (!workspaces.length) {
    return (
      <div className="coming-soon">
        <div className="coming-soon-card">
          <h2>还没有授权目录</h2>
          <p>专业版只能在你授权的目录里读写文件。先添加一个项目目录，再回来扫描。</p>
          <button type="button" className="pro-btn" onClick={onGotoSettings}>
            去添加工作区
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pro-project">
      <header className="pro-project-head">
        <div>
          <h1>项目</h1>
          <p>选一个工作区扫一下：规模、语言分布、顶层结构、可跑的命令。读操作不需要授权。</p>
        </div>
        <div className="pro-project-actions">
          <select
            className="pro-select"
            value={currentId}
            onChange={(e) => {
              setCurrentId(e.target.value);
              setScan(null);
            }}
          >
            {workspaces.map((wp) => (
              <option key={wp.id} value={wp.id}>
                {wp.label || wp.path}
              </option>
            ))}
          </select>
          <button type="button" className="pro-btn" onClick={() => runScan(currentId)} disabled={loading}>
            {loading ? '扫描中…' : '扫描'}
          </button>
        </div>
      </header>

      {error ? <div className="pro-inline-error">{error}</div> : null}

      {!scan ? (
        <div className="pro-project-empty">
          {loading ? '正在遍历目录（尊重 .gitignore，自动跳过 node_modules）…' : '点「扫描」查看这个目录的情况。'}
        </div>
      ) : (
        <>
          <section className="pro-card">
            <div className="pro-card-head">
              <h2>{scan.label || scan.root}</h2>
              <span className="pro-card-note">{scan.root}</span>
            </div>
            <div className="pro-usage">
              <div className="pro-usage-item">
                <span className="pro-usage-num">{scan.files}</span>
                <span className="pro-usage-label">文件</span>
              </div>
              <div className="pro-usage-item">
                <span className="pro-usage-num">{scan.dirs}</span>
                <span className="pro-usage-label">目录</span>
              </div>
              <div className="pro-usage-item">
                <span className="pro-usage-num">{formatSize(scan.totalBytes)}</span>
                <span className="pro-usage-label">总大小</span>
              </div>
              <div className="pro-usage-item">
                <span className="pro-usage-num">{scan.gitignoreRules}</span>
                <span className="pro-usage-label">gitignore 规则</span>
              </div>
            </div>
            {scan.truncated ? (
              <div className="pro-card-note mt">目录过大，只统计了前 4000 个文件（结果已截断）。</div>
            ) : null}
            {scan.git?.branch ? (
              <div className="pro-kv mt">
                <span className="pro-kv-key">Git 分支</span>
                <span className="pro-kv-value">{scan.git.branch}</span>
              </div>
            ) : null}
            {scan.packageJson ? (
              <div className="pro-kv">
                <span className="pro-kv-key">package.json</span>
                <span className="pro-kv-value">
                  {scan.packageJson.name || '（无名）'} {scan.packageJson.version ? `v${scan.packageJson.version}` : ''} ·
                  依赖 {scan.packageJson.deps} / 开发依赖 {scan.packageJson.devDeps}
                  {scan.packageJson.scripts?.length ? ` · 脚本：${scan.packageJson.scripts.join('、')}` : ''}
                </span>
              </div>
            ) : null}
          </section>

          <section className="pro-card">
            <div className="pro-card-head">
              <h2>语言 / 文件类型分布</h2>
              <span className="pro-card-note">按扩展名统计，取前 12 类</span>
            </div>
            {scan.byExt.length ? (
              <div className="pro-ext-list">
                {scan.byExt.map((item) => {
                  const pct = scan.files ? Math.round((item.count / scan.files) * 100) : 0;
                  return (
                    <div key={item.ext} className="pro-ext-row">
                      <span className="pro-ext-name">{item.ext}</span>
                      <span className="pro-ext-bar">
                        <span className="pro-ext-fill" style={{ width: `${Math.max(2, pct)}%` }} />
                      </span>
                      <span className="pro-ext-num">
                        {item.count} 个 · {pct}% · {formatSize(item.bytes)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="pro-wp-empty">没有统计到文件。</div>
            )}
          </section>

          <section className="pro-card">
            <div className="pro-card-head">
              <h2>顶层结构</h2>
              <span className="pro-card-note">最多 40 项</span>
            </div>
            <div className="pro-top-list">
              {scan.top.map((item) => (
                <span key={item.name} className={`pro-top-item${item.dir ? ' dir' : ''}`}>
                  {item.dir ? '▸ ' : ''}
                  {item.name}
                </span>
              ))}
            </div>
          </section>

          <section className="pro-card">
            <div className="pro-card-head">
              <h2>让助手接着干</h2>
              <span className="pro-card-note">点一下就把需求发进会话</span>
            </div>
            <div className="pro-project-samples">
              <button type="button" className="pro-sample" onClick={() => onAsk('扫描这个项目的结构，指出最值得先改的三处问题')}>
                扫描结构，指出最值得改的问题
              </button>
              <button type="button" className="pro-sample" onClick={() => onAsk('读一下这个项目的 README 和入口文件，给我一份上手说明')}>
                读 README，给我上手说明
              </button>
              {scan.packageJson?.scripts?.includes('build') ? (
                <button type="button" className="pro-sample" onClick={() => onAsk('跑一次构建，有报错就定位并修掉')}>
                  跑构建，报错了就修掉
                </button>
              ) : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
