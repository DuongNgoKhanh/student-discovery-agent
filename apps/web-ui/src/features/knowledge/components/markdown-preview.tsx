'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils/cn';

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

/** GFM preview; raw HTML in the source is dropped (no rehype-raw), and links open in a new tab. */
export function MarkdownPreview({ source, className }: { source: string; className?: string }) {
  if (source.trim() === '') return <p className={cn('text-sm text-muted-foreground', className)}>Chưa có nội dung.</p>;
  return (
    <div className={cn(PROSE, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{ a: ({ href, title, children }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a> }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
