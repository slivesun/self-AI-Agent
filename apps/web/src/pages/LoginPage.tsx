import { useState } from 'react';
import { Card, Form, Input, Button, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const data = await api.login(values.username, values.password);
      setToken(data.token);
      message.success('登录成功');
      navigate('/admin');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', background: '#f0f2f5' }}>
      <Card title="简历 Agent 后台登录" style={{ width: 360 }}>
        <Form onFinish={onFinish} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input defaultValue="admin" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password defaultValue="admin123" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>登录</Button>
        </Form>
        <p style={{ marginTop: 12, fontSize: 12, color: '#999' }}>默认账号 admin / admin123</p>
      </Card>
    </div>
  );
}
