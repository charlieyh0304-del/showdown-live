import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createEmptySet } from '@shared/utils/scoring';
import { showWarning, showSuccess } from '@shared/utils/toast';
import { showConfirm } from '@shared/utils/confirm';
import { buildGroupAssignment, calculateMatchCount, countPlayableMatches } from '@shared/utils/tournament';
import { combineWriteResults, notifyWriteOutcome, notifyTournamentWrite, replaceStagesFor, type MatchesBulkOptions, type WriteResult } from '@shared/utils/dataWrites';
import type { Match, MatchUpdate, Team, Player, StageGroup, Tournament } from '@shared/types';
import GroupAssignmentSection from './GroupAssignmentSection';
import FinalsSection from './FinalsSection';
import MatchListSection from './MatchListSection';
import AddMatchForm from './AddMatchForm';

// Firebase can return arrays as objects with numeric keys; ensure we always get an array
function toArray<T>(val: T[] | Record<string, T> | undefined | null): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [];
}

export interface BracketTabProps {
  tournament: Tournament;
  matches: Match[];
  tournamentPlayers: Player[];
  teams: Team[];
  setMatchesBulk: (matches: Omit<Match, 'id'>[], options: MatchesBulkOptions) => Promise<string[] | void>;
  updateMatch: (matchId: string, data: MatchUpdate) => Promise<WriteResult>;
  addMatch: (match: Omit<Match, 'id'>) => Promise<string | null>;
  deleteMatch: (matchId: string) => Promise<void>;
  updateTournament: (data: Record<string, unknown>) => Promise<boolean | void>;
  referees: { id: string; name: string }[];
  courts: { id: string; name: string }[];
  isTeamType: boolean;
}

export default function BracketTab({ tournament, matches, tournamentPlayers, teams, setMatchesBulk, updateMatch, addMatch, deleteMatch, updateTournament, referees, courts, isTeamType }: BracketTabProps) {
  const { t } = useTranslation();
  const isCompleted = tournament.status === 'completed';
  const [generating, setGenerating] = useState(false);
  const [groupAssignment, setGroupAssignment] = useState<StageGroup[]>([]);
  const [groupEditWarning, setGroupEditWarning] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addPlayer1, setAddPlayer1] = useState('');
  const [addPlayer2, setAddPlayer2] = useState('');
  const [addGroupId, setAddGroupId] = useState('');
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [editPlayer1, setEditPlayer1] = useState('');
  const [editPlayer2, setEditPlayer2] = useState('');

  const isManualMode = tournament.formatType === 'manual';

  // 설정 기반 예상 경기 수 계산
  const expectedMatchCount = useMemo(() => {
    const participantCount = isTeamType ? teams.length : tournamentPlayers.length;
    const stages = toArray(tournament.stages);
    const hasGroupStage = stages.some(s => s.type === 'qualifying');
    const hasFinalsStage = stages.some(s => s.type === 'finals');
    const groupCount = tournament.qualifyingConfig?.groupCount || 1;
    const advanceCount = tournament.finalsConfig?.advanceCount || 0;
    const rankingMatch = tournament.rankingMatchConfig || {
      enabled: false, thirdPlace: false, fifthToEighth: false,
      fifthToEighthFormat: 'simple' as const, classificationGroups: false, classificationGroupSize: 4,
    };
    const finalsStartRound = tournament.finalsConfig?.startingRound;
    return calculateMatchCount(participantCount, hasGroupStage, groupCount, hasFinalsStage, advanceCount, rankingMatch, finalsStartRound);
  }, [isTeamType, teams.length, tournamentPlayers.length, tournament.stages, tournament.qualifyingConfig, tournament.finalsConfig, tournament.rankingMatchConfig]);

  // Load saved group assignments from tournament stages
  useEffect(() => {
    const stages = toArray(tournament.stages);
    const qualifying = stages.find(s => s.type === 'qualifying');
    if (qualifying) {
      const savedGroups = toArray(qualifying.groups);
      if (savedGroups.length > 0) {
        setGroupAssignment(savedGroups);
      }
    }
  }, [tournament.stages]);

  const handleMovePlayer = async (playerId: string, fromGroupId: string, toGroupId: string) => {
    if (fromGroupId === toGroupId) return;
    const updatedGroups = groupAssignment.map(g => {
      if (g.id === fromGroupId) {
        return { ...g, playerIds: (g.playerIds || []).filter(pid => pid !== playerId) };
      }
      if (g.id === toGroupId) {
        return { ...g, playerIds: [...g.playerIds, playerId] };
      }
      return g;
    });
    setGroupAssignment(updatedGroups);
    setGroupEditWarning(true);

    const qualifyingStage = toArray(tournament.stages).find(s => s.type === 'qualifying');
    if (qualifyingStage) {
      const updatedStages = toArray(tournament.stages).map(s =>
        s.id === qualifyingStage.id ? { ...s, groups: updatedGroups } : s
      );
      notifyTournamentWrite(await updateTournament({ stages: updatedStages }), t);
    }
  };

  const handleAutoGroupAssignment = async () => {
    const groupCount = tournament.qualifyingConfig?.groupCount || 2;
    const playerIds = tournamentPlayers.map(p => p.id);
    const seedIds = toArray(tournament.seeds).map(s => s.playerId || s.teamId).filter(Boolean) as string[];

    const groups = buildGroupAssignment(playerIds, groupCount, seedIds, isManualMode);
    const qualifyingStage = toArray(tournament.stages).find(s => s.type === 'qualifying');
    if (qualifyingStage) {
      groups.forEach(g => { g.stageId = qualifyingStage.id; });
    }

    setGroupAssignment(groups);
    setGroupEditWarning(false);
    if (qualifyingStage) {
      const updatedStages = toArray(tournament.stages).map(s =>
        s.id === qualifyingStage.id ? { ...s, groups } : s
      );
      notifyTournamentWrite(await updateTournament({ stages: updatedStages }), t);
    }
  };

  const generateBracket = useCallback(async () => {
    // Guard: cannot regenerate while matches are in progress
    const hasActiveMatches = matches.some(m => m.status === 'in_progress');
    if (hasActiveMatches) {
      showWarning(t('admin.tournamentDetail.bracketTab.cannotEditWhileActive'));
      return;
    }

    // Guard: need at least 2 players/teams to generate brackets
    if (isTeamType && teams.length < 2) {
      showWarning(t('admin.tournamentDetail.bracketTab.needMinPlayers', { count: 2 }));
      return;
    }
    if (!isTeamType && tournamentPlayers.length < 2) {
      showWarning(t('admin.tournamentDetail.bracketTab.needMinPlayers', { count: 2 }));
      return;
    }

    setGenerating(true);
    try {
      const newMatches: Omit<Match, 'id'>[] = [];
      const now = Date.now();
      const qualifyingStage = toArray(tournament.stages).find(s => s.type === 'qualifying');
      const hasGroups = groupAssignment.length > 0 && groupAssignment.some(g => (g.playerIds?.length || 0) > 0 || (g.teamIds?.length || 0) > 0);

      // 기존 경기 쌍 수집 (중복 방지)
      const existingMatchPairs = new Set<string>();
      for (const m of matches) {
        const p1 = m.player1Id || m.team1Id || '';
        const p2 = m.player2Id || m.team2Id || '';
        if (p1 && p2) {
          existingMatchPairs.add([p1, p2].sort().join('__'));
        }
      }

      if (hasGroups && !isTeamType) {
        // 조별 라운드로빈: 각 조 내에서 라운드로빈 (기존 대진 제외)
        let round = matches.length + 1;
        let skipped = 0;
        for (const group of groupAssignment) {
          const playerIds = group.playerIds;
          for (let i = 0; i < playerIds.length; i++) {
            for (let j = i + 1; j < playerIds.length; j++) {
              const pairKey = [playerIds[i], playerIds[j]].sort().join('__');
              if (existingMatchPairs.has(pairKey)) { skipped++; continue; }
              const p1 = tournamentPlayers.find(p => p.id === playerIds[i]);
              const p2 = tournamentPlayers.find(p => p.id === playerIds[j]);
              if (!p1 || !p2) continue;
              newMatches.push({
                tournamentId: tournament.id,
                type: 'individual',
                status: 'pending',
                round,
                player1Id: p1.id,
                player2Id: p2.id,
                player1Name: p1.name,
                player2Name: p2.name,
                sets: [createEmptySet()],
                currentSet: 0,
                player1Timeouts: 0,
                player2Timeouts: 0,
                winnerId: null,
                createdAt: now,
                groupId: group.id,
                ...(qualifyingStage ? { stageId: qualifyingStage.id } : {}),
              });
              existingMatchPairs.add(pairKey);
              round++;
            }
          }
        }
        if (skipped > 0) {
          showWarning(t('admin.tournamentDetail.bracketTab.duplicateBlocked', { skipped }));
          setGenerating(false);
          return;
        }
      } else if (!isTeamType) {
        // Individual round-robin (전체 풀리그, 기존 대진 제외)
        const players = [...tournamentPlayers];
        let round = matches.length + 1;
        let skipped = 0;
        for (let i = 0; i < players.length; i++) {
          for (let j = i + 1; j < players.length; j++) {
            const pairKey = [players[i].id, players[j].id].sort().join('__');
            if (existingMatchPairs.has(pairKey)) { skipped++; continue; }
            newMatches.push({
              tournamentId: tournament.id,
              type: 'individual',
              status: 'pending',
              round,
              player1Id: players[i].id,
              player2Id: players[j].id,
              player1Name: players[i].name,
              player2Name: players[j].name,
              sets: [createEmptySet()],
              currentSet: 0,
              player1Timeouts: 0,
              player2Timeouts: 0,
              winnerId: null,
              createdAt: now,
              // 스테이지 규칙(점수·동률·휴식)이 이 경기에 적용되도록 스테이지를 적는다
              ...(qualifyingStage ? { stageId: qualifyingStage.id } : {}),
            });
            existingMatchPairs.add(pairKey);
            round++;
          }
        }
        if (skipped > 0) {
          showWarning(t('admin.tournamentDetail.bracketTab.duplicateBlocked', { skipped }));
          setGenerating(false);
          return;
        }
      } else {
        // Team round-robin (기존 대진 제외)
        let round = matches.length + 1;
        let skipped = 0;
        for (let i = 0; i < teams.length; i++) {
          for (let j = i + 1; j < teams.length; j++) {
            const t1 = teams[i];
            const t2 = teams[j];
            const pairKey = [t1.id, t2.id].sort().join('__');
            if (existingMatchPairs.has(pairKey)) { skipped++; continue; }

            newMatches.push({
              tournamentId: tournament.id,
              type: 'team',
              status: 'pending',
              round,
              team1Id: t1.id,
              team2Id: t2.id,
              team1Name: t1.name,
              team2Name: t2.name,
              team1: t1,
              team2: t2,
              sets: [createEmptySet()],
              currentSet: 0,
              player1Timeouts: 0,
              player2Timeouts: 0,
              winnerId: null,
              createdAt: now,
              // 스테이지 규칙(점수·동률·휴식)이 이 경기에 적용되도록 스테이지를 적는다
              ...(qualifyingStage ? { stageId: qualifyingStage.id } : {}),
            });
            existingMatchPairs.add(pairKey);
            round++;
          }
        }
        if (skipped > 0) {
          showWarning(t('admin.tournamentDetail.bracketTab.duplicateBlocked', { skipped }));
          setGenerating(false);
          return;
        }
      }

      if (newMatches.length === 0) {
        setGenerating(false);
        return;
      }

      // 설정된 최대 경기 수 초과 검증
      // (BYE 경기는 치르지 않으므로 세지 않는다)
      const maxAllowed = expectedMatchCount.total;
      const currentCount = countPlayableMatches(matches);
      const totalAfterCreate = currentCount + newMatches.length;
      if (maxAllowed > 0 && totalAfterCreate > maxAllowed) {
        showWarning(t('admin.tournamentDetail.bracketTab.matchCountExceeded', {
          max: maxAllowed, current: currentCount, newCount: newMatches.length, total: totalAfterCreate,
        }));
        setGenerating(false);
        return;
      }

      // 이번에 생성하는 스테이지(조별 예선 또는 stageId 없는 풀리그)의 pending 경기만 교체.
      // 본선 등 다른 스테이지의 경기는 보존된다.
      await setMatchesBulk(newMatches, { replaceStages: replaceStagesFor(newMatches) });
    } finally {
      setGenerating(false);
    }
  }, [isTeamType, tournamentPlayers, teams, tournament.id, setMatchesBulk, groupAssignment, tournament.stages, matches, t, expectedMatchCount.total]);

  const handleAssign = useCallback(async (matchId: string, field: 'refereeId' | 'courtId' | 'assistantRefereeId', value: string) => {
    // 빈 값(미배정 선택)은 null로 보내 Firebase에서 필드를 삭제한다
    const data: MatchUpdate = { [field]: value || null };
    if (field === 'refereeId') {
      const found = referees.find(r => r.id === value);
      data.refereeName = found?.name ?? null;
    }
    if (field === 'assistantRefereeId') {
      const found = referees.find(r => r.id === value);
      data.assistantRefereeName = found?.name ?? null;
    }
    if (field === 'courtId') {
      const found = courts.find(c => c.id === value);
      data.courtName = found?.name ?? null;
    }
    notifyWriteOutcome(combineWriteResults([await updateMatch(matchId, data)]), t);
  }, [updateMatch, referees, courts, t]);

  const handleBulkAssignReferees = useCallback(async () => {
    const unassigned = matches.filter(m => !m.refereeId && m.status !== 'completed');
    if (unassigned.length === 0 || referees.length === 0) return;

    const updates = unassigned.map((match, i) => {
      const ref = referees[i % referees.length];
      return updateMatch(match.id, { refereeId: ref.id, refereeName: ref.name });
    });
    const results = await Promise.all(updates);
    notifyWriteOutcome(combineWriteResults(results), t, t('admin.tournamentDetail.bracketTab.bulkRefereeAlert', { count: unassigned.length }));
  }, [matches, referees, updateMatch, t]);

  const handleAddMatch = useCallback(async () => {
    if (!addPlayer1 || !addPlayer2 || addPlayer1 === addPlayer2) return;

    // 중복 대진 검증
    const pairKey = [addPlayer1, addPlayer2].sort().join('__');
    const isDuplicate = matches.some(m => {
      const p1 = m.player1Id || m.team1Id || '';
      const p2 = m.player2Id || m.team2Id || '';
      return p1 && p2 && [p1, p2].sort().join('__') === pairKey;
    });
    if (isDuplicate) {
      showWarning(t('admin.tournamentDetail.bracketTab.addMatchDuplicate'));
      return;
    }

    // 경기 수 초과 검증
    // (BYE 경기는 치르지 않으므로 세지 않는다)
    const maxAllowed = expectedMatchCount.total;
    const currentCount = countPlayableMatches(matches);
    if (maxAllowed > 0 && currentCount + 1 > maxAllowed) {
      showWarning(t('admin.tournamentDetail.bracketTab.matchCountExceeded', {
        max: maxAllowed, current: currentCount, newCount: 1, total: currentCount + 1,
      }));
      return;
    }

    const now = Date.now();
    const maxRound = matches.length > 0 ? Math.max(...matches.map(m => m.round ?? 0)) : 0;
    // 수동 추가 경기도 스테이지 규칙을 받도록: 예선(리그) 스테이지, 스테이지가 하나뿐이면 그 스테이지
    const stageList = toArray(tournament.stages);
    const addStageId = (stageList.find(s => s.type === 'qualifying') ?? (stageList.length === 1 ? stageList[0] : undefined))?.id;
    if (isTeamType) {
      const t1 = teams.find(t => t.id === addPlayer1);
      const t2 = teams.find(t => t.id === addPlayer2);
      if (!t1 || !t2) return;
      await addMatch({
        tournamentId: tournament.id,
        type: 'team',
        status: 'pending',
        round: maxRound + 1,
        team1Id: t1.id,
        team2Id: t2.id,
        team1Name: t1.name,
        team2Name: t2.name,
        team1: t1,
        team2: t2,
        sets: [createEmptySet()],
        currentSet: 0,
        player1Timeouts: 0,
        player2Timeouts: 0,
        winnerId: null,
        createdAt: now,
        ...(addGroupId ? { groupId: addGroupId } : {}),
        ...(addStageId ? { stageId: addStageId } : {}),
      });
    } else {
      const p1 = tournamentPlayers.find(p => p.id === addPlayer1);
      const p2 = tournamentPlayers.find(p => p.id === addPlayer2);
      if (!p1 || !p2) return;
      await addMatch({
        tournamentId: tournament.id,
        type: 'individual',
        status: 'pending',
        round: maxRound + 1,
        player1Id: p1.id,
        player2Id: p2.id,
        player1Name: p1.name,
        player2Name: p2.name,
        sets: [createEmptySet()],
        currentSet: 0,
        player1Timeouts: 0,
        player2Timeouts: 0,
        winnerId: null,
        createdAt: now,
        ...(addGroupId ? { groupId: addGroupId } : {}),
        ...(addStageId ? { stageId: addStageId } : {}),
      });
    }
    setAddPlayer1('');
    setAddPlayer2('');
    setAddGroupId('');
    setShowAddForm(false);
  }, [addPlayer1, addPlayer2, addGroupId, isTeamType, teams, tournamentPlayers, matches, tournament.id, tournament.stages, addMatch, expectedMatchCount.total, t]);

  const handleDeleteMatch = useCallback(async (matchId: string) => {
    if (!await showConfirm({ message: t('admin.tournamentDetail.bracketTab.deleteMatchConfirm'), destructive: true })) return;
    await deleteMatch(matchId);
  }, [deleteMatch]);

  const openEditModal = useCallback((match: Match) => {
    setEditingMatchId(match.id);
    if (isTeamType) {
      setEditPlayer1(match.team1Id ?? '');
      setEditPlayer2(match.team2Id ?? '');
    } else {
      setEditPlayer1(match.player1Id ?? '');
      setEditPlayer2(match.player2Id ?? '');
    }
  }, [isTeamType]);

  const handleEditMatch = useCallback(async () => {
    if (!editingMatchId || !editPlayer1 || !editPlayer2 || editPlayer1 === editPlayer2) return;
    let result: WriteResult;
    if (isTeamType) {
      const t1 = teams.find(t => t.id === editPlayer1);
      const t2 = teams.find(t => t.id === editPlayer2);
      if (!t1 || !t2) return;
      // 진출 링크로 채워진 팀전 경기는 player{N}*에도 같은 팀이 들어 있으므로 함께 바꾼다 (남은 옛 팀이 표시/진출되지 않게)
      result = await updateMatch(editingMatchId, {
        team1Id: t1.id,
        team2Id: t2.id,
        team1Name: t1.name,
        team2Name: t2.name,
        team1: t1,
        team2: t2,
        player1Id: t1.id,
        player2Id: t2.id,
        player1Name: t1.name,
        player2Name: t2.name,
      });
    } else {
      const p1 = tournamentPlayers.find(p => p.id === editPlayer1);
      const p2 = tournamentPlayers.find(p => p.id === editPlayer2);
      if (!p1 || !p2) return;
      result = await updateMatch(editingMatchId, {
        player1Id: p1.id,
        player2Id: p2.id,
        player1Name: p1.name,
        player2Name: p2.name,
      });
    }
    // 실패 시 편집 상태를 유지해 다시 저장할 수 있게 한다
    if (notifyWriteOutcome(combineWriteResults([result]), t) !== 'failed') setEditingMatchId(null);
  }, [editingMatchId, editPlayer1, editPlayer2, isTeamType, teams, tournamentPlayers, updateMatch, t]);

  const handleSwapRound = useCallback(async (matchId: string, direction: 'up' | 'down') => {
    const sorted = [...matches].sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
    const idx = sorted.findIndex(m => m.id === matchId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;
    const currentMatch = sorted[idx];
    const targetMatch = sorted[targetIdx];
    const results = await Promise.all([
      updateMatch(currentMatch.id, { round: targetMatch.round }),
      updateMatch(targetMatch.id, { round: currentMatch.round }),
    ]);
    notifyWriteOutcome(combineWriteResults(results), t);
  }, [matches, updateMatch, t]);

  const hasActiveMatches = matches.some(m => m.status === 'in_progress');
  const canGenerate = (isTeamType ? teams.length >= 2 : tournamentPlayers.length >= 2) && !hasActiveMatches;

  // Build player/team options with group info
  const getGroupName = (playerId: string) => {
    for (const g of groupAssignment) {
      if ((g.playerIds || []).includes(playerId) || (g.teamIds || []).includes(playerId)) return g.name;
    }
    return '';
  };
  const selectOptions = isTeamType
    ? teams.map(t => ({ id: t.id, name: t.name, group: '' }))
    : tournamentPlayers.map(p => ({ id: p.id, name: p.name, group: getGroupName(p.id) }));

  // Track existing match pairs to filter out completed pairings
  const existingPairs = useMemo(() => {
    const pairs = new Set<string>();
    for (const m of matches) {
      const p1 = m.player1Id || m.team1Id || '';
      const p2 = m.player2Id || m.team2Id || '';
      if (p1 && p2) {
        pairs.add(`${p1}__${p2}`);
        pairs.add(`${p2}__${p1}`);
      }
    }
    return pairs;
  }, [matches]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-xl font-bold text-center">{t('admin.tournamentDetail.bracketTab.title')}</h2>
        <div className="flex gap-2 flex-wrap">
          {!isManualMode && tournament.status !== 'completed' && (
            <button
              className="btn btn-accent"
              onClick={generateBracket}
              disabled={generating || !canGenerate}
              aria-label={t('admin.tournamentDetail.bracketTab.autoGenerateAriaLabel')}
            >
              {generating ? t('admin.tournamentDetail.bracketTab.generatingText') : (groupAssignment.length > 0 && groupAssignment.some(g => (g.playerIds?.length || 0) > 0 || (g.teamIds?.length || 0) > 0) ? t('admin.tournamentDetail.bracketTab.groupRoundRobinGenerate') : t('admin.tournamentDetail.bracketTab.autoGenerateText'))}
            </button>
          )}
          {tournament.status !== 'completed' && (
            <button
              className="btn btn-success"
              onClick={() => setShowAddForm(v => !v)}
              aria-label={t('admin.tournamentDetail.bracketTab.addMatchAriaLabel')}
            >
              {t('admin.tournamentDetail.bracketTab.addMatchButton')}
            </button>
          )}
          {matches.length > 0 && tournament.status !== 'completed' && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                const msg = tournament.status === 'in_progress' || tournament.status === 'paused'
                  ? t('admin.tournamentDetail.bracketTab.confirmBracketUpdate')
                  : t('admin.tournamentDetail.bracketTab.confirmBracket');
                if (await showConfirm({ message: msg })) {
                  if (tournament.status !== 'in_progress') {
                    if (!notifyTournamentWrite(await updateTournament({ status: 'in_progress' }), t)) return;
                  }
                  showSuccess(t('admin.tournamentDetail.bracketTab.bracketConfirmed'));
                }
              }}
              aria-label={t('admin.tournamentDetail.bracketTab.confirmBracketAriaLabel')}
            >
              {t('admin.tournamentDetail.bracketTab.confirmBracketButton')}
            </button>
          )}
        </div>
      </div>

      {/* 경기 추가 폼 */}
      {showAddForm && (
        <AddMatchForm
          isTeamType={isTeamType}
          groupAssignment={groupAssignment}
          selectOptions={selectOptions}
          existingPairs={existingPairs}
          addPlayer1={addPlayer1}
          addPlayer2={addPlayer2}
          addGroupId={addGroupId}
          setAddPlayer1={setAddPlayer1}
          setAddPlayer2={setAddPlayer2}
          setAddGroupId={setAddGroupId}
          handleAddMatch={handleAddMatch}
        />
      )}

      {/* 조 편성 (조별 예선이 있을 때, 완료 시 숨김) */}
      {!isCompleted && tournament.qualifyingConfig?.groupCount && tournament.qualifyingConfig.groupCount > 1 && tournamentPlayers.length > 0 && (
        <GroupAssignmentSection
          tournament={tournament}
          tournamentPlayers={tournamentPlayers}
          teams={teams}
          isTeamType={isTeamType}
          isManualMode={isManualMode}
          groupAssignment={groupAssignment}
          groupEditWarning={groupEditWarning}
          setGroupAssignment={setGroupAssignment}
          setGroupEditWarning={setGroupEditWarning}
          handleAutoGroupAssignment={handleAutoGroupAssignment}
          handleMovePlayer={handleMovePlayer}
          updateTournament={updateTournament}
        />
      )}

      {!canGenerate && (
        <p className="text-gray-400">
          {isTeamType ? t('admin.tournamentDetail.bracketTab.needMoreTeams') : t('admin.tournamentDetail.bracketTab.needMorePlayers')}
        </p>
      )}

      {matches.length > 0 && referees.length > 0 && tournament.status !== 'completed' && (
        <div className="card p-4 space-y-3">
          <h3 className="font-bold">{t('admin.tournamentDetail.bracketTab.bulkRefereeTitle')}</h3>
          <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.bracketTab.bulkRefereeDescription')}</p>
          <div className="flex gap-2 flex-wrap">
            <button
              className="btn btn-primary"
              onClick={handleBulkAssignReferees}
              aria-label={t('admin.tournamentDetail.bracketTab.bulkRefereeAutoAssignAriaLabel')}
            >
              {t('admin.tournamentDetail.bracketTab.bulkRefereeAutoAssign')}
            </button>
          </div>
        </div>
      )}

      {/* 본선 대진 (생성 + 편성) */}
      <FinalsSection
        tournament={tournament}
        matches={matches}
        tournamentPlayers={tournamentPlayers}
        teams={teams}
        isTeamType={isTeamType}
        isManualMode={isManualMode}
        expectedMatchCount={expectedMatchCount}
        setMatchesBulk={setMatchesBulk}
        updateMatch={updateMatch}
        updateTournament={updateTournament}
      />

      {/* 경기 목록 + 수정 모달 */}
      <MatchListSection
        matches={matches}
        referees={referees}
        courts={courts}
        isTeamType={isTeamType}
        isCompleted={isCompleted}
        isManualMode={isManualMode}
        selectOptions={selectOptions}
        handleSwapRound={handleSwapRound}
        handleAssign={handleAssign}
        handleDeleteMatch={handleDeleteMatch}
        openEditModal={openEditModal}
        editingMatchId={editingMatchId}
        setEditingMatchId={setEditingMatchId}
        editPlayer1={editPlayer1}
        editPlayer2={editPlayer2}
        setEditPlayer1={setEditPlayer1}
        setEditPlayer2={setEditPlayer2}
        handleEditMatch={handleEditMatch}
      />
    </div>
  );
}
