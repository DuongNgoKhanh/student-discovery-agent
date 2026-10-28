import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from './markdown-preview';

describe('MarkdownPreview', () => {
  it('renders GFM but never raw HTML', () => {
    const { container } = render(<MarkdownPreview source={'# Học phí\n\n<b onclick="x()">đậm</b><script>alert(1)</script>\n\n| Ngành | Học phí |\n|---|---|\n| CNTT | 42 |\n\n[HUTECH](https://hutech.edu.vn)'} />);
    expect(screen.getByRole('heading', { name: 'Học phí' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'HUTECH' })).toHaveAttribute('target', '_blank');
    expect(container.querySelector('b, script')).toBeNull();
  });
});
