import { useState, useEffect, useRef } from 'react';
import { Card, Table, Button, Modal, Tag, message, Space, Popconfirm, Input } from 'antd';
import { UploadOutlined, EyeOutlined, DeleteOutlined, EditOutlined, FormOutlined } from '@ant-design/icons';
import { api, getToken } from '../../api';

export default function KnowledgePage() {
  const [list, setList] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editDoc, setEditDoc] = useState<any>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editNewTag, setEditNewTag] = useState('');
  const [renameDoc, setRenameDoc] = useState<any>(null);
  const [renameName, setRenameName] = useState('');
  const [renameExt, setRenameExt] = useState('');

  const load = async () => {
    const res: any = await api.getKnowledge();
    setList(res.list);
    const tagSet = new Set<string>();
    res.list.forEach((d: any) => (d.tags || []).forEach((t: string) => tagSet.add(t)));
    setAllTags([...tagSet]);
  };

  useEffect(() => { load(); }, []);

  // 第一步：打开标签选择弹框
  const openUpload = () => {
    setSelectedTags([]);
    setNewTag('');
    setTagModalOpen(true);
  };

  // 第二步：标签确定后打开文件选择
  const confirmTags = () => {
    setTagModalOpen(false);
    fileInputRef.current?.click();
  };

  // 第三步：选文件后上传
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tags', JSON.stringify(selectedTags));
      const token = getToken();
      const res = await fetch('/api/admin/knowledge', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        message.success('上传成功');
        load();
      } else {
        message.error(data.error);
      }
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onPreview = async (id: string) => {
    const res: any = await api.getKnowledgeDoc(id);
    setPreview(res);
  };

  const onDelete = async (id: string) => {
    await api.deleteKnowledge(id);
    message.success('已删除');
    load();
  };

  const columns = [
    { title: '文件名', dataIndex: 'filename', key: 'filename' },
    { title: '类型', dataIndex: 'fileType', key: 'fileType', width: 80, render: (t: string) => <Tag>{t}</Tag> },
    { title: '大小', dataIndex: 'size', key: 'size', width: 100, render: (s: number) => s > 1000 ? `${(s/1000).toFixed(1)}KB` : `${s}B` },
    { title: '标签', dataIndex: 'tags', key: 'tags', render: (tags: string[]) => (tags || []).map((t: string) => <Tag key={t} color="blue">{t}</Tag>) },
    { title: '上传时间', dataIndex: 'createdAt', key: 'createdAt', width: 160 },
    { title: '操作', key: 'actions', width: 260, render: (_: any, r: any) => (
      <Space>
        <Button size="small" icon={<EyeOutlined />} onClick={() => onPreview(r.id)}>预览</Button>
        <Button size="small" icon={<FormOutlined />} onClick={() => { setRenameDoc(r); const dot = r.filename.lastIndexOf('.'); setRenameName(dot > 0 ? r.filename.slice(0, dot) : r.filename); setRenameExt(dot > 0 ? r.filename.slice(dot) : ''); }}>重命名</Button>
        <Button size="small" icon={<EditOutlined />} onClick={() => { setEditDoc(r); setEditTags(r.tags || []); setEditNewTag(''); }}>编辑标签</Button>
        <Popconfirm title="确定删除此文件？" onConfirm={() => onDelete(r.id)} okText="删除" cancelText="取消">
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  return (
    <Card title="其他知识文档" extra={
      <Button type="primary" icon={<UploadOutlined />} loading={loading} onClick={openUpload}>上传文档</Button>
    }>
      <input ref={fileInputRef} type="file" accept=".pdf,.docx,.md,.markdown,.txt,.csv,.xlsx" style={{ display: 'none' }} onChange={onFileChange} />

      <Table dataSource={list} columns={columns} rowKey="id" pagination={false} />

      {/* 标签选择弹框 */}
      <Modal
        title="选择文档标签"
        open={tagModalOpen}
        onOk={confirmTags}
        onCancel={() => setTagModalOpen(false)}
        okText="确定，选择文件"
        cancelText="取消"
      >
        <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
          选择标签或输入新标签（最多8字），然后点击确定上传文件
        </div>
        <Space wrap>
          {allTags.map(t => (
            <Tag.CheckableTag
              key={t}
              checked={selectedTags.includes(t)}
              onChange={(c) => {
                setSelectedTags(c ? [...selectedTags, t] : selectedTags.filter(v => v !== t));
              }}
            >
              {t}
            </Tag.CheckableTag>
          ))}
          {allTags.length === 0 && <span style={{ color: '#999' }}>暂无历史标签</span>}
        </Space>
        <div style={{ marginTop: 16 }}>
          <Input
            placeholder="输入新标签（最多8字）"
            maxLength={8}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            suffix={
              <Button
                size="small"
                type="link"
                disabled={!newTag.trim() || selectedTags.includes(newTag.trim())}
                onClick={() => {
                  setSelectedTags([...selectedTags, newTag.trim()]);
                  setNewTag('');
                }}
              >
                添加
              </Button>
            }
          />
        </div>
        {selectedTags.length > 0 && (
          <div style={{ marginTop: 12 }}>
            已选：{selectedTags.map(t => <Tag key={t} color="blue" closable onClose={() => setSelectedTags(selectedTags.filter(v => v !== t))}>{t}</Tag>)}
          </div>
        )}
      </Modal>

      {/* 编辑标签弹框 */}
      <Modal
        title={`编辑标签 - ${editDoc?.filename || ''}`}
        open={!!editDoc}
        onOk={async () => {
          await api.updateKnowledgeTags(editDoc.id, editTags);
          message.success('标签已更新');
          setEditDoc(null);
          load();
        }}
        onCancel={() => setEditDoc(null)}
        okText="保存"
      >
        <Space wrap>
          {allTags.map(t => (
            <Tag.CheckableTag
              key={t}
              checked={editTags.includes(t)}
              onChange={(c) => setEditTags(c ? [...editTags, t] : editTags.filter(v => v !== t))}
            >
              {t}
            </Tag.CheckableTag>
          ))}
        </Space>
        <div style={{ marginTop: 16 }}>
          <Input
            placeholder="输入新标签（最多8字）"
            maxLength={8}
            value={editNewTag}
            onChange={(e) => setEditNewTag(e.target.value)}
            suffix={
              <Button size="small" type="link" disabled={!editNewTag.trim() || editTags.includes(editNewTag.trim())}
                onClick={() => { setEditTags([...editTags, editNewTag.trim()]); setEditNewTag(''); }}>
                添加
              </Button>
            }
          />
        </div>
        {editTags.length > 0 && (
          <div style={{ marginTop: 12 }}>
            已选：{editTags.map(t => <Tag key={t} color="blue" closable onClose={() => setEditTags(editTags.filter(v => v !== t))}>{t}</Tag>)}
          </div>
        )}
      </Modal>

      {/* 重命名弹框 */}
      <Modal
        title="重命名文档"
        open={!!renameDoc}
        onOk={async () => {
          if (!renameName.trim()) return;
          await fetch(`/api/admin/knowledge/${renameDoc.id}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
            body: JSON.stringify({ filename: renameName.trim() + renameExt }),
          });
          message.success('已重命名');
          setRenameDoc(null);
          load();
        }}
        onCancel={() => setRenameDoc(null)}
        okText="保存"
      >
        <Input
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          placeholder="输入新文件名"
          maxLength={100}
          suffix={<span style={{ color: '#999' }}>{renameExt}</span>}
        />
      </Modal>

      {/* 预览弹框 */}
      <Modal
        title={preview?.filename}
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={null}
        width="80%"
        style={{ top: '5%', maxWidth: '90vw' }}
      >
        <div style={{ maxHeight: '80vh', overflow: 'auto', background: '#f7f8fa', padding: 16, borderRadius: 8, whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.8 }}>
          {preview?.content}
        </div>
      </Modal>
    </Card>
  );
}
