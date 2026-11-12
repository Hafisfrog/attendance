import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useTapStream } from '../hooks.js';
import { Alert, Modal, PageHead, StudentPicker } from '../components/ui.jsx';
import { fmtDateTime } from '../utils.js';

// ขั้นตอน: ให้นักเรียนแตะบัตรที่จุดแตะ -> บัตรที่ระบบไม่รู้จักจะโผล่ในรายการนี้ -> เลือกนักเรียนเพื่อผูก
export default function CardRegistration() {
  const [cards, setCards] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [target, setTarget] = useState(null); // uid ที่กำลังผูก
  const [studentId, setStudentId] = useState(null);
  const [manualUid, setManualUid] = useState('');

  const load = useCallback(async () => {
    try {
      setCards(await api.get('/api/cards/unassigned', { hours: 24 }));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const live = useTapStream(
    useCallback(
      (tap) => {
        if (tap.result === 'unknown_card') load();
      },
      [load],
    ),
  );

  function open(uid) {
    setTarget(uid);
    setStudentId(null);
    setError('');
  }

  async function link() {
    try {
      await api.post('/api/cards', { uid: target, studentId });
      setNotice(`ผูกบัตร ${target} เรียบร้อย`);
      setTarget(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <PageHead
        title="ลงทะเบียนบัตร"
        subtitle="ให้นักเรียนแตะบัตรที่เครื่อง แล้วเลือกชื่อนักเรียนเพื่อผูกกับบัตรใบนั้น"
      >
        <span className="hint">
          <span className={`dot ${live ? 'on' : ''}`} />
          {live ? 'รอรับบัตรแบบสด' : 'กำลังเชื่อมต่อ...'}
        </span>
      </PageHead>

      <Alert>{error}</Alert>
      <Alert tone="ok">{notice}</Alert>

      <div className="two-col">
        <section className="card">
          <h2 style={{ marginBottom: 8 }}>บัตรที่ยังไม่ถูกผูก (24 ชั่วโมงล่าสุด)</h2>
          {cards.length === 0 && <div className="empty">ยังไม่มี — ลองแตะบัตรใบใหม่ที่เครื่อง</div>}
          {cards.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>รหัสบัตร</th>
                    <th>แตะล่าสุด</th>
                    <th className="num">ครั้ง</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cards.map((c) => (
                    <tr key={c.uid}>
                      <td>
                        <code>{c.uid}</code>
                      </td>
                      <td>{fmtDateTime(c.lastTappedAt)}</td>
                      <td className="num">{c.taps}</td>
                      <td>
                        <button className="small primary" onClick={() => open(c.uid)}>
                          ผูกกับนักเรียน
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 8 }}>กรอกรหัสบัตรเอง</h2>
          <p className="hint">ใช้เมื่อมีรหัสบัตรอยู่แล้ว เช่น พิมพ์ติดมากับบัตรหรืออ่านจากแอป NFC</p>
          <div className="row">
            <input
              className="grow"
              placeholder="เช่น 04A1B2C3"
              value={manualUid}
              onChange={(e) => setManualUid(e.target.value)}
            />
            <button disabled={!manualUid.trim()} onClick={() => open(manualUid.trim())}>
              ถัดไป
            </button>
          </div>
        </section>
      </div>

      {target && (
        <Modal
          title={`ผูกบัตร ${target}`}
          onClose={() => setTarget(null)}
          actions={
            <>
              <button onClick={() => setTarget(null)}>ยกเลิก</button>
              <button className="primary" disabled={!studentId} onClick={link}>
                ยืนยัน
              </button>
            </>
          }
        >
          <Alert>{error}</Alert>
          <StudentPicker value={studentId} onChange={setStudentId} />
        </Modal>
      )}
    </>
  );
}
