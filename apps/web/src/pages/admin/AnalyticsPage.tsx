import { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Table, List, Tag, Modal, Timeline, Space } from 'antd';
import { api } from '../../api';

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [sessionMsgs, setSessionMsgs] = useState<any[]>([]);
  const [sessionOpen, setSessionOpen] = useState(false);

  const load = async () => {
    const d = await api.getAnalytics();
    setData(d);
  };
  useEffect(() => { load(); }, []);

  const openSession = async (sessionId: string) => {
    const d = await api.getSessionMessages(sessionId);
    setSessionMsgs(d.list);
    setSessionOpen(true);
  };

  if (!data) return <div>加载中...</div>;

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Row gutter={16}>
        <Col span={6}><Card size="small"><Statistic title="今日访客" value={data.todayVisitors} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="今日消息" value={data.todayMessages} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="总会话数" value={data.totalSessions} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="未命中问题" value={data.unanswered.length} /></Card></Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card title="未命中问题（面试官问了但你没答上来的）" size="small">
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              <List
                dataSource={data.unanswered}
                renderItem={(item: any) => (
                  <List.Item>
                    <List.Item.Meta
                      title={item.question}
                      description={`出现 ${item.hitCount} 次 · 最近 ${item.lastSeen}`}
                    />
                  </List.Item>
                )}
                locale={{ emptyText: '暂无未命中问题，继续保持！' }}
              />
            </div>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="最近访客会话" size="small">
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              <Table dataSource={data.recentSessions} rowKey="id" size="small" pagination={false}
                onRow={(r) => ({ onClick: () => openSession(r.id), style: { cursor: 'pointer' } })}>
                <Table.Column title="访客问的第一个问题" dataIndex="firstQuestion" ellipsis render={(v) => v || '—'} />
                <Table.Column title="消息数" dataIndex="messageCount" width={70} />
                <Table.Column title="时间" dataIndex="createdAt" width={150} />
              </Table>
            </div>
          </Card>
        </Col>
      </Row>

      <Modal open={sessionOpen} title="会话回放" onCancel={() => setSessionOpen(false)} footer={null} width={600}>
        <Timeline
          items={sessionMsgs.map((m: any) => ({
            color: m.role === 'user' ? 'blue' : 'green',
            children: (
              <div>
                <strong>{m.role === 'user' ? '访客' : 'Agent'}</strong>
                <p style={{ whiteSpace: 'pre-wrap' }}>{m.content}</p>
                {m.citations?.length > 0 && m.citations.map((c: any, i: number) => (
                  <Tag key={i} color="blue">{c.label}</Tag>
                ))}
              </div>
            )
          }))}
        />
      </Modal>
    </Space>
  );
}
