import 'dotenv/config';
import { ALLOWED_PRAYERS, CALCULATION_METHODS } from './utils/constants.js';

function num(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`ค่า env ต้องเป็นตัวเลข แต่ได้ "${value}"`);
  return n;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`ต้องตั้งค่า ${name} ในไฟล์ .env`);
  return value;
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร');
}
required('DATABASE_URL');

const prayers = (process.env.PRAYERS ?? 'dhuhr,asr')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
for (const p of prayers) {
  if (!ALLOWED_PRAYERS.includes(p)) {
    throw new Error(`PRAYERS มีค่าที่ไม่รองรับ: "${p}" (ใช้ได้: ${ALLOWED_PRAYERS.join(', ')})`);
  }
}

const method = process.env.PRAYER_METHOD || 'Singapore';
if (!CALCULATION_METHODS.includes(method)) {
  throw new Error(`PRAYER_METHOD ไม่รองรับ: "${method}" (ใช้ได้: ${CALCULATION_METHODS.join(', ')})`);
}

const madhab = (process.env.PRAYER_MADHAB || 'shafi').toLowerCase();
if (!['shafi', 'hanafi'].includes(madhab)) {
  throw new Error('PRAYER_MADHAB ต้องเป็น shafi หรือ hanafi');
}

const latitude = process.env.PRAYER_LATITUDE ? num(process.env.PRAYER_LATITUDE) : null;
const longitude = process.env.PRAYER_LONGITUDE ? num(process.env.PRAYER_LONGITUDE) : null;
if ((latitude === null) !== (longitude === null)) {
  throw new Error('ต้องตั้งทั้ง PRAYER_LATITUDE และ PRAYER_LONGITUDE ให้ครบทั้งคู่');
}
if (latitude !== null && (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)) {
  throw new Error('พิกัดไม่อยู่ในช่วงที่ถูกต้อง');
}

const openBeforeMin = num(process.env.WINDOW_OPEN_BEFORE_MIN, 15);
const lateAfterMin = num(process.env.WINDOW_LATE_AFTER_MIN, 30);
const closeAfterMin = num(process.env.WINDOW_CLOSE_AFTER_MIN, 60);
if (openBeforeMin < 0 || lateAfterMin < 0 || closeAfterMin <= 0) {
  throw new Error('ค่า WINDOW_* ต้องไม่ติดลบ และ WINDOW_CLOSE_AFTER_MIN ต้องมากกว่า 0');
}

export const config = {
  port: num(process.env.PORT, 3000),
  timezone: process.env.APP_TIMEZONE || 'Asia/Bangkok',
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  prayer: {
    latitude,
    longitude,
    method,
    madhab,
    prayers,
    jumuahOnFriday: bool(process.env.JUMUAH_ON_FRIDAY, true),
    openBeforeMin,
    lateAfterMin,
    closeAfterMin,
    autoGenerate: bool(process.env.AUTO_GENERATE_WINDOWS, true),
  },
};

export const hasCoordinates = () =>
  config.prayer.latitude !== null && config.prayer.longitude !== null;
