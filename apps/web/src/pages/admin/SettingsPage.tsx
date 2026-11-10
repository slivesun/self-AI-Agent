import { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Alert, Tag, message, Space, Select } from 'antd';
import { MODEL_OPTIONS } from '@resume-agent/shared';
import { api } from '../../api';

interface LlmSettings {
  hasApiKey: boolean;
  apiKeyMasked: string;
  apiKeySource: 'env' | 'db' | 'none';
  model: string;
  modelSource: 'env' | 'db' | 'default';
  envModel?: string | null;
  editable: boolean;
}

const sourceLabel: Record<string, string> = {
  env: '环境变量',
  db: '后台填写',
  none: '未配置',
  default: '默认值',
};

export default function SettingsPage() {
  const [data, setData] = useState<LlmSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getLlmSettings();
      setData(res);
      form.setFieldsValue({ model: res.model, apiKey: '' });
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await api.saveLlmSettings({
        apiKey: values.apiKey?.trim() || undefined,
        model: values.model?.trim() || undefined,
      });
      message.success('已保存');
      form.setFieldValue('apiKey', '');
      await load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const onClear = async () => {
    setSaving(true);
    try {
      await api.saveLlmSettings({ clearApiKey: true });
      message.success('已清除本地保存的 Key');
      await load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="模型设置" loading={loading}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="API Key 只保存在本机数据库，不再随安装包分发。"
        description="留空表示不修改已保存的 Key。"
      />

      <Form form={form} layout="vertical" style={{ maxWidth: 520 }}>
        <Form.Item label="当前 Key">
          <Space>
            {data?.hasApiKey ? <Tag color="green">{data.apiKeyMasked}</Tag> : <Tag color="red">未配置</Tag>}
            <Tag>{sourceLabel[data?.apiKeySource || 'none']}</Tag>
          </Space>
        </Form.Item>

        <Form.Item
          name="apiKey"
          label="设置新的 API Key"
          rules={[{ max: 200, message: 'Key 过长' }]}
        >
          <Input.Password
            placeholder={data?.editable === false ? '当前由环境变量提供，应用内不可修改' : '粘贴火山方舟 ARK_API_KEY'}
            disabled={data?.editable === false}
            autoComplete="off"
          />
        </Form.Item>

        <Form.Item
          name="model"
          label="模型"
          extra={
            data?.envModel
              ? `环境变量里也配置了 ${data.envModel}；在这里保存后，以此处选择的模型为准`
              : `当前来源：${sourceLabel[data?.modelSource || 'default']}（${data?.model || '—'}）`
          }
        >
          <Select
            placeholder="选择要使用的模型"
            options={MODEL_OPTIONS.map(m => ({ value: m.value, label: `${m.label}（${m.value}）` }))}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Space>
          <Button type="primary" onClick={onSave} loading={saving}>保存</Button>
          <Button danger onClick={onClear} loading={saving} disabled={!data?.hasApiKey || data?.apiKeySource === 'env'}>
            清除本地 Key
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
