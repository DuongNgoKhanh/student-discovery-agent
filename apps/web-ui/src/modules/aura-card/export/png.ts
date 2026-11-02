import { timelineConfig } from '../animation/config';
import type { CardFrameRenderer } from '../components/share-card';

export interface ExportSize {
  width: number;
  height: number;
}

/** Static PNG of the fully revealed card at rest. */
export async function exportPng(
  renderer: CardFrameRenderer,
  { width, height }: ExportSize,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ vẽ ảnh.');
  renderer.paint(ctx, timelineConfig.stillTime, { reduced: true });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Không tạo được ảnh PNG.'))),
      'image/png',
    ),
  );
}
