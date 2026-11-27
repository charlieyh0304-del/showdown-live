import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { database } from '../config/firebase';

/**
 * 서버 시각 (경기 시계용, M0f). Firebase가 알려 주는 기기 시계와 서버의 차이(.info/serverTimeOffset)를 더한다.
 * 기기 시계가 틀려도 심판 기기·관전 기기가 같은 남은 시간을 본다. 오프라인이면 마지막으로 받은 차이(처음에는 0)를 쓴다.
 */
let offsetMs = 0;
let subscribed = false;

function ensureOffset() {
  if (subscribed) return;
  subscribed = true;
  try {
    onValue(ref(database, '.info/serverTimeOffset'), snap => {
      const v = snap.val();
      if (typeof v === 'number' && Number.isFinite(v)) offsetMs = v;
    });
  } catch {
    // 연결 전 등: 기기 시계를 그대로 쓴다
  }
}

export function serverNow(): number {
  ensureOffset();
  return Date.now() + offsetMs;
}

/** 켜져 있는 동안 intervalMs마다 서버 시각을 다시 읽는다 (남은 시간 표시용) */
export function useServerNow(enabled: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
  return now;
}
