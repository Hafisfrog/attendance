import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { bus } from '../events.js';

const router = Router();

const HEARTBEAT_MS = 25 * 1000;

// Server-Sent Events: หน้าเว็บเปิดด้วย new EventSource('/api/events?token=<JWT>')
// จะได้รับ event ชื่อ "tap" ทุกครั้งที่มีการแตะบัตร
router.get('/', async (req, res) => {
  await authenticate(req, { allowQuery: true });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const onTap = (payload) => res.write(`event: tap\ndata: ${JSON.stringify(payload)}\n\n`);
  bus.on('tap', onTap);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('tap', onTap);
  });
});

export default router;
