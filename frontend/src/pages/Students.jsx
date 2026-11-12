import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useDebounced } from '../hooks.js';
import {
  Alert,
  Badge,
  ClassroomSelect,
  Field,
  Modal,
  PageHead,
  useClassrooms,
} from '../components/ui.jsx';
import { fullName } from '../utils.js';

const PAGE_SIZE = 50;

function parseDelimited(text) {
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(value.trim()); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; value = '';
    } else value += char;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function readXlsx(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const entries = new Map();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('อ่านไฟล์ Excel ไม่ได้ กรุณาใช้ไฟล์ .xlsx');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  async function entryText(name) {
    const entry = entries.get(name);
    if (!entry) return '';
    const local = entry.offset;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const compressed = bytes.slice(start, start + entry.size);
    if (entry.method === 0) return decoder.decode(compressed);
    if (entry.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('เบราว์เซอร์นี้ไม่รองรับการอ่านไฟล์ Excel');
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return decoder.decode(await new Response(stream).arrayBuffer());
  }
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    entries.set(name, { method, size, offset: view.getUint32(offset + 42, true) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  const xml = (value) => new DOMParser().parseFromString(value, 'application/xml');
  const workbook = xml(await entryText('xl/workbook.xml'));
  const sheet = [...workbook.getElementsByTagName('*')].find((node) => node.localName === 'sheet');
  if (!sheet) throw new Error('ไม่พบชีตในไฟล์ Excel');
  const relId = sheet.getAttribute('r:id');
  const relationships = xml(await entryText('xl/_rels/workbook.xml.rels'));
  const relation = [...relationships.getElementsByTagName('*')].find((node) => node.getAttribute('Id') === relId);
  const target = relation?.getAttribute('Target') || 'worksheets/sheet1.xml';
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sharedXml = xml(await entryText('xl/sharedStrings.xml'));
  const shared = [...sharedXml.getElementsByTagName('*')].filter((node) => node.localName === 'si')
    .map((item) => [...item.getElementsByTagName('*')].filter((node) => node.localName === 't').map((node) => node.textContent).join(''));
  const sheetXml = xml(await entryText(path));
  const sheetRows = [...sheetXml.getElementsByTagName('*')].filter((node) => node.localName === 'row');
  const columnIndex = (ref) => [...ref.match(/[A-Z]+/i)[0].toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return sheetRows.map((sheetRow) => {
    const values = [];
    for (const cell of [...sheetRow.children].filter((node) => node.localName === 'c')) {
      const index = columnIndex(cell.getAttribute('r'));
      const type = cell.getAttribute('t');
      const raw = [...cell.children].find((node) => node.localName === 'v')?.textContent ?? '';
      const inline = [...cell.children].find((node) => node.localName === 'is');
      values[index] = type === 's' ? (shared[Number(raw)] ?? '') : type === 'inlineStr'
        ? [...(inline?.getElementsByTagName('*') ?? [])].filter((node) => node.localName === 't').map((node) => node.textContent).join('')
        : raw;
    }
    return values.map((v) => v ?? '');
  }).filter((row) => row.some((value) => String(value).trim()));
}

function rowsToStudents(rows) {
  if (!rows.length) throw new Error('ไม่พบรายชื่อในไฟล์');
  const aliases = {
    code: ['รหัส', 'รหัสนักเรียน', 'studentcode', 'studentid', 'code'],
    first: ['ชื่อ', 'ชื่อจริง', 'firstname', 'first'],
    last: ['นามสกุล', 'lastname', 'surname', 'last'],
    gender: ['เพศ', 'gender', 'sex'],
  };
  const normalize = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s_\-]/g, '');
  const header = rows[0].map(normalize);
  const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, header.findIndex((v) => names.includes(v))]));
  const hasHeader = columns.code >= 0 && columns.first >= 0 && columns.last >= 0;
  const indexes = hasHeader ? columns : { code: 0, first: 1, last: 2, gender: 3 };
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const students = dataRows.map((row, i) => {
    const studentCode = String(row[indexes.code] ?? '').trim();
    const firstName = String(row[indexes.first] ?? '').trim();
    const lastName = String(row[indexes.last] ?? '').trim();
    if (!studentCode && !firstName && !lastName) return null;
    if (!studentCode || !firstName || !lastName) throw new Error(`แถวข้อมูลที่ ${i + 1 + Number(hasHeader)} ต้องมีรหัส ชื่อ และนามสกุล`);
    const rawGender = String(row[indexes.gender] ?? '').trim().toUpperCase();
    const gender = ['M', 'MALE', 'ชาย'].includes(rawGender) ? 'M' : ['F', 'FEMALE', 'หญิง'].includes(rawGender) ? 'F' : null;
    return { studentCode, firstName, lastName, gender };
  }).filter(Boolean);
  if (students.length > 2000) throw new Error('นำเข้าได้ครั้งละไม่เกิน 2,000 รายชื่อ');
  return students;
}

function StudentForm({ student, rooms, onClose, onSaved }) {
  const [form, setForm] = useState({
    studentCode: student?.studentCode ?? '',
    firstName: student?.firstName ?? '',
    lastName: student?.lastName ?? '',
    gender: student?.gender ?? '',           
    classroomId: student?.classroomId ?? '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setError('');
    const body = {
      studentCode: form.studentCode.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      gender: form.gender || null,
      classroomId: form.classroomId ? Number(form.classroomId) : null,
    };
    try {
      if (student) await api.put(`/api/students/${student.id}`, body);
      else await api.post('/api/students', body);
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={student ? 'แก้ไขนักเรียน' : 'เพิ่มนักเรียน'}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>ยกเลิก</button>
          <button className="primary" onClick={save} disabled={busy}>
            บันทึก
          </button>
        </>
      }
    >
      <Alert>{error}</Alert>
      <Field label="รหัสนักเรียน">
        <input value={form.studentCode} onChange={set('studentCode')} />
      </Field>
      <Field label="ชื่อ">
        <input value={form.firstName} onChange={set('firstName')} />
      </Field>
      <Field label="นามสกุล">
        <input value={form.lastName} onChange={set('lastName')} />
      </Field>
      <Field label="เพศ">
        <select value={form.gender} onChange={set('gender')}>
          <option value="">ไม่ระบุ</option>
          <option value="M">ชาย</option>
          <option value="F">หญิง</option>
        </select>
      </Field>
      <Field label="ห้องเรียน">
        <ClassroomSelect
          rooms={rooms}
          value={form.classroomId}
          onChange={(v) => setForm({ ...form, classroomId: v })}
          allLabel="ไม่ระบุ"
        />
      </Field>
    </Modal>
  );
}

// วางข้อมูลจาก Excel/CSV: รหัส,ชื่อ,นามสกุล,เพศ(M/F ไม่บังคับ)  — คั่นด้วยจุลภาคหรือแท็บ
function ImportModal({ rooms, onClose, onDone }) {
  const [text, setText] = useState('');
  const [fileRows, setFileRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [classroomId, setClassroomId] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function chooseFile(file) {
    if (!file) return;
    setError('');
    try {
      const rows = file.name.toLowerCase().endsWith('.xlsx')
        ? await readXlsx(file)
        : parseDelimited(await file.text());
      const students = rowsToStudents(rows);
      if (!students.length) throw new Error('ไม่พบรายชื่อในไฟล์');
      setFileRows(students);
      setFileName(file.name);
      setText('');
    } catch (e) {
      setFileRows(null);
      setFileName('');
      setError(e.message || 'อ่านไฟล์ไม่สำเร็จ');
    }
  }

  function parseLines() {
    if (fileRows) return fileRows.map((student) => ({ ...student, classroomId: classroomId ? Number(classroomId) : null }));
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line, i) => {
        const [studentCode, firstName, lastName, gender] = line.split(/[,\t]/).map((s) => s.trim());
        if (!studentCode || !firstName || !lastName) {
          throw new Error(`บรรทัดที่ ${i + 1} ข้อมูลไม่ครบ (ต้องมี รหัส, ชื่อ, นามสกุล)`);
        }
        const g = gender?.toUpperCase();
        return {
          studentCode,
          firstName,
          lastName,
          gender: g === 'M' || g === 'F' ? g : null,
          classroomId: classroomId ? Number(classroomId) : null,
        };
      });
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const students = parseLines();
      if (students.length === 0) throw new Error('ยังไม่ได้วางข้อมูล');
      setResult(await api.post('/api/students/bulk', { students }));
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  return (
    <Modal
      title="นำเข้านักเรียนหลายคน"
      onClose={result ? onDone : onClose}
      actions={
        result ? (
          <button className="primary" onClick={onDone}>
            เสร็จสิ้น
          </button>
        ) : (
          <>
            <button onClick={onClose}>ยกเลิก</button>
            <button className="primary" onClick={submit} disabled={busy}>
              นำเข้า
            </button>
          </>
        )
      }
    >
      <Alert>{error}</Alert>
      {!result && (
        <Field label="เลือกไฟล์ Excel (.xlsx) หรือ CSV (.csv)">
          <input type="file" accept=".xlsx,.csv,text/csv" onChange={(e) => chooseFile(e.target.files?.[0])} />
          {fileRows && <p className="hint">{fileName}: อ่านได้ {fileRows.length} รายชื่อแล้ว</p>}
          <p className="hint">ใช้คอลัมน์ รหัสนักเรียน, ชื่อ, นามสกุล และเพศ (M/F ไม่บังคับ) เรียงตามลำดับนี้ รหัสที่มีเลขศูนย์นำหน้าควรกำหนดเป็นข้อความใน Excel</p>
          {fileRows && <ul className="hint">{fileRows.slice(0, 3).map((student) => <li key={student.studentCode}>{student.studentCode} — {student.firstName} {student.lastName}</li>)}</ul>}
        </Field>
      )}
      {result ? (
        <Alert tone="ok">
          เพิ่มใหม่ {result.created} คน · ข้าม {result.skipped} คน (รหัสซ้ำกับที่มีอยู่)
        </Alert>
      ) : (
        <>
          <Field label="ห้องเรียนของทุกคนในชุดนี้">
            <ClassroomSelect rooms={rooms} value={classroomId} onChange={setClassroomId} allLabel="ไม่ระบุ" />
          </Field>
          <Field label="วางข้อมูล 1 บรรทัดต่อ 1 คน: รหัส, ชื่อ, นามสกุล, เพศ (M/F ไม่บังคับ)">
            <textarea
              rows={8}
              value={text}
              onChange={(e) => { setText(e.target.value); setFileRows(null); setFileName(''); }}
              placeholder={'S001, อาลี, สมใจ, M\nS002, ฟาติมะฮ์, ใจดี, F'}
            />
          </Field>
        </>
      )}
    </Modal>
  );
}

function CardModal({ student, onClose, onSaved }) {
  const [uid, setUid] = useState('');
  const [error, setError] = useState('');

  async function link() {
    try {
      await api.post('/api/cards', { uid, studentId: student.id });
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  }
  async function setStatus(card, status) {
    try {
      await api.put(`/api/cards/${card.id}`, { status });
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  }
  async function unlink(card) {
    if (!window.confirm(`ยกเลิกการผูกบัตร ${card.uid} จาก ${fullName(student)}?`)) return;
    try {
      await api.put(`/api/cards/${card.id}`, { studentId: null });
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Modal title={`บัตรของ ${fullName(student)}`} onClose={onClose} actions={<button onClick={onClose}>ปิด</button>}>
      <Alert>{error}</Alert>
      {student.cards.length === 0 && <p className="hint">ยังไม่มีบัตร</p>}
      {student.cards.map((c) => (
        <div key={c.id} className="row" style={{ marginBottom: 8 }}>
          <code>{c.uid}</code>
          <Badge tone={c.status === 'active' ? 'ok' : 'bad'}>
            {{ active: 'ใช้งาน', lost: 'หาย', disabled: 'ระงับ' }[c.status]}
          </Badge>
          <span className="grow" />
          {c.status === 'active' ? (
            <button className="small danger" onClick={() => setStatus(c, 'lost')}>
              แจ้งหาย
            </button>
          ) : (
            <button className="small" onClick={() => setStatus(c, 'active')}>
              เปิดใช้งาน
            </button>
          )}
          <button className="small" onClick={() => unlink(c)}>
            ยกเลิกผูก
          </button>
        </div>
      ))}
      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '14px 0' }} />
      <Field label="ผูกบัตรใหม่ (พิมพ์รหัสบัตร หรือใช้เมนู “ลงทะเบียนบัตร” เพื่อแตะแล้วเลือก)">
        <input value={uid} onChange={(e) => setUid(e.target.value)} placeholder="เช่น 04A1B2C3" />
      </Field>
      <button className="primary" onClick={link} disabled={!uid.trim()}>
        ผูกบัตร
      </button>
    </Modal>
  );
}

export default function Students() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [classroomId, setClassroomId] = useState('');
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0 });
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { type, student }
  const { rooms } = useClassrooms();

  const load = useCallback(async () => {
    try {
      setData(await api.get('/api/students', { q: dq, classroomId, active, page, pageSize: PAGE_SIZE }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [dq, classroomId, active, page]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [dq, classroomId, active]);

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const close = () => setModal(null);
  const saved = () => {
    close();
    load();
  };

  async function toggleActive(s) {
    try {
      if (s.isActive) {
        if (!window.confirm(`ปิดการใช้งาน ${fullName(s)}? (ประวัติยังอยู่ และเปิดกลับได้)`)) return;
        await api.del(`/api/students/${s.id}`);
      } else {
        await api.put(`/api/students/${s.id}`, { isActive: true });
      }
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <PageHead title="นักเรียน" subtitle={`ทั้งหมด ${data.total} คน`}>
        <button onClick={() => setModal({ type: 'import' })}>นำเข้าหลายคน</button>
        <button className="primary" onClick={() => setModal({ type: 'form' })}>
          + เพิ่มนักเรียน
        </button>
      </PageHead>

      <div className="row" style={{ marginBottom: 14 }}>
        <input
          className="grow"
          placeholder="ค้นหาชื่อหรือรหัสนักเรียน"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ClassroomSelect rooms={rooms} value={classroomId} onChange={setClassroomId} />
        <select value={active} onChange={(e) => setActive(e.target.value)} aria-label="สถานะ">
          <option value="true">ที่ใช้งานอยู่</option>
          <option value="false">ที่ปิดการใช้งาน</option>
          <option value="all">ทั้งหมด</option>
        </select>
      </div>

      <Alert>{error}</Alert>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>รหัส</th>
                <th>ชื่อ-นามสกุล</th>
                <th>ห้อง</th>
                <th>บัตร</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} style={s.isActive ? undefined : { opacity: 0.55 }}>
                  <td>{s.studentCode}</td>
                  <td>{fullName(s)}</td>
                  <td>{s.classroom?.name ?? '-'}</td>
                  <td>
                    {s.cards.length === 0 ? (
                      <Badge tone="warn">ยังไม่มีบัตร</Badge>
                    ) : (
                      s.cards.map((c) => (
                        <Badge key={c.id} tone={c.status === 'active' ? 'ok' : 'bad'}>
                          {c.uid}
                        </Badge>
                      ))
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button className="small" onClick={() => setModal({ type: 'card', student: s })}>
                        บัตร
                      </button>
                      <button className="small" onClick={() => setModal({ type: 'form', student: s })}>
                        แก้ไข
                      </button>
                      <button className="small" onClick={() => toggleActive(s)}>
                        {s.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.items.length === 0 && <div className="empty">ไม่พบนักเรียน</div>}
        </div>
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ก่อนหน้า
          </button>
          <span className="hint">
            หน้า {page} / {pages}
          </span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
            ถัดไป
          </button>
        </div>
      </div>

      {modal?.type === 'form' && (
        <StudentForm student={modal.student} rooms={rooms} onClose={close} onSaved={saved} />
      )}
      {modal?.type === 'import' && <ImportModal rooms={rooms} onClose={close} onDone={saved} />}
      {modal?.type === 'card' && (
        <CardModal
          student={data.items.find((s) => s.id === modal.student.id) ?? modal.student}
          onClose={close}
          onSaved={load}
        />
      )}
    </>
  );
}
