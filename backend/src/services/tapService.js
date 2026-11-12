import { prisma } from '../db.js';
import { bus } from '../events.js';
import { HttpError } from '../utils/errors.js';
import { PRAYER_NAMES_TH, RESULT_MESSAGES_TH } from '../utils/constants.js';
import { findWindowAt } from './prayerService.js';

// รหัสบัตรเก็บเป็นตัวพิมพ์ใหญ่ ไม่มีตัวคั่น เช่น "04A1B2C3" (ใช้ทั้งตอนลงทะเบียนและตอนแตะ)
export function normalizeUid(raw) {
  return String(raw ?? '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase();
}

function describe(result, status) {
  if (result === 'recorded' && status === 'late') return RESULT_MESSAGES_TH.late;
  return RESULT_MESSAGES_TH[result];
}

/**
 * ประมวลผลการแตะบัตร 1 ครั้ง
 * ผลลัพธ์ (result): recorded | duplicate | unknown_card | card_disabled | outside_window
 * ทุกครั้งที่แตะจะถูกบันทึกลง tap_logs; เฉพาะ recorded เท่านั้นที่เพิ่มแถวใน attendance
 */
export async function processTap({ device, cardUid, tappedAt }) {
  const uid = normalizeUid(cardUid);
  if (!uid || uid.length > 32) throw new HttpError(400, 'รหัสบัตรไม่ถูกต้อง');

  const card = await prisma.card.findUnique({
    where: { uid },
    include: { student: { include: { classroom: true } } },
  });
  const student = card?.student ?? null;

  let result = null;
  let window = null;
  if (!card || !student) {
    result = 'unknown_card';
  } else if (card.status !== 'active' || !student.isActive) {
    result = 'card_disabled';
  } else {
    window = await findWindowAt(tappedAt);
    if (!window) result = 'outside_window';
  }

  const logData = {
    cardUid: uid,
    cardId: card?.id ?? null,
    studentId: student?.id ?? null,
    deviceId: device.id,
    tappedAt,
  };

  let log;
  let attendance = null;

  if (result === null) {
    try {
      ({ log, attendance } = await prisma.$transaction(async (tx) => {
        const createdLog = await tx.tapLog.create({ data: { ...logData, result: 'recorded' } });
        const createdAttendance = await tx.attendance.create({
          data: {
            studentId: student.id,
            prayerWindowId: window.id,
            tapLogId: createdLog.id,
            deviceId: device.id,
            tappedAt,
            status: window.lateAt && tappedAt > window.lateAt ? 'late' : 'present',
          },
        });
        return { log: createdLog, attendance: createdAttendance };
      }));
      result = 'recorded';
    } catch (e) {
      // UNIQUE (student_id, prayer_window_id) ชน = แตะซ้ำในช่วงเดียวกัน (transaction ถูก rollback แล้ว)
      if (e?.code !== 'P2002') throw e;
      result = 'duplicate';
      log = await prisma.tapLog.create({ data: { ...logData, result } });
    }
  } else {
    log = await prisma.tapLog.create({ data: { ...logData, result } });
  }

  const status = attendance?.status ?? null;
  const outcome = {
    ok: result === 'recorded',
    result,
    message: describe(result, status),
    tapLogId: String(log.id),
    tappedAt: tappedAt.toISOString(),
    status,
    prayer: window?.prayer ?? null,
    prayerName: window ? PRAYER_NAMES_TH[window.prayer] : null,
    student: student
      ? {
          id: student.id,
          code: student.studentCode,
          name: `${student.firstName} ${student.lastName}`,
          classroom: student.classroom?.name ?? null,
        }
      : null,
  };

  bus.emit('tap', {
    ...outcome,
    deviceId: device.id,
    deviceName: device.name,
    // แสดงรหัสบัตรเฉพาะบัตรที่ยังไม่รู้จัก เพื่อให้หน้าลงทะเบียนบัตรนำไปผูกกับนักเรียนได้
    cardUid: result === 'unknown_card' ? uid : undefined,
  });

  return outcome;
}
