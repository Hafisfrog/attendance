import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { HttpError } from '../utils/errors.js';
import { parse } from '../utils/validate.js';

const router = Router();

// กันการเดารหัสผ่าน: 10 ครั้งต่อ 15 นาทีต่อ IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่' },
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { username } });
  // ตอบข้อความเดียวกันไม่ว่าผิดที่ชื่อหรือรหัสผ่าน
  const ok = user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร').max(200),
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new HttpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });
  res.json({ ok: true });
});

export default router;
