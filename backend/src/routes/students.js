import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { normalizeUid } from '../services/tapService.js';
import { HttpError } from '../utils/errors.js';
import { idParam, parse, positiveInt } from '../utils/validate.js';

const router = Router();
router.use(requireAuth);

const studentSchema = z.object({
  studentCode: z.string().trim().min(1).max(20),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  gender: z.enum(['M', 'F']).nullable().optional(),
  classroomId: z.number().int().positive().nullable().optional(),
  cardUid: z.string().trim().max(64).optional(),
});
const updateSchema = studentSchema.partial().extend({ isActive: z.boolean().optional() });
const bulkSchema = z.object({ students: z.array(studentSchema).min(1).max(2000) });

const listQuery = z.object({
  classroomId: positiveInt.optional(),
  q: z.string().trim().optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  page: positiveInt.default(1),
  pageSize: positiveInt.max(200).default(50),
});

const include = {
  classroom: { select: { id: true, name: true } },
  cards: { select: { id: true, uid: true, status: true } },
};

router.get('/', async (req, res) => {
  const q = parse(listQuery, req.query);
  const where = {
    ...(q.classroomId && { classroomId: q.classroomId }),
    ...(q.active !== 'all' && { isActive: q.active === 'true' }),
    ...(q.q && {
      OR: [
        { studentCode: { contains: q.q, mode: 'insensitive' } },
        { firstName: { contains: q.q, mode: 'insensitive' } },
        { lastName: { contains: q.q, mode: 'insensitive' } },
      ],
    }),
  };
  const [items, total] = await prisma.$transaction([
    prisma.student.findMany({
      where,
      include,
      orderBy: [{ classroomId: 'asc' }, { studentCode: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.student.count({ where }),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
});

// เพิ่มนักเรียนหลายคนพร้อมกัน (นำเข้าจากไฟล์) -- รหัสนักเรียนที่ซ้ำจะถูกข้าม
router.post('/bulk', async (req, res) => {
  const { students } = parse(bulkSchema, req.body);
  const result = await prisma.student.createMany({ data: students, skipDuplicates: true });
  res.status(201).json({ created: result.count, skipped: students.length - result.count });
});

router.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      ...include,
      attendance: {
        take: 30,
        orderBy: { tappedAt: 'desc' },
        include: { prayerWindow: { select: { prayerDate: true, prayer: true } } },
      },
    },
  });
  if (!student) throw new HttpError(404, 'ไม่พบนักเรียน');
  res.json(student);
});

async function assignCard(tx, cardUid, studentId) {
  const uid = normalizeUid(cardUid);
  if (!uid || uid.length > 32) throw new HttpError(400, 'รหัสบัตรไม่ถูกต้อง');

  const existing = await tx.card.findUnique({ where: { uid } });
  if (existing?.studentId && existing.studentId !== studentId) {
    throw new HttpError(409, 'บัตรนี้ผูกกับนักเรียนคนอื่นแล้ว');
  }
  if (existing) {
    await tx.card.update({ where: { uid }, data: { studentId, status: 'active' } });
  } else {
    await tx.card.create({ data: { uid, studentId, status: 'active' } });
  }
}

router.post('/', async (req, res) => {
  const data = parse(studentSchema, req.body);
  const { cardUid, ...studentData } = data;
  const student = await prisma.$transaction(async (tx) => {
    const created = await tx.student.create({ data: studentData });
    if (cardUid) await assignCard(tx, cardUid, created.id);
    return tx.student.findUnique({ where: { id: created.id }, include });
  });
  res.status(201).json(student);
});

router.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const data = parse(updateSchema, req.body);
  const { cardUid, ...studentData } = data;
  const student = await prisma.$transaction(async (tx) => {
    await tx.student.update({ where: { id }, data: studentData });
    if (cardUid) await assignCard(tx, cardUid, id);
    return tx.student.findUnique({ where: { id }, include });
  });
  res.json(student);
});

// ไม่ลบจริง (เพื่อเก็บประวัติ) แต่ปิดการใช้งาน; ต้องการเปิดใหม่ใช้ PUT { "isActive": true }
router.delete('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  await prisma.student.update({ where: { id }, data: { isActive: false } });
  res.status(204).end();
});

export default router;
