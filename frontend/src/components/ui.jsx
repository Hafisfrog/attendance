import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useDebounced } from '../hooks.js';
import { fullName } from '../utils.js';

export function Modal({ title, onClose, children, actions }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

export const Field = ({ label, children }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);

export const Alert = ({ tone, children }) =>
  children ? <div className={`alert ${tone || ''}`}>{children}</div> : null;

export const Badge = ({ tone, children }) => <span className={`badge ${tone || ''}`}>{children}</span>;

export const PageHead = ({ title, subtitle, children }) => (
  <div className="page-head">
    <div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    <div className="row">{children}</div>
  </div>
);

// ดึงรายชื่อห้องเรียนมาใช้ซ้ำในหลายหน้า
export function useClassrooms() {
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .get('/api/classrooms')
      .then(setRooms)
      .catch((e) => setError(e.message));
  }, []);
  return { rooms, error };
}

export function ClassroomSelect({ rooms, value, onChange, allLabel = 'ทุกห้อง' }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="ห้องเรียน">
      <option value="">{allLabel}</option>
      {rooms.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name} ({r.academicYear})
        </option>
      ))}
    </select>
  );
}

// ช่องค้นหาและเลือกนักเรียน
export function StudentPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/students', { q: debounced, pageSize: 20 })
      .then((r) => !cancelled && setItems(r.items))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <div>
      <input
        style={{ width: '100%' }}
        placeholder="ค้นหาด้วยชื่อหรือรหัสนักเรียน"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Alert>{error}</Alert>
      <div className="picker-list">
        {items.length === 0 && <div className="empty">ไม่พบนักเรียน</div>}
        {items.map((s) => (
          <button
            type="button"
            key={s.id}
            className={value === s.id ? 'selected' : ''}
            onClick={() => onChange(s.id)}
          >
            {s.studentCode} · {fullName(s)}
            {s.classroom ? ` · ${s.classroom.name}` : ''}
            {s.cards.some((c) => c.status === 'active') ? ' (มีบัตรแล้ว)' : ''}
          </button>
        ))}
      </div>
    </div>
  );
}
