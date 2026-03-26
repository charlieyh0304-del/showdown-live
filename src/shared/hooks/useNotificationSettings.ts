import { useState, useCallback, useRef, useEffect } from 'react';

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
  enabled: boolean;
  types: NotificationTypeFlags;
  quietHours: QuietHours;
  perPlayer: Record<string, PlayerNotificationSettings>;
}

const SETTINGS_KEY = 'showdown_notification_settings';

const DEFAULT_TYPES: NotificationTypeFlags = {
  preMatch: true,
  matchStart: true,
  matchComplete: true,
};

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  types: { ...DEFAULT_TYPES },
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
  perPlayer: {},
};

function loadSettings(): NotificationSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(stored);
    return {
      enabled: parsed.enabled ?? true,
      types: { ...DEFAULT_TYPES, ...parsed.types },
      quietHours: { ...DEFAULT_SETTINGS.quietHours, ...parsed.quietHours },
      perPlayer: parsed.perPlayer ?? {},
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
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

export function useNotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettings>(loadSettings);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const update = useCallback((partial: Partial<NotificationSettings>) => {
    const next = { ...settingsRef.current, ...partial };
    saveSettings(next);
    settingsRef.current = next;
    setSettings(next);
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    update({ enabled });
  }, [update]);

  const setTypeEnabled = useCallback((type: keyof NotificationTypeFlags, enabled: boolean) => {
    const types = { ...settingsRef.current.types, [type]: enabled };
    update({ types });
  }, [update]);

  const setQuietHours = useCallback((quietHours: QuietHours) => {
    update({ quietHours });
  }, [update]);

  const setPlayerSettings = useCallback((playerId: string, playerSettings: PlayerNotificationSettings) => {
    const perPlayer = { ...settingsRef.current.perPlayer, [playerId]: playerSettings };
    update({ perPlayer });
  }, [update]);

  const removePlayerSettings = useCallback((playerId: string) => {
    const perPlayer = { ...settingsRef.current.perPlayer };
    delete perPlayer[playerId];
    update({ perPlayer });
  }, [update]);

  const getPlayerSettings = useCallback((playerId: string): PlayerNotificationSettings => {
    return settingsRef.current.perPlayer[playerId] ?? {
      enabled: true,
      types: { ...DEFAULT_TYPES },
    };
  }, []);

  return {
    settings,
    setEnabled,
    setTypeEnabled,
    setQuietHours,
    setPlayerSettings,
    removePlayerSettings,
    getPlayerSettings,
  };
}
