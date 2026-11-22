import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { findWindowAt } from '../services/prayerService.js';
import { processTap } from '../services/tapService.js';
import {
  ALL_PRAYER_KEYS,
  ATTENDANCE_STATUSES,
  PRAYER_NAMES_TH,
  RESULT_MESSAGES_TH,
  STATUS_NAMES_TH,
} from '../utils/constants.js';
import { HttpError } from '../utils/errors.js';
import { addDaysStr, dateOnly, dateStringInTz, formatLocal } from '../utils/time.js';
import { dateString, idParam, parse, positiveInt } from '../utils/validate.js';

const router = Router();
router.use(requireAuth);

const prayerEnum = z.enum(ALL_PRAYER_KEYS);
const statusEnum = z.enum(ATTENDANCE_STATUSES);

const facePhotoSchema = z.object({
  image: z.string().regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/).max(700_000),
});

router.get('/reader-devices', async (req, res) => {
  res.json(await prisma.device.findMany({
    where: { isActive: true },
    select: { id: true, name: true, location: true },
    orderBy: { id: 'asc' },
  }));
});

router.get('/recent-taps', async (req, res) => {
  const taps = await prisma.tapLog.findMany({
    take: 1,
    orderBy: [{ tappedAt: 'desc' }, { id: 'desc' }],
    include: {
      student: { select: { firstName: true, lastName: true, classroom: { select: { name: true } } } },
      device: { select: { name: true } },
      attendance: { select: { status: true } },
    },
  });
  const photoRows = await prisma.attendance.findMany({
    where: { tapLogId: { in: taps.map((tap) => tap.id) }, facePhoto: { not: null } },
    select: { tapLogId: true },
  });
  const photoTapIds = new Set(photoRows.map((row) => String(row.tapLogId)));

  res.json(taps.map((tap) => {
    const attendance = tap.attendance[0];
    return {
      tapLogId: String(tap.id),
      tappedAt: tap.tappedAt.toISOString(),
      result: tap.result,
      status: attendance?.status ?? null,
      message: tap.result === 'recorded' && attendance?.status === 'late'
        ? RESULT_MESSAGES_TH.late
        : RESULT_MESSAGES_TH[tap.result] ?? tap.result,
      student: tap.student ? {
        name: `${tap.student.firstName} ${tap.student.lastName}`,
        classroom: tap.student.classroom?.name ?? null,
      } : null,
      cardUid: tap.result === 'unknown_card' ? tap.cardUid : undefined,
      deviceName: tap.device.name,
      hasPhoto: photoTapIds.has(String(tap.id)),
    };
  }));
});

router.post('/reader-scan', async (req, res) => {
  const body = parse(z.object({
    cardUid: z.string().trim().min(1).max(64),
    deviceId: positiveInt,
  }), req.body);
  const device = await prisma.device.findFirst({ where: { id: body.deviceId, isActive: true } });
  if (!device) throw new HttpError(404, 'ไม่พบเครื่องอ่านบัตรที่เปิดใช้งาน');
  res.json(await processTap({ device, cardUid: body.cardUid, tappedAt: new Date() }));
});

router.post('/tap/:tapLogId/photo', async (req, res) => {
  const tapLogId = BigInt(idParam(req.params.tapLogId));
  const { image } = parse(facePhotoSchema, req.body);
  const attendance = await prisma.attendance.findFirst({
    where: { tapLogId },
    select: { id: true },
  });
  if (!attendance) throw new HttpError(404, 'ไม่พบรายการเช็คชื่อสำหรับภาพนี้');
  await prisma.attendance.update({ where: { id: attendance.id }, data: { facePhoto: image } });
  res.status(204).end();
});

router.get('/tap/:tapLogId/photo', async (req, res) => {
  const tapLogId = BigInt(idParam(req.params.tapLogId));
  const attendance = await prisma.attendance.findFirst({
    where: { tapLogId },
    select: { facePhoto: true },
  });
  if (!attendance?.facePhoto) throw new HttpError(404, 'รายการนี้ยังไม่มีภาพ');
  res.json({ image: attendance.facePhoto });
});

const studentSelect = {
  id: true,
  studentCode: true,
  firstName: true,
  lastName: true,
  classroom: { select: { id: true, name: true } },
};

// เงื่อนไขเลือกช่วงละหมาด: ระบุ windowId ตรง ๆ หรือระบุวันที่ (+ ละหมาด)
function windowFilter({ windowId, date, prayer }) {
  if (windowId) return { id: windowId };
  return { prayerDate: dateOnly(date ?? dateStringInTz()), ...(prayer && { prayer }) };
}

const listQuery = z.object({
  date: dateString.optional(),
  prayer: prayerEnum.optional(),
  windowId: positiveInt.optional(),
  classroomId: positiveInt.optional(),
  studentId: positiveInt.optional(),
  status: statusEnum.optional(),
});

// รายการลงเวลา (ค่าเริ่มต้น: ของวันนี้)
router.get('/', async (req, res) => {
  const q = parse(listQuery, req.query);
  res.json(
    await prisma.attendance.findMany({
      omit: { facePhoto: true },
      where: {
        prayerWindow: windowFilter(q),
        ...(q.status && { status: q.status }),
        ...((q.classroomId || q.studentId) && {
          student: {
            ...(q.classroomId && { classroomId: q.classroomId }),
            ...(q.studentId && { id: q.studentId }),
          },
        }),
      },
      include: {
        student: { select: studentSelect },
        prayerWindow: { select: { id: true, prayerDate: true, prayer: true } },
        device: { select: { id: true, name: true } },
      },
      orderBy: { tappedAt: 'desc' },
      take: 2000,
    }),
  );
});

async function resolveWindow(q) {
  let window = null;
  if (q.windowId) {
    window = await prisma.prayerWindow.findUnique({ where: { id: q.windowId } });
  } else if (q.prayer) {
    window = await prisma.prayerWindow.findFirst({ where: windowFilter(q) });
  } else {
    // ไม่ระบุ -> ช่วงที่เปิดอยู่ตอนนี้ ถ้าไม่มีใช้ช่วงล่าสุดที่เริ่มแล้วของวันนี้
    window =
      (await findWindowAt(new Date())) ??
      (await prisma.prayerWindow.findFirst({
        where: { prayerDate: dateOnly(q.date ?? dateStringInTz()), opensAt: { lte: new Date() } },
        orderBy: { opensAt: 'desc' },
      }));
  }
  if (!window) throw new HttpError(404, 'ไม่พบช่วงละหมาดที่ระบุ');
  return window;
}

// นักเรียนที่ "ยังไม่มีข้อมูลลงเวลา" ในช่วงละหมาดหนึ่ง
router.get('/missing', async (req, res) => {
  const q = parse(listQuery, req.query);
  const window = await resolveWindow(q);
  const students = await prisma.student.findMany({
    where: {
      isActive: true,
      ...(q.classroomId && { classroomId: q.classroomId }),
      attendance: { none: { prayerWindowId: window.id } },
    },
    select: studentSelect,
    orderBy: [{ classroomId: 'asc' }, { studentCode: 'asc' }],
  });
  res.json({ window, count: students.length, students });
});

// สรุปรายช่วงละหมาดของวันหนึ่ง สำหรับแดชบอร์ด
router.get('/dashboard', async (req, res) => {
  const q = parse(z.object({ date: dateString.optional(), classroomId: positiveInt.optional() }), req.query);
  const date = q.date ?? dateStringInTz();

  const windows = await prisma.prayerWindow.findMany({
    where: { prayerDate: dateOnly(date) },
    orderBy: { opensAt: 'asc' },
  });
  const studentWhere = { isActive: true, ...(q.classroomId && { classroomId: q.classroomId }) };
  const totalStudents = await prisma.student.count({ where: studentWhere });

  const grouped = await prisma.attendance.groupBy({
    by: ['prayerWindowId', 'status'],
    where: { prayerWindow: { prayerDate: dateOnly(date) }, student: studentWhere },
    _count: { _all: true },
  });

  const now = new Date();
  res.json({
    date,
    totalStudents,
    windows: windows.map((w) => {
      const counts = { present: 0, late: 0, excused: 0, absent: 0 };
      for (const g of grouped) {
        if (g.prayerWindowId === w.id) counts[g.status] = g._count._all;
      }
      const recorded = counts.present + counts.late + counts.excused + counts.absent;
      return {
        ...w,
        prayerName: PRAYER_NAMES_TH[w.prayer],
        state: now < w.opensAt ? 'upcoming' : now <= w.closesAt ? 'open' : 'closed',
        ...counts,
        notYet: Math.max(totalStudents - recorded, 0),
      };
    }),
  });
});

const rangeQuery = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  classroomId: positiveInt.optional(),
});

function resolveRange(q) {
  const to = q.to ?? dateStringInTz();
  const from = q.from ?? addDaysStr(to, -6);
  if (from > to) throw new HttpError(400, 'from ต้องไม่หลัง to');
  return { from, to };
}

// สรุปรายคนในช่วงวันที่ (นับเฉพาะช่วงละหมาดที่ปิดรับแล้ว)
router.get('/summary', async (req, res) => {
  const q = parse(rangeQuery, req.query);
  const { from, to } = resolveRange(q);
  const windowWhere = {
    prayerDate: { gte: dateOnly(from), lte: dateOnly(to) },
    closesAt: { lte: new Date() },
  };
  const studentWhere = { isActive: true, ...(q.classroomId && { classroomId: q.classroomId }) };

  const [totalWindows, students, grouped] = await Promise.all([
    prisma.prayerWindow.count({ where: windowWhere }),
    prisma.student.findMany({
      where: studentWhere,
      select: studentSelect,
      orderBy: [{ classroomId: 'asc' }, { studentCode: 'asc' }],
    }),
    prisma.attendance.groupBy({
      by: ['studentId', 'status'],
      where: { prayerWindow: windowWhere, student: studentWhere },
      _count: { _all: true },
    }),
  ]);

  const byStudent = new Map();
  for (const g of grouped) {
    const row = byStudent.get(g.studentId) ?? { present: 0, late: 0, excused: 0, absent: 0 };
    row[g.status] = g._count._all;
    byStudent.set(g.studentId, row);
  }

  const rows = students.map((s) => {
    const c = byStudent.get(s.id) ?? { present: 0, late: 0, excused: 0, absent: 0 };
    const recorded = c.present + c.late + c.excused + c.absent;
    return {
      student: s,
      ...c,
      // ไม่มีข้อมูลเลยในช่วงละหมาดที่ปิดแล้ว = ขาด (ไม่ได้แตะและครูไม่ได้ลงให้)
      missed: Math.max(totalWindows - recorded, 0),
    };
  });

  res.json({ from, to, totalWindows, rows });
});

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  // กัน CSV/Formula injection เมื่อเปิดด้วย Excel: ค่าที่ขึ้นต้นด้วยอักขระพิเศษให้นำหน้าด้วย '
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// ส่งออก CSV (มี BOM เพื่อให้ Excel อ่านภาษาไทยได้ถูกต้อง)
router.get('/export.csv', async (req, res) => {
  const q = parse(rangeQuery, req.query);
  const { from, to } = resolveRange(q);
  const rows = await prisma.attendance.findMany({
    omit: { facePhoto: true },
    where: {
      prayerWindow: { prayerDate: { gte: dateOnly(from), lte: dateOnly(to) } },
      ...(q.classroomId && { student: { classroomId: q.classroomId } }),
    },
    include: {
      student: { select: studentSelect },
      prayerWindow: { select: { prayerDate: true, prayer: true } },
      device: { select: { name: true } },
    },
    orderBy: [{ prayerWindow: { prayerDate: 'asc' } }, { tappedAt: 'asc' }],
    take: 50000,
  });

  const header = ['วันที่', 'ละหมาด', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'ห้อง', 'สถานะ', 'เวลาที่แตะ', 'จุดแตะ', 'หมายเหตุ'];
  const lines = rows.map((r) =>
    [
      r.prayerWindow.prayerDate.toISOString().slice(0, 10),
      PRAYER_NAMES_TH[r.prayerWindow.prayer],
      r.student.studentCode,
      `${r.student.firstName} ${r.student.lastName}`,
      r.student.classroom?.name,
      STATUS_NAMES_TH[r.status],
      r.tapLogId || r.deviceId ? formatLocal(r.tappedAt) : `${formatLocal(r.tappedAt)} (ครูลงให้)`,
      r.device?.name,
      r.note,
    ]
      .map(csvCell)
      .join(','),
  );

  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="attendance_${from}_${to}.csv"`,
  });
  res.send(`﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`);
});

const manualSchema = z.object({
  studentId: z.number().int().positive(),
  prayerWindowId: z.number().int().positive(),
  status: statusEnum,
  note: z.string().max(500).nullable().optional(),
});

// ครูลง/แก้สถานะเอง เช่น ลา ขาด หรือลืมบัตร (ถ้ามีรายการอยู่แล้วจะแก้สถานะ ไม่แก้เวลาที่แตะ)
router.put('/manual', async (req, res) => {
  const { studentId, prayerWindowId, status, note } = parse(manualSchema, req.body);
  const [student, window] = await Promise.all([
    prisma.student.findUnique({ where: { id: studentId } }),
    prisma.prayerWindow.findUnique({ where: { id: prayerWindowId } }),
  ]);
  if (!student) throw new HttpError(404, 'ไม่พบนักเรียน');
  if (!window) throw new HttpError(404, 'ไม่พบช่วงละหมาด');

  const record = await prisma.attendance.upsert({
    where: { studentId_prayerWindowId: { studentId, prayerWindowId } },
    // รายการที่ครูลงเอง tapLogId จะเป็น null และ tappedAt คือเวลาที่ลง
    create: { studentId, prayerWindowId, tappedAt: new Date(), status, note, updatedById: req.user.id },
    update: { status, note, updatedById: req.user.id },
    omit: { facePhoto: true },
    include: { student: { select: studentSelect } },
  });
  res.json(record);
});

// ลบรายการที่ลงผิด (เช่น แตะแทนเพื่อน)
router.delete('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  await prisma.attendance.delete({ where: { id: BigInt(id) } });
  res.status(204).end();
});

export default router;
