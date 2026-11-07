import type { ReactNode } from 'react';

type Props = {
  icon: ReactNode;
  title: string;
  description: string;
};

/**
 * 专业版视图占位：本期所有视图统一展示"敬请期待"。
 * 后续实现具体功能时，把 <ComingSoon /> 换成真实视图即可，外壳（ProShell）不用改。
 */
export default function ComingSoon({ icon, title, description }: Props) {
  return (
    <div className="coming-soon">
      <div className="coming-soon-glow" aria-hidden="true" />
      <div className="coming-soon-card">
        <div className="coming-soon-icon">{icon}</div>
        <h2>{title}</h2>
        <p>{description}</p>
        <span className="coming-soon-tag">敬请期待</span>
      </div>
    </div>
  );
}
