import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const ROLE_TH = { admin: 'สิทธิ์แอดมิน', teacher: 'สิทธิ์ครู' };

export default function Layout() {
  const { user, logout } = useAuth();
  const isAdmin = user.role === 'admin';

  return (
    <div className="shell">
      <aside className="sidebar">
        <img
          className="sidebar-logo"
          src="/logo.png"
          alt=""
          onError={(event) => event.currentTarget.remove()}
        />
        <div className="brand">
          ลงเวลาละหมาด
          <small>ระบบแตะบัตรนักเรียน</small>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            ภาพรวมวันนี้
          </NavLink>
          <NavLink to="/students">นักเรียน</NavLink>
          <NavLink to="/cards">ลงทะเบียนบัตร</NavLink>
          <NavLink to="/reports">รายงาน</NavLink>
          <NavLink to="/windows">ตารางเวลาละหมาด</NavLink>
          <NavLink to="/classrooms">ห้องเรียน</NavLink>
          {isAdmin && <NavLink to="/devices">อุปกรณ์แตะบัตร</NavLink>}
        </nav>
        <div className="spacer" />
        <div className="userbox">
          <div>
            {user.displayName}
            <div className="hint" style={{ color: 'inherit', opacity: 0.75 }}>
              {ROLE_TH[user.role] || user.role}
            </div>
          </div>
          <button onClick={logout}>ออกจากระบบ</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
