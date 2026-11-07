import { useEffect, useState } from 'react';
import { Card, Table, Button, Modal, Form, Input, Switch, Space, message, Popconfirm, Tag, Typography } from 'antd';
import { api } from '../../api';

export default function LinksPage() {
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    const data = await api.getLinks();
    setList(data.list);
  };
  useEffect(() => { load(); }, []);

  const onCreate = async () => {
    const values = await form.validateFields();
    await api.createLink(values);
    message.success('链接已生成');
    setOpen(false);
    form.resetFields();
    load();
  };

  const toggleEnabled = async (record: any, enabled: boolean) => {
    await api.updateLink(record.id, { ...record, enabled });
    load();
  };

  const copyLink = (slug: string) => {
    const url = `${window.location.origin}/c/${slug}`;
    navigator.clipboard.writeText(url);
    message.success('链接已复制');
  };

  return (
    <Card title="分享链接" extra={<Button type="primary" onClick={() => setOpen(true)}>新建链接</Button>}>
      <Table dataSource={list} rowKey="id" pagination={false}>
        <Table.Column title="标签" dataIndex="label" />
        <Table.Column title="来源标记" dataIndex="ref" />
        <Table.Column title="访问链接" dataIndex="slug" render={(slug: string) => (
          <Space>
            <Typography.Text code>/c/{slug}</Typography.Text>
            <Button size="small" onClick={() => copyLink(slug)}>复制</Button>
          </Space>
        )} />
        <Table.Column title="访问码" dataIndex="requireCode" render={(v: boolean, r: any) =>
          v ? <Tag color="orange">需密码</Tag> : <Tag>无</Tag>
        } />
        <Table.Column title="状态" dataIndex="enabled" render={(v: boolean, r: any) => (
          <Switch checked={v} onChange={(c) => toggleEnabled(r, c)} />
        )} />
        <Table.Column title="操作" render={(_, r: any) => (
          <Popconfirm title="确认删除？" onConfirm={async () => { await api.deleteLink(r.id); load(); }}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        )} />
      </Table>

      <Modal open={open} title="新建分享链接" onOk={onCreate} onCancel={() => setOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="label" label="标签（如：投递-A公司-后端岗）">
            <Input />
          </Form.Item>
          <Form.Item name="ref" label="来源标记">
            <Input placeholder="default" />
          </Form.Item>
          <Form.Item name="requireCode" label="需要访问码" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="code" label="访问码">
            <Input placeholder="选填" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
