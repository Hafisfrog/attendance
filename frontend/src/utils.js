export const TZ = import.meta.env.VITE_TIMEZONE || 'Asia/Bangkok';

export const PRAYER_NAMES = {
  fajr: 'ซุบฮิ',
  dhuhr: 'ซุฮ์รี',
  asr: 'อัศรี',
  maghrib: 'มัฆริบ',
  isha: 'อิชาอ์',
  jumuah: 'ญุมุอะฮ์',
};

export const STATUS_NAMES = { present: 'มา', late: 'สาย', excused: 'ลา', absent: 'ขาด' };

export const WINDOW_STATE = {
  upcoming: { label: 'ยังไม่เริ่ม', tone: 'muted' },
  open: { label: 'เปิดรับแตะ', tone: 'ok' },
  closed: { label: 'ปิดแล้ว', tone: 'muted' },
};

export const RESULT_TONE = {
  recorded: 'ok',
  duplicate: 'warn',
  unknown_card: 'bad',
  card_disabled: 'bad',
  outside_window: 'warn',
};

const dtf = (opts) => new Intl.DateTimeFormat('th-TH', { timeZone: TZ, hourCycle: 'h23', ...opts });

export const fmtTime = (iso) =>
  iso ? dtf({ hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso)) : '-';

export const fmtShortTime = (iso) =>
  iso ? dtf({ hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '-';

export const fmtDateTime = (iso) =>
  iso
    ? dtf({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
        new Date(iso),
      )
    : '-';

// วันที่ล้วน (YYYY-MM-DD) -> ข้อความไทย โดยไม่ให้เขตเวลาทำให้วันเลื่อน
export const fmtDate = (dateStr) =>
  new Intl.DateTimeFormat('th-TH', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`));

export const todayStr = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

export const addDays = (dateStr, days) =>
  new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// ปีการศึกษา/ปี พ.ศ. ปัจจุบัน
export const currentBuddhistYear = () => new Date().getFullYear() + 543;

function tzParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

// ISO -> ค่าสำหรับ <input type="datetime-local"> ตามเขตเวลาของระบบ
export function toLocalInput(iso) {
  if (!iso) return '';
  const p = tzParts(new Date(iso));
  const z = (n) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

// ค่าจาก <input type="datetime-local"> (เวลาท้องถิ่นของระบบ) -> ISO UTC
export function fromLocalInput(value) {
  if (!value) return null;
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  const p = tzParts(new Date(asUtc));
  const offsetMs = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - asUtc;
  return new Date(asUtc - offsetMs).toISOString();
}

export const fullName = (s) => (s ? `${s.firstName} ${s.lastName}` : '');
