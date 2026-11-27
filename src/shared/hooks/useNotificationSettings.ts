import { useCallback, useSyncExternalStore } from 'react';

// === Types ===
export interface NotificationTypeFlags {
  preMatch: boolean;
  matchStart: boolean;
  matchComplete: boolean;
}

export interface QuietHours {
  enabled: boolean;
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

export interface PlayerNotificationSettings {
  enabled: boolean;
  types: NotificationTypeFlags;
}

export interface NotificationSettings {
  /** 즐겨찾기 선수 경기 알림 (켜는 사람만: 기본 꺼짐) */
  enabled: boolean;
  /** 새 결과가 나오면 소리로 알리기 (앱을 보고 있을 때, 기본 꺼짐) */
  resultSound: boolean;
  /** 결과 소리를 즐겨찾기 선수 경기에만 */
  resultSoundFavoritesOnly: boolean;
  types: NotificationTypeFlags;
  quietHours: QuietHours;
  perPlayer: Record<string, PlayerNotificationSettings>;
}

const SETTINGS_KEY = 'showdown_notification_settings';

const DEFAULT_TYPES: NotificationTypeFlags = {
  preMatch: true,
  matchStart: false,
  matchComplete: true,
};

/** 예전 버전에서 푸시를 켠 기기(토큰 저장됨)는 이미 알림을 받기로 한 것으로 본다 */
function hadPushOptIn(): boolean {
  try { return !!localStorage.getItem('showdown_fcm_token'); } catch { return false; }
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  resultSound: false,
  resultSoundFavoritesOnly: true,
  types: { ...DEFAULT_TYPES },
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
  perPlayer: {},
};

/** 저장된 값을 완전한 설정으로 (저장 값이 없으면 기본 꺼짐, 단 예전에 푸시를 켠 기기는 켜짐) */
export function normalizeNotificationSettings(parsed: unknown, pushOptIn = false): NotificationSettings {
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS, types: { ...DEFAULT_TYPES, matchStart: pushOptIn }, enabled: pushOptIn };
  const p = parsed as Partial<NotificationSettings>;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : pushOptIn,
    resultSound: p.resultSound === true,
    resultSoundFavoritesOnly: p.resultSoundFavoritesOnly !== false,
    types: { ...DEFAULT_TYPES, ...(p.types || {}) },
    quietHours: { ...DEFAULT_SETTINGS.quietHours, ...(p.quietHours || {}) },
    perPlayer: p.perPlayer ?? {},
  };
}

function loadSettings(): NotificationSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return normalizeNotificationSettings(stored ? JSON.parse(stored) : null, hadPushOptIn());
  } catch {
    return normalizeNotificationSettings(null, hadPushOptIn());
  }
}

function saveSettings(settings: NotificationSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

// Check if current time is within quiet hours
export function isInQuietHours(qh: QuietHours): boolean {
  if (!qh.enabled) return false;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = qh.start.split(':').map(Number);
  const [eh, em] = qh.end.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  if (start <= end) {
    return current >= start && current < end;
  }
  // Overnight (e.g., 22:00 - 08:00)
  return current >= start || current < end;
}

// Check if a notification should be sent for a player+type
export function shouldNotify(
  settings: NotificationSettings,
  playerId: string,
  type: 'preMatch' | 'matchStart' | 'matchComplete',
): boolean {
  if (!settings.enabled) return false;
  if (isInQuietHours(settings.quietHours)) return false;

  // Check global type toggle
  if (!settings.types[type]) return false;

  // Check per-player settings
  const playerSettings = settings.perPlayer[playerId];
  if (playerSettings) {
    if (!playerSettings.enabled) return false;
    if (!playerSettings.types[type]) return false;
  }

  return true;
}

// Get settings suitable for Firebase push subscription sync
export function getSettingsForSync(settings: NotificationSettings) {
  return {
    enabled: settings.enabled,
    types: settings.types,
    quietHours: settings.quietHours,
    perPlayer: settings.perPlayer,
  };
}

// ===== 모듈 저장소: 여러 화면(관전 설정 구역, 알림 감시, 즐겨찾기 화면)이 같은 값을 보고 바로 함께 바뀐다 =====
let current: NotificationSettings | null = null;
const listeners = new Set<() => void>();

export function getNotificationSettings(): NotificationSettings {
  if (!current) current = loadSettings();
  return current;
}

export function updateNotificationSettings(partial: Partial<NotificationSettings>): NotificationSettings {
  const next = { ...getNotificationSettings(), ...partial };
  current = next;
  saveSettings(next);
  listeners.forEach(l => l());
  return next;
}

function subscribeNotificationSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 테스트용: 저장소를 비워 다음 읽기 때 기기 저장 값을 다시 읽게 한다 */
export function resetNotificationSettingsCache(): void {
  current = null;
}

export function useNotificationSettings() {
  const settings = useSyncExternalStore(subscribeNotificationSettings, getNotificationSettings, getNotificationSettings);

  const update = useCallback((partial: Partial<NotificationSettings>) => updateNotificationSettings(partial), []);

  const setEnabled = useCallback((enabled: boolean) => {
    update({ enabled });
  }, [update]);

  const setTypeEnabled = useCallback((type: keyof NotificationTypeFlags, enabled: boolean) => {
    update({ types: { ...getNotificationSettings().types, [type]: enabled } });
  }, [update]);

  const setQuietHours = useCallback((quietHours: QuietHours) => {
    update({ quietHours });
  }, [update]);

  const setPlayerSettings = useCallback((playerId: string, playerSettings: PlayerNotificationSettings) => {
    update({ perPlayer: { ...getNotificationSettings().perPlayer, [playerId]: playerSettings } });
  }, [update]);

  const removePlayerSettings = useCallback((playerId: string) => {
    const perPlayer = { ...getNotificationSettings().perPlayer };
    delete perPlayer[playerId];
    update({ perPlayer });
  }, [update]);

  const getPlayerSettings = useCallback((playerId: string): PlayerNotificationSettings => {
    return getNotificationSettings().perPlayer[playerId] ?? {
      enabled: true,
      types: { ...DEFAULT_TYPES },
    };
  }, []);

  return {
    settings,
    update,
    setEnabled,
    setTypeEnabled,
    setQuietHours,
    setPlayerSettings,
    removePlayerSettings,
    getPlayerSettings,
  };
}
