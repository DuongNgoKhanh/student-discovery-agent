/**
 * Tách lời chào thành tiêu đề ngắn (câu đầu, kèm emoji theo sau) và phần thân markdown,
 * để màn chào không dùng cả đoạn văn dài làm heading.
 */
export function splitGreeting(text: string): { heading: string; body: string } {
  const trimmed = text.trim();
  const match =
    /^(.+?[!?.])(\s*\p{Extended_Pictographic}[\p{Extended_Pictographic}\u{FE0F}\u{200D}]*)?(?=\s|$)/u.exec(
      trimmed,
    );
  const head = match ? match[0] : trimmed;
  return { heading: stripInlineMarks(head).trim(), body: trimmed.slice(head.length).trim() };
}

/** Tiêu đề hiện chữ thuần: bỏ dấu đậm/nghiêng của markdown. */
function stripInlineMarks(text: string): string {
  return text.replace(/(\*\*|__|\*|_)(.+?)\1/g, '$2');
}
