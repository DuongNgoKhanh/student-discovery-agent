import { z } from 'zod';
import { assessmentProgressSchema, idSchema } from './blocks';

/**
 * Trạng thái phiên đánh giá (QT-02). Nguồn: docs/openapi/schemas/activity.yaml.
 * `ended`/`expired` không nhận answer, confirm hay edit.
 */
export const activityStatusSchema = z.enum([
  'collecting_name',
  'in_progress',
  'completed',
  'ended',
  'expired',
]);
export type ActivityStatus = z.infer<typeof activityStatusSchema>;

export const activityQuestionSchema = z
  .object({
    question_id: idSchema,
    title: z.string().min(1),
    options: z.array(z.object({ id: idSchema, label: z.string().min(1) }).passthrough()).min(2),
  })
  .passthrough();

export const activityClarificationSchema = z
  .object({
    proposal_id: idSchema,
    question_id: idSchema,
    activity_revision: z.number().int().min(0),
    title: z.string().min(1),
    candidates: z
      .array(
        z.object({ id: idSchema, option_id: idSchema, label: z.string().min(1) }).passthrough(),
      )
      .min(1),
  })
  .passthrough();

export const activityAnswerSchema = z
  .object({
    answer_id: idSchema,
    question_id: idSchema,
    option_id: idSchema,
    ordinal: z.number().int().min(1),
    question: activityQuestionSchema.optional(),
  })
  .passthrough();

export const activityViewSchema = z
  .object({
    id: idSchema,
    conversation_id: idSchema,
    // v1: 6 câu cố định; v2: adaptive (số câu do engine quyết định trong khoảng min/max).
    type: z.enum(['personality_assessment', 'personality_assessment_adaptive']),
    schema_version: z.union([z.literal(1), z.literal(2)]),
    status: activityStatusSchema,
    revision: z.number().int().min(0),
    display_name: z.string().min(1).nullable(),
    progress: assessmentProgressSchema,
    current_question: activityQuestionSchema.nullable(),
    clarification: activityClarificationSchema.nullable(),
    answers: z.array(activityAnswerSchema),
    result: z
      .object({
        result_id: idSchema,
        result_revision: z.number().int().min(1),
      })
      .passthrough()
      .nullable(),
    is_demo: z.boolean(),
  })
  .passthrough();

export type ActivityView = z.infer<typeof activityViewSchema>;
export type ActivityQuestion = z.infer<typeof activityQuestionSchema>;
export type ActivityAnswer = z.infer<typeof activityAnswerSchema>;
