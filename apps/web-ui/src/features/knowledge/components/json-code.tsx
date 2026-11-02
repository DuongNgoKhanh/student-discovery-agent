import { cn } from '@/lib/utils/cn';

export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'plain';
export interface JsonToken { kind: JsonTokenKind; text: string }

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

/** Splits pretty-printed JSON into coloured runs; everything between tokens (braces, commas, spaces) stays plain. */
export function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let cursor = 0;
  for (const match of json.matchAll(TOKEN)) {
    const at = match.index;
    if (at > cursor) tokens.push({ kind: 'plain', text: json.slice(cursor, at) });
    const [, string, colon, number, literal] = match;
    if (string !== undefined && colon !== undefined) tokens.push({ kind: 'key', text: string }, { kind: 'plain', text: colon });
    else if (string !== undefined) tokens.push({ kind: 'string', text: string });
    else if (number !== undefined) tokens.push({ kind: 'number', text: number });
    else tokens.push({ kind: 'literal', text: literal! });
    cursor = at + match[0].length;
  }
  if (cursor < json.length) tokens.push({ kind: 'plain', text: json.slice(cursor) });
  return tokens;
}

const COLOR: Record<JsonTokenKind, string | undefined> = {
  key: 'text-primary',
  string: 'text-warning-foreground',
  number: 'text-destructive',
  literal: 'text-brand font-medium',
  plain: undefined,
};

export function JsonCode({ value, className, ...props }: { value: unknown; className?: string } & React.HTMLAttributes<HTMLPreElement>) {
  return (
    <pre className={cn('overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5', className)} {...props}>
      <code>
        {tokenizeJson(JSON.stringify(value, null, 2)).map((token, index) => (
          <span key={index} className={COLOR[token.kind]}>{token.text}</span>
        ))}
      </code>
    </pre>
  );
}
