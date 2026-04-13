import { useTranslation } from 'react-i18next';
import { createEmptySet } from '@shared/utils/scoring';
import { showWarning, showSuccess } from '@shared/utils/toast';
import type { Match, Team, Player, Tournament } from '@shared/types';

// Firebase can return arrays as objects with numeric keys; ensure we always get an array
function toArray<T>(val: T[] | Record<string, T> | undefined | null): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [];
}

/** Compute group rankings from qualifying matches */
function computeGroupRankings(
  qualifyingMatches: Match[],
  groupIdToName: Map<string, string>,
) {
  const groupRankings = new Map<string, { groupId: string; groupName: string; rank: number }>();
  const groupMap = new Map<string, Match[]>();
  qualifyingMatches.forEach(m => {
    const gid = m.groupId!;
    if (!groupMap.has(gid)) groupMap.set(gid, []);
    groupMap.get(gid)!.push(m);
  });
  groupMap.forEach((gMatches, gid) => {
    const stats = new Map<string, { wins: number; setsWon: number; setsLost: number; pointsFor: number; pointsAgainst: number }>();
    gMatches.filter(m => m.status === 'completed').forEach(m => {
      const p1 = m.player1Id || m.team1Id || '';
      const p2 = m.player2Id || m.team2Id || '';
      if (!stats.has(p1)) stats.set(p1, { wins: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 });
      if (!stats.has(p2)) stats.set(p2, { wins: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 });
      if (m.winnerId === p1) stats.get(p1)!.wins++;
      else if (m.winnerId === p2) stats.get(p2)!.wins++;
      (m.sets || []).forEach(s => {
        stats.get(p1)!.pointsFor += s.player1Score;
        stats.get(p1)!.pointsAgainst += s.player2Score;
        stats.get(p2)!.pointsFor += s.player2Score;
        stats.get(p2)!.pointsAgainst += s.player1Score;
        if (s.player1Score > s.player2Score) { stats.get(p1)!.setsWon++; stats.get(p2)!.setsLost++; }
        else { stats.get(p2)!.setsWon++; stats.get(p1)!.setsLost++; }
      });
    });
    const sorted = Array.from(stats.entries())
      .sort(([,a], [,b]) => b.wins - a.wins || (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost) || (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst));
    sorted.forEach(([id], idx) => {
      groupRankings.set(id, { groupId: gid, groupName: groupIdToName.get(gid) || gid, rank: idx + 1 });
    });
  });
  return groupRankings;
}

export interface FinalsSectionProps {
  tournament: Tournament;
  matches: Match[];
  tournamentPlayers: Player[];
  teams: Team[];
  isTeamType: boolean;
  isManualMode: boolean;
  expectedMatchCount: { total: number };
  setMatchesBulk: (matches: Omit<Match, 'id'>[]) => Promise<string[] | void>;
  updateMatch: (matchId: string, data: Partial<Match>) => Promise<boolean | void>;
}

export default function FinalsSection({
  tournament,
  matches,
  tournamentPlayers,
  teams,
  isTeamType,
  isManualMode,
  expectedMatchCount,
  setMatchesBulk,
  updateMatch,
}: FinalsSectionProps) {
  const { t } = useTranslation();

  if (tournament.status === 'completed') return null;
  if (tournament.type === 'randomTeamLeague') return null;

  const finalsStage = toArray(tournament.stages).find(s => s.type === 'finals');
  if (!finalsStage) return null;

  const finalsMatches = matches.filter(m => m.stageId === finalsStage.id || (m.stageId && m.stageId.includes('finals')));

  // Shared data
  const qualifyingGroups = (() => {
    const qualifying = toArray(tournament.stages).find(s => s.type === 'qualifying');
    return qualifying ? toArray(qualifying.groups) : [];
  })();
  const qualifyingMatches = matches.filter(m => m.groupId);
  const groupIdToName = new Map<string, string>();
  qualifyingGroups.forEach(g => { groupIdToName.set(g.id, g.name); });
  const groupRankings = computeGroupRankings(qualifyingMatches, groupIdToName);

  const idToName = new Map<string, string>();
  tournamentPlayers.forEach(p => idToName.set(p.id, p.name));
  teams.forEach(t => idToName.set(t.id, t.name));

  const fc = tournament.finalsConfig as Record<string, unknown> | undefined;
  const advancePerGroup = typeof fc?.advancePerGroup === 'number' ? fc.advancePerGroup : 2;
  const totalAdvance = finalsStage.advanceCount || advancePerGroup * (tournament.qualifyingConfig?.groupCount || 2);

  // --- Finals Creation (no finals matches yet) ---
  if (finalsMatches.length === 0) {
    const hasQualifyingMatches = qualifyingMatches.length > 0;
    let matchCount = Math.floor(totalAdvance / 2);
    if (matchCount < 1) matchCount = 1;

    const completedCount = qualifyingMatches.filter(m => m.status === 'completed').length;
    const totalCount = qualifyingMatches.length;

    return (
      <div className="card space-y-4 border-cyan-600">
        <h3 className="text-lg font-bold text-cyan-400">{t('admin.tournamentDetail.bracketTab.finalsTitle')}</h3>

        {!hasQualifyingMatches ? (
          <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.bracketTab.finalsNoQualifying')}</p>
        ) : (
          <>
            <div className="text-sm text-gray-400">
              {t('admin.tournamentDetail.bracketTab.finalsProgress', { completed: completedCount, total: totalCount, advancePerGroup, totalAdvance, matchCount })}
            </div>

            {/* 조별 순위 현황 */}
            {completedCount > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-gray-300">{t('admin.tournamentDetail.bracketTab.groupRankTitle')}</h4>
                <div className="grid grid-cols-2 gap-2">
                  {qualifyingGroups.map(group => {
                    const groupPlayerRankings = Array.from(groupRankings.entries())
                      .filter(([, info]) => info.groupId === group.id)
                      .sort(([, a], [, b]) => a.rank - b.rank);
                    return (
                      <div key={group.id} className="bg-gray-800 rounded p-2">
                        <h5 className="text-xs font-bold text-cyan-400 mb-1">{group.name}</h5>
                        {groupPlayerRankings.map(([pid, info]) => (
                          <div key={pid} className={`text-xs flex gap-1 ${info.rank <= advancePerGroup ? 'text-green-400' : 'text-gray-400'}`}>
                            <span className="w-6">{info.rank}{t('admin.tournamentDetail.bracketTab.rankSuffix')}</span>
                            <span>{idToName.get(pid) || pid}</span>
                            {info.rank <= advancePerGroup && <span className="text-green-500 ml-auto">{t('admin.tournamentDetail.bracketTab.advanceLabel')}</span>}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              className="btn btn-accent w-full"
              onClick={async () => {
                // 본선 대진 경기 수 초과 검증
                const maxAllowed = expectedMatchCount.total;
                const totalAfterCreate = matches.length + matchCount;
                if (maxAllowed > 0 && totalAfterCreate > maxAllowed) {
                  showWarning(t('admin.tournamentDetail.bracketTab.matchCountExceeded', {
                    max: maxAllowed, current: matches.length, newCount: matchCount, total: totalAfterCreate,
                    defaultValue: `설정된 최대 경기 수(${maxAllowed}경기)를 초과합니다.\n현재 ${matches.length}경기 + 새로 ${matchCount}경기 = ${totalAfterCreate}경기\n대진 생성이 취소되었습니다.`,
                  }));
                  return;
                }
                // 본선 대진 중복 검증
                const existingFinalsMatches = matches.filter(m => m.stageId === finalsStage.id);
                if (existingFinalsMatches.length > 0) {
                  showWarning(t('admin.tournamentDetail.bracketTab.finalsDuplicateBlocked', {
                    count: existingFinalsMatches.length,
                  }));
                  return;
                }
                const now = Date.now(); // eslint-disable-line react-hooks/purity
                const newMatches: Omit<Match, 'id'>[] = [];
                for (let i = 0; i < matchCount; i++) {
                  newMatches.push({
                    tournamentId: tournament.id,
                    type: isTeamType ? 'team' : 'individual',
                    status: 'pending',
                    round: 1,
                    bracketPosition: i,
                    stageId: finalsStage.id,
                    player1Id: '',
                    player2Id: '',
                    player1Name: t('admin.tournamentDetail.bracketTab.undecided'),
                    player2Name: t('admin.tournamentDetail.bracketTab.undecided'),
                    sets: [createEmptySet()],
                    currentSet: 0,
                    player1Timeouts: 0,
                    player2Timeouts: 0,
                    winnerId: null,
                    createdAt: now + i,
                  });
                }
                await setMatchesBulk(newMatches);
              }}
              aria-label={t('admin.tournamentDetail.bracketTab.createFinalsSlotsAriaLabel')}
            >
              {t('admin.tournamentDetail.bracketTab.createFinalsSlots', { count: matchCount })}
            </button>
            <p className="text-gray-400 text-xs">{t('admin.tournamentDetail.bracketTab.createFinalsSlotsHint')}</p>
          </>
        )}
      </div>
    );
  }

  // --- Finals Arrangement (finals matches exist) ---
  // All advanced player IDs from finals matches
  const advancedIds = new Set<string>();
  finalsMatches.forEach(m => {
    const p1 = isTeamType ? m.team1Id : m.player1Id;
    const p2 = isTeamType ? m.team2Id : m.player2Id;
    if (p1) advancedIds.add(p1);
    if (p2) advancedIds.add(p2);
  });
  const advancedList = Array.from(advancedIds);

  const getLabel = (pid: string) => {
    const info = groupRankings.get(pid);
    const name = idToName.get(pid) || pid;
    if (info) return `${info.groupName} ${info.rank}${t('admin.tournamentDetail.bracketTab.rankSuffix')}: ${name}`;
    return name;
  };

  const applyArrangement = async (mode: 'cross' | 'sequential') => {
    const withInfo = advancedList.map(id => ({ id, ...(groupRankings.get(id) || { groupId: '', groupName: '', rank: 0 }) }));
    const groupIds = [...new Set(withInfo.map(w => w.groupId))].sort();
    const byGroup = new Map<string, typeof withInfo>();
    withInfo.forEach(w => {
      if (!byGroup.has(w.groupId)) byGroup.set(w.groupId, []);
      byGroup.get(w.groupId)!.push(w);
    });
    byGroup.forEach(arr => arr.sort((a, b) => a.rank - b.rank));

    const pairs: [string, string][] = [];

    if (mode === 'cross') {
      for (let i = 0; i < groupIds.length; i += 2) {
        const gA = byGroup.get(groupIds[i]) || [];
        const gB = byGroup.get(groupIds[i + 1] || groupIds[i]) || [];
        if (gA[0] && gB[1]) pairs.push([gA[0].id, gB[1].id]);
        if (gB[0] && gA[1]) pairs.push([gB[0].id, gA[1].id]);
        for (let k = 2; k < Math.max(gA.length, gB.length); k++) {
          if (gA[k] && gB[k]) pairs.push([gA[k].id, gB[k].id]);
          else if (gA[k]) pairs.push([gA[k].id, gA[k].id]);
        }
      }
    } else if (mode === 'sequential') {
      groupIds.forEach(gid => {
        const arr = byGroup.get(gid) || [];
        for (let k = 0; k < arr.length; k += 2) {
          if (arr[k + 1]) pairs.push([arr[k].id, arr[k + 1].id]);
        }
      });
    }

    const sortedFinals = [...finalsMatches].sort((a, b) => (a.bracketPosition ?? 0) - (b.bracketPosition ?? 0) || a.createdAt - b.createdAt);
    for (let i = 0; i < Math.min(pairs.length, sortedFinals.length); i++) {
      const [p1, p2] = pairs[i];
      const matchData: Partial<Match> = isTeamType ? {
        team1Id: p1, team2Id: p2,
        team1Name: idToName.get(p1) || p1,
        team2Name: idToName.get(p2) || p2,
      } : {
        player1Id: p1, player2Id: p2,
        player1Name: idToName.get(p1) || p1,
        player2Name: idToName.get(p2) || p2,
      };
      await updateMatch(sortedFinals[i].id, matchData);
    }
    showSuccess(t('admin.tournamentDetail.bracketTab.finalsArranged'));
  };

  const handleSlotChange = async (matchId: string, slot: 'player1' | 'player2', newId: string) => {
    const name = idToName.get(newId) || newId;
    const matchData: Partial<Match> = isTeamType
      ? (slot === 'player1' ? { team1Id: newId, team1Name: name } : { team2Id: newId, team2Name: name })
      : (slot === 'player1' ? { player1Id: newId, player1Name: name } : { player2Id: newId, player2Name: name });
    await updateMatch(matchId, matchData);
  };

  const sortedFinals = [...finalsMatches].sort((a, b) => (a.bracketPosition ?? 0) - (b.bracketPosition ?? 0) || a.createdAt - b.createdAt);

  // Build group+rank based options for manual arrangement
  const groupNames = [...new Set(Array.from(groupRankings.values()).map(v => v.groupName))].sort();
  const maxRank = Math.max(...Array.from(groupRankings.values()).map(v => v.rank), 0);
  const findByGroupRank = (groupName: string, rank: number): string | null => {
    for (const [pid, info] of groupRankings.entries()) {
      if (info.groupName === groupName && info.rank === rank) return pid;
    }
    return null;
  };

  return (
    <div className="card space-y-4 border-yellow-600">
      <h3 className="text-lg font-bold text-yellow-400">{t('admin.tournamentDetail.bracketTab.finalsArrangement')}</h3>

      {/* Preset buttons (자동 모드만) */}
      {!isManualMode && (
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-primary" onClick={() => applyArrangement('cross')} aria-label={t('admin.tournamentDetail.bracketTab.crossArrangementAriaLabel')}>
            {t('admin.tournamentDetail.bracketTab.crossArrangement')}
          </button>
          <button className="btn btn-secondary" onClick={() => applyArrangement('sequential')} aria-label={t('admin.tournamentDetail.bracketTab.sequentialArrangementAriaLabel')}>
            {t('admin.tournamentDetail.bracketTab.sequentialArrangement')}
          </button>
        </div>
      )}
      {isManualMode && (
        <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.bracketTab.manualArrangementHint')}</p>
      )}

      {/* Manual arrangement: group+rank selectors per match */}
      <div className="space-y-2">
        <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.bracketTab.arrangementSelectHint')}</p>
        {sortedFinals.map((m, i) => {
          const p1Id = isTeamType ? m.team1Id : m.player1Id;
          const p2Id = isTeamType ? m.team2Id : m.player2Id;
          const p1Info = p1Id ? groupRankings.get(p1Id) : null;
          const p2Info = p2Id ? groupRankings.get(p2Id) : null;

          const makeGroupRankSelector = (slot: 'player1' | 'player2', _currentId: string | undefined, currentInfo: typeof p1Info) => {
            const groupVal = currentInfo?.groupName || '';
            const rankVal = currentInfo?.rank || 0;

            return (
              <div className="flex-1 min-w-44 flex gap-1 items-center">
                <select
                  className="input flex-1 min-w-20"
                  value={groupVal}
                  onChange={e => {
                    const newGroup = e.target.value;
                    const r = rankVal || 1;
                    const pid = findByGroupRank(newGroup, r);
                    if (pid) handleSlotChange(m.id, slot, pid);
                  }}
                  disabled={m.status !== 'pending'}
                  aria-label={t('admin.tournamentDetail.bracketTab.matchNumber', { num: i + 1 }) + ' ' + (slot === 'player1' ? 'P1' : 'P2') + ' group'}
                >
                  <option value="">{t('admin.tournamentDetail.bracketTab.groupSelectPlaceholder')}</option>
                  {groupNames.map(gn => (
                    <option key={gn} value={gn}>{gn}</option>
                  ))}
                </select>
                <select
                  className="input w-20"
                  value={rankVal || ''}
                  onChange={e => {
                    const newRank = Number(e.target.value);
                    const g = groupVal;
                    if (g) {
                      const pid = findByGroupRank(g, newRank);
                      if (pid) handleSlotChange(m.id, slot, pid);
                    }
                  }}
                  disabled={m.status !== 'pending' || !groupVal}
                  aria-label={t('admin.tournamentDetail.bracketTab.matchNumber', { num: i + 1 }) + ' ' + (slot === 'player1' ? 'P1' : 'P2') + ' rank'}
                >
                  <option value="">{t('admin.tournamentDetail.bracketTab.rankSelectPlaceholder')}</option>
                  {Array.from({ length: maxRank }, (_, k) => k + 1).map(r => {
                    const pid = groupVal ? findByGroupRank(groupVal, r) : null;
                    return (
                      <option key={r} value={r} disabled={!pid}>
                        {r}{t('admin.tournamentDetail.bracketTab.rankSuffix')}{pid ? ` (${idToName.get(pid) || ''})` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            );
          };

          return (
            <div key={m.id} className="bg-gray-800 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-gray-400 text-sm font-mono w-16">{t('admin.tournamentDetail.bracketTab.matchNumber', { num: i + 1 })}</span>
                {groupNames.length > 0 ? (
                  <>
                    {makeGroupRankSelector('player1', p1Id, p1Info)}
                    <span className="text-gray-400 font-bold">vs</span>
                    {makeGroupRankSelector('player2', p2Id, p2Info)}
                  </>
                ) : (
                  <>
                    <select
                      className="input flex-1 min-w-36"
                      value={p1Id || ''}
                      onChange={e => handleSlotChange(m.id, 'player1', e.target.value)}
                      disabled={m.status !== 'pending'}
                      aria-label={t('admin.tournamentDetail.bracketTab.matchNumber', { num: i + 1 }) + ' P1'}
                    >
                      <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                      {advancedList.map(pid => (
                        <option key={pid} value={pid}>{getLabel(pid)}</option>
                      ))}
                    </select>
                    <span className="text-gray-400 font-bold">vs</span>
                    <select
                      className="input flex-1 min-w-36"
                      value={p2Id || ''}
                      onChange={e => handleSlotChange(m.id, 'player2', e.target.value)}
                      disabled={m.status !== 'pending'}
                      aria-label={t('admin.tournamentDetail.bracketTab.matchNumber', { num: i + 1 }) + ' P2'}
                    >
                      <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                      {advancedList.map(pid => (
                        <option key={pid} value={pid}>{getLabel(pid)}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>
              {/* Show current assignment summary */}
              {(p1Id || p2Id) && (
                <div className="text-xs text-gray-400 ml-16">
                  {p1Id ? getLabel(p1Id) : t('admin.tournamentDetail.bracketTab.undecided')} vs {p2Id ? getLabel(p2Id) : t('admin.tournamentDetail.bracketTab.undecided')}
                </div>
              )}
              {m.status !== 'pending' && (
                <span className="text-xs text-orange-400 ml-16">{t('admin.tournamentDetail.bracketTab.inProgressCannotChange')}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
