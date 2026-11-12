import { prisma } from '../db.js';
import { HttpError } from '../utils/errors.js';
import { hashKey, safeEqualHex } from '../utils/crypto.js';

const LAST_SEEN_THROTTLE_MS = 30 * 1000;

// อุปกรณ์ส่ง header: x-api-key: <deviceId>.<secret>
export async function requireDevice(req, res, next) {
  const raw = req.headers['x-api-key'];
  if (typeof raw !== 'string') throw new HttpError(401, 'ไม่พบ x-api-key');

  const dot = raw.indexOf('.');
  const id = Number(raw.slice(0, dot));
  const secret = raw.slice(dot + 1);
  if (dot < 1 || !Number.isInteger(id) || id <= 0 || !secret) {
    throw new HttpError(401, 'รูปแบบ API key ไม่ถูกต้อง');
  }

  const device = await prisma.device.findUnique({ where: { id } });
  if (!device || !device.isActive || !safeEqualHex(hashKey(secret), device.apiKeyHash)) {
    throw new HttpError(401, 'API key ไม่ถูกต้องหรืออุปกรณ์ถูกปิดใช้งาน');
  }

  const now = new Date();
  if (!device.lastSeenAt || now - device.lastSeenAt > LAST_SEEN_THROTTLE_MS) {
    // ไม่ต้องรอผล เพื่อไม่ให้หน่วงการตอบอุปกรณ์
    prisma.device
      .update({ where: { id }, data: { lastSeenAt: now } })
      .catch((e) => console.error('อัปเดต last_seen_at ไม่สำเร็จ', e.message));
  }

  req.device = { id: device.id, name: device.name };
  next();
}
