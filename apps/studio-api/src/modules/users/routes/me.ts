import { requireUser } from '@/modules/auth/auth.service';
import { getProductDatabase } from '@/infrastructure/db/client';
import { readJsonBody } from '@/http/body';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { adminToPublic, toUserProfile } from '@/modules/users/users.profile';
import { selfUpdateSchema } from '@/modules/users/users.schemas';
import { updateUser } from '@/modules/users/users.service';


export const handleGet = withHandler(async (req, ctx) => {
  const user = await requireUser(req, getProductDatabase());
  return success(toUserProfile(user), ctx);
});

export const handlePut = withHandler(async (req, ctx) => {
  const db = getProductDatabase();
  const user = await requireUser(req, db);
  const input = selfUpdateSchema.parse(await readJsonBody(req));
  // Only profile fields: email, id, is_deleted and the password hash are never touched here.
  return success(adminToPublic(await updateUser(db, user.id, input)), ctx);
});
