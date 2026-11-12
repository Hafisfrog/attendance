import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// API key ของอุปกรณ์เป็นค่าสุ่มยาว (256 บิต) จึงใช้ SHA-256 ได้ ไม่ต้องใช้ bcrypt (เร็วกว่าเมื่อมีการแตะบ่อย)
export const hashKey = (secret) => createHash('sha256').update(secret).digest('hex');

export const generateSecret = () => randomBytes(32).toString('hex');

export function safeEqualHex(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// รูปแบบคีย์ที่ให้ผู้ใช้: "<deviceId>.<secret>"
export const formatApiKey = (deviceId, secret) => `${deviceId}.${secret}`;
