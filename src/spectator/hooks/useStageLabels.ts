import { useTranslation } from 'react-i18next';
import type { Match } from '@shared/types';

/** 경기 단계 이름 (A조 / 4강 / 3/4위 결정전 …) */
export function useStageLabel() {
  const { t } = useTranslation();
  return (m: Match): string => {
    if (m.groupId) return t('spectator.tournament.view.groupLabel', { id: m.groupId });
    return m.roundLabel || m.bracketRound || '';
  };
}

/** 일정 필터의 단계 키 표시 이름 ('group:A' → A조, finals → 본선 …) */
export function useStageKeyLabel() {
  const { t } = useTranslation();
  return (key: string) => key.startsWith('group:')
    ? t('spectator.tournament.view.groupLabel', { id: key.slice(6) || '-' })
    : t(`spectator.schedule.stage.${key}`);
}
