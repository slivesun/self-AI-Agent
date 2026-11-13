import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import ProApp from './ProApp';
import '../styles/global.scss';

/**
 * 专业版独立入口（pro.html）。
 * 与普通版共用设计系统与组件，但构建产物、路由与运行状态完全独立：
 * 专业版的任何代码都不会被打进普通版的 index 包。
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#2b5cff' } }}>
      <ProApp />
    </ConfigProvider>
  </React.StrictMode>,
);
