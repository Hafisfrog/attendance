import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useTapStream } from '../hooks.js';
import { Alert, Badge, ClassroomSelect, PageHead, useClassrooms } from '../components/ui.jsx';
import {
  PRAYER_NAMES,
  RESULT_TONE,
  WINDOW_STATE,
  addDays,
  fmtDate,
  fmtShortTime,
  fmtTime,
  fullName,
  todayStr,
} from '../utils.js';

const REFRESH_MS = 30 * 1000;

export default function Dashboard() {
  const [date, setDate] = useState(todayStr());
  const [classroomId, setClassroomId] = useState('');
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [missing, setMissing] = useState(null);
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [readerDevices, setReaderDevices] = useState([]);
  const [readerDeviceId, setReaderDeviceId] = useState('');
  const [scanUid, setScanUid] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [readerMessage, setReaderMessage] = useState('');
  const scanInputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const { rooms } = useClassrooms();

  useEffect(() => {
    if (scanBusy || scanUid.trim().length < 4) return undefined;
    const timer = window.setTimeout(() => scanInputRef.current?.form?.requestSubmit(), 250);
    return () => window.clearTimeout(timer);
  }, [scanUid, scanBusy]);

  useEffect(() => {
    api.get('/api/attendance/reader-devices').then((items) => {
      setReaderDevices(items);
      if (items.length) setReaderDeviceId(String(items[0].id));
    }).catch((e) => setReaderMessage(e.message));
  }, []);

  async function submitReaderScan(event) {
    event.preventDefault();
    const cardUid = scanUid.trim();
    setScanUid('');
    scanInputRef.current?.focus();
    if (!cardUid || !readerDeviceId || scanBusy) return;
    setScanBusy(true);
    setReaderMessage('กำลังอ่านบัตร...');
    try {
      const result = await api.post('/api/attendance/reader-scan', { cardUid, deviceId: Number(readerDeviceId) });
      setReaderMessage(result.message || 'รับข้อมูลบัตรแล้ว');
    } catch (e) {
      setReaderMessage(e.message);
    } finally {
      setScanBusy(false);
      scanInputRef.current?.focus();
    }
  }

  useEffect(() => {
    if (!cameraOn) return undefined;
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('เบราว์เซอร์นี้ไม่รองรับกล้อง กรุณาเปิดเว็บผ่าน HTTPS หรือ localhost');
      return () => { active = false; };
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then((stream) => {
        if (!active) return stream.getTracks().forEach((track) => track.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraError('');
      })
      .catch(() => setCameraError('เปิดกล้องไม่ได้ กรุณาอนุญาตการใช้กล้องและตรวจสอบว่าใช้ HTTPS หรือ localhost'));
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraOn]);

  const captureForTap = useCallback(async (tap) => {
    if (!streamRef.current || !tap.tapLogId) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = Math.round(640 * video.videoHeight / video.videoWidth);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      await api.post(`/api/attendance/tap/${tap.tapLogId}/photo`, { image: canvas.toDataURL('image/jpeg', 0.65) });
      setFeed((items) => items.map((item) => item.tapLogId === tap.tapLogId ? { ...item, hasPhoto: true } : item));
    } catch (e) {
      setCameraError(`บันทึกภาพไม่สำเร็จ: ${e.message}`);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      setData(await api.get('/api/attendance/dashboard', { date, classroomId }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [date, classroomId]);

  const loadMissing = useCallback(async () => {
    if (!selected) return setMissing(null);
    try {
      setMissing(await api.get('/api/attendance/missing', { windowId: selected, classroomId }));
    } catch (e) {
      setError(e.message);
    }
  }, [selected, classroomId]);

  useEffect(() => {
    loadDashboard();
    const t = setInterval(loadDashboard, REFRESH_MS);
    return () => clearInterval(t);
  }, [loadDashboard]);

  useEffect(() => {
    loadMissing();
  }, [loadMissing]);

  // เลือกช่วงละหมาดเริ่มต้น: ช่วงที่เปิดอยู่ มิฉะนั้นช่วงล่าสุดที่เริ่มแล้ว
  useEffect(() => {
    if (!data) return;
    if (data.windows.some((w) => w.id === selected)) return;
    const open = data.windows.find((w) => w.state === 'open');
    const lastStarted = [...data.windows].reverse().find((w) => w.state !== 'upcoming');
    setSelected((open || lastStarted || data.windows[0])?.id ?? null);
  }, [data, selected]);

  const live = useTapStream(
    useCallback(
      (tap) => {
        setFeed((f) => [{ ...tap, at: Date.now() }, ...f].slice(0, 20));
        if (tap.result === 'recorded') captureForTap(tap);
        loadDashboard();
        loadMissing();
      },
      [captureForTap, loadDashboard, loadMissing],
    ),
  );

  async function mark(studentId, status) {
    try {
      await api.put('/api/attendance/manual', { studentId, prayerWindowId: selected, status });
      loadDashboard();
      loadMissing();
    } catch (e) {
      setError(e.message);
    }
  }

  const isToday = date === todayStr();

  return (
    <>
      <PageHead title="Dashboard(ภาพรวม)" subtitle={fmtDate(date)}>
        <ClassroomSelect rooms={rooms} value={classroomId} onChange={setClassroomId} />
        <button onClick={() => setDate(addDays(date, -1))} aria-label="วันก่อนหน้า">
          ←
        </button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button onClick={() => setDate(addDays(date, 1))} aria-label="วันถัดไป">
          →
        </button>
        {!isToday && <button onClick={() => setDate(todayStr())}>วันนี้</button>}
      </PageHead>

      <Alert>{error}</Alert>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <strong>บันทึกภาพขณะสแกน</strong>
            <div className="hint">เปิดกล้องคอมพิวเตอร์นี้ไว้ ระบบจะถ่ายภาพเมื่อมีการแตะบัตรสำเร็จ</div>
          </div>
          <button className={cameraOn ? 'danger' : 'primary'} onClick={() => { setCameraError(''); setCameraOn((on) => !on); }}>
            {cameraOn ? 'ปิดกล้อง' : 'เปิดกล้อง'}
          </button>
        </div>
        {cameraOn && <video ref={videoRef} autoPlay muted playsInline style={{ display: 'block', width: 240, maxWidth: '100%', marginTop: 12, borderRadius: 8, background: '#111' }} />}
        {cameraError && <p className="hint" role="alert">{cameraError}</p>}
        <hr style={{ margin: '16px 0' }} />
        <strong>เครื่องอ่านบัตร USB</strong>
        <div className="hint">เลือกจุดอ่านบัตร แล้วคลิกช่องนี้ก่อนแตะบัตร ระบบจะบันทึกให้อัตโนมัติเมื่ออ่านรหัสเสร็จ</div>
        <form onSubmit={submitReaderScan} className="row" style={{ marginTop: 10 }}>
          <select aria-label="จุดอ่านบัตร" value={readerDeviceId} onChange={(e) => setReaderDeviceId(e.target.value)} disabled={!readerDevices.length}>
            {!readerDevices.length && <option value="">ยังไม่มีจุดอ่านบัตร</option>}
            {readerDevices.map((device) => <option key={device.id} value={device.id}>{device.name}{device.location ? ` — ${device.location}` : ''}</option>)}
          </select>
          <input ref={scanInputRef} autoFocus value={scanUid} onChange={(e) => setScanUid(e.target.value)} placeholder="คลิกที่นี่ แล้วแตะบัตร..." aria-label="รับรหัสจากเครื่องอ่านบัตร" disabled={!readerDeviceId || scanBusy} />
        </form>
        {readerMessage && <p className="hint" role="status">{readerMessage}</p>}
      </section>

      {data && data.windows.length === 0 && (
        <div className="card empty">
          ยังไม่มีตารางเวลาละหมาดของวันนี้ — ไปที่เมนู "ตารางเวลาละหมาด" เพื่อสร้าง
          (ถ้าตั้งพิกัดโรงเรียนใน .env แล้ว ระบบจะสร้างให้อัตโนมัติ)
        </div>
      )}

      {data && data.windows.length > 0 && (
        <div className="grid" style={{ marginBottom: 16 }}>
          {data.windows.map((w) => {
            const total = data.totalStudents || 1;
            const state = WINDOW_STATE[w.state];
            return (
              <button
                key={w.id}
                className={`card window-card ${selected === w.id ? 'selected' : ''}`}
                onClick={() => setSelected(w.id)}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2>{w.prayerName}</h2>
                  <Badge tone={state.tone}>{state.label}</Badge>
                </div>
                <div className="hint">
                  {fmtShortTime(w.opensAt)} – {fmtShortTime(w.closesAt)} น.
                </div>
                <div className="bar" aria-hidden="true">
                  <i className="present" style={{ width: `${(w.present / total) * 100}%` }} />
                  <i className="late" style={{ width: `${(w.late / total) * 100}%` }} />
                  <i className="excused" style={{ width: `${(w.excused / total) * 100}%` }} />
                  <i className="absent" style={{ width: `${(w.absent / total) * 100}%` }} />
                </div>
                <div className="legend">
                  <span>
                    มา <b>{w.present}</b>
                  </span>
                  <span>
                    สาย <b>{w.late}</b>
                  </span>
                  <span>
                    ลา <b>{w.excused}</b>
                  </span>
                  <span>
                    ขาด <b>{w.absent}</b>
                  </span>
                  <span>
                    ยังไม่แตะ <b>{w.notYet}</b>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="two-col">
        {/* <section className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h2>
              ยังไม่แตะบัตร
              {missing && ` (${missing.count} คน)`}
              {missing?.window && ` · ${PRAYER_NAMES[missing.window.prayer]}`}
            </h2>
          </div>
          {!missing && <div className="empty">เลือกช่วงละหมาดด้านบน</div>}
          {missing && missing.count === 0 && <div className="empty">แตะครบทุกคนแล้ว 🎉</div>}
          {missing && missing.count > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>รหัส</th>
                    <th>ชื่อ</th>
                    <th>ห้อง</th>
                    <th>ลงให้</th>
                  </tr>
                </thead>
                <tbody>
                  {missing.students.map((s) => (
                    <tr key={s.id}>
                      <td>{s.studentCode}</td>
                      <td>{fullName(s)}</td>
                      <td>{s.classroom?.name ?? '-'}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="small" onClick={() => mark(s.id, 'present')}>
                            มา
                          </button>
                          <button className="small" onClick={() => mark(s.id, 'excused')}>
                            ลา
                          </button>
                          <button className="small danger" onClick={() => mark(s.id, 'absent')}>
                            ขาด
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section> */}

        <section className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h2>การแตะล่าสุด</h2>
            <span className="hint">
              <span className={`dot ${live ? 'on' : ''}`} />
              {live ? 'สด' : 'กำลังเชื่อมต่อ...'}
            </span>
          </div>
          {feed.length === 0 && <div className="empty">รอการแตะบัตร...</div>}
          <ul className="feed">
            {feed.map((t) => (
              <li key={`${t.tapLogId}-${t.at}`}>
                <time>{fmtTime(t.tappedAt)}</time>
                <div className="grow">
                  <strong>{t.student ? t.student.name : 'ไม่รู้จักบัตร'}</strong>
                  {t.student?.classroom && <span className="hint"> · {t.student.classroom}</span>}
                  {t.cardUid && <div className="hint">รหัสบัตร {t.cardUid}</div>}
                  <div className="hint">{t.deviceName}</div>
                  {t.hasPhoto && <button className="small" onClick={async () => {
                    try { setPhoto((await api.get(`/api/attendance/tap/${t.tapLogId}/photo`)).image); }
                    catch (e) { setCameraError(e.message); }
                  }}>ดูภาพ</button>}
                </div>
                <Badge tone={t.status === 'late' ? 'warn' : RESULT_TONE[t.result]}>{t.message}</Badge>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {photo && <div className="overlay" onClick={() => setPhoto(null)}><div className="modal" style={{ width: 'min(720px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <button className="small" style={{ float: 'right' }} onClick={() => setPhoto(null)}>ปิด</button>
        <h2>ภาพจากจุดสแกน</h2><img src={photo} alt="ภาพผู้สแกน" style={{ display: 'block', maxWidth: 'min(80vw, 640px)', maxHeight: '70vh', borderRadius: 8 }} />
      </div></div>}
    </>
  );
}
