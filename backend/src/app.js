import './utils/bigint.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import classroomsRoutes from './routes/classrooms.js';
import studentsRoutes from './routes/students.js';
import cardsRoutes from './routes/cards.js';
import devicesRoutes from './routes/devices.js';
import prayerWindowsRoutes from './routes/prayerWindows.js';
import attendanceRoutes from './routes/attendance.js';
import deviceApiRoutes from './routes/deviceApi.js';
import eventsRoutes from './routes/events.js';

export const app = express();

// ถ้าอยู่หลัง reverse proxy (nginx ฯลฯ) ให้ตั้ง TRUST_PROXY=1 เพื่อให้ rate limit เห็น IP จริง
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || true);

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/classrooms', classroomsRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/cards', cardsRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/prayer-windows', prayerWindowsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/device', deviceApiRoutes); // สำหรับอุปกรณ์ ESP32
app.use('/api/events', eventsRoutes);

app.use(notFound);
app.use(errorHandler);
