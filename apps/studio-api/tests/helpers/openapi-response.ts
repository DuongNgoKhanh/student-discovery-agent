import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import Ajv from 'ajv';
import { parse } from 'yaml';

/** Resolve the operation's declared response, including external OpenAPI Response refs. */
export function declaredResponseValidator(file: string, path: string, method: string, status: number) {
  const root = resolve(__dirname, '../../../../contracts/openapi');
  const documents = new Map<string, ReturnType<typeof parse>>();
  const ajv = new Ajv({ strict: false, allErrors: true });
  for (const format of ['date-time', 'normalized-display-name', 'display-name']) ajv.addFormat(format, true);
  function register(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) register(filename);
      else if (entry.name.endsWith('.yaml')) {
        const id = `https://contracts.local/${relative(root, filename).replaceAll('\\', '/')}`;
        const document = parse(readFileSync(filename, 'utf8'));
        documents.set(id, document);
        ajv.addSchema({ ...document, $id: id });
      }
    }
  }
  register(root);
  let documentId = `https://contracts.local/${file}`;
  let response = documents.get(documentId)?.paths[path][method.toLowerCase()].responses[String(status)];
  while (response?.$ref) {
    const target = new URL(response.$ref, documentId);
    documentId = target.origin + target.pathname;
    response = documents.get(documentId);
    for (const segment of target.hash.slice(2).split('/')) {
      response = response[decodeURIComponent(segment).replaceAll('~1', '/').replaceAll('~0', '~')];
    }
  }
  const schemaRef = response?.content?.['application/json']?.schema?.$ref;
  if (typeof schemaRef !== 'string') throw new Error(`Missing declared response schema: ${file} ${method} ${path} ${status}`);
  return ajv.compile({ $ref: new URL(schemaRef, documentId).href });
}
