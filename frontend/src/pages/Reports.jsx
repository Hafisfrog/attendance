import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, ClassroomSelect, PageHead, useClassrooms } from '../components/ui.jsx';
import { addDays, fullName, todayStr } from '../utils.js';

const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0);

export default function Reports() {
  const [to, setTo] = useState(todayStr());
  const [from, setFrom] = useState(addDays(todayStr(), -6));
  const [classroomId, setClassroomId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { rooms } = useClassrooms();

  const load = useCallback(async () => {
    if (from > to) return setError('วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด');
    try {
      setData(await api.get('/api/attendance/summary', { from, to, classroomId }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [from, to, classroomId]);

  useEffect(() => {
    load();
  }, [load]);

  async function exportCsv() {
    setBusy(true);
    try {
      await api.download('/api/attendance/export.csv', { from, to, classroomId }, `attendance_${from}_${to}.csv`);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  const preset = (days) => {
    setTo(todayStr());
    setFrom(addDays(todayStr(), -(days - 1)));
  };

  return (
    <>
      <PageHead title="รายงานการละหมาด" subtitle="นับเฉพาะช่วงละหมาดที่ปิดรับแตะแล้ว">
        <button onClick={exportCsv} disabled={busy}>
          ส่งออก CSV (Excel)
        </button>
      </PageHead>

      <div className="row" style={{ marginBottom: 14 }}>
        <label className="row">
          จาก <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="row">
          ถึง <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <button className="small" onClick={() => preset(7)}>
          7 วัน
        </button>
        <button className="small" onClick={() => preset(30)}>
          30 วัน
        </button>
        <ClassroomSelect rooms={rooms} value={classroomId} onChange={setClassroomId} />
      </div>

      <Alert>{error}</Alert>
      {data && (
        <div className="card">
          <p className="hint" style={{ marginTop: 0 }}>
            ช่วงละหมาดที่ปิดแล้วในช่วงนี้ทั้งหมด <b>{data.totalWindows}</b> ครั้ง — “ขาด/ไม่แตะ” คือไม่มีข้อมูลเลยในครั้งที่ปิดไปแล้ว
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อ-นามสกุล</th>
                  <th>ห้อง</th>
                  <th className="num">มา</th>
                  <th className="num">สาย</th>
                  <th className="num">ลา</th>
                  <th className="num">ขาด (ลงเอง)</th>
                  <th className="num">ไม่แตะ</th>
                  <th className="num">เข้าร่วม %</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.student.id}>
                    <td>{r.student.studentCode}</td>
                    <td>{fullName(r.student)}</td>
                    <td>{r.student.classroom?.name ?? '-'}</td>
                    <td className="num">{r.present}</td>
                    <td className="num">{r.late}</td>
                    <td className="num">{r.excused}</td>
                    <td className="num">{r.absent}</td>
                    <td className="num">{r.missed}</td>
                    <td className="num">
                      <b>{pct(r.present + r.late, data.totalWindows)}%</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length === 0 && <div className="empty">ไม่พบนักเรียน</div>}
          </div>
        </div>
      )}
    </>
  );
}
