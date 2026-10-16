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
  if (slash < 1 || !key || key.includes('..') || bucket !== publicBucket()) throw notFound();
  const obj = await getObject(bucket, key);
  if (!obj) throw notFound();
  const filename = (key.split('/').pop() ?? 'download').replace(/[^A-Za-z0-9._-]/g, '_');
  return new Response(obj.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(obj.size),
      'content-disposition': `attachment; filename=${filename}`,
    },
  });
});
