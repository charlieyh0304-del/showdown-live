import { useTranslation } from 'react-i18next';
import { createEmptySet } from '@shared/utils/scoring';
import { showWarning } from '@shared/utils/toast';
import { combineWriteResults, notifyWriteOutcome, replaceStagesFor, type MatchesBulkOptions, type WriteResult } from '@shared/utils/dataWrites';
import { buildFirstRoundSlots, buildSingleEliminationSkeleton, fifthToEighthMatchCount, nextPowerOfTwo, type FirstRoundSlot } from '@shared/utils/bracketSkeleton';
import { byeSetsFactory, computeFinalsSeeding } from '@shared/utils/competition';
import { resolveCompetitionRules } from '@shared/rules/competitionRules';
import { marksFromQualification, splitQualificationTies } from '@shared/utils/ranking';
import { isByeMatch } from '@shared/rules/walkover';
import { findDuplicateSlot } from '@shared/rules/seeding';
import TieDecisionPanel from './TieDecisionPanel';
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

/** BYE 경기에서 실제 선수가 들어가는 쪽 (서버 생성 BYE는 'BYE' ID의 반대쪽, 클라이언트 생성은 항상 1번) */
function byeRealSide(m: Match): 'player1' | 'player2' {
  return (m.player1Id || m.team1Id) === 'BYE' ? 'player2' : 'player1';
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
  updateTournament: (data: Record<string, unknown>) => Promise<boolean | void>;
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
  updateTournament,
}: FinalsSectionProps) {
  const { t } = useTranslation();

  if (tournament.status === 'completed') return null;
  if (tournament.type === 'randomTeamLeague') return null;

  const finalsStage = toArray(tournament.stages).find(s => s.type === 'finals');
  if (!finalsStage) return null;

  const finalsMatches = matches.filter(m => m.stageId === finalsStage.id || (m.stageId && m.stageId.includes('finals')));

  // Shared data
  const qualifyingStage = toArray(tournament.stages).find(s => s.type === 'qualifying');
  const qualifyingGroups = qualifyingStage ? toArray(qualifyingStage.groups) : [];
  const qualifyingMatches = matches.filter(m => m.groupId);
  const groupIdToName = new Map<string, string>();
  qualifyingGroups.forEach(g => { groupIdToName.set(g.id, g.name); });

  const idToName = new Map<string, string>();
  tournamentPlayers.forEach(p => idToName.set(p.id, p.name));
  teams.forEach(t => idToName.set(t.id, t.name));

  // 진출 인원·동률·시드는 대회 규칙 단일 설정원(shared/rules)에서 읽는다
  const firstRound = finalsMatches.filter(m => !hasSourceLinks(m) && m.stageId === finalsStage.id);
  const seeding = computeFinalsSeeding(tournament, qualifyingMatches, qualifyingStage?.id, finalsStage.id, { size: firstRound.length * 2 || undefined });
  const qualRules = resolveCompetitionRules(tournament, qualifyingStage?.id).qualification;
  const advancePerGroup = qualRules.perGroup;
  // 본선 진출 인원 = 조당 인원 × 조 수 + 와일드카드 (본선 생성기와 같은 규칙). 조 수는 실제 조 편성/예선 경기에서 센다.
  const groupCount = qualifyingGroups.length || new Set(qualifyingMatches.map(m => m.groupId)).size || tournament.qualifyingConfig?.groupCount || 1;
  const totalAdvance = advancePerGroup * groupCount + qualRules.wildcards;
  // 진출 표시: selectQualifiers 결과(와일드카드 포함). 관전 순위표와 같은 표시 규칙(marksFromQualification):
  // 경계 동률이 걸린 선수는 진출로 표시하지 않고, 그 조 경기가 다 끝난 뒤에만 '동률 결정 필요'로 표시한다.
  const marks = marksFromQualification(seeding.qualification, qualifyingMatches);
  const tiedIds = new Set([...marks].filter(([, m]) => m === 'tie').map(([id]) => id));
  const qualifierIds = new Set([...marks].filter(([, m]) => m !== 'tie').map(([id]) => id));
  // 조별 순위 (규칙의 동률 기준 반영): 선수 ID → 조/순위
  const groupRankings = new Map<string, { groupId: string; groupName: string; rank: number }>();
  seeding.qualification.groups.forEach(g => {
    g.ranking.ranked.forEach(r => {
      groupRankings.set(r.row.id, { groupId: g.groupId, groupName: groupIdToName.get(g.groupId) || g.groupId, rank: r.rank });
    });
  });
  // 동률 결정 화면에는 확정된 동률(그 범위 경기가 다 끝남)만 보인다. 본선 생성 가드는 전체 blockingTies를 쓴다.
  const blockingTies = splitQualificationTies(seeding.qualification, qualifyingMatches).settled;
  const matchType = isTeamType ? 'team' as const : 'individual' as const;
  const byeSets = byeSetsFactory(tournament, finalsStage.id, matchType);

  // 3/4위전 사용 여부: 대회 규칙(finalRanking.thirdPlace, 레거시 rankingMatchConfig.thirdPlace 포함)
  const finalRankingRules = resolveCompetitionRules(tournament, finalsStage.id).finalRanking;
  const includeThirdPlace = finalRankingRules.thirdPlace === 'match';
  // 5~8위 결정전 방식 (서버 generate_finals와 같은 규칙: finalRanking.fifthToEighthMatches)
  const fifthToEighth = finalRankingRules.fifthToEighthMatches;

  // --- Finals Creation (no finals matches yet) ---
  if (finalsMatches.length === 0) {
    const hasQualifyingMatches = qualifyingMatches.length > 0;
    // 전체 싱글 엘리미네이션 골격: 대진 크기 = 진출 인원 이상인 최소 2의 거듭제곱
    const entrantCount = Math.max(2, totalAdvance);
    const bracketSize = nextPowerOfTwo(entrantCount);
    const hasThirdPlaceMatch = includeThirdPlace && bracketSize >= 4;
    const placementCount = fifthToEighthMatchCount(fifthToEighth, bracketSize);
    // 실제로 치르는 본선 경기 수 (BYE 제외): N-1 (+3/4위전, +5~8위 결정전)
    const matchCount = entrantCount - 1 + (hasThirdPlaceMatch ? 1 : 0) + placementCount;
    // 생성되는 슬롯 수 (BYE 경기 포함)
    const slotCount = bracketSize - 1 + (hasThirdPlaceMatch ? 1 : 0) + placementCount;

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

            <TieDecisionPanel
              ties={blockingTies}
              nameOf={id => idToName.get(id) || id}
              groupLabel={scope => groupIdToName.get(scope) || scope || t('common.competitionRules.tie.league')}
              updateTournament={updateTournament}
            />

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
                          <div key={pid} className={`text-xs flex gap-1 ${qualifierIds.has(pid) ? 'text-green-400' : 'text-gray-400'}`}>
                            <span className="w-6">{info.rank}{t('admin.tournamentDetail.bracketTab.rankSuffix')}</span>
                            <span>{idToName.get(pid) || pid}</span>
                            {qualifierIds.has(pid) && <span className="text-green-500 ml-auto">{t('admin.tournamentDetail.bracketTab.advanceLabel')}</span>}
                            {tiedIds.has(pid) && <span className="text-yellow-400 ml-auto">{t('common.competitionRules.qualifierTie')}</span>}
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
                // 예선이 끝났고 진출자가 확정됐으면 1라운드를 표준 시드 + 조 교차로 바로 채운다.
                // 아니면 빈 슬롯(이후 수동 편성/시드 배치). 2라운드~결승과 3/4위전은 진출 링크로 연결
                const q = seeding.qualification;
                const ready = q.complete && q.blockingTies.length === 0 && q.qualifiers.length >= 2;
                const slots: FirstRoundSlot[] = ready
                  ? computeFinalsSeeding(tournament, qualifyingMatches, qualifyingStage?.id, finalsStage.id).slots
                    .map(e => (e ? { id: e.id, name: idToName.get(e.id) || e.name || e.id } : null))
                  : buildFirstRoundSlots(entrantCount);
                const entries = buildSingleEliminationSkeleton({
                  tournamentId: tournament.id,
                  stageId: finalsStage.id,
                  matchType,
                  slots,
                  byeSets,
                  thirdPlace: includeThirdPlace,
                  fifthToEighth,
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
  // 배정 후보: 규칙으로 정한 진출자 + 이미 1라운드에 들어간 선수 (빈 골격에서도 선택지가 보이도록)
  const advancedIds = new Set<string>(seeding.qualification.qualifiers.map(q => q.id));
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
    isBye: true,
    bye: null,
    walkover: newId ? true : null,
    walkoverReason: newId ? 'bye' : null,
    // 부전승 = 대회 규칙의 부전승 점수(기본 11:0 × 이겨야 하는 세트 수)
    sets: newId ? byeSets(byeRealSide(m) === 'player1' ? 1 : 2, newId) : [createEmptySet()],
  });

  /** 1라운드 한 경기를 시드 배치 결과로 바꾸는 데이터 (BYE 여부도 다시 정한다) */
  const seededMatchData = (a: { id: string } | null, b: { id: string } | null): MatchUpdate => {
    const name = (id: string) => idToName.get(id) || id;
    const side = (n: 1 | 2, id: string, label: string): MatchUpdate => {
      const player: MatchUpdate = n === 1 ? { player1Id: id, player1Name: label } : { player2Id: id, player2Name: label };
      if (!isTeamType) return player;
      return { ...player, ...(n === 1 ? { team1Id: id, team1Name: label } : { team2Id: id, team2Name: label }) };
    };
    const byeLabel = t('admin.tournamentDetail.bracketTab.byeSlot');
    const base: MatchUpdate = {
      ...(a ? side(1, a.id, name(a.id)) : side(1, '', byeLabel)),
      ...(b ? side(2, b.id, name(b.id)) : side(2, '', byeLabel)),
    };
    if (a && b) {
      return { ...base, status: 'pending', winnerId: null, isBye: null, bye: null, walkover: null, walkoverReason: null, sets: [createEmptySet()] };
    }
    const real = a || b;
    return {
      ...base,
      status: 'completed',
      winnerId: real ? real.id : null,
      isBye: true,
      bye: null,
      walkover: real ? true : null,
      walkoverReason: real ? 'bye' : null,
      sets: real ? byeSets(a ? 1 : 2, real.id) : [],
    };
  };

  /** 예선 순위로 표준 시드 + 조 교차 배치를 1라운드 전체에 적용한다 (같은 선수 중복·자기 자신 대전 없음) */
  const applySeededArrangement = async () => {
    const q = seeding.qualification;
    if (q.blockingTies.length > 0) { showWarning(t('common.competitionRules.finals.tieBlocking')); return; }
    if (q.qualifiers.length < 2) { showWarning(t('common.competitionRules.finals.noQualifiers')); return; }
    const sorted = [...firstRound].sort((a, b) => (a.bracketPosition ?? 0) - (b.bracketPosition ?? 0) || a.createdAt - b.createdAt);
    if (seeding.size > sorted.length * 2) {
      showWarning(t('common.competitionRules.finals.noQualifiers'));
      return;
    }
    // 시드 배치는 1라운드 전체를 처음부터 다시 정한다. 이미 시작/완료된 실제 경기가 있으면 그 선수가
    // 다른 경기에 또 배치될 수 있으므로(같은 선수 중복) 전체 적용을 거절한다.
    if (sorted.some(m => m.status !== 'pending' && !isByeMatch(m))) {
      showWarning(t('common.competitionRules.finals.seededArrangementStarted'));
      return;
    }
    if (findDuplicateSlot(seeding.slots)) { showWarning(t('common.competitionRules.finals.duplicateSlot')); return; }
    const results: WriteResult[] = [];
    for (let k = 0; k < sorted.length; k++) {
      results.push(await updateMatch(sorted[k].id, seededMatchData(seeding.slots[2 * k] ?? null, seeding.slots[2 * k + 1] ?? null)));
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

      <TieDecisionPanel
        ties={blockingTies}
        nameOf={id => idToName.get(id) || id}
        groupLabel={scope => groupIdToName.get(scope) || scope || t('common.competitionRules.tie.league')}
        updateTournament={updateTournament}
      />

      {/* 시드 배치 (자동 모드만): 예선 순위 → 표준 시드 위치 + 조 교차(같은 조 1라운드 회피). 진출자가 정해져야 동작한다 */}
      {!isManualMode && (
        <div className="flex gap-2 flex-wrap items-center">
          <button
            className="btn btn-primary"
            onClick={applySeededArrangement}
            disabled={seeding.qualification.qualifiers.length < 2 || seeding.qualification.blockingTies.length > 0}
            aria-label={t('common.competitionRules.finals.seededArrangementAria')}
          >
            {t('common.competitionRules.finals.seededArrangement')}
          </button>
          {seeding.qualification.qualifiers.length < 2 && (
            <p className="text-gray-400 text-sm">{t('common.competitionRules.finals.noQualifiers')}</p>
          )}
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
