import { app } from './app.js';
import { config, hasCoordinates } from './config.js';
import { prisma } from './db.js';
import { ensureUpcomingWindows } from './services/prayerService.js';

const HOUR_MS = 60 * 60 * 1000;

async function refreshWindows() {
  try {
    await ensureUpcomingWindows();
  } catch (e) {
    console.error('สร้างตารางเวลาละหมาดอัตโนมัติไม่สำเร็จ:', e.message);
  }
}

const server = app.listen(config.port, () => {
  console.log(`เซิร์ฟเวอร์ทำงานที่พอร์ต ${config.port} (เขตเวลา ${config.timezone})`);
  if (!hasCoordinates()) {
    console.warn(
      'คำเตือน: ยังไม่ได้ตั้ง PRAYER_LATITUDE/PRAYER_LONGITUDE -> ไม่สร้างตารางเวลาละหมาดอัตโนมัติ (เพิ่มเองผ่าน API ได้)',
    );
  }
});

refreshWindows();
const timer = setInterval(refreshWindows, HOUR_MS);
timer.unref();

async function shutdown(signal) {
  console.log(`ได้รับ ${signal} กำลังปิดระบบ...`);
  clearInterval(timer);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // SSE เปิดค้างอยู่ทำให้ปิดไม่ลง -> บังคับปิดหลัง 5 วินาที
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
