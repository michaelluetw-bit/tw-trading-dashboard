// Source-local polling: reserve the attempt before I/O so restarts retain the cadence.
import { createNewsHealth, fetchNewsSource } from './news-health.mjs';
export function createNewsPoller({ now = Date.now } = {}) {
  const pending = new Set();
  async function poll({ id, interval, health, request, isCurrent, onAttempt, onResult }) {
    const at = now(), previous = health[id];
    if (pending.has(id) || previous?.pausedUntil > at || previous?.lastAttempt != null && previous.lastAttempt + interval > at) return false;
    const current = health[id] ??= createNewsHealth({ [id]: {} })[id];
    current.lastAttempt = at;
    const local = createNewsHealth({ [id]: current });
    pending.add(id);
    try {
      onAttempt();
      let success = false;
      const rows = await fetchNewsSource(local, id, async () => { const rows = await request(); success = true; return rows; }, { now });
      if (!isCurrent()) return false;
      health[id] = local[id];
      onResult(rows, success);
      return true;
    } finally { pending.delete(id); }
  }
  return { poll };
}
