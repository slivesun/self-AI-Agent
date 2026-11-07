import { Layout, Menu, Button, Space, Modal, Form, Input, message } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { clearToken, api } from '../../api';
import { useState } from 'react';

const { Sider, Header, Content } = Layout;

const menuItems = [
  { key: '/admin/profile', label: '档案编辑' },
  { key: '/admin/qa', label: 'Q&A 库' },
  { key: '/admin/persona', label: '人设与边界' },
  { key: '/admin/knowledge', label: '知识文档' },
  { key: '/admin/links', label: '分享链接' },
  { key: '/admin/analytics', label: '会话分析' },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [form] = Form.useForm();

  const handleLogout = () => {
    clearToken();
    navigate('/login');
  };

  const onChangePwd = async () => {
    const values = await form.validateFields();
    try {
      await api.changePassword(values.oldPassword, values.newPassword);
      message.success('密码修改成功');
      setPwdOpen(false);
      form.resetFields();
    } catch (e: any) {
      message.error(e.message || '修改失败');
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={200}>
        <div style={{ height: 32, margin: 16, color: '#fff', fontSize: 16, fontWeight: 600 }}>
          简历 Agent 后台
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Space>
            <Button icon={<MessageOutlined />} type="primary" ghost onClick={() => window.open('/c/yw2h7ngjq6', 'resume-chat')}>预览对话页</Button>
            <Button onClick={() => setPwdOpen(true)}>修改密码</Button>
            <Button danger onClick={handleLogout}>退出登录</Button>
          </Space>
        </Header>
        <Content style={{ padding: 24, background: '#f0f2f5' }}>
          <Outlet />
        </Content>
      </Layout>

      <Modal title="修改密码" open={pwdOpen} onOk={onChangePwd} onCancel={() => setPwdOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="oldPassword" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 6, message: '至少 6 位' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="confirm" label="确认新密码" dependencies={['newPassword']} rules={[
            { required: true, message: '请确认新密码' },
            ({ getFieldValue }) => ({ validator(_, value) {
              if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
              return Promise.reject(new Error('两次密码不一致'));
            }})
          ]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
