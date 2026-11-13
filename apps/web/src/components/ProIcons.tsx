/**
 * 专业版相关的图标集合（纯展示，无状态）。
 * 与 HeaderIcons.tsx 一致：统一 24 栅格、stroke 用 currentColor，便于深浅色统一着色。
 */

/** 入口图标：品牌渐变星芒 + 右上角轨道点，比普通线性图标更有"会员/专业版"指向 */
export function ProEntryIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="pro-entry-svg" aria-hidden="true">
      <defs>
        <linearGradient id="proEntryGrad" x1="3" y1="2" x2="21" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5C9CFF" />
          <stop offset="0.55" stopColor="#5A72FF" />
          <stop offset="1" stopColor="#9A5CFF" />
        </linearGradient>
      </defs>
      <path
        d="M11.9 2.9l2.35 5.15 5.6.7-4.1 3.95 1.05 5.55-4.9-2.72-4.9 2.72 1.05-5.55-4.1-3.95 5.6-.7z"
        fill="url(#proEntryGrad)"
      />
      <circle cx="19.6" cy="4.6" r="1.5" fill="url(#proEntryGrad)" opacity="0.85" />
    </svg>
  );
}

/** 侧边栏：消息 */
export function MessageIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.2 5.2h15.6a1.4 1.4 0 0 1 1.4 1.4v8.2a1.4 1.4 0 0 1-1.4 1.4H9.6L5.2 19.6V16.2H4.2A1.4 1.4 0 0 1 2.8 14.8V6.6A1.4 1.4 0 0 1 4.2 5.2Z" />
      <path d="M7.6 9.6h8.8M7.6 12.6h5.6" strokeWidth="1.4" opacity="0.75" />
    </svg>
  );
}

/** 侧边栏：AI 工作台 */
export function AiIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.6 3.4l1.35 3.85 3.85 1.35-3.85 1.35-1.35 3.85-1.35-3.85L5.4 8.6l3.85-1.35z" />
      <path d="M17.3 13.2l.85 2.35 2.35.85-2.35.85-.85 2.35-.85-2.35-2.35-.85 2.35-.85z" />
    </svg>
  );
}

/** 侧边栏：项目（本地代码工作区） */
export function ProjectIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.2 7.4a1.6 1.6 0 0 1 1.6-1.6h4.2l1.6 2h8a1.6 1.6 0 0 1 1.6 1.6v8.2a1.6 1.6 0 0 1-1.6 1.6H4.8A1.6 1.6 0 0 1 3.2 17.8z" />
      <path d="M3.2 10.4h17.6" strokeWidth="1.4" opacity="0.7" />
    </svg>
  );
}

/** 侧边栏：创作（画图 / 设计 / 文档） */
export function CreateIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.2c4.2 0 7.6 3 7.6 6.8 0 2.6-1.8 4.2-4 4.2h-1.4c-1.1 0-1.9.8-1.9 1.8 0 .5.2.9.5 1.3.4.4.6.8.6 1.3 0 .9-.8 1.5-2 1.5-4.4 0-8-3.4-8-7.7 0-4 3.2-7 7.6-7z" />
      <circle cx="8.2" cy="9.2" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.2" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.8" cy="9.2" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 侧边栏：素材（产物库） */
export function AssetsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2" />
      <circle cx="8.4" cy="9.4" r="1.4" />
      <path d="M3.6 16.4l4.4-4 3.2 2.8 3.6-3.4 5 4.6" strokeWidth="1.5" opacity="0.85" />
    </svg>
  );
}

/** 侧边栏：任务（待办面板） */
export function TaskIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4.4" y="3.6" width="15.2" height="16.8" rx="2" />
      <path d="M8.4 9.2l1.6 1.6 2.8-2.9" strokeWidth="1.5" />
      <path d="M8.4 15.4h7.2" strokeWidth="1.5" opacity="0.8" />
    </svg>
  );
}

/** 侧边栏：设置 */
export function SettingsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3v2.2M12 18.8V21M4.8 7.8l1.9 1.1M17.3 15.1l1.9 1.1M3 12h2.2M18.8 12H21M4.8 16.2l1.9-1.1M17.3 8.9l1.9-1.1" />
    </svg>
  );
}

/** 发送 */
export function SendIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.2 12l15.6-7-4 7 4 7z" />
    </svg>
  );
}

/** 工具调用状态点 */
export function ToolDot() {
  return <span className="tool-dot" aria-hidden="true" />;
}
