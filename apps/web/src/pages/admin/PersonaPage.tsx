import { useEffect, useState } from 'react';
import { Card, Form, Input, Button, message, InputNumber } from 'antd';
import { api } from '../../api';

const { TextArea } = Input;

export default function PersonaPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getPersona().then((data: any) => {
      form.setFieldsValue(data.persona);
      setLoading(false);
    });
  }, []);

  const onSave = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue();
      // refusalTopics 从文本转回数组
      if (typeof values.refusalTopics === 'string') {
        values.refusalTopics = (values.refusalTopics as string).split('\n').filter(Boolean);
      }
      await api.savePersona(values);
      message.success('人设配置已保存');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>加载中...</div>;

  return (
    <Card title="人设与边界" extra={<Button type="primary" loading={saving} onClick={onSave}>保存</Button>}>
      <Form form={form} layout="vertical"
        initialValues={{ refusalTopics: form.getFieldValue('refusalTopics')?.join?.('\n') || '' }}
        onValuesChange={(changed) => {
          if (changed.refusalTopics && Array.isArray(changed.refusalTopics)) {
            form.setFieldValue('refusalTopics', changed.refusalTopics.join('\n'));
          }
        }}
      >
        <Form.Item name="systemPrompt" label="身份设定">
          <TextArea rows={2} />
        </Form.Item>
        <Form.Item name="tone" label="语气风格">
          <TextArea rows={2} />
        </Form.Item>
        <Form.Item name="hardConstraint" label="硬约束（反幻觉）">
          <TextArea rows={3} />
        </Form.Item>
        <Form.Item name="refusalTopics" label="拒答清单（每行一个话题）">
          <TextArea rows={4} />
        </Form.Item>
        <Form.Item name="fallbackReply" label="兜底话术">
          <TextArea rows={2} />
        </Form.Item>
        <Form.Item name="temperature" label="温度（越低越保守）">
          <InputNumber min={0} max={1} step={0.1} />
        </Form.Item>
      </Form>
    </Card>
  );
}
