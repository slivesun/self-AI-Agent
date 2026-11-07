import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import knowledgeRoutes from './routes/knowledge.js';
import linksRoutes from './routes/links.js';
import visitorRoutes from './routes/visitor.js';
import visitorAuthRoutes from './routes/visitorAuth.js';

initDb();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3001'],
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// 路由挂载
app.use('/api/auth', authRoutes);
app.use('/api/auth/visitor', visitorAuthRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/knowledge', knowledgeRoutes);
app.use('/api/admin/links', linksRoutes);
app.use('/api', visitorRoutes);

// 生产环境：托管前端静态文件
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '../../web/dist');
console.log('Static dist path:', webDist, 'exists:', fs.existsSync(webDist));
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: 'index.html' }));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
