import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return res.destroy();

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input',
        details: err.issues,
      },
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    if (err.code === 'P2002') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Already exists' } });
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'Request body too large' } });
  }
  if (e?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
  }

  logger.error({ err, path: req.path, method: req.method }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
}
