import { Badge } from '@/components/ui/badge';

const LABELS = {
  pending: ['Chờ index', 'info'],
  indexing: ['Đang index', 'info'],
  ready: ['Sẵn sàng', 'success'],
  error: ['Lỗi index', 'danger'],
} as const;

export function IndexStatusBadge({ status }: { status: keyof typeof LABELS }) {
  const [label, tone] = LABELS[status];
  return <Badge tone={tone}>{label}</Badge>;
}
