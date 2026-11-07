import ComingSoon from '../ComingSoon';
import { AiIcon } from '../../../components/ProIcons';

/**
 * 专业版 · AI 视图（占位）。
 * 后续这里放：模型编排、知识库、工作流、批量生成等。
 */
export default function AiView() {
  return (
    <ComingSoon
      icon={<AiIcon size={30} />}
      title="AI 工作台"
      description="专业版 AI 工作台正在建设中：自定义模型、知识库与工作流编排将在这里呈现。"
    />
  );
}
