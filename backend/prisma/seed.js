// สร้างบัญชีแอดมินเริ่มต้น (และข้อมูลตัวอย่างถ้า SEED_DEMO=true)
// รัน: npm run seed
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { formatApiKey, generateSecret, hashKey } from '../src/utils/crypto.js';

const prisma = new PrismaClient();

async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`มีบัญชี "${username}" อยู่แล้ว ข้ามขั้นตอนนี้`);
    return;
  }

  let password = process.env.ADMIN_PASSWORD;
  const generated = !password;
  if (generated) password = randomBytes(9).toString('base64url');
  if (password.length < 8) throw new Error('ADMIN_PASSWORD ต้องยาวอย่างน้อย 8 ตัวอักษร');

  await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      displayName: 'ผู้ดูแลระบบ',
      role: 'admin',
    },
  });
  console.log(`สร้างบัญชีแอดมิน: ${username}`);
  if (generated) {
    console.log(`รหัสผ่าน (แสดงครั้งเดียว กรุณาเก็บไว้และเปลี่ยนหลังเข้าระบบ): ${password}`);
  }
}

async function seedDemo() {
  const academicYear = new Date().getFullYear() + 543;
  const classroom = await prisma.classroom.upsert({
    where: { name_academicYear: { name: 'ตัวอย่าง 1/1', academicYear } },
    create: { name: 'ตัวอย่าง 1/1', academicYear },
    update: {},
  });

  const demo = [
    ['D0001', 'สมชาย', 'ตัวอย่าง', 'M', 'AA000001'],
    ['D0002', 'สมหญิง', 'ตัวอย่าง', 'F', 'AA000002'],
    ['D0003', 'อาลี', 'ทดสอบ', 'M', 'AA000003'],
    ['D0004', 'ฟาติมะฮ์', 'ทดสอบ', 'F', 'AA000004'],
    ['D0005', 'ยูซุฟ', 'ทดสอบ', 'M', 'AA000005'],
  ];
  for (const [studentCode, firstName, lastName, gender, uid] of demo) {
    const student = await prisma.student.upsert({
      where: { studentCode },
      create: { studentCode, firstName, lastName, gender, classroomId: classroom.id },
      update: {},
    });
    await prisma.card.upsert({
      where: { uid },
      create: { uid, studentId: student.id },
      update: {},
    });
  }
  console.log('สร้างห้องเรียนและนักเรียนตัวอย่าง 5 คน (บัตร AA000001 - AA000005)');

  const secret = generateSecret();
  const device = await prisma.device.create({
    data: { name: 'อุปกรณ์ทดสอบ', location: 'ทดสอบ', apiKeyHash: hashKey(secret) },
  });
  console.log(`สร้างอุปกรณ์ทดสอบ id=${device.id}`);
  console.log(`API key (แสดงครั้งเดียว): ${formatApiKey(device.id, secret)}`);
}

try {
  await seedAdmin();
  if (['1', 'true', 'yes'].includes(String(process.env.SEED_DEMO).toLowerCase())) {
    await seedDemo();
  }
} finally {
  await prisma.$disconnect();
}
