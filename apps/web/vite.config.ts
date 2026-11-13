import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    // 多入口：普通版 index.html + 专业版 pro.html。
    // 两个入口各自产出自己的 bundle，专业版代码不会进普通版的包，反之亦然。
    rollupOptions: {
      input: {
        main: path.resolve(webRoot, 'index.html'),
        pro: path.resolve(webRoot, 'pro.html'),
      },
      output: {
        // 拆分第三方依赖，避免单个 chunk 过大导致首屏加载慢
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('antd') || id.includes('@ant-design') || id.includes('rc-')) return 'antd';
          if (id.includes('react') || id.includes('scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
});
