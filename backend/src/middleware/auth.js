import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from '../utils/errors.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

// ตรวจโทเค็นจาก header "Authorization: Bearer ..."
// allowQuery = true ใช้กับ SSE เพราะ EventSource ตั้ง header เองไม่ได้ (ส่ง ?token=...)
export async function authenticate(req, { allowQuery = false } = {}) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token && allowQuery && typeof req.query.token === 'string') token = req.query.token;
  if (!token) throw new HttpError(401, 'ต้องเข้าสู่ระบบก่อน');

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'โทเค็นไม่ถูกต้องหรือหมดอายุ');
  }

  const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } });
  if (!user || !user.isActive) throw new HttpError(401, 'บัญชีนี้ใช้งานไม่ได้');

  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
}

export async function requireAuth(req, res, next) {
  req.user = await authenticate(req);
  next();
}

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, 'ไม่มีสิทธิ์ใช้งานส่วนนี้');
    }
    next();
  };
