import type { ChatflowWorkflow, NodeTypeCatalog } from '../../types';

export interface VariableGroup {
  title: string;
  paths: string[];
}

function ancestors(workflow: ChatflowWorkflow, nodeId: string): Set<string> {
  const parents = new Map<string, string[]>();
  for (const edge of workflow.edges ?? []) {
    parents.set(edge.target, [...(parents.get(edge.target) ?? []), edge.source]);
  }
  const found = new Set<string>();
  const queue = [...(parents.get(nodeId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (found.has(id) || id === nodeId) continue;
    found.add(id);
    queue.push(...(parents.get(id) ?? []));
  }
  return found;
}

/**
 * Variables a node can read, grouped by namespace, for pickers. Node outputs come only from nodes that can run
 * before it (its ancestors), as `<node_id>.<field>`; profile fields are not listed by the catalog and are typed by hand.
 */
export function readableVariables(
  workflow: ChatflowWorkflow,
  catalog: NodeTypeCatalog | undefined,
  nodeId: string,
): VariableGroup[] {
  const groups: VariableGroup[] = [];
  for (const namespace of catalog?.namespaces ?? []) {
    let paths: string[] = [];
    if (namespace.source === 'static') {
      paths = (namespace.variables ?? []).map((variable) => `${namespace.name}.${variable.name}`);
    } else if (namespace.source === 'workflow_variables') {
      paths = (workflow.variables ?? []).map((variable) => `${namespace.name}.${variable.name}`);
    } else if (namespace.source === 'node_output') {
      const upstream = ancestors(workflow, nodeId);
      for (const node of workflow.nodes) {
        if (!upstream.has(node.id)) continue;
        const spec = catalog?.node_types.find((item) => item.type === node.type);
        const properties = (spec?.output_schema as { properties?: Record<string, unknown> } | undefined)?.properties;
        paths.push(...Object.keys(properties ?? {}).map((field) => `${node.id}.${field}`));
      }
    }
    if (paths.length) groups.push({ title: namespace.title, paths });
  }
  return groups;
}
