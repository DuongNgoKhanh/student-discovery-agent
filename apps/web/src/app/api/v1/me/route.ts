import { requireUser } from '@/server/auth/auth.service';
import { getProductDatabase } from '@/server/db/client';
import { readJsonBody } from '@/server/http/body';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';
import { adminToPublic, toUserProfile } from '@/server/users/users.profile';
import { selfUpdateSchema } from '@/server/users/users.schemas';
import { updateUser } from '@/server/users/users.service';

export const runtime = 'nodejs';

export const GET = withHandler(async (req, ctx) => {
  const user = await requireUser(req, getProductDatabase());
  return success(toUserProfile(user), ctx);
});

export const PUT = withHandler(async (req, ctx) => {
  const db = getProductDatabase();
  const user = await requireUser(req, db);
  const input = selfUpdateSchema.parse(await readJsonBody(req));
  // Only profile fields: email, id, is_deleted and the password hash are never touched here.
  return success(adminToPublic(await updateUser(db, user.id, input)), ctx);
});
