/** Shared API/UI session contract. Apps supply their own Zod instance. */
export type Session =
  | { principal: { type: 'user'; id: string }; is_admin: false }
  | { principal: { type: 'admin'; id: 'admin' }; is_admin: true };

// Dependency injection keeps this shared source independent of either app's node_modules.
interface ZodBuilder {
  string(): { regex(pattern: RegExp): unknown };
  literal(value: string | boolean): unknown;
  object(shape: never): unknown;
  union(options: never): unknown;
}
export function createSessionSchema(z: ZodBuilder): { parse(value: unknown): Session } {
  const user = z.object({
    principal: z.object({ type: z.literal('user'), id: z.string().regex(/^[1-9]\d*$/) } as never),
    is_admin: z.literal(false),
  } as never);
  const admin = z.object({
    principal: z.object({ type: z.literal('admin'), id: z.literal('admin') } as never),
    is_admin: z.literal(true),
  } as never);
  return z.union([user, admin] as never) as { parse(value: unknown): Session };
}
