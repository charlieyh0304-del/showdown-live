import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';

export interface NotificationHistoryEntry {
  id: string;
  type: 'preMatch' | 'matchStart' | 'matchComplete';
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
  matchId?: string;
  tournamentId?: string;
  playerName: string;
  playerId: string;
}

const HISTORY_KEY = 'showdown_notification_history';
const MAX_HISTORY = 200;

// Global listeners for cross-component reactivity
type Listener = () => void;
const listeners = new Set<Listener>();
let currentSnapshot: NotificationHistoryEntry[] | null = null;

function notifyListeners() {
  currentSnapshot = null; // invalidate cache
  listeners.forEach((l) => l());
}

function loadHistory(): NotificationHistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveHistory(entries: NotificationHistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(-MAX_HISTORY)));
  } catch { /* ignore */ }
}

function getSnapshot(): NotificationHistoryEntry[] {
  if (!currentSnapshot) {
    currentSnapshot = loadHistory();
  }
  return currentSnapshot;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Standalone function to add history entry (usable outside React)
export function addNotificationToHistory(entry: Omit<NotificationHistoryEntry, 'id' | 'timestamp' | 'read'>) {
  const history = loadHistory();
  const newEntry: NotificationHistoryEntry = {
    ...entry,
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    read: false,
  };
  history.push(newEntry);
  saveHistory(history);
  notifyListeners();
}

export function useNotificationHistory() {
  const history = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const unreadCount = history.filter((n) => !n.read).length;

  const markAsRead = useCallback((id: string) => {
    const entries = loadHistory();
    const entry = entries.find((e) => e.id === id);
    if (entry && !entry.read) {
      entry.read = true;
      saveHistory(entries);
      notifyListeners();
    }
  }, []);

  const markAllAsRead = useCallback(() => {
    const entries = loadHistory();
    let changed = false;
    entries.forEach((e) => {
      if (!e.read) { e.read = true; changed = true; }
    });
    if (changed) {
      saveHistory(entries);
      notifyListeners();
    }
  }, []);

  const removeEntry = useCallback((id: string) => {
    const entries = loadHistory().filter((e) => e.id !== id);
    saveHistory(entries);
    notifyListeners();
  }, []);

  const clearAll = useCallback(() => {
    saveHistory([]);
    notifyListeners();
  }, []);

  // Sorted newest first
  const sortedHistory = [...history].reverse();

  return {
    history: sortedHistory,
    unreadCount,
    markAsRead,
    markAllAsRead,
    removeEntry,
    clearAll,
  };
}
