/**
 * 관전 도우미의 기기 안 응답기.
 * - 지금 보고 있는 대회 데이터는 대회 화면(TournamentView)이 setAssistantData로 알려 준다.
 * - 설정 명령(글씨 크게, 고대비, ○○ 즐겨찾기, 알림 켜줘)은 서버에 묻지 않고 바로 실행하고 확인 문장을 돌려준다.
 * - 정보 질문은 서버에 닿지 않을 때(오프라인·오류) 불러온 데이터로 답한다.
 */
import type { Match, ScheduleSlot, Tournament } from '@shared/types';
import { dispatchA11y, FONT_SCALES } from '@shared/utils/a11ySettings';
import { setFavoriteEntry, getFavoriteEntries } from '@shared/hooks/useFirebase';
import { enablePushNotifications, disablePushNotifications } from '@shared/hooks/usePushNotifications';
import { updateNotificationSettings } from '@shared/hooks/useNotificationSettings';
import { answerSpectatorIntent, parseSpectatorIntent, type SpectatorIntent } from './spectatorIntents';
import { buildPeopleIndex } from './peopleSearch';
import type { Translate } from './rulesSentence';

export interface AssistantData {
  tournament: Tournament | null;
  matches: Match[];
  schedule: ScheduleSlot[];
}

let data: AssistantData | null = null;

export function setAssistantData(d: AssistantData | null): void {
  data = d;
}

export function getAssistantData(): AssistantData | null {
  return data;
}

export interface LocalResponder {
  /** 설정 명령이면 실행하고 확인 문장, 아니면 null */
  command: (text: string) => string | null;
  /** 서버 없이 답할 수 있는 질문이면 답, 아니면 null */
  answer: (text: string) => string | null;
}

function names(d: AssistantData | null): string[] {
  if (!d) return [];
  return buildPeopleIndex(d.matches).filter(p => p.kind !== 'referee').map(p => p.name);
}

const COLOR_LABEL: Record<string, string> = {
  dark: 'common.accessibility.dark',
  light: 'common.accessibility.light',
  'high-contrast': 'common.accessibility.highContrast',
  'high-contrast-light': 'common.accessibility.highContrastLight',
  invert: 'common.accessibility.invert',
};

/** 설정·즐겨찾기 의도를 실행한다 (나머지 의도는 null) */
export function executeIntent(intent: SpectatorIntent, t: Translate, d: AssistantData | null): string | null {
  if (intent.type === 'setting') {
    const c = intent.command;
    if (c.setting === 'fontStep') {
      const next = dispatchA11y({ type: 'fontStep', delta: c.delta });
      return t('spectator.assistant.fontChanged', { n: next.fontLevel + 1, percent: Math.round(FONT_SCALES[next.fontLevel] * 100) });
    }
    if (c.setting === 'colorMode') {
      dispatchA11y({ type: 'update', patch: { colorMode: c.mode } });
      return t('spectator.assistant.colorChanged', { label: t(COLOR_LABEL[c.mode]) });
    }
    updateNotificationSettings({ enabled: c.on });
    if (c.on) {
      void enablePushNotifications(getFavoriteEntries());
      return t('spectator.assistant.notificationsOn');
    }
    void disablePushNotifications();
    return t('spectator.assistant.notificationsOff');
  }
  if (intent.type === 'favorite') {
    const person = d ? buildPeopleIndex(d.matches).find(p => p.name === intent.name && p.kind !== 'referee') : undefined;
    setFavoriteEntry(person?.id || intent.name, intent.name, intent.on);
    return t(intent.on ? 'spectator.assistant.favoriteAdded' : 'spectator.assistant.favoriteRemoved', { name: intent.name });
  }
  return null;
}

export function createSpectatorResponder(t: Translate, now: () => number = Date.now): LocalResponder {
  return {
    command(text) {
      const d = getAssistantData();
      const intent = parseSpectatorIntent(text, { names: names(d) });
      if (!intent || (intent.type !== 'setting' && intent.type !== 'favorite')) return null;
      return executeIntent(intent, t, d);
    },
    answer(text) {
      const d = getAssistantData();
      if (!d) return null;
      const intent = parseSpectatorIntent(text, { names: names(d) });
      if (!intent) return null;
      return answerSpectatorIntent(intent, d, now(), t);
    },
  };
}
