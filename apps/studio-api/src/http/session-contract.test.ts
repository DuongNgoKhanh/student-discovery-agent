import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { parse } from 'yaml';

const root = resolve(__dirname, '../../../../contracts');
const fixture = JSON.parse(readFileSync(join(root, 'fixtures/session-lifecycle.json'), 'utf8').replace(/^\uFEFF/, ''));
const turns = JSON.parse(readFileSync(join(root, 'fixtures/session-turns.json'), 'utf8').replace(/^\uFEFF/, ''));
function validUtcTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0)
    && hour <= 23 && minute <= 59 && second <= 59;
}
function validator(file: string, name: string) {
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addFormat('date-time', validUtcTimestamp);
  for (const format of ['normalized-display-name', 'display-name']) ajv.addFormat(format, true);
  function register(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) register(path);
      else if (entry.name.endsWith('.yaml')) {
        const id = `https://contracts.local/${relative(root, path).replaceAll('\\', '/')}`;
        ajv.addSchema({ ...parse(readFileSync(path, 'utf8')), $id: id });
      }
    }
  }
  register(join(root, 'openapi'));
  return ajv.compile({ $ref: `https://contracts.local/openapi/${file}#/components/schemas/${name}` });
}

describe('session lifecycle public and internal contracts', () => {
  it('accepts only the five closed acknowledgement fields', () => {
    const validate = validator('schemas/session-lifecycle.yaml', 'ClosedConversationAcknowledgement');
    expect(validate(fixture.closed_ack), JSON.stringify(validate.errors)).toBe(true);
    for (const field of ['display_name', 'answers', 'result', 'owner_id']) {
      expect(validate({ ...fixture.closed_ack, [field]: 'secret' })).toBe(false);
    }
  });
  it.each([
    ['2024-02-29T12:30:45Z', true], ['2024-02-29T12:30:45.123456Z', true],
    ['not-a-dateZ', false], ['2023-02-29T12:30:45Z', false],
    ['2024-04-31T12:30:45Z', false], ['2024-02-29T12:30:45', false],
  ])('validates actual UTC calendar timestamp %s', (timestamp, accepted) => {
    const validate = validator('schemas/session-lifecycle.yaml', 'ClosedConversationAcknowledgement');
    expect(validate({ ...fixture.closed_ack, closed_at: timestamp, expires_at: timestamp })).toBe(accepted);
  });
  it('registers adaptive v2 without widening legacy view v1', () => {
    const validate = validator('schemas/activity.yaml', 'ActivityView');
    expect(validate(fixture.adaptive_view), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...fixture.adaptive_view, schema_version: 1 })).toBe(false);
    expect(validate({ ...fixture.adaptive_view, type: 'personality_assessment' })).toBe(false);
    expect(validate({ ...fixture.adaptive_view, progress: { ...fixture.adaptive_view.progress, total: 30 } })).toBe(false);
    const legacy = validator('schemas/activity.yaml', 'AssessmentProgress');
    expect(legacy({ completed: 7, total: 6 })).toBe(false);
  });
  it.each(['collecting_name', 'in_progress'])('rejects completed progress before activity completion: %s', (status) => {
    const validate = validator('schemas/activity.yaml', 'ActivityView');
    const collecting = status === 'collecting_name';
    const view = {
      ...fixture.adaptive_view, status,
      ...(collecting ? { display_name: null, current_question: null, clarification: null, answers: [] } : {}),
      progress: { ...fixture.adaptive_view.progress, completed: collecting ? 0 : 14, phase: 'completed', total: 14 },
    };
    expect(validate({ ...view, progress: { ...view.progress, phase: collecting ? 'baseline' : 'adaptive', total: null } }),
      JSON.stringify(validate.errors)).toBe(true);
    expect(validate(view)).toBe(false);
  });
  it.each(['ended', 'expired'])('preserves partial or completed progress after activity closure: %s', (status) => {
    const validate = validator('schemas/activity.yaml', 'ActivityView');
    for (const completed of [false, true]) {
      const view = {
        ...fixture.adaptive_view, status, current_question: null, clarification: null,
        progress: { ...fixture.adaptive_view.progress, phase: completed ? 'completed' : 'adaptive', total: completed ? 14 : null },
        result: completed ? { result_id: 'res1', result_revision: 1, validity: 'valid' } : null,
      };
      expect(validate(view), JSON.stringify(validate.errors)).toBe(true);
    }
  });
  it('negotiates adaptive without accepting owner injection', () => {
    const validate = validator('public/conversation-api.yaml', 'CreateConversationInput');
    expect(validate(fixture.adaptive_create), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...fixture.adaptive_create, owner_id: 'injected' })).toBe(false);
  });
  it('bounds create/end keys while leaving semantic profile negotiation to the service', () => {
    for (const name of ['CreateConversationInput', 'EndConversationInput']) {
      const validate = validator('public/conversation-api.yaml', name);
      const extra = name === 'EndConversationInput' ? { expected_revision: 0 } : {};
      expect(validate({ ...extra, idempotency_key: 'k'.repeat(256) })).toBe(true);
      expect(validate({ ...extra, idempotency_key: 'k'.repeat(257) })).toBe(false);
    }
    const create = validator('public/conversation-api.yaml', 'CreateConversationInput');
    expect(create({ idempotency_key: 'key', accepted_activity_profiles: ['future.v99'] })).toBe(true);
    expect(create({ idempotency_key: 'key', accepted_activity_profiles: [99] })).toBe(false);
  });
  it('accepts server-built knowledge cards', () => {
    const validate = validator('schemas/typed-blocks.yaml', 'TypedBlock');
    const card = { block_id: 'b1', type: 'knowledge_card', schema_version: 1, title: 'Trường A',
      fields: [{ label: 'Học phí', value: '25.000.000' }], source_url: 'https://ihrd.vn/a',
      document_id: 'doc_a', revision: 2, updated_at: '2026-10-27T03:00:00Z' };
    expect(validate(card), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...card, source_url: undefined })).toBe(true);
    expect(validate({ ...card, source_url: null }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...card, fields: [] })).toBe(false);
    expect(validate({ ...card, schema_version: 2 })).toBe(false);
  });
  it('supports adaptive question and clarification blocks v2', () => {
    const validate = validator('schemas/typed-blocks.yaml', 'TypedBlock');
    for (const [type, extra] of [
      ['assessment_question', { question_id: 'q15', title: 'Question', options: fixture.adaptive_view.current_question.options }],
      ['assessment_clarification', { proposal_id: 'prop1', question_id: 'q15', activity_revision: 16, title: 'Clarify', candidates: [{ id: 'c1', option_id: 'rating3', label: 'Three' }] }],
    ] as const) {
      const block = { block_id: 'b1', activity_id: 'act_demo', type, schema_version: 2, progress: fixture.adaptive_view.progress, ...extra };
      expect(validate(block), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ ...block, schema_version: 1 })).toBe(false);
    }
  });
  it('keeps ShareCard summary.v1 a closed allowlist', () => {
    const validate = validator('public/result-api.yaml', 'ShareCard');
    const doc = parse(readFileSync(join(root, 'openapi/public/result-api.yaml'), 'utf8'));
    const card = doc.components.examples.ShareSummary.value.data;
    expect(validate(card), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...card, scores: { R: 99 } })).toBe(false);
  });
});

describe('B-02 structured turn contract', () => {
  it.each(['name_input', 'option_input', 'message_input', 'text_input', 'confirm_input', 'edit_input'])(
    'accepts shared turn input %s', (name) => {
      const validate = validator('schemas/chat.yaml', 'ConversationTurnInput');
      expect(validate(turns[name]), JSON.stringify(validate.errors)).toBe(true);
    });
  it('rejects malformed turn inputs', () => {
    const validate = validator('schemas/chat.yaml', 'ConversationTurnInput');
    const option = turns.option_input;
    expect(validate({ ...option, payload: { ...option.payload, text: 'both' } })).toBe(false);
    expect(validate({ ...turns.name_input, owner_id: 'spoof' })).toBe(false);
    expect(validate({ ...turns.name_input, expected_revision: '1' })).toBe(false);
    expect(validate({ ...turns.name_input, idempotency_key: 'k'.repeat(256) })).toBe(true);
    expect(validate({ ...turns.name_input, idempotency_key: 'k'.repeat(257) })).toBe(false);
    // Name length is enforced after normalization by the runtime, never by a raw maxLength.
    expect(validate({ ...turns.name_input, payload: { display_name: ' '.repeat(60) + 'Lan' } })).toBe(true);
  });
  it('validates the committed turn result and typed conflict', () => {
    const result = validator('schemas/chat.yaml', 'ConversationTurnResult');
    expect(result(turns.question_result), JSON.stringify(result.errors)).toBe(true);
    expect(result({ ...turns.question_result, blocks: [] })).toBe(false);
    const envelope = validator('schemas/common.yaml', 'ErrorEnvelope');
    expect(envelope(turns.conflict_error), JSON.stringify(envelope.errors)).toBe(true);
    const details = turns.conflict_error.error.details;
    expect(envelope({ ...turns.conflict_error, error: { ...turns.conflict_error.error,
      details: { ...details, resource_kind: 'result' } } })).toBe(false);
  });
});

describe('agent snapshot contract parity', () => {
  const demo = JSON.parse(readFileSync(join(root, 'fixtures/agent-snapshot-demo.json'), 'utf8').replace(/^﻿/, ''));
  it('accepts the demo fixture and rejects values past the runtime ceilings', () => {
    const validate = validator('schemas/session-lifecycle.yaml', 'AgentSnapshotV1');
    expect(validate(demo), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...demo, limits: { ...demo.limits, max_tool_steps: 9 } })).toBe(false);
    expect(validate({ ...demo, persona: { ...demo.persona, name: '   ' } })).toBe(false);
    expect(validate({ ...demo, guardrails: { ...demo.guardrails,
      blocked_topics: Array.from({ length: 21 }, (_, i) => `topic ${i}`) } })).toBe(false);
  });
});

describe('message and response contract', () => {
  it('accepts one content part and the compact response', () => {
    const input = validator('schemas/chat.yaml', 'MessageInput');
    expect(input({ expected_revision: 0, idempotency_key: 'k', content: [{ type: 'text', text: 'chào' }] })).toBe(true);
    expect(input({ expected_revision: 0, idempotency_key: 'k', content: [] })).toBe(false);
    expect(input({ expected_revision: 0, idempotency_key: 'k',
      content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe(false);
    const response = validator('schemas/chat.yaml', 'TurnResponse');
    expect(response({ id: `resp_${'a'.repeat(32)}`, conversation_id: 'c1', status: 'in_progress', revision: 0,
      input_message_id: 'm1', created_at: '2026-10-26T00:00:00Z', output: null, activity: null, error: null,
      completed_at: null })).toBe(true);
  });
});
