import { Coordinates, CalculationMethod, Madhab, PrayerTimes } from 'adhan';
import { prisma } from '../db.js';
import { config, hasCoordinates } from '../config.js';
import { HttpError } from '../utils/errors.js';
import {
  addDaysStr,
  dateOnly,
  dateStringInTz,
  weekdayOfStr,
} from '../utils/time.js';

const MINUTE = 60 * 1000;

function buildParams() {
  const params = CalculationMethod[config.prayer.method]();
  params.madhab = config.prayer.madhab === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;
  return params;
}

// คำนวณเวลาละหมาดของวันที่ระบุ (YYYY-MM-DD ตามเวลาท้องถิ่น) -> { fajr, dhuhr, asr, maghrib, isha } เป็น Date
export function computePrayerTimes(dateStr) {
  if (!hasCoordinates()) {
    throw new HttpError(
      400,
      'ยังไม่ได้ตั้งค่าพิกัดโรงเรียน (PRAYER_LATITUDE / PRAYER_LONGITUDE ในไฟล์ .env)',
    );
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  // adhan อ่านปี/เดือน/วัน จากองค์ประกอบ local ของ Date จึงสร้างด้วย new Date(y, m-1, d)
  const coordinates = new Coordinates(config.prayer.latitude, config.prayer.longitude);
  const times = new PrayerTimes(coordinates, new Date(y, m - 1, d), buildParams());
  return {
    fajr: times.fajr,
    dhuhr: times.dhuhr,
    asr: times.asr,
    maghrib: times.maghrib,
    isha: times.isha,
  };
}

// รายการละหมาดที่ต้องสร้างของวันนั้น (วันศุกร์เปลี่ยนซุฮ์รีเป็นญุมุอะฮ์ถ้าเปิดใช้)
function prayersForDate(dateStr) {
  const isFriday = weekdayOfStr(dateStr) === 5;
  return config.prayer.prayers.map((p) => ({
    prayer: p === 'dhuhr' && isFriday && config.prayer.jumuahOnFriday ? 'jumuah' : p,
    timeKey: p,
  }));
}

export function buildWindowData(dateStr, prayer, base) {
  const { openBeforeMin, lateAfterMin, closeAfterMin } = config.prayer;
  const opensAt = new Date(base.getTime() - openBeforeMin * MINUTE);
  const closesAt = new Date(base.getTime() + closeAfterMin * MINUTE);
  const lateRaw = new Date(base.getTime() + lateAfterMin * MINUTE);
  // ต้องเป็นไปตามเงื่อนไข opens_at <= late_at <= closes_at
  const lateAt = lateRaw > closesAt ? closesAt : lateRaw;
  return { prayerDate: dateOnly(dateStr), prayer, opensAt, lateAt, closesAt };
}

// สร้างตารางเวลาของวันเดียว; overwrite=false จะไม่แตะรายการที่มีอยู่ (รักษาค่าที่แอดมินแก้เอง)
export async function generateWindowsForDate(dateStr, { overwrite = false } = {}) {
  const times = computePrayerTimes(dateStr);
  const results = [];
  for (const { prayer, timeKey } of prayersForDate(dateStr)) {
    const data = buildWindowData(dateStr, prayer, times[timeKey]);
    const window = await prisma.prayerWindow.upsert({
      where: { prayerDate_prayer: { prayerDate: data.prayerDate, prayer } },
      create: data,
      update: overwrite
        ? { opensAt: data.opensAt, lateAt: data.lateAt, closesAt: data.closesAt }
        : {},
    });
    results.push(window);
  }
  return results;
}

// หาช่วงละหมาดที่ครอบเวลา t
export function findWindowAt(t) {
  return prisma.prayerWindow.findFirst({
    where: { opensAt: { lte: t }, closesAt: { gte: t } },
    orderBy: { opensAt: 'desc' },
  });
}

// เรียกตอนเริ่มระบบและทุกชั่วโมง ให้มีตารางของวันนี้และพรุ่งนี้เสมอ
export async function ensureUpcomingWindows() {
  if (!config.prayer.autoGenerate || !hasCoordinates()) return;
  const today = dateStringInTz();
  for (const day of [today, addDaysStr(today, 1)]) {
    await generateWindowsForDate(day, { overwrite: false });
  }
}
