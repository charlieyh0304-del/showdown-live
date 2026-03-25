import { useState, useCallback, useEffect } from 'react';
import type { PracticeMatch, PracticeAction, SetScore } from '@shared/types';
import { createEmptySet } from '@shared/utils/scoring';

const PRACTICE_MATCH_KEY = 'showdown_practice_match';

/** Save current practice match to localStorage for resume */
export function savePracticeMatch(match: PracticeMatch) {
  try {
    localStorage.setItem(PRACTICE_MATCH_KEY, JSON.stringify(match));
  } catch { /* quota exceeded - ignore */ }
}

/** Load saved practice match from localStorage */
export function loadSavedPracticeMatch(): PracticeMatch | null {
  try {
    const stored = localStorage.getItem(PRACTICE_MATCH_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

/** Clear saved practice match */
export function clearSavedPracticeMatch() {
  localStorage.removeItem(PRACTICE_MATCH_KEY);
}

interface PracticeConfig {
  SETS_TO_WIN: number;
  MAX_SETS: number;
  POINTS_TO_WIN: number;
  MIN_POINT_DIFF: number;
}

interface UsePracticeMatchOptions {
  matchType: 'individual' | 'team';
  player1Name: string;
  player2Name: string;
  config: PracticeConfig;
  initialSets?: SetScore[];
  initialCurrentSet?: number;
  // Team-specific
  team1Members?: string[];
  team2Members?: string[];
  // Resume from saved match
  resumeMatch?: PracticeMatch | null;
}

export function usePracticeMatch(options: UsePracticeMatchOptions) {
  const [match, setMatch] = useState<PracticeMatch>(() => {
    // Resume from saved match if provided
    if (options.resumeMatch) return options.resumeMatch;

    return {
      id: crypto.randomUUID(),
      type: options.matchType,
      player1Name: options.player1Name,
      player2Name: options.player2Name,
      sets: options.initialSets || [],
      currentSet: options.initialCurrentSet ?? 0,
      status: 'pending',
      winnerId: null,
      player1Timeouts: 0,
      player2Timeouts: 0,
      activeTimeout: null,
      gameConfig: options.config,
      currentServe: 'player1',
      serveCount: 0,
      serveSelected: false,
      sideChangeUsed: false,
      scoreHistory: [],
      isPaused: false,
      warmupUsed: false,
      pauseHistory: [],
      actionLog: [],
      startedAt: Date.now(),
      ...(options.matchType === 'team' ? {
        team1Name: options.player1Name,
        team2Name: options.player2Name,
        team1Members: options.team1Members || [],
        team2Members: options.team2Members || [],
        team1PlayerOrder: options.team1Members || [],
        team2PlayerOrder: options.team2Members || [],
        team1CurrentPlayerIndex: 0,
        team2CurrentPlayerIndex: 0,
        team1SubUsed: false,
        team2SubUsed: false,
      } : {}),
    };
  });

  // Auto-save match to localStorage on every change (for resume)
  useEffect(() => {
    if (match.status === 'in_progress') {
      savePracticeMatch(match);
    } else if (match.status === 'completed') {
      clearSavedPracticeMatch();
    }
  }, [match]);

  const addAction = useCallback((action: Omit<PracticeAction, 'timestamp'>) => {
    setMatch(prev => ({
      ...prev,
      actionLog: [...prev.actionLog, { ...action, timestamp: Date.now() }],
    }));
  }, []);

  const updateMatch = useCallback((data: Partial<PracticeMatch>) => {
    setMatch(prev => ({ ...prev, ...data }));
  }, []);

  const startMatch = useCallback((firstServe: 'player1' | 'player2') => {
    setMatch(prev => ({
      ...prev,
      status: 'in_progress',
      sets: [createEmptySet()],
      currentSet: 0,
      player1Timeouts: 0,
      player2Timeouts: 0,
      activeTimeout: null,
      currentServe: firstServe,
      serveCount: 0,
      serveSelected: true,
      sideChangeUsed: false,
      scoreHistory: [],
      isPaused: false,
      // Reset team rotation
      ...(prev.type === 'team' ? {
        team1CurrentPlayerIndex: 0,
        team2CurrentPlayerIndex: 0,
        team1SubUsed: false,
        team2SubUsed: false,
      } : {}),
    }));
    addAction({ type: 'start', player: firstServe === 'player1' ? 1 : 2 });
  }, [addAction]);

  const resetMatch = useCallback(() => {
    clearSavedPracticeMatch();
    setMatch(prev => ({
      ...prev,
      sets: [],
      currentSet: 0,
      status: 'pending',
      winnerId: null,
      player1Timeouts: 0,
      player2Timeouts: 0,
      activeTimeout: null,
      currentServe: 'player1',
      serveCount: 0,
      serveSelected: false,
      sideChangeUsed: false,
      scoreHistory: [],
      isPaused: false,
      actionLog: [],
      startedAt: Date.now(),
      completedAt: undefined,
      // Reset team fields
      ...(prev.type === 'team' ? {
        team1CurrentPlayerIndex: 0,
        team2CurrentPlayerIndex: 0,
        team1SubUsed: false,
        team2SubUsed: false,
      } : {}),
    }));
  }, []);

  return { match, updateMatch, startMatch, resetMatch, addAction };
}
