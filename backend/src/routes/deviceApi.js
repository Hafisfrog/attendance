import { Router } from 'express';
import { z } from 'zod';
import { requireDevice } from '../middleware/deviceAuth.js';
import { normalizeUid, processTap } from '../services/tapService.js';
import { RESULT_MESSAGES_TH } from '../utils/constants.js';
import { parse } from '../utils/validate.js';

// เส้นทางสำหรับอุปกรณ์ ESP32 (ยืนยันตัวตนด้วย x-api-key)
const router = Router();
router.use(requireDevice);

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const MIN_VALID_TIME = Date.parse('2024-01-01T00:00:00Z'); // เวลาก่อนหน้านี้ = RTC ของอุปกรณ์ยังไม่ได้ตั้ง

// แปลงเวลาที่อุปกรณ์ส่งมา (ISO string / epoch วินาที / epoch มิลลิวินาที)
// เวลาที่ผิดปกติ (อนาคตเกิน 5 นาที, ก่อนปี 2024, แปลงไม่ได้) จะใช้เวลาของเซิร์ฟเวอร์แทนและแจ้ง timeAdjusted
export function resolveTappedAt(input, now = new Date()) {
  if (input === undefined || input === null || input === '') return { date: now, adjusted: false };

  let date;
  if (typeof input === 'number' || /^\d+$/.test(String(input))) {
    const n = Number(input);
    date = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    date = new Date(input);
  }

  const t = date.getTime();
  if (Number.isNaN(t) || t < MIN_VALID_TIME || t > now.getTime() + FUTURE_TOLERANCE_MS) {
    return { date: now, adjusted: true };
  }
  return { date, adjusted: false };
}

const timeField = z.union([z.string(), z.number()]).optional();
const tapSchema = z.object({ cardUid: z.string().min(1).max(64), tappedAt: timeField });
const batchSchema = z.object({ taps: z.array(z.unknown()).min(1).max(200) });

// อุปกรณ์เช็กการเชื่อมต่อและขอเวลาจากเซิร์ฟเวอร์ (ใช้ตั้ง RTC)
router.get('/ping', (req, res) => {
  const now = new Date();
  res.json({
    ok: true,
    device: req.device,
    serverTime: now.toISOString(),
    epoch: Math.floor(now.getTime() / 1000),
  });
});

// แตะบัตร 1 ครั้ง
router.post('/taps', async (req, res) => {
  const body = parse(tapSchema, req.body);
  const { date, adjusted } = resolveTappedAt(body.tappedAt);
  const outcome = await processTap({ device: req.device, cardUid: body.cardUid, tappedAt: date });
  res.json({ handled: true, timeAdjusted: adjusted, ...outcome });
});

// ส่งย้อนหลังเป็นชุด (กรณีอุปกรณ์ออฟไลน์) -- แต่ละรายการมี handled=true เมื่อเซิร์ฟเวอร์ประมวลผลแล้ว
// (รวมผลเช่น unknown_card/duplicate) อุปกรณ์ลบรายการที่ handled แล้วออกจากคิวได้
// ถ้าเซิร์ฟเวอร์ตอบ error (5xx) ให้เก็บไว้ส่งใหม่ รายการที่ส่งซ้ำจะได้ผล duplicate ไม่ทำให้ข้อมูลซ้ำ
router.post('/taps/batch', async (req, res) => {
  const { taps } = parse(batchSchema, req.body);
  const results = [];

  for (let index = 0; index < taps.length; index += 1) {
    const parsed = tapSchema.safeParse(taps[index]);
    if (!parsed.success || !normalizeUid(parsed.data.cardUid)) {
      results.push({
        index,
        handled: true,
        ok: false,
        result: 'invalid',
        message: RESULT_MESSAGES_TH.invalid,
      });
      continue;
    }
    const { date, adjusted } = resolveTappedAt(parsed.data.tappedAt);
    const outcome = await processTap({
      device: req.device,
      cardUid: parsed.data.cardUid,
      tappedAt: date,
    });
    results.push({ index, handled: true, timeAdjusted: adjusted, ...outcome });
  }

  res.json({ count: results.length, results });
});

export default router;
