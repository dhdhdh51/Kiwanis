import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// BigInt values (file sizes, quotas) are serialised as numbers in JSON responses.
// Number.MAX_SAFE_INTEGER bytes ≈ 8 PiB, which is far beyond any single quota.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};
