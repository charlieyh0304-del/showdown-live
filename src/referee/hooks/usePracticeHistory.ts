import { useState, useCallback } from 'react';
import type { PracticeSession } from '@shared/types';

const STORAGE_KEY = 'showdown_practice_history';

function loadSessions(): PracticeSession[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: PracticeSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function usePracticeHistory() {
  const [sessions, setSessions] = useState<PracticeSession[]>(loadSessions);

  const addSession = useCallback((session: PracticeSession) => {
    setSessions(prev => {
      const next = [session, ...prev].slice(0, 50); // 최대 50개 보관
      saveSessions(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setSessions([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const getStats = useCallback(() => {
    const total = sessions.length;
    const withAccuracy = sessions.filter(s => s.accuracy !== undefined);
    const avgAccuracy = withAccuracy.length > 0
      ? Math.round(withAccuracy.reduce((sum, s) => sum + (s.accuracy ?? 0), 0) / withAccuracy.length)
      : 0;
    const recent5 = withAccuracy.slice(0, 5);
    const older5 = withAccuracy.slice(5, 10);
    const recentAvg = recent5.length > 0 ? recent5.reduce((s, x) => s + (x.accuracy ?? 0), 0) / recent5.length : 0;
    const olderAvg = older5.length > 0 ? older5.reduce((s, x) => s + (x.accuracy ?? 0), 0) / older5.length : 0;
    const improvement = older5.length > 0 ? Math.round(recentAvg - olderAvg) : 0;

    return { totalSessions: total, avgAccuracy, improvement };
  }, [sessions]);

  return { sessions, addSession, clearHistory, getStats };
}
