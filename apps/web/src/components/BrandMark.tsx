type Props = {
  size?: number;
  className?: string;
};

/**
 * 「个人AI助手」品牌图标
 * 渐变圆角方块 + 白色对话气泡 + 气泡内的 AI 星芒，36px 下依然清晰。
 */
export default function BrandMark({ size = 36, className = '' }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={`brand-mark ${className}`.trim()}
      role="img"
      aria-label="个人AI助手"
    >
      <defs>
        <linearGradient id="paGrad" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5C9CFF" />
          <stop offset="0.45" stopColor="#5A72FF" />
          <stop offset="1" stopColor="#9A5CFF" />
        </linearGradient>
        <linearGradient id="paSheen" x1="10" y1="2" x2="22" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.38" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <clipPath id="paClip">
          <rect width="48" height="48" rx="13" />
        </clipPath>
      </defs>

      {/* 底色 */}
      <rect width="48" height="48" rx="13" fill="url(#paGrad)" />

      <g clipPath="url(#paClip)">
        {/* 左上柔光 */}
        <ellipse cx="12" cy="6" rx="22" ry="15" fill="url(#paSheen)" />
        {/* 右下淡紫压深，增加体积感 */}
        <ellipse cx="46" cy="48" rx="26" ry="18" fill="#7B3FF2" opacity="0.22" />
      </g>

      <rect width="48" height="48" rx="13" fill="none" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="1" />

      {/* 对话气泡 */}
      <rect x="11.5" y="13.6" width="25" height="16.8" rx="5.6" fill="#FFFFFF" />
      {/* 气泡尾巴 */}
      <path d="M16.4 28.6 L24.2 28.6 L16.4 37.8 Z" fill="#FFFFFF" />

      {/* AI 星芒 */}
      <path
        d="M24 15.6c1 4.4 2.7 6.1 7.1 7.1-4.4 1-6.1 2.7-7.1 7.1-1-4.4-2.7-6.1-7.1-7.1 4.4-1 6.1-2.7 7.1-7.1z"
        fill="url(#paGrad)"
      />
    </svg>
  );
}
