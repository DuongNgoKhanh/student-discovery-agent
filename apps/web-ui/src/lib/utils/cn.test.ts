import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('merge và loại class trùng của tailwind', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-sm', false && 'hidden', 'font-bold')).toBe('text-sm font-bold');
    expect(cn('text-13 text-muted-foreground', 'text-sm')).toBe('text-muted-foreground text-sm');
  });
});
