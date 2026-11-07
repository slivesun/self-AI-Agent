import ComingSoon from '../ComingSoon';
import { MessageIcon } from '../../../components/ProIcons';

/**
 * 专业版 · 消息视图（占位）。
 * 后续这里放：多会话协作、通知中心、待办提醒等。
 */
export default function MessagesView() {
  return (
    <ComingSoon
      icon={<MessageIcon size={30} />}
      title="消息中心"
      description="专业版消息中心正在建设中：多会话协作、通知与待办提醒将在这里集中呈现。"
    />
  );
}
