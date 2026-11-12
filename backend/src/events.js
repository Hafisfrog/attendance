import { EventEmitter } from 'node:events';

// ตัวกลางส่งเหตุการณ์การแตะบัตรไปยังหน้าเว็บที่เปิดดูแบบเรียลไทม์ (SSE)
export const bus = new EventEmitter();
bus.setMaxListeners(200);
