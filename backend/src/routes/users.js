import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../utils/errors.js';
import { idParam, parse } from '../utils/validate.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const select = { id: true, username: true, displayName: true, role: true, isActive: true, createdAt: true };

const createSchema = z.object({
  username: z.string().trim().min(3).max(50),
  password: z.string().min(8, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร').max(200),
  displayName: z.string().trim().min(1).max(100),
  role: z.enum(['admin', 'teacher']).default('teacher'),
});

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  role: z.enum(['admin', 'teacher']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร').max(200).optional(),
});

router.get('/', async (req, res) => {
  res.json(await prisma.user.findMany({ select, orderBy: { id: 'asc' } }));
});

router.post('/', async (req, res) => {
  const { password, ...data } = parse(createSchema, req.body);
  const user = await prisma.user.create({
    data: { ...data, passwordHash: await bcrypt.hash(password, 10) },
    select,
  });
  res.status(201).json(user);
});

router.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const { password, ...data } = parse(updateSchema, req.body);

  // กันแอดมินปิดหรือลดสิทธิ์ตัวเองจนไม่เหลือใครเข้าระบบจัดการได้
  if (id === req.user.id && (data.isActive === false || (data.role && data.role !== 'admin'))) {
    throw new HttpError(400, 'ไม่สามารถปิดบัญชีหรือลดสิทธิ์ของตัวเองได้');
  }

  const user = await prisma.user.update({
    where: { id },
    data: { ...data, ...(password && { passwordHash: await bcrypt.hash(password, 10) }) },
    select,
  });
  res.json(user);
});

export default router;
