import { describe, expect, it } from 'vitest';
import { splitGreeting } from './greeting';

describe('splitGreeting', () => {
  it('lấy câu đầu kèm emoji làm tiêu đề, phần còn lại làm thân', () => {
    const text =
      'Chào bạn! 👋 Mình là **IHRD Mentor**, người bạn đồng hành.\n\nCùng bắt đầu nhé! ✨';
    expect(splitGreeting(text)).toEqual({
      heading: 'Chào bạn! 👋',
      body: 'Mình là **IHRD Mentor**, người bạn đồng hành.\n\nCùng bắt đầu nhé! ✨',
    });
  });

  it('không có dấu câu thì cả đoạn là tiêu đề, bỏ dấu markdown', () => {
    expect(splitGreeting('Xin chào **bạn**')).toEqual({ heading: 'Xin chào bạn', body: '' });
  });

  it('một câu duy nhất thì thân rỗng', () => {
    expect(splitGreeting('Chào bạn!')).toEqual({ heading: 'Chào bạn!', body: '' });
  });
});
