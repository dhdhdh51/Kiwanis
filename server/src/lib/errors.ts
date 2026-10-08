export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE'
  | 'GONE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'QUOTA_EXCEEDED'
  | 'UPLOAD_INCOMPLETE'
  | 'INVALID_FILE'
  | 'PASSWORD_REQUIRED'
  | 'ACCOUNT_SUSPENDED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have access to this resource') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Not found') => new HttpError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, 'CONFLICT', msg, details);
