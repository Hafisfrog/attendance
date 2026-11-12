const BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'prayer_token';

// localStorage อาจใช้ไม่ได้ (โหมดส่วนตัว ฯลฯ) จึงครอบ try/catch ไว้
export const tokenStore = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ไม่เป็นไร: จะต้องเข้าสู่ระบบใหม่ตอนรีเฟรชหน้า */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

function buildUrl(path, query) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  return url;
}

async function request(method, path, { query, body, raw } = {}) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบว่า backend ทำงานอยู่');
  }

  if (res.status === 401 && token && !path.startsWith('/api/auth/login')) {
    tokenStore.clear();
    onUnauthorized();
  }
  if (!res.ok) {
    let message = `เกิดข้อผิดพลาด (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ตอบกลับไม่ใช่ JSON */
    }
    throw new Error(message);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body: body ?? {} }),
  put: (path, body) => request('PUT', path, { body: body ?? {} }),
  del: (path, query) => request('DELETE', path, { query }),

  // ดาวน์โหลดไฟล์ที่ต้องแนบโทเค็น (เปิดลิงก์ตรง ๆ ไม่ได้)
  async download(path, query, fallbackName) {
    const res = await request('GET', path, { query, raw: true });
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = match?.[1] || fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  },

  // EventSource ตั้ง header เองไม่ได้ จึงส่งโทเค็นทาง query string
  eventsUrl() {
    return buildUrl('/api/events', { token: tokenStore.get() }).toString();
  },
};
