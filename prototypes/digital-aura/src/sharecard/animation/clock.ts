/** Wall-clock playback position that can pause, resume, seek and replay. */
export class PlaybackClock {
  private elapsed = 0;
  private startedAt: number | null = null;

  get running() {
    return this.startedAt !== null;
  }

  time(now: number) {
    return this.elapsed + (this.startedAt === null ? 0 : Math.max(0, now - this.startedAt));
  }

  play(now: number) {
    if (this.startedAt === null) this.startedAt = now;
  }

  pause(now: number) {
    this.elapsed = this.time(now);
    this.startedAt = null;
  }

  seek(time: number, now: number) {
    this.elapsed = Math.max(0, time);
    if (this.startedAt !== null) this.startedAt = now;
  }
}
