import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Students from './pages/Students.jsx';
import Reports from './pages/Reports.jsx';
import PrayerWindows from './pages/PrayerWindows.jsx';
import Classrooms from './pages/Classrooms.jsx';
import Devices from './pages/Devices.jsx';

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="login-wrap">กำลังโหลด...</div>;
  if (!user) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="reports" element={<Reports />} />
        <Route path="windows" element={<PrayerWindows />} />
        <Route path="classrooms" element={<Classrooms />} />
        {user.role === 'admin' && <Route path="devices" element={<Devices />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
