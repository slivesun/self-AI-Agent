import { useEffect, useState } from 'react';
import { Card, Table, Button, Modal, Form, Input, Switch, Space, message, Popconfirm, Tag } from 'antd';
import { api } from '../../api';

export default function QAPage() {
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = async () => {
    const data = await api.getQA();
    setList(data.list);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ enabled: true, variants: '', tags: '' });
    setOpen(true);
  };

  const openEdit = (record: any) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      variants: (record.variants || []).join('\n'),
    });
    setOpen(true);
  };

  const onSubmit = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      variants: typeof values.variants === 'string'
        ? values.variants.split('\n').map((s: string) => s.trim()).filter(Boolean)
        : (values.variants || []),
      tags: typeof values.tags === 'string'
        ? values.tags.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean)
        : (values.tags || []),
    };
    if (editing) {
      await api.updateQA(editing.id, payload);
      message.success('已更新');
    } else {
      await api.createQA(payload);
      message.success('已创建');
    }
    setOpen(false);
    load();
  };

  const onDelete = async (id: string) => {
    await api.deleteQA(id);
    message.success('已删除');
    load();
  };

  return (
    <Card title="Q&A 库" extra={<Button type="primary" onClick={openCreate}>新增问答</Button>}>
      <Table dataSource={list} rowKey="id" pagination={false}>
        <Table.Column title="问题" dataIndex="question" />
        <Table.Column title="标准答案" dataIndex="answer" ellipsis width="40%" />
        <Table.Column title="相似问法" dataIndex="variants" render={(v: any) => {
          const arr = Array.isArray(v) ? v : [];
          return arr.length ? arr.map((s, i) => <Tag key={i}>{s}</Tag>) : '-';
        }} />
        <Table.Column title="启用" dataIndex="enabled" render={(v: boolean, r: any) => (
          <Switch checked={v} onChange={async (checked) => { await api.updateQA(r.id, { ...r, enabled: checked }); load(); }} />
        )} />
        <Table.Column title="操作" render={(_, r: any) => (
          <Space>
            <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
            <Popconfirm title="确认删除？" onConfirm={() => onDelete(r.id)}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          </Space>
        )} />
      </Table>

      <Modal open={open} title={editing ? '编辑问答' : '新增问答'} onOk={onSubmit} onCancel={() => setOpen(false)} width={600}>
        <Form form={form} layout="vertical">
          <Form.Item name="question" label="问题" rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="variants" label="相似问法（每行一条）">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="answer" label="标准答案" rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
