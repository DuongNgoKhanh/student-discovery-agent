import { z } from 'zod';

export const versionCreateSchema = z.object({
  version: z.string().min(5).max(50).regex(/^\d+\.\d+\.\d+$/, 'Version must be semantic (x.x.x)'),
  description: z.string().max(500).nullish(),
});
export type VersionCreate = z.infer<typeof versionCreateSchema>;

export interface VersionResponse {
  id: number;
  version: string;
  description: string | null;
  is_current: boolean;
  is_deprecated: boolean;
  created_at: string;
  updated_at: string | null;
}
