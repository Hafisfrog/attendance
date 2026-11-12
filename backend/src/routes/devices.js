import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { formatApiKey, generateSecret, hashKey } from '../utils/crypto.js';
import { idParam, parse } from '../utils/validate.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const select = {
  id: true,
  name: true,
  location: true,
  isActive: true,
  lastSeenAt: true,
  createdAt: true,
};

const withOnline = (d) => ({
  ...d,
  online: Boolean(d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  location: z.string().trim().max(200).nullable().optional(),
});
const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

router.get('/', async (req, res) => {
  const devices = await prisma.device.findMany({ select, orderBy: { id: 'asc' } });
  res.json(devices.map(withOnline));
});

// สร้างอุปกรณ์ใหม่ -- API key แสดงครั้งเดียวเท่านั้น (ในฐานข้อมูลเก็บเฉพาะค่า hash)
router.post('/', async (req, res) => {
  const data = parse(createSchema, req.body);
  const secret = generateSecret();
  const device = await prisma.device.create({
    data: { ...data, apiKeyHash: hashKey(secret) },
    select,
  });
  res.status(201).json({ device: withOnline(device), apiKey: formatApiKey(device.id, secret) });
});

router.put('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const data = parse(updateSchema, req.body);
  res.json(withOnline(await prisma.device.update({ where: { id }, data, select })));
});

// ออกคีย์ใหม่ (คีย์เดิมใช้ไม่ได้ทันที) เช่นกรณีคีย์รั่วหรืออุปกรณ์หาย
router.post('/:id/rotate-key', async (req, res) => {
  const id = idParam(req.params.id);
  const secret = generateSecret();
  await prisma.device.update({ where: { id }, data: { apiKeyHash: hashKey(secret) } });
  res.json({ apiKey: formatApiKey(id, secret) });
});

// ไม่ลบจริงเพราะมีประวัติการแตะอ้างอิงอยู่ -> ปิดการใช้งานแทน
router.delete('/:id', async (req, res) => {
  await prisma.device.update({ where: { id: idParam(req.params.id) }, data: { isActive: false } });
  res.status(204).end();
});

export default router;
