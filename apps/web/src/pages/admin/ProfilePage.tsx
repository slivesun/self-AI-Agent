import { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Space, message, Tabs, Switch, Select, Upload } from 'antd';
import { MinusCircleOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { api, getToken } from '../../api';

const { TextArea } = Input;

export default function ProfilePage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // 历史解析快照（每次「上传简历解析」成功后都会留一份）
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [snapshotId, setSnapshotId] = useState<string | undefined>(undefined);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const loadSnapshots = async () => {
    try {
      const d: any = await api.getProfileSnapshots();
      setSnapshots(d.list || []);
    } catch {
      // 快照列表拉不到不影响编辑表单
      setSnapshots([]);
    }
  };

  const load = async () => {
    try {
      const data = await api.getProfile();
      form.setFieldsValue(data.profile);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
    loadSnapshots();
  };

  // 选中一条历史解析 → 整体回填到表单（并落草稿，发布后才对外生效）
  const onRestoreSnapshot = async (id: string) => {
    setSnapshotId(id);
    setRestoring(true);
    try {
      const d: any = await api.getProfileSnapshot(id);
      const p = d.profile || {};
      // 必须整体替换而不是浅合并：否则旧档案里多出的经历/项目会残留，
      // 回填结果和选中的那份记录对不上
      const normalized = {
        ...p,
        basics: p.basics || {},
        summary: p.summary || '',
        experiences: p.experiences || [],
        projects: p.projects || [],
        skills: p.skills || [],
        education: p.education || [],
      };
      form.resetFields();
      form.setFieldsValue(normalized);
      await api.saveProfile(normalized);
      message.success('已回填到表单并保存为草稿，点「发布」后访客才能看到');
    } catch (e: any) {
      setSnapshotId(undefined);
      message.error('回填失败：' + e.message);
    } finally {
      setRestoring(false);
    }
  };

  const onUpload = async (file: File) => {
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/parse', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      const { parsed, llm } = json.data;
      // 合并解析结果到表单（只填充非空字段）
      const current = form.getFieldsValue(true);
      const merged = { ...current, ...parsed };
      if (parsed.basics) merged.basics = { ...current.basics, ...parsed.basics };
      form.setFieldsValue(merged);
      // 解析结果必须落库成草稿，否则刷新页面就丢了（发布也是复制库里的草稿）
      await api.saveProfile(merged);
      loadSnapshots();
      if (llm?.error) {
        // 模型没兜住时不能只说"成功"，否则用户会以为内容解析完整
        message.warning(
          `已保存为草稿，但大模型解析未完全成功：${llm.error.message}。请逐项核对内容是否缺失`,
          8,
        );
      } else {
        message.success('文件解析完成，已保存为草稿，请检查并补充内容');
      }
    } catch (e: any) {
      message.error('解析失败：' + e.message);
    } finally {
      setParsing(false);
    }
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue(true);
      await api.saveProfile(values);
      message.success('保存成功（草稿已保存，访客看到的是已发布版本）');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const onPublish = async () => {
    setPublishing(true);
    try {
      // 把当前表单一起提交：后端先落草稿再发布，保证发布的就是界面上看到的内容
      await api.publishProfile(form.getFieldsValue(true));
      message.success('已发布！访客现在可以看到最新内容');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setPublishing(false);
    }
  };

  if (loading) return <div>加载中...</div>;

  return (
    <Card
      title="档案编辑"
      extra={
        <Space>
          <Upload accept=".pdf,.docx" showUploadList={false} beforeUpload={(file) => { onUpload(file); return false; }}>
            <Button icon={<UploadOutlined />} loading={parsing}>上传简历解析</Button>
          </Upload>
          <Button loading={saving} onClick={onSave}>保存草稿</Button>
          <Button type="primary" danger loading={publishing} onClick={onPublish}>发布</Button>
        </Space>
      }
    >
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12,
        marginBottom: 16, padding: '10px 16px', background: '#fafafa',
        border: '1px solid #f0f0f0', borderRadius: 8,
      }}>
        <span style={{ fontSize: 13, color: '#555' }}>从已解析档案回填</span>
        <Select
          style={{ width: 420, maxWidth: '100%' }}
          placeholder={snapshots.length ? '选择一份历史解析结果' : '还没有历史解析记录，先上传简历解析'}
          value={snapshotId}
          loading={restoring}
          disabled={!snapshots.length}
          showSearch
          optionFilterProp="label"
          allowClear
          onChange={(v) => { if (v) onRestoreSnapshot(v); else setSnapshotId(undefined); }}
          options={snapshots.map((s) => ({
            value: s.id,
            label: `${s.filename || '未命名文件'}｜${s.name || '未识别姓名'}${s.title ? '·' + s.title : ''}｜${s.createdAt}`,
          }))}
        />
        <span style={{ fontSize: 12, color: '#999' }}>
          回填会整体覆盖当前表单并保存为草稿，点「发布」后访客才看到
        </span>
      </div>

      <Form form={form} layout="vertical">
        <Tabs
          defaultActiveKey="basics"
          items={[
            {
              key: 'basics',
              label: '基本信息',
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <Form.Item name={['basics', 'name']} label="姓名" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name={['basics', 'title']} label="职位头衔">
                    <Input />
                  </Form.Item>
                  <Form.Item name={['basics', 'city']} label="城市">
                    <Input />
                  </Form.Item>
                  <Form.Item name={['basics', 'email']} label="邮箱（默认私密，不进上下文）">
                    <Input />
                  </Form.Item>
                  <Form.Item name="summary" label="自我描述（150-300字）">
                    <TextArea rows={4} />
                  </Form.Item>
                </Space>
              )
            },
            {
              key: 'experiences',
              label: '工作经历',
              children: (
                <Form.List name="experiences">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name }) => (
                        <Card key={key} size="small" style={{ marginBottom: 16 }}
                          extra={<MinusCircleOutlined onClick={() => remove(name)} />}>
                          <Space direction="vertical" style={{ width: '100%' }}>
                            <Space style={{ display: 'flex' }}>
                              <Form.Item name={[name, 'company']} label="公司" style={{ width: 200 }}>
                                <Input />
                              </Form.Item>
                              <Form.Item name={[name, 'role']} label="职位" style={{ width: 200 }}>
                                <Input />
                              </Form.Item>
                              <Form.Item name={[name, 'start']} label="开始" style={{ width: 120 }}>
                                <Input placeholder="2023.01" />
                              </Form.Item>
                              <Form.Item name={[name, 'end']} label="结束" style={{ width: 120 }}>
                                <Input placeholder="至今" />
                              </Form.Item>
                            </Space>
                            <Form.Item name={[name, 'highlights']} label="亮点（每行一条，用回车分隔）">
                              <TextArea rows={3} />
                            </Form.Item>
                            <Form.Item name={[name, 'stack']} label="技术栈（逗号分隔）">
                              <Input placeholder="React, TypeScript, Node.js" />
                            </Form.Item>
                            <Form.Item name={[name, 'visibility']} label="可见性" initialValue="public">
                              <Select options={[{ value: 'public', label: '公开（面试官可见）' }, { value: 'private', label: '私密（不进上下文）' }]} />
                            </Form.Item>
                          </Space>
                        </Card>
                      ))}
                      <Button type="dashed" onClick={() => add({ visibility: 'public', highlights: [], stack: [] })} block icon={<PlusOutlined />}>
                        添加工作经历
                      </Button>
                    </>
                  )}
                </Form.List>
              )
            },
            {
              key: 'projects',
              label: '项目经历',
              children: (
                <Form.List name="projects">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name }) => (
                        <Card key={key} size="small" style={{ marginBottom: 16 }}
                          extra={<MinusCircleOutlined onClick={() => remove(name)} />}>
                          <Space direction="vertical" style={{ width: '100%' }}>
                            <Space style={{ display: 'flex' }}>
                              <Form.Item name={[name, 'name']} label="项目名" style={{ width: 200 }}>
                                <Input />
                              </Form.Item>
                              <Form.Item name={[name, 'role']} label="角色" style={{ width: 150 }}>
                                <Input />
                              </Form.Item>
                              <Form.Item name={[name, 'period']} label="时间" style={{ width: 150 }}>
                                <Input />
                              </Form.Item>
                            </Space>
                            <Form.Item name={[name, 'background']} label="背景">
                              <TextArea rows={2} />
                            </Form.Item>
                            <Form.Item name={[name, 'challenge']} label="挑战">
                              <TextArea rows={2} />
                            </Form.Item>
                            <Form.Item name={[name, 'solution']} label="方案">
                              <TextArea rows={2} />
                            </Form.Item>
                            <Form.Item name={[name, 'result']} label="成果（带数字）">
                              <TextArea rows={2} />
                            </Form.Item>
                            <Form.Item name={[name, 'stack']} label="技术栈（逗号分隔）">
                              <Input />
                            </Form.Item>
                            <Form.Item name={[name, 'visibility']} label="可见性" initialValue="public">
                              <Select options={[{ value: 'public', label: '公开' }, { value: 'private', label: '私密' }]} />
                            </Form.Item>
                          </Space>
                        </Card>
                      ))}
                      <Button type="dashed" onClick={() => add({ visibility: 'public', stack: [] })} block icon={<PlusOutlined />}>
                        添加项目
                      </Button>
                    </>
                  )}
                </Form.List>
              )
            },
            {
              key: 'skills',
              label: '技能',
              children: (
                <Form.List name="skills">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name }) => (
                        <Card key={key} size="small" style={{ marginBottom: 16 }}
                          extra={<MinusCircleOutlined onClick={() => remove(name)} />}>
                          <Form.Item name={[name, 'group']} label="技能分组名">
                            <Input placeholder="前端 / 后端 / 工程化" />
                          </Form.Item>
                          <Form.List name={[name, 'items']}>
                            {(sFields, { add: sAdd, remove: sRemove }) => (
                              <>
                                {sFields.map(({ key: sk, name: sn }) => (
                                  <Space key={sk} style={{ display: 'flex', marginBottom: 8 }}>
                                    <Form.Item name={[sn, 'name']} noStyle>
                                      <Input placeholder="技能名" style={{ width: 150 }} />
                                    </Form.Item>
                                    <Form.Item name={[sn, 'level']} noStyle>
                                      <Select placeholder="水平" style={{ width: 100 }} options={[1,2,3,4,5].map(n => ({ value: n, label: '★'.repeat(n) }))} />
                                    </Form.Item>
                                    <MinusCircleOutlined onClick={() => sRemove(sn)} />
                                  </Space>
                                ))}
                                <Button type="dashed" size="small" onClick={() => sAdd({ level: 3 })} icon={<PlusOutlined />}>添加技能</Button>
                              </>
                            )}
                          </Form.List>
                        </Card>
                      ))}
                      <Button type="dashed" onClick={() => add({ items: [] })} block icon={<PlusOutlined />}>添加技能分组</Button>
                    </>
                  )}
                </Form.List>
              )
            },
            {
              key: 'education',
              label: '教育',
              children: (
                <Form.List name="education">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name }) => (
                        <Card key={key} size="small" style={{ marginBottom: 16 }}
                          extra={<MinusCircleOutlined onClick={() => remove(name)} />}>
                          <Space style={{ display: 'flex' }}>
                            <Form.Item name={[name, 'school']} label="学校">
                              <Input />
                            </Form.Item>
                            <Form.Item name={[name, 'degree']} label="学历">
                              <Input />
                            </Form.Item>
                            <Form.Item name={[name, 'major']} label="专业">
                              <Input />
                            </Form.Item>
                            <Form.Item name={[name, 'period']} label="时间">
                              <Input />
                            </Form.Item>
                          </Space>
                        </Card>
                      ))}
                      <Button type="dashed" onClick={() => add({})} block icon={<PlusOutlined />}>添加教育经历</Button>
                    </>
                  )}
                </Form.List>
              )
            }
          ]}
        />
      </Form>
    </Card>
  );
}
