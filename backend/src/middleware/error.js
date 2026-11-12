import { HttpError } from '../utils/errors.js';

export function notFound(req, res) {
  res.status(404).json({ error: 'ไม่พบเส้นทางที่เรียก' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'รูปแบบ JSON ไม่ถูกต้อง' });
  }
  if (err?.code === 'P2002') {
    return res.status(409).json({ error: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว', fields: err.meta?.target });
  }
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: 'ไม่พบข้อมูลที่ต้องการ' });
  }
  if (err?.code === 'P2003') {
    return res.status(409).json({ error: 'ข้อมูลนี้ถูกอ้างอิงอยู่หรือข้อมูลที่อ้างถึงไม่มีอยู่จริง' });
  }
  console.error(err);
  return res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
}
