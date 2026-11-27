import { useTranslation } from 'react-i18next';
import { createEmptySet } from '@shared/utils/scoring';
import { showWarning } from '@shared/utils/toast';
import { combineWriteResults, notifyWriteOutcome, replaceStagesFor, type MatchesBulkOptions, type WriteResult } from '@shared/utils/dataWrites';
import { buildFirstRoundSlots, buildSingleEliminationSkeleton, nextPowerOfTwo } from '@shared/utils/bracketSkeleton';
import { newMatchKey } from '@shared/hooks/useFirebase';
import { countPlayableMatches } from '@shared/utils/tournament';
import type { Match, MatchUpdate, Team, Player, Tournament } from '@shared/types';

// Firebase can return arrays as objects with numeric keys; ensure we always get an array
function toArray<T>(val: T[] | Record<string, T> | undefined | null): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [];
}

/** 이전 경기 결과로 채워지는 경기(진출 링크가 있음): 수동 편성 대상이 아니다 */
function hasSourceLinks(m: Match): boolean {
  return !!(m.sourceMatch1 || m.sourceMatch2 || m.sourceMatch1Id || m.sourceMatch2Id);
}

/** BYE(부전승) 경기 */
function isByeMatch(m: Match): boolean {
  return m.bye === true || m.isBye === true;
}

/** BYE 경기에서 실제 선수가 들어가는 쪽 (서버 생성 BYE는 'BYE' ID의 반대쪽, 클라이언트 생성은 항상 1번) */
function byeRealSide(m: Match): 'player1' | 'player2' {
  return (m.player1Id || m.team1Id) === 'BYE' ? 'player2' : 'player1';
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
  setMatchesBulk: (matches: Omit<Match, 'id'>[], options: MatchesBulkOptions) => Promise<string[] | void>;
  updateMatch: (matchId: string, data: MatchUpdate) => Promise<WriteResult>;
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

  // 3/4위전 사용 여부 (대회 생성 위저드의 3/4위 결정전 설정)
  const includeThirdPlace = tournament.rankingMatchConfig?.thirdPlace === true;

  // --- Finals Creation (no finals matches yet) ---
  if (finalsMatches.length === 0) {
    const hasQualifyingMatches = qualifyingMatches.length > 0;
    // 전체 싱글 엘리미네이션 골격: 대진 크기 = 진출 인원 이상인 최소 2의 거듭제곱
    const entrantCount = Math.max(2, totalAdvance);
    const bracketSize = nextPowerOfTwo(entrantCount);
    const hasThirdPlaceMatch = includeThirdPlace && bracketSize >= 4;
    // 실제로 치르는 본선 경기 수 (BYE 제외): N-1 (+3/4위전)
    const matchCount = entrantCount - 1 + (hasThirdPlaceMatch ? 1 : 0);
    // 생성되는 슬롯 수 (BYE 경기 포함)
    const slotCount = bracketSize - 1 + (hasThirdPlaceMatch ? 1 : 0);

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
                // (실제로 치르는 경기만 센다: BYE 슬롯 경기는 빼고 3/4위전은 넣는다. calculateMatchCount와 같은 기준)
                const maxAllowed = expectedMatchCount.total;
                const currentCount = countPlayableMatches(matches);
                const totalAfterCreate = currentCount + matchCount;
                if (maxAllowed > 0 && totalAfterCreate > maxAllowed) {
                  showWarning(t('admin.tournamentDetail.bracketTab.matchCountExceeded', {
                    max: maxAllowed, current: currentCount, newCount: matchCount, total: totalAfterCreate,
                    defaultValue: `설정된 최대 경기 수(${maxAllowed}경기)를 초과합니다.\n현재 ${currentCount}경기 + 새로 ${matchCount}경기 = ${totalAfterCreate}경기\n대진 생성이 취소되었습니다.`,
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
                // 1라운드는 빈 슬롯(이후 수동 편성), 2라운드~결승과 3/4위전은 진출 링크로 연결
                const entries = buildSingleEliminationSkeleton({
                  tournamentId: tournament.id,
                  stageId: finalsStage.id,
                  matchType: isTeamType ? 'team' : 'individual',
                  slots: buildFirstRoundSlots(entrantCount),
                  thirdPlace: includeThirdPlace,
                  makeKey: () => newMatchKey(tournament.id),
                  now,
                  labels: {
                    undecided: t('admin.tournamentDetail.bracketTab.undecided'),
                    bye: t('admin.tournamentDetail.bracketTab.byeSlot'),
                  },
                });
                const newMatches = entries.map(e => e.match);
                // 본선(및 3/4위전) 스테이지만 교체 범위로 지정: 대기 중인 예선 경기는 보존된다
                await setMatchesBulk(newMatches, { replaceStages: replaceStagesFor(newMatches), keys: entries.map(e => e.key) });
              }}
              aria-label={t('admin.tournamentDetail.bracketTab.createFinalsSlotsAriaLabel')}
            >
              {t('admin.tournamentDetail.bracketTab.createFinalsSlots', { count: slotCount })}
            </button>
            <p className="text-gray-400 text-xs">{t('admin.tournamentDetail.bracketTab.createFinalsSlotsHint')}</p>
            <p className="text-gray-400 text-xs">{t('admin.tournamentDetail.bracketTab.autoAdvanceHint')}</p>
          </>
        )}
      </div>
    );
  }

  // --- Finals Arrangement (finals matches exist) ---
  // 수동 편성 대상: 진출 링크가 없는 경기(1라운드). 링크가 있는 경기는 앞 경기 결과로 자동으로 채워진다.
  const arrangeableMatches = finalsMatches.filter(m => !hasSourceLinks(m));
  const hasLinkedMatches = arrangeableMatches.length < finalsMatches.length;
  // All advanced player IDs from finals matches
  const advancedIds = new Set<string>();
  arrangeableMatches.forEach(m => {
    const p1 = isTeamType ? m.team1Id : m.player1Id;
    const p2 = isTeamType ? m.team2Id : m.player2Id;
    if (p1 && p1 !== 'BYE') advancedIds.add(p1);
    if (p2 && p2 !== 'BYE') advancedIds.add(p2);
  });
  const advancedList = Array.from(advancedIds);

  const getLabel = (pid: string) => {
    const info = groupRankings.get(pid);
    const name = idToName.get(pid) || pid;
    if (info) return `${info.groupName} ${info.rank}${t('admin.tournamentDetail.bracketTab.rankSuffix')}: ${name}`;
    return name;
  };

  const slotData = (slot: 'player1' | 'player2', newId: string): MatchUpdate => {
    const name = idToName.get(newId) || newId;
    const player: MatchUpdate = slot === 'player1' ? { player1Id: newId, player1Name: name } : { player2Id: newId, player2Name: name };
    // 팀전 본선 골격은 team{N}*와 player{N}*를 함께 갖는다: 둘 다 바꿔야 옛 값이 표시/진출되지 않는다
    if (!isTeamType) return player;
    return { ...player, ...(slot === 'player1' ? { team1Id: newId, team1Name: name } : { team2Id: newId, team2Name: name }) };
  };

  /**
   * BYE 경기에 실제 선수를 배정하면 바로 부전승 완료로 표시한다(가짜 점수 없음).
   * 완료로 바뀌면 서버 진출 트리거가 다음 라운드에 그 선수를 채운다. 선수를 비우면 다시 대기로 돌린다.
   */
  const byeSlotData = (m: Match, newId: string): MatchUpdate => ({
    ...slotData(byeRealSide(m), newId),
    status: newId ? 'completed' : 'pending',
    winnerId: newId || null,
    sets: newId ? [] : [createEmptySet()],
  });

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
          // 짝이 없는 선수는 자기 자신과 짝짓지 않는다 (아래에서 BYE 자리 또는 남은 선수끼리 배치)
          if (gA[k] && gB[k]) pairs.push([gA[k].id, gB[k].id]);
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

    // 한 선수가 두 번 배치되거나 자기 자신과 대전하지 않도록 정리
    const placed = new Set<string>();
    const cleanPairs = pairs.filter(([a, b]) => {
      if (a === b || placed.has(a) || placed.has(b)) return false;
      placed.add(a);
      placed.add(b);
      return true;
    });
    const sorted = [...arrangeableMatches].sort((a, b) => (a.bracketPosition ?? 0) - (b.bracketPosition ?? 0) || a.createdAt - b.createdAt);
    const realSlots = sorted.filter(m => !isByeMatch(m));
    const byeSlots = sorted.filter(m => isByeMatch(m));
    const usedPairs = cleanPairs.slice(0, realSlots.length);
    const usedIds = new Set(usedPairs.flat());
    // 짝을 못 지은 선수: 먼저 BYE 자리에, 그래도 남으면 남은 실제 경기에 둘씩
    const leftovers = advancedList.filter(id => !usedIds.has(id));

    const pairData = (p1: string, p2: string): MatchUpdate => ({ ...slotData('player1', p1), ...slotData('player2', p2) });
    const results: WriteResult[] = [];
    for (let i = 0; i < usedPairs.length; i++) {
      results.push(await updateMatch(realSlots[i].id, pairData(usedPairs[i][0], usedPairs[i][1])));
    }
    for (const byeMatch of byeSlots) {
      const id = leftovers.shift();
      if (!id) break;
      results.push(await updateMatch(byeMatch.id, byeSlotData(byeMatch, id)));
    }
    for (let i = usedPairs.length; i < realSlots.length && leftovers.length >= 2; i++) {
      const p1 = leftovers.shift()!;
      const p2 = leftovers.shift()!;
      results.push(await updateMatch(realSlots[i].id, pairData(p1, p2)));
    }
    notifyWriteOutcome(combineWriteResults(results), t, t('admin.tournamentDetail.bracketTab.finalsArranged'));
  };

  const handleSlotChange = async (match: Match, slot: 'player1' | 'player2', newId: string) => {
    const matchData = isByeMatch(match) ? byeSlotData(match, newId) : slotData(slot, newId);
    notifyWriteOutcome(combineWriteResults([await updateMatch(match.id, matchData)]), t);
  };

  const sideSummary = (pid: string | undefined, isByeSide: boolean) => {
    if (isByeSide) return t('admin.tournamentDetail.bracketTab.byeSlot');
    return pid && pid !== 'BYE' ? getLabel(pid) : t('admin.tournamentDetail.bracketTab.undecided');
  };

  const sortedFinals = [...arrangeableMatches].sort((a, b) => (a.bracketPosition ?? 0) - (b.bracketPosition ?? 0) || a.createdAt - b.createdAt);

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
        {hasLinkedMatches && (
          <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.bracketTab.autoAdvanceHint')}</p>
        )}
        {sortedFinals.map((m, i) => {
          const p1Id = isTeamType ? m.team1Id : m.player1Id;
          const p2Id = isTeamType ? m.team2Id : m.player2Id;
          const p1Info = p1Id ? groupRankings.get(p1Id) : null;
          const p2Info = p2Id ? groupRankings.get(p2Id) : null;
          // BYE 경기는 실제로 치르지 않으므로 완료 표시가 돼 있어도 다시 배정할 수 있다
          const isBye = isByeMatch(m);
          const locked = m.status !== 'pending' && !isBye;
          const realSide = isBye ? byeRealSide(m) : null;
          const byeLabel = (
            <span className="flex-1 min-w-36 text-gray-400 text-sm">{t('admin.tournamentDetail.bracketTab.byeSlot')}</span>
          );

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
                    if (pid) handleSlotChange(m, slot, pid);
                  }}
                  disabled={locked}
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
                      if (pid) handleSlotChange(m, slot, pid);
                    }
                  }}
                  disabled={locked || !groupVal}
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
                    {realSide === 'player2' ? byeLabel : makeGroupRankSelector('player1', p1Id, p1Info)}
                    <span className="text-gray-400 font-bold">vs</span>
                    {realSide === 'player1' ? byeLabel : makeGroupRankSelector('player2', p2Id, p2Info)}
                  </>
                ) : (
                  <>
                    {realSide === 'player2' ? byeLabel : <select
                      className="input flex-1 min-w-36"
                      value={p1Id || ''}
                      onChange={e => handleSlotChange(m, 'player1', e.target.value)}
                      disabled={locked}
                      aria-label={t('admin.tournamentDetail.bracketTab.matchNumber', { num: i + 1 }) + ' P1'}
                    >
                      <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                      {advancedList.map(pid => (
                        <option key={pid} value={pid}>{getLabel(pid)}</option>
                      ))}
                    </select>}
                    <span className="text-gray-400 font-bold">vs</span>
                    {realSide === 'player1' ? byeLabel : <select
                      className="input flex-1 min-w-36"
                      value={p2Id || ''}
                      onChange={e => handleSlotChange(m, 'player2', e.target.value)}
                      disabled={locked}
                      aria-label={t('admin.tournamentDetail.bracketTab.matchNumber', { num: i + 1 }) + ' P2'}
                    >
                      <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                      {advancedList.map(pid => (
                        <option key={pid} value={pid}>{getLabel(pid)}</option>
                      ))}
                    </select>}
                  </>
                )}
              </div>
              {/* Show current assignment summary */}
              {(p1Id || p2Id) && (
                <div className="text-xs text-gray-400 ml-16">
                  {sideSummary(p1Id, realSide === 'player2')} vs {sideSummary(p2Id, realSide === 'player1')}
                </div>
              )}
              {locked && (
                <span className="text-xs text-orange-400 ml-16">{t('admin.tournamentDetail.bracketTab.inProgressCannotChange')}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
