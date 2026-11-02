import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils/cn';

// Chỉ những gì tin nhắn trợ lý cần; HTML thô trong nội dung không bao giờ thành phần tử (FR-UI-01).
const ALLOWED = [
  'p',
  'strong',
  'em',
  'del',
  'ul',
  'ol',
  'li',
  'a',
  'br',
  'code',
  'blockquote',
  'h3',
  'h4',
];

const PROSE = cn(
  'space-y-3 break-words',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-1',
  '[&_strong]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold',
  '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm',
);

/** Markdown của tin nhắn trợ lý: đậm/nghiêng/danh sách/link. Tiêu đề lớn bị hạ thành chữ thường. */
export function ChatMarkdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn(PROSE, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        allowedElements={ALLOWED}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
