import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdvancementConflicts, type AdvancementConflict } from '@shared/hooks/useFirebase';
import { combineWriteResults, notifyWriteOutcome, type WriteResult } from '@shared/utils/dataWrites';
import { showError } from '@shared/utils/toast';
import { isTeamType } from '@shared/rules/competitionRules';
import type { Match, MatchUpdate, Team } from '@shared/types';

/**
 * 자동 진출 충돌 패널 (M0c).
 * 서버 진출 트리거가 하위 경기 슬롯을 바꾸지 못한 경우(이미 시작/완료, 또는 관리자가 직접 넣은 값)를
 * 쉬운 말로 설명하고 두 가지 동작을 준다.
 * - 적용: 하위 경기가 아직 대기(pending)일 때만. 결과대로 선수를 넣고 충돌 기록을 지운다.
 * - 유지: 지금 값을 그대로 두고 충돌 기록을 지운다.
 * 접근성: 제목 + 목록, 버튼마다 경기·자리·선수 이름이 들어간 라벨, 처리 결과는 aria-live로 알린다.
 */
/** 서버 fillPatch와 같은 모양의 명단 객체 (undefined 필드 없이) */
function rosterValue(team: Partial<Team>, id: string, name: string): Team {
  return {
    id: team.id || id,
    name: team.name || name,
    memberIds: team.memberIds || [],
    memberNames: team.memberNames || [],
    coachName: team.coachName || '',
  };
}

export interface AdvancementConflictsPanelProps {
  tournamentId: string;
  matches: Match[];
  updateMatch: (matchId: string, data: MatchUpdate) => Promise<WriteResult>;
  /** 팀 명단(team{N} 객체)을 찾을 팀 목록 */
  teams?: Team[];
}

export default function AdvancementConflictsPanel({ tournamentId, matches, updateMatch, teams = [] }: AdvancementConflictsPanelProps) {
  const { t } = useTranslation();
  const { conflicts, dismissConflict } = useAdvancementConflicts(tournamentId);
  const [announcement, setAnnouncement] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const byId = new Map(matches.map(m => [m.id, m]));
  const matchName = (id: string) => {
    const m = byId.get(id);
    if (!m) return id;
    return t('common.competitionRules.conflicts.matchName', { round: m.roundLabel || m.bracketRound || `R${m.round}`, num: (m.bracketPosition ?? 0) + 1 });
  };
  const statusLabel = (s: string) => (s === 'in_progress' ? t('common.matchStatus.inProgress') : s === 'completed' ? t('common.matchStatus.completed') : s);
  const sideLabel = (side: 1 | 2) => t(side === 1 ? 'common.competitionRules.conflicts.side1' : 'common.competitionRules.conflicts.side2');
  const nameOr = (name: string, id: string) => name || id || t('common.competitionRules.conflicts.empty');

  /**
   * 진출할 팀의 명단 객체 (서버 fillPatch처럼 team{N}을 함께 써야 심판·관전 화면이 선수 명단을 잃지 않는다).
   * 원 경기에서 그 팀이 있던 쪽의 team{N} → 팀 목록 순으로 찾는다.
   */
  const rosterOf = (c: AdvancementConflict): Team | null => {
    if (!c.expectedId) return null;
    const src = byId.get(c.sourceMatchId);
    if (src) {
      const side = src.team1Id === c.expectedId ? src.team1 : src.team2Id === c.expectedId ? src.team2 : undefined;
      if (side) return rosterValue(side, c.expectedId, c.expectedName);
    }
    const team = teams.find(tm => tm.id === c.expectedId);
    return team ? rosterValue(team, c.expectedId, c.expectedName) : null;
  };

  const apply = async (c: AdvancementConflict, key: string) => {
    const m = byId.get(c.downstreamMatchId);
    if (!m || m.status !== 'pending') {
      setAnnouncement(t('common.competitionRules.conflicts.cannotApply'));
      return;
    }
    setBusy(key);
    try {
      const n = c.side;
      const name = c.expectedId ? c.expectedName : t('common.competitionRules.undecided');
      const data: MatchUpdate = n === 1
        ? { player1Id: c.expectedId, player1Name: name, player1Source: c.expectedId ? { matchId: c.sourceMatchId, outcome: c.outcome, id: c.expectedId, name: c.expectedName, prevName: t('common.competitionRules.undecided') } : null }
        : { player2Id: c.expectedId, player2Name: name, player2Source: c.expectedId ? { matchId: c.sourceMatchId, outcome: c.outcome, id: c.expectedId, name: c.expectedName, prevName: t('common.competitionRules.undecided') } : null };
      if (isTeamType(m.type) || m.team1Id !== undefined || m.team2Id !== undefined) {
        // 빈 자리로 바꾸거나 명단을 못 찾으면 team{N}을 지운다(다른 팀의 옛 명단이 남지 않게)
        const roster = rosterOf(c);
        Object.assign(data, n === 1 ? { team1Id: c.expectedId, team1Name: name, team1: roster } : { team2Id: c.expectedId, team2Name: name, team2: roster });
      }
      const outcome = combineWriteResults([await updateMatch(m.id, data)]);
      if (outcome === 'failed') { showError(t('common.competitionRules.conflicts.failed')); return; }
      await dismissConflict(c.downstreamMatchId, c.side);
      const msg = t('common.competitionRules.conflicts.applied', { match: matchName(c.downstreamMatchId), side: sideLabel(c.side), expected: nameOr(c.expectedName, c.expectedId) });
      notifyWriteOutcome(outcome, t, msg);
      setAnnouncement(msg);
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (c: AdvancementConflict, key: string) => {
    setBusy(key);
    try {
      if (!await dismissConflict(c.downstreamMatchId, c.side)) { showError(t('common.competitionRules.conflicts.failed')); return; }
      setAnnouncement(t('common.competitionRules.conflicts.dismissed', { match: matchName(c.downstreamMatchId), side: sideLabel(c.side) }));
    } finally {
      setBusy(null);
    }
  };

  // 알림 영역은 목록이 비어도 계속 남겨 둬야 마지막 처리 결과가 읽힌다
  const liveRegion = <p className="sr-only" role="status" aria-live="polite">{announcement}</p>;
  if (conflicts.length === 0) return liveRegion;

  return (
    <>
    {liveRegion}
    <section className="card space-y-3 border-orange-500" aria-labelledby="advancement-conflicts-title">
      <h2 id="advancement-conflicts-title" className="text-xl font-bold text-orange-400">
        {t('common.competitionRules.conflicts.title')} ({conflicts.length})
      </h2>
      <p className="text-sm text-gray-300">{t('common.competitionRules.conflicts.intro')}</p>
      <ul className="space-y-2">
        {conflicts.map(c => {
          const key = `${c.downstreamMatchId}_${c.side}`;
          const downstream = byId.get(c.downstreamMatchId);
          const canApply = !!downstream && downstream.status === 'pending';
          const vars = {
            match: matchName(c.downstreamMatchId),
            side: sideLabel(c.side),
            expected: nameOr(c.expectedName, c.expectedId),
            current: nameOr(c.currentName, c.currentId),
            status: statusLabel(downstream?.status || c.downstreamStatus),
          };
          return (
            <li key={key} className="bg-gray-800 rounded-lg p-3 space-y-2">
              <p>{t(c.reason === 'manual_override' && canApply ? 'common.competitionRules.conflicts.explainManual' : 'common.competitionRules.conflicts.explainStarted', vars)}</p>
              {!canApply && <p className="text-sm text-gray-400">{t('common.competitionRules.conflicts.cannotApply')}</p>}
              <div className="flex gap-2 flex-wrap">
                {canApply && (
                  <button
                    type="button"
                    className="btn btn-accent"
                    onClick={() => apply(c, key)}
                    disabled={busy === key}
                    aria-busy={busy === key}
                  >
                    {t('common.competitionRules.conflicts.apply', vars)}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => dismiss(c, key)}
                  disabled={busy === key}
                  aria-busy={busy === key}
                >
                  {t('common.competitionRules.conflicts.dismiss', vars)}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
    </>
  );
}
