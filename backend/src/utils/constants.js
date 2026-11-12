export const ALLOWED_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
export const ALL_PRAYER_KEYS = [...ALLOWED_PRAYERS, 'jumuah'];

export const CALCULATION_METHODS = [
  'MuslimWorldLeague',
  'Egyptian',
  'Karachi',
  'UmmAlQura',
  'Dubai',
  'MoonsightingCommittee',
  'NorthAmerica',
  'Kuwait',
  'Qatar',
  'Singapore',
  'Tehran',
  'Turkey',
];

export const ATTENDANCE_STATUSES = ['present', 'late', 'excused', 'absent'];

export const PRAYER_NAMES_TH = {
  fajr: 'ซุบฮิ',
  dhuhr: 'ซุฮ์รี',
  asr: 'อัศรี',
  maghrib: 'มัฆริบ',
  isha: 'อิชาอ์',
  jumuah: 'ญุมุอะฮ์',
};

export const STATUS_NAMES_TH = {
  present: 'มา',
  late: 'สาย',
  excused: 'ลา',
  absent: 'ขาด',
};

export const RESULT_MESSAGES_TH = {
  recorded: 'บันทึกแล้ว',
  late: 'บันทึกแล้ว (สาย)',
  duplicate: 'แตะไปแล้วในช่วงนี้',
  unknown_card: 'ไม่รู้จักบัตรนี้',
  card_disabled: 'บัตรถูกระงับการใช้งาน',
  outside_window: 'ไม่อยู่ในช่วงเวลาละหมาด',
  invalid: 'ข้อมูลการแตะไม่ถูกต้อง',
};
