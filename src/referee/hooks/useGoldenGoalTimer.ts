import { useEffect, useState } from 'react';
import { isGoldenGoalActive } from '@shared/utils/scoring';

/**
 * 시간 제한 경기용 카운트다운 훅.
 * matchStartedAt + timeLimitSeconds 기준으로 매초 remaining/active 계산.
 *
 * - timeLimitSeconds 미설정: 항상 enabled=false
 * - 미시작(matchStartedAt 없음): remainingSec = timeLimitSeconds
 * - 만료: isActive=true (호출자가 goldenGoalActive Firebase 플래그 동기화 책임)
 */
export function useGoldenGoalTimer(
  matchStartedAt: number | undefined | null,
  timeLimitSeconds: number | undefined | null,
): { enabled: boolean; remainingSec: number; isActive: boolean } {
  const enabled = !!(timeLimitSeconds && timeLimitSeconds > 0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return { enabled: false, remainingSec: 0, isActive: false };
  if (!matchStartedAt) return { enabled: true, remainingSec: timeLimitSeconds!, isActive: false };

  const elapsedMs = now - matchStartedAt;
  const remainingSec = Math.max(0, Math.ceil((timeLimitSeconds! * 1000 - elapsedMs) / 1000));
  const isActive = isGoldenGoalActive(matchStartedAt, now, timeLimitSeconds);
  return { enabled: true, remainingSec, isActive };
}
