import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';

// Liveness only: does not touch DB/MinIO and needs no secrets at build time.
export const dynamic = 'force-dynamic';

export const GET = withHandler(async (_req, ctx) => success({ status: 'alive' }, ctx));
