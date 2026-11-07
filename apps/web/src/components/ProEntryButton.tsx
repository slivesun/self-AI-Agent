import { ProEntryIcon } from './ProIcons';

type Props = {
  onClick: () => void;
};

/**
 * 主窗口顶部栏的"专业版"入口（位于主题切换按钮左侧）。
 * 只在桌面端渲染，由调用方通过 isDesktop 控制。
 * 视觉：品牌渐变星芒 + 悬停时的旋转光环和 PRO 角标，纯 transform/opacity 动画。
 */
export default function ProEntryButton({ onClick }: Props) {
  return (
    <button
      type="button"
      className="header-icon-btn pro-entry-btn"
      onClick={onClick}
      aria-label="打开专业版"
    >
      <span className="pro-entry-halo" aria-hidden="true" />
      <span className="pro-entry-glyph">
        <ProEntryIcon />
      </span>
      <span className="pro-entry-tip" aria-hidden="true">专业版</span>
    </button>
  );
}
