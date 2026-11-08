import { useState } from 'react';
import { Card, Form, Input, Button, Modal, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [pendingChange, setPendingChange] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const data = await api.login(values.username, values.password);
      setToken(data.token);
      if (data.mustChangePassword) {
        // 默认口令首次登录：必须改密后才能使用后台
        message.warning('首次登录请先修改默认密码');
        setPendingChange(true);
      } else {
        message.success('登录成功');
        navigate('/admin');
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const onChangePassword = async () => {
    const values = await form.validateFields();
    try {
      await api.changePassword(values.oldPassword, values.newPassword);
      message.success('密码修改成功');
      setPendingChange(false);
      navigate('/admin');
    } catch (e: any) {
      message.error(e.message || '修改失败');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', background: '#f0f2f5' }}>
      <Card title="简历 Agent 后台登录" style={{ width: 360 }}>
        <Form onFinish={onFinish} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input autoComplete="username" placeholder="请输入管理员账号" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" placeholder="请输入密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>登录</Button>
        </Form>
      </Card>

      <Modal
        title="请修改默认密码"
        open={pendingChange}
        closable={false}
        maskClosable={false}
        onOk={onChangePassword}
        okText="保存并进入后台"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        <p style={{ color: '#999', fontSize: 12 }}>为安全起见，使用默认口令首次登录必须先设置新密码。</p>
        <Form form={form} layout="vertical">
          <Form.Item name="oldPassword" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 6, message: '至少 6 位' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
