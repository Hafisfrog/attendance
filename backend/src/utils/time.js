import { config } from '../config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// วันที่ (YYYY-MM-DD) ตามเขตเวลาของระบบ
export function dateStringInTz(date = new Date(), timeZone = config.timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// วันที่ล้วน (สำหรับคอลัมน์ DATE ใน Postgres) -> เที่ยงคืน UTC ของวันนั้น
export function dateOnly(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export function isValidDateString(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = dateOnly(dateStr);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(dateStr);
}

export function addDaysStr(dateStr, days) {
  return new Date(dateOnly(dateStr).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// 0 = อาทิตย์ ... 5 = ศุกร์ ... 6 = เสาร์
export function weekdayOfStr(dateStr) {
  return dateOnly(dateStr).getUTCDay();
}

export function daysBetween(fromStr, toStr) {
  return Math.round((dateOnly(toStr).getTime() - dateOnly(fromStr).getTime()) / DAY_MS);
}

// "YYYY-MM-DD HH:mm:ss" ตามเขตเวลาของระบบ
export function formatLocal(date, timeZone = config.timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
