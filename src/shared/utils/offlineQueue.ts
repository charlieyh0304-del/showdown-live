import { ref, update, get } from 'firebase/database';
import { database } from '../config/firebase';

const STORAGE_KEY = 'showdown_offline_queue';

const VALID_MATCH_STATUSES = ['pending', 'in_progress', 'completed'];

/**
 * Validate match update data before replaying from offline queue.
 * Returns true if valid, false if data is corrupted/invalid.
 */
function validateMatchUpdate(data: Record<string, unknown>): boolean {
  if (data.status && !VALID_MATCH_STATUSES.includes(data.status as string)) return false;
  if (data.sets && !Array.isArray(data.sets)) return false;
  // Check scores are non-negative
  if (Array.isArray(data.sets)) {
    for (const set of data.sets as Record<string, unknown>[]) {
      if (typeof set.player1Score === 'number' && set.player1Score < 0) return false;
      if (typeof set.player2Score === 'number' && set.player2Score < 0) return false;
    }
  }
  return true;
}

export interface PendingUpdate {
  path: string;
  data: Record<string, unknown>;
  timestamp: number;
  queuedAt: number;
}

function loadQueue(): PendingUpdate[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: PendingUpdate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage may be full or unavailable
  }
}

/**
 * Queue a Firebase update for later replay when back online.
 */
export function queueUpdate(path: string, data: Record<string, unknown>): void {
  const queue = loadQueue();
  const now = Date.now();
  queue.push({ path, data, timestamp: now, queuedAt: now });
  saveQueue(queue);
}

/**
 * Get the number of pending updates in the offline queue.
 */
export function getPendingCount(): number {
  return loadQueue().length;
}

/**
 * Replay all pending updates to Firebase.
 * Removes each update from the queue as it succeeds.
 * Stops on first failure and returns the number of remaining items.
 */
export async function flushQueue(): Promise<number> {
  const queue = loadQueue();
  if (queue.length === 0) return 0;

  const remaining: PendingUpdate[] = [];
  for (const item of queue) {
    try {
      // Validate queued data before replaying
      if (!validateMatchUpdate(item.data)) {
        console.warn('[offlineQueue] Skipping invalid queued update:', item.path, item.data);
        continue;
      }
      // Check if server data is newer than when we queued the update
      const serverSnap = await get(ref(database, `${item.path}/updatedAt`));
      const serverUpdatedAt = serverSnap.val();
      if (serverUpdatedAt !== null && serverUpdatedAt > item.queuedAt) {
        // Server data is newer - skip this stale update
        continue;
      }
      await update(ref(database, item.path), item.data);
    } catch {
      // Keep failed items for retry
      remaining.push(item);
    }
  }

  saveQueue(remaining);
  return remaining.length;
}

/**
 * Clear all pending updates (use with caution).
 */
export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// Auto-flush when coming back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    // Small delay to let the network stabilize
    setTimeout(() => {
      flushQueue().catch(() => {
        // Silent fail - will retry on next online event
      });
    }, 1000);
  });
}
