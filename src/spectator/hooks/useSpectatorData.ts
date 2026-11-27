import { useEffect, useMemo, useRef, useState } from 'react';
import { useMatches, useSchedule, useTournament } from '@shared/hooks/useFirebase';
import { useConnection } from '@shared/hooks/useConnection';
import type { Match, ScheduleSlot, Tournament } from '@shared/types';
import { loadSnapshot, saveSnapshot } from '../utils/spectatorCache';

const SAVE_THROTTLE_MS = 5_000;

/**
 * 관전 대회 데이터 + 연결 상태 + 오프라인 캐시.
 * 서버 데이터가 아직 오지 않았으면(첫 연결 전, 끊긴 상태에서 새로 연 경우) 기기에 저장된 마지막 데이터를 보여 주고
 * usingCache = true로 알린다. 데이터가 오면 저장한다(5초에 한 번).
 */
export function useSpectatorData(tournamentId: string | null) {
  const { tournament, loading: tLoading } = useTournament(tournamentId);
  const { matches, loading: mLoading } = useMatches(tournamentId);
  const { schedule } = useSchedule(tournamentId);
  const { isOnline } = useConnection();
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const snapshot = useMemo(() => (tournamentId ? loadSnapshot(tournamentId) : null), [tournamentId]);
  const lastSave = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const serverLoading = tLoading || mLoading;
  const usingCache = serverLoading && !!snapshot;

  // .info/connected
  const connected: boolean | null = isOnline;

  useEffect(() => {
    if (serverLoading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastUpdateAt(Date.now());
  }, [serverLoading, tournament, matches, schedule]);

  useEffect(() => {
    if (!tournamentId || serverLoading || !tournament) return;
    const write = () => {
      lastSave.current = Date.now();
      saveSnapshot(tournamentId, { savedAt: lastSave.current, tournament, matches, schedule });
    };
    if (Date.now() - lastSave.current >= SAVE_THROTTLE_MS) { write(); return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(write, SAVE_THROTTLE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [tournamentId, serverLoading, tournament, matches, schedule]);

  const data: { tournament: Tournament | null; matches: Match[]; schedule: ScheduleSlot[] } = usingCache
    ? { tournament: snapshot!.tournament, matches: snapshot!.matches, schedule: snapshot!.schedule }
    : { tournament, matches, schedule };

  return {
    ...data,
    loading: serverLoading && !snapshot,
    usingCache,
    cacheSavedAt: snapshot?.savedAt ?? null,
    connected,
    lastUpdateAt,
  };
}

/** 1분 단위 현재 시각 ('N분 전'·다음 경기 계산용) */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
