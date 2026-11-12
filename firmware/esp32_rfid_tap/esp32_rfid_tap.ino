/*
 * จุดแตะบัตรลงเวลาละหมาด — ESP32 + RC522 (+ DS3231 ไม่บังคับ)
 *
 * การทำงาน
 *  1) แตะบัตร -> อ่าน UID -> ส่งไป backend (POST /api/device/taps)
 *  2) ถ้าส่งไม่ได้ (เน็ตหลุด/เซิร์ฟเวอร์ล่ม) เก็บลงไฟล์ในหน่วยความจำแฟลชของบอร์ด
 *     แล้วทยอยส่งย้อนหลังเมื่อกลับมาออนไลน์ (POST /api/device/taps/batch)
 *  3) ทุก 1 นาทีเรียก /api/device/ping เพื่อแจ้งว่าออนไลน์ และตั้งเวลาให้ตรงกับเซิร์ฟเวอร์
 *
 * เสียง/ไฟ
 *  - ไฟเขียว + บี๊บสั้น 1 ครั้ง  = บันทึกสำเร็จ
 *  - ไฟเขียว+แดง + บี๊บสั้น 2 ครั้ง = แตะซ้ำ / นอกเวลาละหมาด / เก็บไว้ส่งทีหลัง (ออฟไลน์)
 *  - ไฟแดง + บี๊บยาว = ไม่รู้จักบัตร / บัตรถูกระงับ / API key ผิด
 *
 * ไลบรารีที่ต้องติดตั้ง (Library Manager): MFRC522 (miguelbalboa), ArduinoJson (v7),
 * RTClib (Adafruit, ถ้าใช้ DS3231)  บอร์ด: "ESP32 Dev Module" (ESP32 Arduino core 3.x)
 *
 * หมายเหตุ: ไฟล์นี้ยังไม่เคยถูกคอมไพล์/ทดสอบกับฮาร์ดแวร์จริง ให้ทดสอบบนโต๊ะก่อนติดตั้งใช้งาน
 */

#include "config.h"

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <sys/time.h>
#include <memory>

#if USE_RTC
#include <Wire.h>
#include <RTClib.h>
#endif

// ---------- ขาที่ใช้ (แก้ได้ตามที่ต่อจริง) ----------
// RC522 (VSPI):  SDA/SS=5  SCK=18  MOSI=23  MISO=19  RST=27  3.3V  GND   (ห้ามต่อ 5V กับ RC522)
// DS3231 (I2C):  SDA=21  SCL=22  (ใช้ 3.3V)
constexpr uint8_t PIN_RC522_SS = 5;
constexpr uint8_t PIN_RC522_RST = 27;
constexpr uint8_t PIN_SPI_SCK = 18;
constexpr uint8_t PIN_SPI_MISO = 19;
constexpr uint8_t PIN_SPI_MOSI = 23;
constexpr uint8_t PIN_BUZZER = 25;  // บัซเซอร์แบบ Active (มีวงจรเสียงในตัว)
constexpr uint8_t PIN_LED_OK = 26;  // ไฟเขียว (ต่อผ่านตัวต้านทาน 220 Ω)
constexpr uint8_t PIN_LED_ERR = 33; // ไฟแดง   (ต่อผ่านตัวต้านทาน 220 Ω)

// ---------- ค่าปรับแต่ง ----------
constexpr uint32_t WIFI_BOOT_WAIT_MS = 15000;
constexpr uint32_t HTTP_TIMEOUT_MS = 6000;
constexpr uint32_t SAME_CARD_IGNORE_MS = 3000;  // ไม่ส่งซ้ำถ้าบัตรใบเดิมค้างอยู่ที่เครื่องอ่าน
constexpr uint32_t HEARTBEAT_MS = 60UL * 1000;
constexpr uint32_t FLUSH_INTERVAL_MS = 20UL * 1000;
constexpr uint32_t WIFI_RETRY_MS = 10UL * 1000;
constexpr uint16_t BATCH_SIZE = 50;             // เซิร์ฟเวอร์รับได้สูงสุด 200 ต่อครั้ง
constexpr uint32_t MAX_QUEUE_BYTES = 200UL * 1024;  // กันไฟล์คิวโตจนแฟลชเต็ม
constexpr uint32_t MIN_VALID_EPOCH = 1704067200UL;  // 2024-01-01 เวลาก่อนหน้านี้ถือว่ายังไม่ได้ตั้งนาฬิกา
constexpr int32_t MAX_DRIFT_SEC = 5;            // เวลาคลาดจากเซิร์ฟเวอร์เกินนี้จะตั้งใหม่
const char *QUEUE_FILE = "/queue.txt";
const char *QUEUE_TMP = "/queue.tmp";

MFRC522 rfid(PIN_RC522_SS, PIN_RC522_RST);

#if USE_RTC
RTC_DS3231 rtc;
bool rtcTrusted = false;  // true เมื่อ RTC มีเวลาที่เชื่อถือได้
#endif

String lastUid;
uint32_t lastUidAt = 0;
uint32_t lastHeartbeat = 0;
uint32_t lastFlush = 0;
uint32_t lastWifiRetry = 0;
bool queueHasData = false;

// =====================================================================
// เสียงและไฟ
// =====================================================================
void beep(uint16_t ms) {
  digitalWrite(PIN_BUZZER, HIGH);
  delay(ms);
  digitalWrite(PIN_BUZZER, LOW);
}

void signalOk() {
  digitalWrite(PIN_LED_OK, HIGH);
  beep(120);
  delay(250);
  digitalWrite(PIN_LED_OK, LOW);
}

void signalWarn() {
  digitalWrite(PIN_LED_OK, HIGH);
  digitalWrite(PIN_LED_ERR, HIGH);
  beep(100);
  delay(100);
  beep(100);
  delay(250);
  digitalWrite(PIN_LED_OK, LOW);
  digitalWrite(PIN_LED_ERR, LOW);
}

void signalError() {
  digitalWrite(PIN_LED_ERR, HIGH);
  beep(600);
  delay(300);
  digitalWrite(PIN_LED_ERR, LOW);
}

// =====================================================================
// เวลา
// =====================================================================
// คืนค่า epoch วินาที (UTC) หรือ 0 ถ้ายังไม่มีเวลาที่เชื่อถือได้
uint32_t nowEpoch() {
#if USE_RTC
  if (rtcTrusted) return rtc.now().unixtime();
#endif
  time_t t = time(nullptr);
  return t >= (time_t)MIN_VALID_EPOCH ? (uint32_t)t : 0;
}

void setClock(uint32_t epoch) {
  struct timeval tv = {(time_t)epoch, 0};
  settimeofday(&tv, nullptr);
#if USE_RTC
  rtc.adjust(DateTime(epoch));
  rtcTrusted = true;
#endif
}

// =====================================================================
// HTTP
// =====================================================================
struct HttpResult {
  int code;
  String body;
};

// code <= 0 = ติดต่อเซิร์ฟเวอร์ไม่ได้
HttpResult httpRequest(bool isPost, const String &path, const String &payload = "") {
  HttpResult r{-1, ""};
  if (WiFi.status() != WL_CONNECTED) return r;

  const String url = String(SERVER_URL) + path;
  HTTPClient http;
  std::unique_ptr<WiFiClient> client;  // สร้างแบบปลอดภัยเฉพาะเมื่อใช้ https เพื่อประหยัดหน่วยความจำ

  if (url.startsWith("https://")) {
    WiFiClientSecure *secure = new WiFiClientSecure();
#ifdef ROOT_CA
    secure->setCACert(ROOT_CA);
#else
    secure->setInsecure();  // ไม่ตรวจใบรับรอง (ไม่แนะนำ) ควรกำหนด ROOT_CA ใน config.h
#endif
    client.reset(secure);
  } else {
    client.reset(new WiFiClient());
  }
  if (!http.begin(*client, url)) return r;

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("x-api-key", API_KEY);
  if (isPost) http.addHeader("Content-Type", "application/json");

  r.code = isPost ? http.POST(payload) : http.GET();
  if (r.code > 0) r.body = http.getString();
  http.end();
  return r;
}

// แจ้งว่าออนไลน์ และตั้งนาฬิกาตามเซิร์ฟเวอร์ (ความคลาดจากความหน่วงเครือข่ายไม่เกินไม่กี่วินาที)
void pingServer() {
  HttpResult r = httpRequest(false, "/api/device/ping");
  if (r.code != 200) {
    Serial.printf("[ping] ไม่สำเร็จ (HTTP %d)\n", r.code);
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, r.body)) return;
  uint32_t serverEpoch = doc["epoch"] | 0UL;
  if (serverEpoch < MIN_VALID_EPOCH) return;

  uint32_t mine = nowEpoch();
  int32_t drift = (int32_t)serverEpoch - (int32_t)mine;
  if (mine == 0 || drift > MAX_DRIFT_SEC || drift < -MAX_DRIFT_SEC) {
    setClock(serverEpoch);
    Serial.printf("[time] ตั้งเวลาใหม่ epoch=%lu (คลาดเดิม %ld วินาที)\n", (unsigned long)serverEpoch, (long)drift);
  }
}

// =====================================================================
// คิวออฟไลน์ (เก็บเป็นบรรทัด: UID,epoch)
// =====================================================================
bool enqueueTap(const String &uid, uint32_t epoch) {
  File f = LittleFS.open(QUEUE_FILE, FILE_APPEND);
  if (!f) return false;
  if (f.size() > MAX_QUEUE_BYTES) {
    f.close();
    Serial.println("[queue] คิวเต็ม ทิ้งรายการใหม่");
    return false;
  }
  f.printf("%s,%lu\n", uid.c_str(), (unsigned long)epoch);
  f.close();
  queueHasData = true;
  return true;
}

// ส่งคิวย้อนหลังครั้งละไม่เกิน BATCH_SIZE รายการ แล้วลบเฉพาะส่วนที่เซิร์ฟเวอร์รับแล้ว (HTTP 200)
void flushQueue() {
  if (!queueHasData || WiFi.status() != WL_CONNECTED) return;

  File f = LittleFS.open(QUEUE_FILE, FILE_READ);
  if (!f) {
    queueHasData = false;
    return;
  }

  JsonDocument doc;
  JsonArray taps = doc["taps"].to<JsonArray>();
  while (f.available() && taps.size() < BATCH_SIZE) {
    String line = f.readStringUntil('\n');
    line.trim();
    int comma = line.indexOf(',');
    if (comma <= 0) continue;  // บรรทัดเสีย ข้าม
    JsonObject o = taps.add<JsonObject>();
    o["cardUid"] = line.substring(0, comma);
    uint32_t epoch = (uint32_t)strtoul(line.substring(comma + 1).c_str(), nullptr, 10);
    if (epoch >= MIN_VALID_EPOCH) o["tappedAt"] = epoch;  // ไม่มีเวลา -> เซิร์ฟเวอร์ใช้เวลาที่รับแทน
  }
  const size_t consumed = f.position();

  if (taps.size() == 0) {
    f.close();
    LittleFS.remove(QUEUE_FILE);
    queueHasData = false;
    return;
  }

  String payload;
  serializeJson(doc, payload);
  HttpResult r = httpRequest(true, "/api/device/taps/batch", payload);
  if (r.code != 200) {
    Serial.printf("[queue] ส่งย้อนหลังไม่สำเร็จ (HTTP %d) เก็บไว้ส่งใหม่\n", r.code);
    f.close();
    return;
  }
  Serial.printf("[queue] ส่งย้อนหลังสำเร็จ %u รายการ\n", (unsigned)taps.size());

  // คัดลอกส่วนที่เหลือไปไฟล์ชั่วคราว แล้วแทนที่ไฟล์คิวเดิม
  f.seek(consumed);
  File tmp = LittleFS.open(QUEUE_TMP, FILE_WRITE);
  size_t remaining = 0;
  if (tmp) {
    uint8_t buf[256];
    while (f.available()) {
      size_t n = f.read(buf, sizeof(buf));
      tmp.write(buf, n);
      remaining += n;
    }
    tmp.close();
  }
  f.close();
  LittleFS.remove(QUEUE_FILE);
  if (remaining > 0) {
    LittleFS.rename(QUEUE_TMP, QUEUE_FILE);
  } else {
    LittleFS.remove(QUEUE_TMP);
    queueHasData = false;
  }
}

// =====================================================================
// แตะบัตร
// =====================================================================
String readUid() {
  String uid;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += '0';
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  return uid;
}

void handleTap(const String &uid) {
  const uint32_t epoch = nowEpoch();
  Serial.printf("[tap] uid=%s epoch=%lu\n", uid.c_str(), (unsigned long)epoch);

  JsonDocument doc;
  doc["cardUid"] = uid;
  if (epoch) doc["tappedAt"] = epoch;
  String payload;
  serializeJson(doc, payload);

  HttpResult r = httpRequest(true, "/api/device/taps", payload);

  if (r.code == 200) {
    JsonDocument res;
    if (!deserializeJson(res, r.body)) {
      const char *result = res["result"] | "";
      Serial.printf("[tap] ผลลัพธ์: %s\n", result);
      if (strcmp(result, "recorded") == 0) signalOk();
      else if (strcmp(result, "duplicate") == 0 || strcmp(result, "outside_window") == 0) signalWarn();
      else signalError();
    } else {
      signalError();
    }
    return;
  }

  // ติดต่อเซิร์ฟเวอร์ไม่ได้ หรือเซิร์ฟเวอร์ล่ม (5xx) -> เก็บไว้ส่งทีหลัง
  if (r.code <= 0 || r.code >= 500) {
    Serial.printf("[tap] ส่งไม่ได้ (HTTP %d) เก็บเข้าคิวออฟไลน์\n", r.code);
    if (enqueueTap(uid, epoch)) signalWarn();
    else signalError();
    return;
  }

  // 4xx เช่น API key ผิด -> ไม่เก็บคิว (ส่งซ้ำก็ไม่ผ่าน) แจ้งเตือนให้ตรวจการตั้งค่า
  Serial.printf("[tap] เซิร์ฟเวอร์ปฏิเสธ (HTTP %d): %s\n", r.code, r.body.c_str());
  signalError();
}

// =====================================================================
void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[wifi] เชื่อมต่อ %s ", WIFI_SSID);
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_BOOT_WAIT_MS) {
    delay(300);
    Serial.print('.');
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " สำเร็จ" : " ยังไม่สำเร็จ (ทำงานแบบออฟไลน์ก่อน)");
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_OK, OUTPUT);
  pinMode(PIN_LED_ERR, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  if (!LittleFS.begin(true)) Serial.println("[fs] เปิด LittleFS ไม่ได้ (คิวออฟไลน์จะใช้ไม่ได้)");
  queueHasData = LittleFS.exists(QUEUE_FILE);

#if USE_RTC
  Wire.begin(21, 22);
  if (rtc.begin()) {
    rtcTrusted = !rtc.lostPower() && rtc.now().unixtime() >= MIN_VALID_EPOCH;
    Serial.printf("[rtc] พบ DS3231 เวลา%s\n", rtcTrusted ? "เชื่อถือได้" : "ยังไม่ถูกตั้ง (จะตั้งจากเซิร์ฟเวอร์)");
  } else {
    Serial.println("[rtc] ไม่พบ DS3231 ตรวจสายต่อ (จะพึ่งเวลาจากเซิร์ฟเวอร์)");
  }
#endif

  SPI.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI, PIN_RC522_SS);
  rfid.PCD_Init();
  Serial.print("[rfid] ");
  rfid.PCD_DumpVersionToSerial();

  connectWifi();
  pingServer();
  lastHeartbeat = millis();

  signalOk();  // เสียงบอกว่าพร้อมใช้งาน
  Serial.println("[พร้อม] รอการแตะบัตร");
}

void loop() {
  const uint32_t ms = millis();

  if (WiFi.status() != WL_CONNECTED && ms - lastWifiRetry > WIFI_RETRY_MS) {
    lastWifiRetry = ms;
    WiFi.reconnect();
  }

  if (WiFi.status() == WL_CONNECTED) {
    if (ms - lastHeartbeat > HEARTBEAT_MS) {
      lastHeartbeat = ms;
      pingServer();
    }
    if (ms - lastFlush > FLUSH_INTERVAL_MS) {
      lastFlush = ms;
      flushQueue();
    }
  }

  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    delay(20);
    return;
  }

  const String uid = readUid();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  if (uid == lastUid && ms - lastUidAt < SAME_CARD_IGNORE_MS) return;
  lastUid = uid;
  lastUidAt = ms;

  handleTap(uid);
  lastUidAt = millis();  // นับเวลาหลังเสียงเตือนจบ เพื่อไม่ให้บัตรเดิมที่ยังค้างถูกอ่านซ้ำ
}
