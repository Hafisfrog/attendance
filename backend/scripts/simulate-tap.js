// จำลองการแตะบัตรเหมือน ESP32 เพื่อทดสอบระบบโดยไม่ต้องมีอุปกรณ์
// ใช้: npm run simulate -- <apiKey> <cardUid> [baseUrl] [tappedAt(ISO)]
// ตัวอย่าง: npm run simulate -- 1.abcdef... AA000001 http://localhost:3000
const [apiKey, cardUid, baseUrl = 'http://localhost:3000', tappedAt] = process.argv.slice(2);

if (!apiKey || !cardUid) {
  console.error('วิธีใช้: npm run simulate -- <apiKey> <cardUid> [baseUrl] [tappedAt]');
  process.exit(1);
}

const res = await fetch(`${baseUrl}/api/device/taps`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
  body: JSON.stringify({ cardUid, ...(tappedAt && { tappedAt }) }),
});

console.log(`HTTP ${res.status}`);
console.log(JSON.stringify(await res.json(), null, 2));
