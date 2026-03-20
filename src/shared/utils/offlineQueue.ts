import { ref, update } from 'firebase/database';
import { database } from '../config/firebase';

const STORAGE_KEY = 'showdown_offline_queue';

export interface PendingUpdate {
  path: string;
  data: Record<string, unknown>;
  timestamp: number;
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
  queue.push({ path, data, timestamp: Date.now() });
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
      await update(ref(database, item.path), item.data);
    } catch {
      // Keep this and all subsequent items for retry
      remaining.push(item);
    }
  }

  // If some items failed mid-way, also keep items we haven't tried yet
  // (the loop above already pushes failed items to remaining)
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
