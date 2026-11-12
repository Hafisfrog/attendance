import { z } from 'zod';
import { HttpError } from './errors.js';
import { isValidDateString } from './time.js';

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.join('.');
    throw new HttpError(
      400,
      `ข้อมูลไม่ถูกต้อง${path ? ` (${path})` : ''}: ${issue.message}`,
      result.error.issues,
    );
  }
  return result.data;
}

export function idParam(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'id ไม่ถูกต้อง');
  return n;
}

// วันที่รูปแบบ YYYY-MM-DD
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'ต้องเป็นรูปแบบ YYYY-MM-DD')
  .refine(isValidDateString, 'วันที่ไม่ถูกต้อง');

export const positiveInt = z.coerce.number().int().positive();
