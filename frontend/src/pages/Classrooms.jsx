import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Field, Modal, PageHead } from '../components/ui.jsx';
import { currentBuddhistYear } from '../utils.js';

function RoomForm({ room, onClose, onSaved }) {
  const [name, setName] = useState(room?.name ?? '');
  const [year, setYear] = useState(room?.academicYear ?? currentBuddhistYear());
  const [error, setError] = useState('');

  async function save() {
    const body = { name: name.trim(), academicYear: Number(year) };
    try {
      if (room) await api.put(`/api/classrooms/${room.id}`, body);
      else await api.post('/api/classrooms', body);
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Modal
      title={room ? 'แก้ไขห้องเรียน' : 'เพิ่มห้องเรียน'}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>ยกเลิก</button>
          <button className="primary" onClick={save} disabled={!name.trim()}>
            บันทึก
          </button>
        </>
      }
    >
      <Alert>{error}</Alert>
      <Field label="ชื่อห้อง (เช่น ม.1/1)">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="ปีการศึกษา (พ.ศ.)">
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
      </Field>
    </Modal>
  );
}

export default function Classrooms() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    try {
      setRooms(await api.get('/api/classrooms'));
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function remove(r) {
    if (!window.confirm(`ลบห้อง ${r.name}?`)) return;
    try {
      await api.del(`/api/classrooms/${r.id}`);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <PageHead title="ห้องเรียน">
        {isAdmin && (
          <button className="primary" onClick={() => setModal({})}>
            + เพิ่มห้อง
          </button>
        )}
      </PageHead>
      <Alert>{error}</Alert>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ห้อง</th>
                <th>ปีการศึกษา</th>
                <th className="num">นักเรียน</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.academicYear}</td>
                  <td className="num">{r.studentCount}</td>
                  <td>
                    {isAdmin && (
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button className="small" onClick={() => setModal({ room: r })}>
                          แก้ไข
                        </button>
                        <button className="small danger" onClick={() => remove(r)}>
                          ลบ
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rooms.length === 0 && <div className="empty">ยังไม่มีห้องเรียน</div>}
        </div>
      </div>
      {modal && (
        <RoomForm
          room={modal.room}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
    </>
  );
}
