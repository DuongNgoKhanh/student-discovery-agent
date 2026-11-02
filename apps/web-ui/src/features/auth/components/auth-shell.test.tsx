import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthShell } from './auth-shell';

describe('AuthShell', () => {
  it('hiển thị thương hiệu IHRD, hình minh hoạ trang trí và nội dung form', () => {
    const { container } = render(
      <AuthShell>
        <p>Nội dung form</p>
      </AuthShell>,
    );

    expect(screen.getByAltText('Logo IHRD')).toBeInTheDocument();
    expect(screen.getByText('IHRD')).toBeInTheDocument();
    expect(screen.getByText('Nội dung form')).toBeInTheDocument();
    // Hình minh hoạ chỉ để trang trí nên ẩn khỏi cây accessibility.
    expect(container.querySelector('svg[aria-hidden="true"] defs')).not.toBeNull();
    expect(container.querySelector('[id="softGlow"]')).toBeNull();
  });
});
