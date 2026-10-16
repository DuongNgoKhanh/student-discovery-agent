import 'server-only';
import { ProductError } from '../http/errors';
import type { RouteContext } from '../http/types';
import { userIdSchema } from './users.schemas';

export async function userIdParam(route: RouteContext<{ user_id: string }>): Promise<number> {
  const parsed = userIdSchema.safeParse((await route.params).user_id);
  if (!parsed.success) throw new ProductError(422, 'INVALID_INPUT', 'Invalid user id', false, { kind: 'validation' });
  return parsed.data;
}

export const queryOf = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);
