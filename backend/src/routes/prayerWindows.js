import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { findWindowAt, generateWindowsForDate } from '../services/prayerService.js';
import { ALL_PRAYER_KEYS } from '../utils/constants.js';
import { HttpError } from '../utils/errors.js';
import { addDaysStr, dateOnly, dateStringInTz, daysBetween } from '../utils/time.js';
import { dateString, idParam, parse } from '../utils/validate.js';

const router = Router();
router.use(requireAuth);

const MAX_GENERATE_DAYS = 62;
const prayerEnum = z.enum(ALL_PRAYER_KEYS);

router.get('/', async (req, res) => {
  const q = parse(
    z.object({ date: dateString.optional(), from: dateString.optional(), to: dateString.optional() }),
    req.query,
  );
  const from = q.from ?? q.date ?? dateStringInTz();
  const to = q.to ?? q.date ?? from;
  res.json(
    await prisma.prayerWindow.findMany({
      where: { prayerDate: { gte: dateOnly(from), lte: dateOnly(to) } },
      orderBy: [{ prayerDate: 'asc' }, { opensAt: 'asc' }],
    }),
  );
});

// ช่วงละหมาดที่กำลังเปิดรับแตะอยู่ตอนนี้ (null ถ้าไม่มี)
router.get('/current', async (req, res) => {
  res.json((await findWindowAt(new Date())) ?? null);
});

const generateSchema = z
  .object({
    date: dateString.optional(),
    from: dateString.optional(),
    to: dateString.optional(),
    overwrite: z.boolean().default(false),
  })
  .refine((v) => v.date || (v.from && v.to), 'ระบุ date หรือระบุทั้ง from และ to');

// สร้างตารางเวลาจากพิกัดและวิธีคำนวณใน .env (overwrite=true จะทับค่าที่เคยแก้เอง)
router.post('/generate', requireRole('admin'), async (req, res) => {
  const body = parse(generateSchema, req.body);
  const from = body.date ?? body.from;
  const to = body.date ?? body.to;
  const span = daysBetween(from, to);
  if (span < 0) throw new HttpError(400, 'to ต้องไม่ก่อน from');
  if (span + 1 > MAX_GENERATE_DAYS) {
    throw new HttpError(400, `สร้างได้ครั้งละไม่เกิน ${MAX_GENERATE_DAYS} วัน`);
  }
  const windows = [];
  for (let i = 0; i <= span; i += 1) {
    windows.push(...(await generateWindowsForDate(addDaysStr(from, i), { overwrite: body.overwrite })));
  }
  res.status(201).json({ count: windows.length, windows });
});

const windowSchema = z
  .object({
    prayerDate: dateString,
    prayer: prayerEnum,
    opensAt: z.coerce.date(),
    lateAt: z.coerce.date().nullable().optional(),
    closesAt: z.coerce.date(),
  })
  .superRefine((v, ctx) => {
    if (v.opensAt >= v.closesAt) {
      ctx.addIssue({ code: 'custom', path: ['closesAt'], message: 'closesAt ต้องหลัง opensAt' });
    }
    if (v.lateAt && (v.lateAt < v.opensAt || v.lateAt > v.closesAt)) {
      ctx.addIssue({ code: 'custom', path: ['lateAt'], message: 'lateAt ต้องอยู่ระหว่าง opensAt และ closesAt' });
    }
  });

// เพิ่มช่วงเวลาเอง เช่น ละหมาดพิเศษ / เหตุการณ์เฉพาะวัน (เวลาส่งเป็น ISO 8601 เช่น 2026-10-26T12:10:00+07:00)
router.post('/', requireRole('admin'), async (req, res) => {
  const body = parse(windowSchema, req.body);
  const created = await prisma.prayerWindow.create({
    data: { ...body, prayerDate: dateOnly(body.prayerDate), lateAt: body.lateAt ?? null },
  });
  res.status(201).json(created);
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const id = idParam(req.params.id);
  const body = parse(
    z.object({
      opensAt: z.coerce.date(),
      lateAt: z.coerce.date().nullable().optional(),
      closesAt: z.coerce.date(),
    }),
    req.body,
  );
  if (body.opensAt >= body.closesAt) throw new HttpError(400, 'closesAt ต้องหลัง opensAt');
  if (body.lateAt && (body.lateAt < body.opensAt || body.lateAt > body.closesAt)) {
    throw new HttpError(400, 'lateAt ต้องอยู่ระหว่าง opensAt และ closesAt');
  }
  res.json(
    await prisma.prayerWindow.update({
      where: { id },
      data: { opensAt: body.opensAt, closesAt: body.closesAt, lateAt: body.lateAt ?? null },
    }),
  );
});

// การลบช่วงเวลาจะลบข้อมูลลงเวลาของช่วงนั้นทั้งหมดด้วย จึงต้องยืนยันด้วย ?force=true ถ้ามีข้อมูลอยู่
router.delete('/:id', requireRole('admin'), async (req, res) => {
  const id = idParam(req.params.id);
  const records = await prisma.attendance.count({ where: { prayerWindowId: id } });
  if (records > 0 && req.query.force !== 'true') {
    throw new HttpError(
      409,
      `ช่วงนี้มีข้อมูลลงเวลา ${records} รายการ การลบจะลบข้อมูลเหล่านั้นด้วย (ยืนยันโดยเพิ่ม ?force=true)`,
    );
  }
  await prisma.prayerWindow.delete({ where: { id } });
  res.status(204).end();
});

export default router;
