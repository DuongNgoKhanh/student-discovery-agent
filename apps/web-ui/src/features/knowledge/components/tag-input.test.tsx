import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { TagInput } from './tag-input';

function Harness() {
  const [tags, setTags] = useState(['E']);
  return <><TagInput label="Hệ" value={tags} onChange={setTags} /><output>{tags.join('|')}</output></>;
}

describe('TagInput', () => {
  it('adds with Enter or ";" and removes with × or Backspace', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Hệ');
    fireEvent.change(input, { target: { value: 'C' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'A; B;' } });
    expect(screen.getByRole('status')).toHaveTextContent('E|C|A|B');
    fireEvent.click(screen.getByRole('button', { name: 'Xoá C' }));
    expect(screen.getByRole('status')).toHaveTextContent('E|A|B');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(screen.getByRole('status')).toHaveTextContent('E|A');
  });
});
