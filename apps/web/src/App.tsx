import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import AdminLayout from './pages/admin/AdminLayout';
import ProfilePage from './pages/admin/ProfilePage';
import QAPage from './pages/admin/QAPage';
import PersonaPage from './pages/admin/PersonaPage';
import LinksPage from './pages/admin/LinksPage';
import AnalyticsPage from './pages/admin/AnalyticsPage';
import KnowledgePage from './pages/admin/KnowledgePage';
import VisitorChatPage from './pages/VisitorChatPage';
import { getToken } from './api';

function ProtectedRoute({ children }: { children: JSX.Element }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/c/:slug" element={<VisitorChatPage />} />
      <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/admin/profile" replace />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="qa" element={<QAPage />} />
        <Route path="persona" element={<PersonaPage />} />
        <Route path="links" element={<LinksPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/c/:slug" replace />} />
    </Routes>
  );
}
