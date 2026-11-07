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
