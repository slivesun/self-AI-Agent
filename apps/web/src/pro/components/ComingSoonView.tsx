/** 尚未进入开发的板块：沿用普通版已有的 coming-soon 样式 */
export default function ComingSoonView({
  title,
  desc,
  phase,
  icon,
}: {
  title: string;
  desc: string;
  phase: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="coming-soon">
      <div className="coming-soon-glow" />
      <div className="coming-soon-card">
        <div className="coming-soon-icon">{icon}</div>
        <h2>{title}</h2>
        <p>{desc}</p>
        <span className="coming-soon-tag">{phase}</span>
      </div>
    </div>
  );
}
