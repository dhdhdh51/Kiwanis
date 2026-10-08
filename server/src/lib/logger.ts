import { pino } from 'pino';

const dev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (dev ? 'debug' : 'info'),
  redact: ['req.headers.cookie', 'req.headers.authorization', 'password', 'newPassword', 'currentPassword'],
  ...(dev ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } } : {}),
});
