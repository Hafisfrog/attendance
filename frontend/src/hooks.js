import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// รับเหตุการณ์แตะบัตรแบบเรียลไทม์ (Server-Sent Events) EventSource ต่อใหม่เองเมื่อหลุด
export function useTapStream(onTap) {
  const handler = useRef(onTap);
  handler.current = onTap; // ใช้ callback ล่าสุดเสมอ โดยไม่ต้องเปิดการเชื่อมต่อใหม่
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource(api.eventsUrl());
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener('tap', (e) => {
      try {
        handler.current(JSON.parse(e.data));
      } catch {
        /* ข้อมูลเสีย ข้ามไป */
      }
    });
    return () => source.close();
  }, []);

  return connected;
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
