import { z } from 'zod';

const schema = z.object({
  STUDIO_API_ORIGIN: z.string().url().default('http://127.0.0.1:3001'),
});
export type UiEnv = z.infer<typeof schema>;
export const parseUiEnv = (source: Record<string, string | undefined>): UiEnv => schema.parse(source);
export const getUiEnv = (): UiEnv => parseUiEnv(process.env);
