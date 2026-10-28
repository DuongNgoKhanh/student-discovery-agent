export interface MappingTarget {
  key: string;
  /** Names a column may carry to match this target, e.g. the technical name and its label. */
  names: string[];
}

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
  .toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Pairs each target with the first unused column whose name equals one of its names, ignoring case, diacritics and punctuation. */
export function autoMapColumns(columns: string[], targets: MappingTarget[]): Record<string, string> {
  const used = new Set<string>();
  const mapping: Record<string, string> = {};
  for (const target of targets) {
    const names = new Set(target.names.map(fold).filter(Boolean));
    const column = columns.find(name => !used.has(name) && names.has(fold(name)));
    if (column === undefined) continue;
    used.add(column);
    mapping[target.key] = column;
  }
  return mapping;
}
