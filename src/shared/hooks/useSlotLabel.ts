import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Match } from '../types';
import { isUndecidedSide, slotSourceInfo } from '../utils/competition';
import { isByeMatch } from '../rules/walkover';
import { isTeamType } from '../rules/competitionRules';

export interface SlotLabel {
  /** 화면 표시 문구 */
  text: string;
  /** 스크린리더 문구 (미정 슬롯은 어느 경기의 승자/패자인지까지) */
  srText: string;
  /** 아직 참가자가 정해지지 않은 슬롯(미정 또는 BYE) — 흐린 스타일로 그리고 선수 링크를 만들지 않는다 */
  undecided: boolean;
}

/**
 * 대진표 슬롯 이름. ID가 빈 쪽은 저장된 이름(예전 데이터의 'TBD', '8강 승자1' 등)과 상관없이
 * 현지화된 '미정'으로 보이고, 스크린리더에는 '미정 (4강 1경기 승자)'처럼 출처 경기를 읽어 준다.
 * BYE 경기의 빈 쪽은 '부전승'으로 보인다.
 */
export function useSlotLabel(allMatches: readonly Match[]) {
  const { t } = useTranslation();
  const byId = useMemo(() => new Map(allMatches.map(m => [m.id, m])), [allMatches]);
  return useCallback((m: Match, side: 1 | 2): SlotLabel => {
    const team = isTeamType(m.type);
    const name = side === 1
      ? (team ? m.team1Name || m.player1Name : m.player1Name || m.team1Name)
      : (team ? m.team2Name || m.player2Name : m.player2Name || m.team2Name);
    if (!isUndecidedSide(m, side)) {
      const text = name || t('common.unknown');
      return { text, srText: text, undecided: false };
    }
    if (isByeMatch(m)) {
      const text = t('admin.tournamentDetail.bracketTab.byeSlot');
      return { text, srText: t('common.competitionRules.byeBadge'), undecided: true };
    }
    const undecided = t('common.competitionRules.undecided');
    const info = slotSourceInfo(m, side, byId);
    const srText = info
      ? t('common.competitionRules.undecidedFrom', {
        round: info.roundLabel,
        num: info.matchNumber,
        outcome: t(info.outcome === 'loser' ? 'common.competitionRules.outcomeLoser' : 'common.competitionRules.outcomeWinner'),
      })
      : undecided;
    return { text: undecided, srText, undecided: true };
  }, [byId, t]);
}
