import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../utils/errors.js';
import { idParam, parse, positiveInt } from '../utils/validate.js';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1).max(50),
  academicYear: z.number().int().min(2400).max(2700), // ปีการศึกษา พ.ศ.
  homeroomTeacherId: z.number().int().positive().nullable().optional(),
});
const updateSchema = createSchema.partial();

router.get('/', async (req, res) => {
  const { academicYear } = parse(z.object({ academicYear: positiveInt.optional() }), req.query);
  const rows = await prisma.classroom.findMany({
    where: academicYear ? { academicYear } : undefined,
    include: {
      homeroomTeacher: { select: { id: true, displayName: true } },
      _count: { select: { students: { where: { isActive: true } } } },
    },
    orderBy: [{ academicYear: 'desc' }, { name: 'asc' }],
  });
  res.json(rows.map(({ _count, ...c }) => ({ ...c, studentCount: _count.students })));
});

router.post('/', requireRole('admin'), async (req, res) => {
  const data = parse(createSchema, req.body);
  res.status(201).json(await prisma.classroom.create({ data }));
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const id = idParam(req.params.id);
  const data = parse(updateSchema, req.body);
  res.json(await prisma.classroom.update({ where: { id }, data }));
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const id = idParam(req.params.id);
  const count = await prisma.student.count({ where: { classroomId: id } });
  if (count > 0) {
    throw new HttpError(409, `ห้องนี้ยังมีนักเรียน ${count} คน ย้ายนักเรียนออกก่อนจึงจะลบได้`);
  }
  await prisma.classroom.delete({ where: { id } });
  res.status(204).end();
});

export default router;
