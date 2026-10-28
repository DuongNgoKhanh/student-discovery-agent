import { z } from 'zod';

/**
 * Typed blocks của response chat. Nguồn: docs/openapi/schemas/typed-blocks.yaml.
 * Mọi block đều `.passthrough()`: field mới của cùng version được bỏ qua, không làm hỏng render.
 */

/** ID ổn định từ backend: chữ/số đầu, sau đó `._-`. */
export const idSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

const blockBase = {
  block_id: idSchema,
  schema_version: z.literal(1),
};

export const textBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('text'),
    content: z.string().min(1),
  })
  .passthrough();

export const assessmentOptionSchema = z
  .object({ id: idSchema, label: z.string().min(1) })
  .passthrough();

export const assessmentProgressSchema = z
  .object({
    completed: z.number().int().min(0).max(6),
    total: z.literal(6),
  })
  .passthrough();

export const assessmentQuestionBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('assessment_question'),
    activity_id: idSchema,
    question_id: idSchema,
    title: z.string().min(1),
    options: z.array(assessmentOptionSchema).min(2),
    progress: assessmentProgressSchema,
  })
  .passthrough();

export const clarificationCandidateSchema = z
  .object({
    id: idSchema,
    option_id: idSchema,
    label: z.string().min(1),
  })
  .passthrough();

export const assessmentClarificationBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('assessment_clarification'),
    activity_id: idSchema,
    proposal_id: idSchema,
    question_id: idSchema,
    activity_revision: z.number().int().min(0),
    title: z.string().min(1),
    candidates: z.array(clarificationCandidateSchema).min(1),
    progress: assessmentProgressSchema,
  })
  .passthrough();

export const houseSchema = z
  .object({
    house_id: idSchema,
    name: z.string().min(1),
    theme_ref: idSchema,
    mascot_ref: idSchema,
  })
  .passthrough();

export const personalityCardDataSchema = z
  .object({
    display_name: z.string().min(1),
    house: houseSchema,
    strengths: z.array(z.string().min(1)).min(1),
    tendencies: z.array(z.string().min(1)).min(1),
    career_groups: z.array(z.string().min(1)).min(1),
    quote: z.string().min(1),
    is_demo: z.boolean(),
  })
  .passthrough();

export const personalityCardBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('personality_card'),
    activity_id: idSchema,
    result_id: idSchema,
    result_revision: z.number().int().min(1),
    data: personalityCardDataSchema,
  })
  .passthrough();

/** Các block UI hiểu. Thêm loại mới = thêm schema ở đây và một nhánh trong BlockRenderer. */
export const knownBlockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  assessmentQuestionBlockSchema,
  assessmentClarificationBlockSchema,
  personalityCardBlockSchema,
]);

export type TextBlock = z.infer<typeof textBlockSchema>;
export type AssessmentQuestionBlock = z.infer<typeof assessmentQuestionBlockSchema>;
export type AssessmentClarificationBlock = z.infer<typeof assessmentClarificationBlockSchema>;
export type PersonalityCardBlock = z.infer<typeof personalityCardBlockSchema>;
export type KnownBlock = z.infer<typeof knownBlockSchema>;

/**
 * Block sau khi kiểm tra. `unsupported` là block có type/version không hỗ trợ
 * hoặc sai schema: UI hiển thị thông báo không tương thích, không làm hỏng trang (FR-UI-01).
 */
export type RenderableBlock =
  | { kind: 'known'; block: KnownBlock }
  | { kind: 'unsupported'; blockId: string | null; type: string | null };

export function parseBlock(raw: unknown): RenderableBlock {
  const result = knownBlockSchema.safeParse(raw);
  if (result.success) return { kind: 'known', block: result.data };

  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    kind: 'unsupported',
    blockId: typeof obj.block_id === 'string' ? obj.block_id : null,
    type: typeof obj.type === 'string' ? obj.type : null,
  };
}
