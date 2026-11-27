/**
 * 연결·갱신 상태 (관전 화면 상단 한 줄): 실시간 연결됨 / 다시 연결하는 중 / 저장된 데이터.
 * 오래된 데이터는 'N분 전'을 꼭 붙인다.
 */
import type { Translate } from './rulesSentence';

export type ConnectionKind = 'connecting' | 'live' | 'reconnecting' | 'cached';

export interface ConnectionInput {
  /** .info/connected (처음 연결 전에는 null) */
  connected: boolean | null;
  /** 마지막으로 서버 데이터를 받은 시각 */
  lastUpdateAt: number | null;
  /** 지금 화면이 기기에 저장된 데이터(직전 방문)로 그려졌는가 */
  usingCache: boolean;
  /** 저장된 데이터의 저장 시각 */
  cacheSavedAt?: number | null;
  now: number;
}

export interface ConnectionModel {
  kind: ConnectionKind;
  /** 기준 시각 (마지막 갱신 또는 저장 시각) */
  at: number | null;
  /** 기준 시각에서 지난 분 (1분 미만 0) */
  minutesAgo: number | null;
  /** 오래됨 (2분 이상 지났고 실시간 연결이 아님) */
  stale: boolean;
}

export const STALE_AFTER_MS = 2 * 60_000;

export function connectionModel(i: ConnectionInput): ConnectionModel {
  const at = i.usingCache ? (i.cacheSavedAt ?? null) : i.lastUpdateAt;
  const minutesAgo = at === null ? null : Math.max(0, Math.floor((i.now - at) / 60_000));
  let kind: ConnectionKind;
  if (i.usingCache) kind = 'cached';
  else if (i.connected === true) kind = 'live';
  else if (i.connected === false && i.lastUpdateAt !== null) kind = 'reconnecting';
  else kind = 'connecting';
  const stale = kind !== 'live' && at !== null && i.now - at >= STALE_AFTER_MS;
  return { kind, at, minutesAgo, stale };
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "N분 전" / "방금" (1분 미만) / 60분 이상이면 "N시간 M분 전" */
export function formatAgo(minutes: number, t: Translate): string {
  if (minutes < 1) return t('spectator.connection.justNow');
  if (minutes < 60) return t('spectator.connection.minutesAgo', { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? t('spectator.connection.hoursAgo', { h }) : t('spectator.connection.hoursMinutesAgo', { h, m });
}

/** 상태 줄 문구 */
export function describeConnection(model: ConnectionModel, t: Translate): string {
  const time = model.at !== null ? formatClock(model.at) : '';
  const ago = model.minutesAgo !== null ? formatAgo(model.minutesAgo, t) : '';
  switch (model.kind) {
    case 'connecting':
      return t('spectator.connection.connecting');
    case 'live':
      return time ? t('spectator.connection.live', { time }) : t('spectator.connection.liveNoTime');
    case 'reconnecting':
      return t('spectator.connection.reconnecting', { time, ago });
    case 'cached':
      return time ? t('spectator.connection.cached', { time, ago }) : t('spectator.connection.cachedNoTime');
  }
}
