import { requireUser } from '@/modules/auth/auth.service';
import { getProductDatabase } from '@/infrastructure/db/client';
import { ProductError } from '@/http/errors';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { MAX_AVATAR_BYTES, tooLarge, uploadAvatar } from '@/modules/users/avatar.service';


export const handlePost = withHandler(async (req, ctx) => {
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
