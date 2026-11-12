import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, Badge, Field, Modal, PageHead } from '../components/ui.jsx';
import { fmtDateTime } from '../utils.js';

function KeyModal({ apiKey, onClose }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      /* คัดลอกเองจากกล่องข้อความได้ */
    }
  }
  return (
    <Modal
      title="API key ของอุปกรณ์"
      onClose={onClose}
      actions={
        <>
          <button onClick={copy}>{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</button>
          <button className="primary" onClick={onClose}>
            ฉันเก็บไว้แล้ว
          </button>
        </>
      }
    >
      <Alert tone="warn">คีย์นี้จะแสดงครั้งเดียวเท่านั้น หากทำหาย ต้องออกคีย์ใหม่ (คีย์เดิมจะใช้ไม่ได้)</Alert>
      <div className="secret">{apiKey}</div>
      <p className="hint">นำไปใส่ในโค้ด ESP32 ที่ตัวแปร API_KEY</p>
    </Modal>
  );
}

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [shownKey, setShownKey] = useState(null);

  const load = useCallback(async () => {
    try {
      setDevices(await api.get('/api/devices'));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  async function create() {
    try {
      const r = await api.post('/api/devices', { name: name.trim(), location: location.trim() || null });
      setAdding(false);
      setName('');
      setLocation('');
      setShownKey(r.apiKey);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function rotate(d) {
    if (!window.confirm(`ออกคีย์ใหม่ให้ "${d.name}"? คีย์เดิมจะใช้ไม่ได้ทันที ต้องอัปเดตในเครื่องด้วย`)) return;
    try {
      setShownKey((await api.post(`/api/devices/${d.id}/rotate-key`)).apiKey);
    } catch (e) {
      setError(e.message);
    }
  }

  async function setActive(d, isActive) {
    try {
      await api.put(`/api/devices/${d.id}`, { isActive });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <PageHead title="อุปกรณ์แตะบัตร" subtitle="จุดแตะบัตรแต่ละจุด (ESP32) มี API key ของตัวเอง">
        <button className="primary" onClick={() => setAdding(true)}>
          + เพิ่มอุปกรณ์
        </button>
      </PageHead>
      <Alert>{error}</Alert>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th>ตำแหน่ง</th>
                <th>สถานะ</th>
                <th>เห็นล่าสุด</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} style={d.isActive ? undefined : { opacity: 0.55 }}>
                  <td>
                    #{d.id} {d.name}
                  </td>
                  <td>{d.location || '-'}</td>
                  <td>
                    {!d.isActive ? (
                      <Badge tone="muted">ปิดใช้งาน</Badge>
                    ) : d.online ? (
                      <Badge tone="ok">ออนไลน์</Badge>
                    ) : (
                      <Badge tone="warn">ออฟไลน์</Badge>
                    )}
                  </td>
                  <td>{fmtDateTime(d.lastSeenAt)}</td>
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button className="small" onClick={() => rotate(d)}>
                        ออกคีย์ใหม่
                      </button>
                      <button className="small" onClick={() => setActive(d, !d.isActive)}>
                        {d.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {devices.length === 0 && <div className="empty">ยังไม่มีอุปกรณ์</div>}
        </div>
      </div>

      {adding && (
        <Modal
          title="เพิ่มอุปกรณ์"
          onClose={() => setAdding(false)}
          actions={
            <>
              <button onClick={() => setAdding(false)}>ยกเลิก</button>
              <button className="primary" disabled={!name.trim()} onClick={create}>
                สร้างและรับคีย์
              </button>
            </>
          }
        >
          <Field label="ชื่อจุดแตะ (เช่น มัสยิดโรงเรียน)">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="ตำแหน่ง (ไม่บังคับ)">
            <input value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </Modal>
      )}
      {shownKey && <KeyModal apiKey={shownKey} onClose={() => setShownKey(null)} />}
    </>
  );
}
