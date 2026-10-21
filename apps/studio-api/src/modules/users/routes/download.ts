import { z } from 'zod';
import { ProductError } from '@/http/errors';
import { withHandler } from '@/http/handler';
import { getObject } from '@/infrastructure/storage/objects';
import { publicBucket } from '@/modules/users/avatar.service';


const query = z.object({ object_name: z.string().min(1) });

export const handleGet = withHandler(async (req) => {
  const { object_name } = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const slash = object_name.indexOf('/');
  const bucket = object_name.slice(0, slash);
  const key = object_name.slice(slash + 1);
  const notFound = () => new ProductError(404, 'RES_OBJECT_NOT_FOUND', 'Object not found');
  // URLSearchParams has decoded one layer; inspect every remaining encoding layer before storage.
  let decoded = key;
  for (let depth = 0; ; depth += 1) {
    if (depth > 8 || /[\x00-\x1f\x7f-\x9f\\]/.test(decoded) || decoded.split('/').some((p) => p === '.' || p === '..' || p === '')) throw notFound();
    if (!decoded.includes('%')) break;
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { throw notFound(); }
    if (next === decoded) break;
    decoded = next;
  }
  if (slash < 1 || !key || bucket !== publicBucket()) throw notFound();
  const obj = await getObject(bucket, key);
  if (!obj) throw notFound();
  const filename = (key.split('/').pop() ?? 'download').replace(/[^A-Za-z0-9._-]/g, '_');
  return new Response(obj.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'content-length': String(obj.size),
      'content-disposition': `attachment; filename="${filename || 'download'}"`,
    },
  });
});
