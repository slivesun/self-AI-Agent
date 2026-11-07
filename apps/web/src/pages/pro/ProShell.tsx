import { useState } from 'react';
import { AiIcon, MessageIcon } from '../../components/ProIcons';
import { useTheme } from '../../theme';
import AiView from './views/AiView';
import MessagesView from './views/MessagesView';

type ProView = 'messages' | 'ai';

type NavItem = {
  id: ProView;
  label: string;
  hint: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'messages', label: '消息', hint: '消息中心' },
  { id: 'ai', label: 'AI', hint: 'AI 工作台' },
];

const VIEW_COMPONENTS: Record<ProView, () => JSX.Element> = {
  messages: MessagesView,
  ai: AiView,
};

/**
 * 专业版窗口的页面外壳（在端内渲染）：
 * - 左侧是只有图标的窄侧边栏，负责视图切换（消息 / AI）；
 * - 右侧是视图内容区，本期统一展示"敬请期待"；
 * - 主题跟随 localStorage（与主窗口跨窗口同步），窗口外观与主窗口保持一致。
 */
export default function ProShell() {
  useTheme();
  const [view, setView] = useState<ProView>('messages');
  const ActiveView = VIEW_COMPONENTS[view];

  return (
    <div className="pro-shell">
      <aside className="pro-sidebar">
        <nav className="pro-nav" role="tablist" aria-label="专业版功能">
          {NAV_ITEMS.map((item) => {
            const active = item.id === view;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`pro-nav-btn ${active ? 'active' : ''}`}
                onClick={() => setView(item.id)}
                title={item.hint}
              >
                <span className="pro-nav-icon">
                  {item.id === 'messages' ? <MessageIcon /> : <AiIcon />}
                </span>
                <span className="pro-nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="pro-sidebar-foot">
          <span className="pro-sidebar-mark">PRO</span>
        </div>
      </aside>

      <main className="pro-main" role="tabpanel">
        <ActiveView />
      </main>
    </div>
  );
}
