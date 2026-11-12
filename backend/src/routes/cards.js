import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { normalizeUid } from '../services/tapService.js';
import { HttpError } from '../utils/errors.js';
import { idParam, parse, positiveInt } from '../utils/validate.js';

const router = Router();
router.use(requireAuth);

const CARD_STATUSES = ['active', 'lost', 'disabled'];

const include = {
  student: {
    select: { id: true, studentCode: true, firstName: true, lastName: true, classroom: { select: { name: true } } },
  },
};

router.get('/', async (req, res) => {
  const q = parse(
    z.object({
      studentId: positiveInt.optional(),
      status: z.enum(CARD_STATUSES).optional(),
    }),
    req.query,
  );
  res.json(
    await prisma.card.findMany({
      where: { ...(q.studentId && { studentId: q.studentId }), ...(q.status && { status: q.status }) },
      include,
      orderBy: { id: 'desc' },
      take: 500,
    }),
  );
});

// บัตรที่เพิ่งถูกแตะแต่ยังไม่ผูกกับนักเรียน (ใช้กับหน้าลงทะเบียนบัตร: แตะบัตร -> เลือกนักเรียน)
router.get('/unassigned', async (req, res) => {
  const { hours } = parse(z.object({ hours: positiveInt.max(168).default(24) }), req.query);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const grouped = await prisma.tapLog.groupBy({
    by: ['cardUid'],
    where: { result: 'unknown_card', tappedAt: { gte: since } },
    _max: { tappedAt: true },
    _count: { _all: true },
    orderBy: { _max: { tappedAt: 'desc' } },
    take: 50,
  });

  // ตัดบัตรที่ถูกผูกไปแล้วหลังจากแตะ
  const assigned = await prisma.card.findMany({
    where: { uid: { in: grouped.map((g) => g.cardUid) }, studentId: { not: null } },
    select: { uid: true },
  });
  const assignedSet = new Set(assigned.map((c) => c.uid));

  res.json(
    grouped
      .filter((g) => !assignedSet.has(g.cardUid))
      .map((g) => ({ uid: g.cardUid, lastTappedAt: g._max.tappedAt, taps: g._count._all })),
  );
});

const createSchema = z.object({
  uid: z.string().min(1).max(64),
  studentId: z.number().int().positive(),
  note: z.string().max(500).nullable().optional(),
});

// ผูกบัตรกับนักเรียน (ถ้ามีบัตรนี้อยู่แล้วแต่ยังไม่ผูกใคร จะผูกให้)
router.post('/', async (req, res) => {
  const body = parse(createSchema, req.body);
  const uid = normalizeUid(body.uid);
  if (!uid || uid.length > 32) throw new HttpError(400, 'รหัสบัตรไม่ถูกต้อง');

  const student = await prisma.student.findUnique({ where: { id: body.studentId } });
  if (!student) throw new HttpError(404, 'ไม่พบนักเรียน');

  const existing = await prisma.card.findUnique({ where: { uid } });
  if (existing?.studentId) {
    throw new HttpError(409, 'บัตรนี้ถูกผูกกับนักเรียนคนอื่นแล้ว ต้องยกเลิกการผูกก่อน');
  }

  const data = { studentId: body.studentId, status: 'active', note: body.note ?? null };
  const card = existing
    ? await prisma.card.update({ where: { uid }, data, include })
    : await prisma.card.create({ data: { uid, ...data }, include });
  res.status(201).json(card);
});

const updateSchema = z.object({
  studentId: z.number().int().positive().nullable().optional(), // null = ยกเลิกการผูก
  status: z.enum(CARD_STATUSES).optional(),
  note: z.string().max(500).nullable().optional(),
});

router.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const data = parse(updateSchema, req.body);
  res.json(await prisma.card.update({ where: { id }, data, include }));
});

// ลบบัตรออกจากระบบ (ประวัติการแตะยังอยู่ใน tap_logs)
router.delete('/:id', async (req, res) => {
  await prisma.card.delete({ where: { id: idParam(req.params.id) } });
  res.status(204).end();
});

export default router;
