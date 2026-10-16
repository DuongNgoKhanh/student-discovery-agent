import { requireUser } from '@/server/auth/auth.service';
import { getProductDatabase } from '@/server/db/client';
import { ProductError } from '@/server/http/errors';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';
import { MAX_AVATAR_BYTES, tooLarge, uploadAvatar } from '@/server/users/avatar.service';

export const runtime = 'nodejs';

export const POST = withHandler(async (req, ctx) => {
  const db = getProductDatabase();
  const user = await requireUser(req, db);
  // Reject early (before buffering) when the declared size exceeds 1 MiB + multipart overhead.
  if (Number(req.headers.get('content-length') ?? 0) > MAX_AVATAR_BYTES + 65536) throw tooLarge();
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
