import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  type VideoCodec,
} from 'mediabunny';
import { timelineConfig } from '../animation/config';
import type { CardFrameRenderer } from '../components/ShareCard';

export interface ExportSize {
  width: number;
  height: number;
}

export type VideoSupport =
  | { kind: 'webcodecs'; codec: VideoCodec; container: 'mp4' | 'webm' }
  | { kind: 'recorder'; mimeType: string; container: 'webm' | 'mp4' }
  | { kind: 'none'; reason: string };

const FPS = 30;

function exportCanvas({ width, height }: ExportSize) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ canvas 2D.');
  return { canvas, ctx };
}

/** Static PNG of the fully revealed card at rest. */
export async function exportPng(renderer: CardFrameRenderer, size: ExportSize): Promise<Blob> {
  const { canvas, ctx } = exportCanvas(size);
  renderer.paint(ctx, timelineConfig.stillTime, { reduced: true });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Không tạo được PNG.'))),
      'image/png',
    ),
  );
}

/** Prefer offline WebCodecs encoding (MP4/H.264, then WebM); fall back to real-time MediaRecorder. */
export async function detectVideoSupport(size: ExportSize): Promise<VideoSupport> {
  if (typeof VideoEncoder !== 'undefined') {
    const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], {
      width: size.width,
      height: size.height,
    }).catch(() => null);
    if (codec) return { kind: 'webcodecs', codec, container: codec === 'avc' ? 'mp4' : 'webm' };
  }
  if (typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype) {
    const mimeType = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    if (mimeType) {
      return {
        kind: 'recorder',
        mimeType,
        container: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm',
      };
    }
  }
  return { kind: 'none', reason: 'Trình duyệt này không hỗ trợ mã hoá video.' };
}

export interface VideoJob {
  renderer: CardFrameRenderer;
  size: ExportSize;
  support: Exclude<VideoSupport, { kind: 'none' }>;
  signal: AbortSignal;
  onProgress(fraction: number): void;
}

/** Full 6 s introduction, always with full motion (reduced motion only affects the preview). */
export async function exportVideo(job: VideoJob): Promise<Blob> {
  return job.support.kind === 'webcodecs'
    ? encodeOffline(job, job.support)
    : recordRealtime(job, job.support);
}

async function encodeOffline(
  { renderer, size, signal, onProgress }: VideoJob,
  support: Extract<VideoSupport, { kind: 'webcodecs' }>,
) {
  const { canvas, ctx } = exportCanvas(size);
  const output = new Output({
    format:
      support.container === 'mp4'
        ? new Mp4OutputFormat({ fastStart: 'in-memory' })
        : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, { codec: support.codec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();
  const frames = Math.round((timelineConfig.duration / 1000) * FPS);
  try {
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      renderer.paint(ctx, (i * 1000) / FPS);
      await source.add(i / FPS, 1 / FPS);
      onProgress((i + 1) / frames);
    }
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Không tạo được video.');
  return new Blob([buffer], { type: output.format.mimeType });
}

/** Fallback for browsers without WebCodecs: paint in real time and record the canvas. */
async function recordRealtime(
  { renderer, size, signal, onProgress }: VideoJob,
  support: Extract<VideoSupport, { kind: 'recorder' }>,
) {
  const { canvas, ctx } = exportCanvas(size);
  renderer.paint(ctx, 0);
  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, {
    mimeType: support.mimeType,
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start(250);
  const duration = timelineConfig.duration;
  const started = performance.now();
  try {
    await new Promise<void>((resolve, reject) => {
      const step = () => {
        if (signal.aborted) return reject(new DOMException('Export cancelled', 'AbortError'));
        const t = Math.min(duration, performance.now() - started);
        renderer.paint(ctx, t);
        onProgress(t / duration);
        if (t >= duration) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  } finally {
    recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    await stopped;
  }
  return new Blob(chunks, { type: support.mimeType.split(';')[0] });
}
