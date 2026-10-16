import { requireUser } from '@/server/auth/auth.service';
import { getProductDatabase } from '@/server/db/client';
import { ProductError } from '@/server/http/errors';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';
import { uploadAvatar } from '@/server/users/avatar.service';

export const runtime = 'nodejs';

export const POST = withHandler(async (req, ctx) => {
  const db = getProductDatabase();
  const user = await requireUser(req, db);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Expected multipart/form-data');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Multipart field "file" is required');
  return success(await uploadAvatar(db, user.id, file), ctx);
});
