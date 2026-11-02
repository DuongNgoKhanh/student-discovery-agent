import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { INDEX_STATUS_LABELS, IndexStatus } from './index-status';

describe('IndexStatus', () => {
  it('renders the label of every state with a decorative icon', () => {
    const { container } = render(
      <>{(['pending', 'indexing', 'ready', 'error'] as const).map(status => <IndexStatus key={status} status={status} />)}</>,
    );
    for (const label of Object.values(INDEX_STATUS_LABELS)) expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4);
    expect(screen.getByText('Đang index').querySelector('svg')).toHaveClass('animate-spin', 'motion-reduce:animate-none');
  });

  it('renders as the requested element', () => {
    render(<IndexStatus status="error" as="p" className="extra" />);
    expect(screen.getByText('Lỗi index').tagName).toBe('P');
    expect(screen.getByText('Lỗi index')).toHaveClass('extra', 'text-destructive');
  });
});
