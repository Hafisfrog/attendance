import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ตอนพัฒนา: เรียก /api จากหน้าเว็บแล้วส่งต่อไปที่ backend (พอร์ต 3000) จึงไม่ติดปัญหา CORS
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:3000', changeOrigin: true },
    },
  },
});
