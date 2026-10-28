'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils/cn';
import { highlightSegments } from './highlight';

// Hand-written prose styles (no typography plugin); kept close to what the agent will show.
const PROSE = cn(
  'space-y-3 text-base leading-7 break-words',
  '[&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold',
  '[&_h4]:font-semibold [&_h1]:mt-6 [&_h2]:mt-5 [&_h3]:mt-4 [&>*:first-child]:mt-0',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_li]:my-1',
  '[&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-13',
  '[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:border [&_td]:border [&_th]:px-2 [&_td]:px-2',
  '[&_th]:py-1 [&_td]:py-1 [&_th]:bg-sidebar [&_th]:text-left [&_th]:font-medium',
  '[&_hr]:border-border [&_img]:max-w-full',
);

// Chunks are read in a list: one size for every block, headings only bolder, tight spacing.
const COMPACT = cn(
  'space-y-1.5 text-sm leading-6 break-words',
  '[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5',
  '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs',
  '[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-13',
  '[&_th]:border [&_td]:border [&_th]:px-2 [&_td]:px-2 [&_th]:py-0.5 [&_td]:py-0.5 [&_th]:bg-sidebar [&_th]:text-left [&_th]:font-medium',
  '[&_hr]:border-border [&_img]:max-h-40 [&_img]:max-w-full',
  '[&_mark]:rounded-sm [&_mark]:bg-warning-subtle [&_mark]:px-px [&_mark]:text-foreground',
);

// Just enough of hast for the highlighter; react-markdown hands us its own tree.
type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/** Rehype plugin: wraps the query's terms in `<mark>` inside text nodes, leaving code blocks alone. */
function rehypeHighlight(query: string) {
  const walk = (node: HastNode) => {
    if (!node.children || node.tagName === 'pre') return;
    node.children = node.children.flatMap(child => {
      if (child.type !== 'text' || !child.value) { walk(child); return [child]; }
      const segments = highlightSegments(child.value, query);
      if (!segments.some(segment => segment.match)) return [child];
      return segments.map(segment => (segment.match
        ? { type: 'element', tagName: 'mark', properties: {}, children: [{ type: 'text', value: segment.text }] }
        : { type: 'text', value: segment.text }));
    });
  };
  return () => (tree: HastNode) => walk(tree);
}

export interface MarkdownPreviewProps {
  source: string;
  className?: string;
  /** Smaller, tighter styles for chunks shown in a list. */
  compact?: boolean;
  /** Query whose terms are marked in the rendered text. */
  highlight?: string;
}

/** GFM preview; raw HTML in the source is dropped (no rehype-raw), unsafe URLs are stripped, and links open in a new tab. */
export function MarkdownPreview({ source, className, compact, highlight }: MarkdownPreviewProps) {
  const rehypePlugins = useMemo(() => (highlight?.trim() ? [rehypeHighlight(highlight)] : []), [highlight]);
  if (source.trim() === '') return <p className={cn('text-sm text-muted-foreground', className)}>Chưa có nội dung.</p>;
  return (
    <div className={cn(compact ? COMPACT : PROSE, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        skipHtml
        components={{ a: ({ href, title, children }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a> }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
