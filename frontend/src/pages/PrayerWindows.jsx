import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Field, Modal, PageHead } from '../components/ui.jsx';
import { PRAYER_NAMES, addDays, fmtDate, fmtShortTime, fromLocalInput, toLocalInput, todayStr } from '../utils.js';

function EditModal({ window: w, onClose, onSaved }) {
  const [opensAt, setOpensAt] = useState(toLocalInput(w.opensAt));
  const [lateAt, setLateAt] = useState(toLocalInput(w.lateAt));
  const [closesAt, setClosesAt] = useState(toLocalInput(w.closesAt));
  const [error, setError] = useState('');

  async function save() {
    try {
      await api.put(`/api/prayer-windows/${w.id}`, {
        opensAt: fromLocalInput(opensAt),
        lateAt: fromLocalInput(lateAt),
        closesAt: fromLocalInput(closesAt),
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove() {
    try {
      await api.del(`/api/prayer-windows/${w.id}`);
      return onSaved();
    } catch {
      /* 409 = มีข้อมูลลงเวลาอยู่ ต้องยืนยันซ้ำ */
    }
    if (!window.confirm('ช่วงนี้มีข้อมูลลงเวลาอยู่ การลบจะลบข้อมูลเหล่านั้นทั้งหมดด้วย ต้องการลบจริงหรือไม่?')) return;
    try {
      await api.del(`/api/prayer-windows/${w.id}`, { force: 'true' });
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Modal
      title={`แก้เวลา ${PRAYER_NAMES[w.prayer]} · ${fmtDate(w.prayerDate)}`}
      onClose={onClose}
      actions={
        <>
          <button className="danger" onClick={remove} style={{ marginRight: 'auto' }}>
            ลบช่วงนี้
          </button>
          <button onClick={onClose}>ยกเลิก</button>
          <button className="primary" onClick={save}>
            บันทึก
          </button>
        </>
      }
    >
      <Alert>{error}</Alert>
      <Field label="เริ่มรับแตะ">
        <input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
      </Field>
      <Field label="หลังเวลานี้นับว่า “สาย” (เว้นว่าง = ไม่แยกสาย)">
        <input type="datetime-local" value={lateAt} onChange={(e) => setLateAt(e.target.value)} />
      </Field>
      <Field label="หมดเวลารับแตะ">
        <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
      </Field>
    </Modal>
  );
}

export default function PrayerWindows() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(addDays(todayStr(), 6));
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.get('/api/prayer-windows', { from, to }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate(overwrite) {
    if (overwrite && !window.confirm('คำนวณใหม่จะทับเวลาที่เคยแก้ไขเองในช่วงวันที่นี้ ต้องการดำเนินการต่อหรือไม่?')) return;
    setBusy(true);
    setNotice('');
    try {
      const r = await api.post('/api/prayer-windows/generate', { from, to, overwrite });
      setNotice(`สร้าง/ตรวจสอบตารางเวลา ${r.count} รายการ`);
      load();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  const byDate = rows.reduce((acc, w) => {
    const d = w.prayerDate.slice(0, 10);
    (acc[d] ||= []).push(w);
    return acc;
  }, {});

  return (
    <>
      <PageHead
        title="ตารางเวลาละหมาด"
        subtitle="ช่วงเวลาที่รับแตะบัตร คำนวณจากพิกัดโรงเรียน และแก้ไขรายวันได้"
      />

      <div className="row" style={{ marginBottom: 14 }}>
        <label className="row">
          จาก <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="row">
          ถึง <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        {isAdmin && (
          <>
            <button className="primary" disabled={busy} onClick={() => generate(false)}>
              สร้างตารางที่ยังไม่มี
            </button>
            <button disabled={busy} onClick={() => generate(true)}>
              คำนวณใหม่ทับของเดิม
            </button>
          </>
        )}
      </div>

      <Alert>{error}</Alert>
      <Alert tone="ok">{notice}</Alert>

      {Object.keys(byDate).length === 0 && <div className="card empty">ไม่มีตารางเวลาในช่วงวันที่นี้</div>}
      <div className="stack">
        {Object.entries(byDate).map(([date, list]) => (
          <section key={date} className="card">
            <h3 style={{ marginBottom: 6 }}>{fmtDate(date)}</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ละหมาด</th>
                    <th>เริ่มรับแตะ</th>
                    <th>นับว่าสายหลัง</th>
                    <th>หมดเวลา</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((w) => (
                    <tr key={w.id}>
                      <td>{PRAYER_NAMES[w.prayer]}</td>
                      <td>{fmtShortTime(w.opensAt)} น.</td>
                      <td>{w.lateAt ? `${fmtShortTime(w.lateAt)} น.` : '-'}</td>
                      <td>{fmtShortTime(w.closesAt)} น.</td>
                      <td>
                        {isAdmin && (
                          <button className="small" onClick={() => setEditing(w)}>
                            แก้ไข
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {editing && (
        <EditModal
          window={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}
