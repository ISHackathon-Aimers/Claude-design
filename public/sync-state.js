// Serialize writes and retain edits made during a request.
export class StateSync {
  constructor({ revision = 0, write, cache, status }) {
    Object.assign(this, { revision, write, cache, status });
    this.pending = null;
    this.running = null;
    this.conflict = false;
  }
  queue(state) {
    this.pending = structuredClone(state);
    this.cache({ state: this.pending, revision: this.revision, dirty: true });
    this.status(this.conflict ? 'conflict' : 'pending', this.conflict ? '다른 기기에서 기록이 변경됐어요. 백업 후 최신 기록을 불러와 주세요.' : '');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.flush().catch(() => {}); }, 400);
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    if (this.conflict) throw new Error('최신 기록을 먼저 불러와 주세요.');
    this.running = this.drain();
    try { await this.running; } finally { this.running = null; }
  }
  async drain() {
    while (this.pending) {
      const state = this.pending;
      this.status('saving');
      try {
        const revision = await this.write(state, this.revision);
        this.revision = revision;
        if (this.pending === state) this.pending = null;
        this.cache({ state: this.pending || state, revision, dirty: Boolean(this.pending) });
      } catch (error) {
        this.conflict = Boolean(error.conflict);
        this.status(this.conflict ? 'conflict' : 'error', error.message);
        throw error;
      }
    }
    this.status('saved');
  }
}
