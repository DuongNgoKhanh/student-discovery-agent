import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { parse } from 'yaml';

const root = resolve(__dirname, '../../../../contracts');
const fixture = (name: string) => JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8').replace(/^﻿/, ''));
const NODE_TYPES = ['start', 'if_else', 'intent_classifier', 'llm', 'agent', 'knowledge_retrieval',
  'tool', 'profile_propose', 'assign', 'answer'];

function contractAjv() {
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addFormat('date-time', true);
  for (const format of ['normalized-display-name', 'display-name']) ajv.addFormat(format, true);
  const register = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) register(path);
      else if (entry.name.endsWith('.yaml')) {
        const id = `https://contracts.local/${relative(root, path).replaceAll('\\', '/')}`;
        ajv.addSchema({ ...parse(readFileSync(path, 'utf8')), $id: id });
      }
    }
  };
  register(join(root, 'openapi'));
  return ajv;
}
function validator(file: string, name: string) {
  return contractAjv().compile({ $ref: `https://contracts.local/openapi/${file}#/components/schemas/${name}` });
}

describe('chatflow snapshot contract parity', () => {
  const minimal = fixture('agent-snapshot-chatflow-min.json');
  const validate = validator('schemas/session-lifecycle.yaml', 'AgentSnapshotV1');

  it('accepts the minimal chatflow fixture and the legacy demo fixture', () => {
    expect(validate(minimal), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(fixture('agent-snapshot-demo.json')), JSON.stringify(validate.errors)).toBe(true);
  });

  const withNodes = (nodes: unknown[]) => ({ ...minimal, workflow: { ...minimal.workflow, nodes } });
  const node = (patch: Record<string, unknown>) => ({ ...minimal.workflow.nodes[1], ...patch });
  it.each([
    ['unknown mode', { ...minimal, mode: 'graph' }],
    ['code node', withNodes([node({ type: 'code' })])],
    ['http node', withNodes([node({ type: 'http' })])],
    ['id with uppercase', withNodes([node({ id: 'Bad-Id' })])],
    ['51 nodes', withNodes(Array.from({ length: 51 }, (_, i) => ({ id: `n${i}`, type: 'start' })))],
    ['unknown node field', withNodes([node({ extra: 'x' })])],
    ['zero budget', { ...minimal, workflow: { ...minimal.workflow, budget: { ...minimal.workflow.budget, max_nodes: 0 } } }],
    ['persona case without turns', { ...minimal, persona_cases: [{ ...minimal.persona_cases[0], turns: [] }] }],
  ])('rejects %s', (_label, content) => {
    expect(validate(content)).toBe(false);
  });
});

describe('workflow node-type catalog contract', () => {
  const catalog = fixture('workflow-node-types.json');
  const validate = validator('schemas/chatflow-authoring.yaml', 'WorkflowNodeTypeCatalog');
  const minimal = fixture('agent-snapshot-chatflow-min.json');

  it('matches the schema and covers exactly the ten node types', () => {
    expect(validate(catalog), JSON.stringify(validate.errors)).toBe(true);
    expect(catalog.node_types.map((t: { type: string }) => t.type).sort()).toEqual([...NODE_TYPES].sort());
  });

  it('keeps the node type enum of the snapshot schema in step with the catalog', () => {
    const snapshotSchema = parse(readFileSync(join(root, 'openapi/schemas/chatflow.yaml'), 'utf8'));
    expect([...snapshotSchema.components.schemas.ChatflowNodeType.enum].sort()).toEqual([...NODE_TYPES].sort());
  });

  it('publishes a compilable config JSON Schema for every node type', () => {
    for (const nodeType of catalog.node_types) {
      expect(() => new Ajv({ strict: false }).compile(nodeType.config_schema), nodeType.type).not.toThrow();
      expect(() => new Ajv({ strict: false }).compile(nodeType.output_schema), nodeType.type).not.toThrow();
    }
  });

  it('accepts the config of every node in the minimal chatflow fixture', () => {
    for (const node of minimal.workflow.nodes) {
      const entry = catalog.node_types.find((t: { type: string }) => t.type === node.type);
      const check = new Ajv({ strict: false }).compile(entry.config_schema);
      expect(check(node.config ?? {}), `${node.id}: ${JSON.stringify(check.errors)}`).toBe(true);
    }
  });

  it('rejects a catalog that misses a required node type field', () => {
    const broken = structuredClone(catalog);
    delete broken.node_types[0].config_schema;
    expect(validate(broken)).toBe(false);
  });

  it('declares handles for the classifier from its labels', () => {
    const classifier = catalog.node_types.find((t: { type: string }) => t.type === 'intent_classifier');
    expect(classifier.handles).toEqual({ static: ['other', 'error'], from_config: { array: 'labels', id_field: 'id' } });
  });
});

describe('workflow debug run contract', () => {
  const example = fixture('workflow-debug-run.json');
  const request = validator('schemas/chatflow-authoring.yaml', 'WorkflowDebugRunRequest');
  const result = validator('schemas/chatflow-authoring.yaml', 'WorkflowDebugRunResult');
  const streamEvent = validator('schemas/chatflow-authoring.yaml', 'WorkflowDebugStreamEvent');

  it('accepts the example request and result', () => {
    expect(request(example.request), JSON.stringify(request.errors)).toBe(true);
    expect(result(example.result), JSON.stringify(result.errors)).toBe(true);
  });

  it('requires exactly one of message and interaction', () => {
    expect(request({ state: example.request.state })).toBe(false);
    expect(request({ ...example.request, interaction: { type: 'confirm_profile' } })).toBe(false);
    const rest = structuredClone(example.request);
    delete rest.message;
    expect(request({ ...rest, interaction: { type: 'confirm_profile' } })).toBe(true);
  });

  it('rejects fields outside the contract', () => {
    expect(request({ ...example.request, conversation_id: 'conv_1' })).toBe(false);
  });

  it('accepts every stream event of the example and nothing unknown', () => {
    for (const event of example.stream) {
      expect(streamEvent(event), `${event.event}: ${JSON.stringify(streamEvent.errors)}`).toBe(true);
    }
    expect(streamEvent({ event: 'workflow.node_exploded' })).toBe(false);
  });

  it('keeps the stream path equal to the result path', () => {
    const started = example.stream.filter((e: { event: string }) => e.event === 'workflow.node_started')
      .map((e: { node_id: string }) => e.node_id);
    expect(started).toEqual(example.result.path);
  });

  it('rejects a result that has no expiry', () => {
    const broken = structuredClone(example.result);
    delete broken.expires_at;
    expect(result(broken)).toBe(false);
  });

  it('validates a completed event only when it carries the result', () => {
    expect(streamEvent({ event: 'completed', result: example.result }), JSON.stringify(streamEvent.errors)).toBe(true);
    expect(streamEvent({ event: 'completed' })).toBe(false);
  });

  it('rejects a well-formed node_started with an unknown event name', () => {
    expect(streamEvent({ event: 'workflow.node_exploded', node_id: 'start', type: 'start', order: 1 })).toBe(false);
  });

  it('rejects a node_started whose started_at is not a string', () => {
    const started = example.stream[0];
    expect(streamEvent({ ...started, started_at: '2026-11-10T08:00:00Z' }), JSON.stringify(streamEvent.errors)).toBe(true);
    expect(streamEvent({ ...started, started_at: 5 })).toBe(false);
  });

  it('carries tokens and error on node_finished', () => {
    const finished = example.stream.find((e: { event: string }) => e.event === 'workflow.node_finished');
    expect(streamEvent(finished), JSON.stringify(streamEvent.errors)).toBe(true);
    expect(finished.tokens).toEqual({ input: 0, output: 0 });
    expect(streamEvent({ ...finished, tokens: { input: -1, output: 0 } })).toBe(false);
  });
});
