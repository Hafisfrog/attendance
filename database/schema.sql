-- =====================================================================
-- ระบบลงเวลาละหมาดด้วยบัตรนักเรียน (RFID) - PostgreSQL schema
-- เวลาทั้งหมดเก็บเป็น timestamptz (UTC ภายใน) แสดงผลเป็นเวลาไทยที่ฝั่งแอป
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) ผู้ใช้งานระบบ (ครู / แอดมิน)
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    username       VARCHAR(50)  NOT NULL UNIQUE,
    password_hash  TEXT         NOT NULL,
    display_name   VARCHAR(100) NOT NULL,
    role           VARCHAR(20)  NOT NULL DEFAULT 'teacher'
                   CHECK (role IN ('admin', 'teacher')),
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2) ห้องเรียน / ชั้นเรียน
-- ---------------------------------------------------------------------
CREATE TABLE classrooms (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(50) NOT NULL,          -- เช่น "ม.1/1"
    academic_year       SMALLINT    NOT NULL,          -- ปีการศึกษา
    homeroom_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (name, academic_year)
);

-- ---------------------------------------------------------------------
-- 3) นักเรียน
-- ---------------------------------------------------------------------
CREATE TABLE students (
    id            SERIAL PRIMARY KEY,
    student_code  VARCHAR(20)  NOT NULL UNIQUE,       -- รหัสนักเรียน
    first_name    VARCHAR(100) NOT NULL,
    last_name     VARCHAR(100) NOT NULL,
    gender        CHAR(1)      CHECK (gender IN ('M', 'F')),
    classroom_id  INTEGER      REFERENCES classrooms(id) ON DELETE SET NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_students_classroom ON students(classroom_id);

-- ---------------------------------------------------------------------
-- 4) บัตร RFID (1 นักเรียนมีได้หลายใบ เผื่อบัตรหาย/ออกใหม่)
-- ---------------------------------------------------------------------
CREATE TABLE cards (
    id          SERIAL PRIMARY KEY,
    uid         VARCHAR(32) NOT NULL UNIQUE,          -- UID จากบัตร เช่น "04A1B2C3"
    student_id  INTEGER     REFERENCES students(id) ON DELETE SET NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'lost', 'disabled')),
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    note        TEXT
);
CREATE INDEX idx_cards_student ON cards(student_id);

-- ---------------------------------------------------------------------
-- 5) อุปกรณ์ (จุดแตะบัตร / ESP32)
-- ---------------------------------------------------------------------
CREATE TABLE devices (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,              -- เช่น "มัสยิดโรงเรียน"
    location      VARCHAR(200),
    api_key_hash  TEXT         NOT NULL,              -- เก็บแบบ hash ไม่เก็บคีย์จริง
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    last_seen_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 6) ตารางเวลาละหมาดรายวัน (ช่วงเวลาที่ยอมให้แตะบัตรได้)
--    opens_at  = เริ่มรับแตะ (มักเป็นเวลาเข้าละหมาด หรือก่อนหน้าเล็กน้อย)
--    closes_at = หมดเวลารับแตะ
--    late_at   = หลังจากนี้นับว่า "สาย" (ไม่บังคับ)
-- ---------------------------------------------------------------------
CREATE TABLE prayer_windows (
    id           SERIAL PRIMARY KEY,
    prayer_date  DATE        NOT NULL,                -- วันที่ตามเวลาไทย
    prayer       VARCHAR(10) NOT NULL
                 CHECK (prayer IN ('fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'jumuah')),
    opens_at     TIMESTAMPTZ NOT NULL,
    late_at      TIMESTAMPTZ,
    closes_at    TIMESTAMPTZ NOT NULL,
    UNIQUE (prayer_date, prayer),
    CHECK (opens_at < closes_at),
    CHECK (late_at IS NULL OR (late_at >= opens_at AND late_at <= closes_at))
);

-- ---------------------------------------------------------------------
-- 7) บันทึกการแตะดิบ (เก็บทุกครั้งที่มีการแตะ รวมบัตรไม่รู้จัก/แตะซ้ำ)
--    ใช้ตรวจสอบย้อนหลัง และใช้ตอนลงทะเบียนบัตรใหม่
-- ---------------------------------------------------------------------
CREATE TABLE tap_logs (
    id           BIGSERIAL PRIMARY KEY,
    card_uid     VARCHAR(32) NOT NULL,
    card_id      INTEGER     REFERENCES cards(id)    ON DELETE SET NULL,
    student_id   INTEGER     REFERENCES students(id) ON DELETE SET NULL,
    device_id    INTEGER     NOT NULL REFERENCES devices(id),
    tapped_at    TIMESTAMPTZ NOT NULL,                -- เวลาที่แตะจริง (จาก RTC)
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),  -- เวลาที่เซิร์ฟเวอร์รับ (กรณีส่งย้อนหลัง)
    result       VARCHAR(20) NOT NULL
                 CHECK (result IN ('recorded', 'duplicate', 'unknown_card',
                                   'card_disabled', 'outside_window'))
);
CREATE INDEX idx_tap_logs_tapped_at ON tap_logs(tapped_at);
CREATE INDEX idx_tap_logs_card_uid  ON tap_logs(card_uid);
CREATE INDEX idx_tap_logs_student   ON tap_logs(student_id);

-- ---------------------------------------------------------------------
-- 8) การลงเวลาละหมาด (ผลสรุป: 1 นักเรียน / 1 ช่วงละหมาด / 1 วัน = 1 แถว)
-- ---------------------------------------------------------------------
CREATE TABLE attendance (
    id               BIGSERIAL PRIMARY KEY,
    student_id       INTEGER     NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    prayer_window_id INTEGER     NOT NULL REFERENCES prayer_windows(id) ON DELETE CASCADE,
    tap_log_id       BIGINT      REFERENCES tap_logs(id) ON DELETE SET NULL,
    device_id        INTEGER     REFERENCES devices(id),
    tapped_at        TIMESTAMPTZ NOT NULL,
    status           VARCHAR(10) NOT NULL DEFAULT 'present'
                     CHECK (status IN ('present', 'late', 'excused', 'absent')),
    note             TEXT,                            -- ครูแก้ไข/หมายเหตุ
      face_photo       TEXT,                            -- ภาพจากกล้องที่จุดสแกน (data URL)
    updated_by       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (student_id, prayer_window_id)             -- กันลงซ้ำในระดับฐานข้อมูล
);
CREATE INDEX idx_attendance_window ON attendance(prayer_window_id);

-- ---------------------------------------------------------------------
-- 9) View สำหรับรายงาน: รวมชื่อนักเรียน ห้อง และช่วงละหมาด
-- ---------------------------------------------------------------------
CREATE VIEW v_attendance_report AS
SELECT
    a.id,
    pw.prayer_date,
    pw.prayer,
    s.student_code,
    s.first_name,
    s.last_name,
    c.name  AS classroom,
    a.status,
    a.tapped_at,
    d.name  AS device_name
FROM attendance a
JOIN prayer_windows pw ON pw.id = a.prayer_window_id
JOIN students s        ON s.id  = a.student_id
LEFT JOIN classrooms c ON c.id  = s.classroom_id
LEFT JOIN devices d    ON d.id  = a.device_id;

COMMIT;

-- =====================================================================
-- ตัวอย่าง query ที่ใช้บ่อย
-- =====================================================================

-- นักเรียนที่ "ยังไม่แตะ" ในช่วงละหมาดหนึ่ง (ใส่วันที่และละหมาดที่ต้องการ)
-- SELECT s.student_code, s.first_name, s.last_name, c.name AS classroom
-- FROM students s
-- LEFT JOIN classrooms c ON c.id = s.classroom_id
-- WHERE s.is_active
--   AND NOT EXISTS (
--     SELECT 1 FROM attendance a
--     JOIN prayer_windows pw ON pw.id = a.prayer_window_id
--     WHERE a.student_id = s.id
--       AND pw.prayer_date = '2026-10-26'
--       AND pw.prayer = 'dhuhr'
--   );

-- สรุปจำนวนการละหมาดรายห้อง รายวัน
-- SELECT prayer_date, classroom, prayer, COUNT(*) AS total
-- FROM v_attendance_report
-- GROUP BY prayer_date, classroom, prayer
-- ORDER BY prayer_date, classroom, prayer;
