import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createEmptySet } from '@shared/utils/scoring';
import { buildGroupAssignment, calculateMatchCount } from '@shared/utils/tournament';
import type { Match, Team, Player, MatchStatus, StageGroup, Tournament } from '@shared/types';

// Firebase can return arrays as objects with numeric keys; ensure we always get an array
function toArray<T>(val: T[] | Record<string, T> | undefined | null): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [];
}

const STATUS_LABEL_KEYS: Record<MatchStatus, string> = {
  pending: 'common.matchStatus.pending',
  in_progress: 'common.matchStatus.inProgress',
  completed: 'common.matchStatus.completed',
};

const STATUS_ICONS: Record<MatchStatus, string> = {
  pending: '\u23F3',
  in_progress: '\u25B6',
  completed: '\u2713',
};

const STATUS_COLORS: Record<MatchStatus, string> = {
  pending: 'bg-gray-600 text-white',
  in_progress: 'bg-orange-500 text-black',
  completed: 'bg-green-600 text-white',
};

export interface BracketTabProps {
  tournament: Tournament;
  matches: Match[];
  tournamentPlayers: Player[];
  teams: Team[];
  setMatchesBulk: (matches: Omit<Match, 'id'>[]) => Promise<string[] | void>;
  updateMatch: (matchId: string, data: Partial<Match>) => Promise<boolean | void>;
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
      await updateTournament({ stages: updatedStages });
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
      await updateTournament({ stages: updatedStages });
    }
  };

  const generateBracket = useCallback(async () => {
    // Guard: cannot regenerate while matches are in progress
    const hasActiveMatches = matches.some(m => m.status === 'in_progress');
    if (hasActiveMatches) {
      alert(t('admin.tournamentDetail.bracketTab.cannotEditWhileActive'));
      return;
    }

    // Guard: need at least 2 players/teams to generate brackets
    if (isTeamType && teams.length < 2) {
      alert(t('admin.tournamentDetail.bracketTab.needMinPlayers', { count: 2 }));
      return;
    }
    if (!isTeamType && tournamentPlayers.length < 2) {
      alert(t('admin.tournamentDetail.bracketTab.needMinPlayers', { count: 2 }));
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
          alert(t('admin.tournamentDetail.bracketTab.duplicateBlocked', { skipped, defaultValue: `중복된 대진이 ${skipped}건 발견되었습니다. 대진 생성이 취소되었습니다.` }));
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
            });
            existingMatchPairs.add(pairKey);
            round++;
          }
        }
        if (skipped > 0) {
          alert(t('admin.tournamentDetail.bracketTab.duplicateBlocked', { skipped, defaultValue: `중복된 대진이 ${skipped}건 발견되었습니다. 대진 생성이 취소되었습니다.` }));
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
            });
            existingMatchPairs.add(pairKey);
            round++;
          }
        }
        if (skipped > 0) {
          alert(t('admin.tournamentDetail.bracketTab.duplicateBlocked', { skipped, defaultValue: `중복된 대진이 ${skipped}건 발견되었습니다. 대진 생성이 취소되었습니다.` }));
          setGenerating(false);
          return;
        }
      }

      if (newMatches.length === 0) {
        setGenerating(false);
        return;
      }

      // 설정된 최대 경기 수 초과 검증
      const maxAllowed = expectedMatchCount.total;
      const totalAfterCreate = matches.length + newMatches.length;
      if (maxAllowed > 0 && totalAfterCreate > maxAllowed) {
        alert(t('admin.tournamentDetail.bracketTab.matchCountExceeded', {
          max: maxAllowed, current: matches.length, newCount: newMatches.length, total: totalAfterCreate,
          defaultValue: `설정된 최대 경기 수(${maxAllowed}경기)를 초과합니다.\n현재 ${matches.length}경기 + 새로 ${newMatches.length}경기 = ${totalAfterCreate}경기\n대진 생성이 취소되었습니다.`,
        }));
        setGenerating(false);
        return;
      }

      await setMatchesBulk(newMatches);
    } finally {
      setGenerating(false);
    }
  }, [isTeamType, tournamentPlayers, teams, tournament.id, setMatchesBulk, groupAssignment, tournament.stages, matches, t, expectedMatchCount.total]);

  const handleAssign = useCallback(async (matchId: string, field: 'refereeId' | 'courtId' | 'assistantRefereeId', value: string) => {
    const data: Partial<Match> = { [field]: value || undefined };
    if (field === 'refereeId') {
      const found = referees.find(r => r.id === value);
      data.refereeName = found?.name ?? undefined;
    }
    if (field === 'assistantRefereeId') {
      const found = referees.find(r => r.id === value);
      data.assistantRefereeName = found?.name ?? undefined;
    }
    if (field === 'courtId') {
      const found = courts.find(c => c.id === value);
      data.courtName = found?.name ?? undefined;
    }
    await updateMatch(matchId, data);
  }, [updateMatch, referees, courts]);

  const handleBulkAssignReferees = useCallback(async () => {
    const unassigned = matches.filter(m => !m.refereeId && m.status !== 'completed');
    if (unassigned.length === 0 || referees.length === 0) return;

    const updates = unassigned.map((match, i) => {
      const ref = referees[i % referees.length];
      return updateMatch(match.id, { refereeId: ref.id, refereeName: ref.name });
    });
    await Promise.all(updates);
    alert(t('admin.tournamentDetail.bracketTab.bulkRefereeAlert', { count: unassigned.length }));
  }, [matches, referees, updateMatch]);

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
      alert(t('admin.tournamentDetail.bracketTab.addMatchDuplicate', { defaultValue: '이미 동일한 대진이 존재합니다. 경기를 추가할 수 없습니다.' }));
      return;
    }

    // 경기 수 초과 검증
    const maxAllowed = expectedMatchCount.total;
    if (maxAllowed > 0 && matches.length + 1 > maxAllowed) {
      alert(t('admin.tournamentDetail.bracketTab.matchCountExceeded', {
        max: maxAllowed, current: matches.length, newCount: 1, total: matches.length + 1,
        defaultValue: `설정된 최대 경기 수(${maxAllowed}경기)를 초과합니다.\n현재 ${matches.length}경기 + 새로 1경기 = ${matches.length + 1}경기\n경기를 추가할 수 없습니다.`,
      }));
      return;
    }

    const now = Date.now();
    const maxRound = matches.length > 0 ? Math.max(...matches.map(m => m.round ?? 0)) : 0;
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
      });
    }
    setAddPlayer1('');
    setAddPlayer2('');
    setAddGroupId('');
    setShowAddForm(false);
  }, [addPlayer1, addPlayer2, addGroupId, isTeamType, teams, tournamentPlayers, matches, tournament.id, addMatch, expectedMatchCount.total, t]);

  const handleDeleteMatch = useCallback(async (matchId: string) => {
    if (!confirm(t('admin.tournamentDetail.bracketTab.deleteMatchConfirm'))) return;
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
    if (isTeamType) {
      const t1 = teams.find(t => t.id === editPlayer1);
      const t2 = teams.find(t => t.id === editPlayer2);
      if (!t1 || !t2) return;
      await updateMatch(editingMatchId, {
        team1Id: t1.id,
        team2Id: t2.id,
        team1Name: t1.name,
        team2Name: t2.name,
        team1: t1,
        team2: t2,
      });
    } else {
      const p1 = tournamentPlayers.find(p => p.id === editPlayer1);
      const p2 = tournamentPlayers.find(p => p.id === editPlayer2);
      if (!p1 || !p2) return;
      await updateMatch(editingMatchId, {
        player1Id: p1.id,
        player2Id: p2.id,
        player1Name: p1.name,
        player2Name: p2.name,
      });
    }
    setEditingMatchId(null);
  }, [editingMatchId, editPlayer1, editPlayer2, isTeamType, teams, tournamentPlayers, updateMatch]);

  const handleSwapRound = useCallback(async (matchId: string, direction: 'up' | 'down') => {
    const sorted = [...matches].sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
    const idx = sorted.findIndex(m => m.id === matchId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;
    const currentMatch = sorted[idx];
    const targetMatch = sorted[targetIdx];
    await Promise.all([
      updateMatch(currentMatch.id, { round: targetMatch.round }),
      updateMatch(targetMatch.id, { round: currentMatch.round }),
    ]);
  }, [matches, updateMatch]);

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
                  ? t('admin.tournamentDetail.bracketTab.confirmBracketUpdate', '대진표 변경사항을 확정하시겠습니까?')
                  : t('admin.tournamentDetail.bracketTab.confirmBracket', '대진표를 확정하고 대회를 시작하시겠습니까?');
                if (confirm(msg)) {
                  if (tournament.status !== 'in_progress') {
                    await updateTournament({ status: 'in_progress' });
                  }
                  alert(t('admin.tournamentDetail.bracketTab.bracketConfirmed', '대진표가 확정되었습니다.'));
                }
              }}
              aria-label={t('admin.tournamentDetail.bracketTab.confirmBracketAriaLabel', '대진표 확정')}
            >
              {t('admin.tournamentDetail.bracketTab.confirmBracketButton', '대진표 확정')}
            </button>
          )}
        </div>
      </div>

      {/* 경기 추가 폼 */}
      {showAddForm && (() => {
        const hasGroups = groupAssignment.length > 0 && groupAssignment.some(g => (g.playerIds?.length || 0) > 0 || (g.teamIds?.length || 0) > 0);
        const selectedP1Group = addPlayer1 ? getGroupName(addPlayer1) : '';
        const selectedGroupId = addGroupId || groupAssignment.find(g => g.name === selectedP1Group)?.id || '';

        // 선수1: 조 필터 적용
        const p1Options = hasGroups && addGroupId
          ? selectOptions.filter(o => o.group === groupAssignment.find(g => g.id === addGroupId)?.name)
          : selectOptions;

        // 선수2: 같은 조 + 미매칭 선수만
        const p2Options = selectOptions.filter(o => {
          if (o.id === addPlayer1) return false;
          if (existingPairs.has(`${addPlayer1}__${o.id}`)) return false;
          if (hasGroups && selectedP1Group && o.group !== selectedP1Group) return false;
          return true;
        });

        return (
          <div className="card space-y-3 border-green-600">
            <h3 className="font-bold text-green-400">{t('admin.tournamentDetail.bracketTab.addMatchTitle')}</h3>
            <div className="flex gap-3 flex-wrap items-end">
              {/* 조 선택 (조가 있을 때만) */}
              {hasGroups && (
                <div className="min-w-32">
                  <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.bracketTab.groupSelectPlaceholder', '조 선택')}</label>
                  <select className="input w-full" value={addGroupId} onChange={e => { setAddGroupId(e.target.value); setAddPlayer1(''); setAddPlayer2(''); }} aria-label={t('admin.tournamentDetail.bracketTab.groupSelectPlaceholder', '조 선택')}>
                    <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                    {groupAssignment.map(g => (
                      <option key={g.id} value={g.id}>{g.name} ({(g.playerIds?.length || 0) + (g.teamIds?.length || 0)})</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex-1 min-w-40">
                <label className="block text-sm text-gray-300 mb-1">{isTeamType ? t('admin.tournamentDetail.bracketTab.team1Label') : t('admin.tournamentDetail.bracketTab.player1Label')}</label>
                <select className="input w-full" value={addPlayer1} onChange={e => { setAddPlayer1(e.target.value); setAddPlayer2(''); if (hasGroups && !addGroupId) { const g = groupAssignment.find(g2 => (g2.playerIds || []).includes(e.target.value) || (g2.teamIds || []).includes(e.target.value)); if (g) setAddGroupId(g.id); } }} aria-label={isTeamType ? t('admin.tournamentDetail.bracketTab.team1SelectAriaLabel') : t('admin.tournamentDetail.bracketTab.player1SelectAriaLabel')}>
                  <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                  {p1Options.map(o => (
                    <option key={o.id} value={o.id}>{o.group ? `[${o.group}] ${o.name}` : o.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-40">
                <label className="block text-sm text-gray-300 mb-1">{isTeamType ? t('admin.tournamentDetail.bracketTab.team2Label') : t('admin.tournamentDetail.bracketTab.player2Label')}</label>
                <select className="input w-full" value={addPlayer2} onChange={e => setAddPlayer2(e.target.value)} aria-label={isTeamType ? t('admin.tournamentDetail.bracketTab.team2SelectAriaLabel') : t('admin.tournamentDetail.bracketTab.player2SelectAriaLabel')}>
                  <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                  {p2Options.map(o => (
                    <option key={o.id} value={o.id}>{o.group ? `[${o.group}] ${o.name}` : o.name}</option>
                  ))}
                </select>
              </div>
              {/* 조 없을 때만 수동 그룹ID 입력 */}
              {!hasGroups && (
                <div className="min-w-32">
                  <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.bracketTab.groupIdLabel')}</label>
                  <input className="input w-full" value={addGroupId} onChange={e => setAddGroupId(e.target.value)} placeholder={t('admin.tournamentDetail.bracketTab.groupIdPlaceholder')} aria-label={t('admin.tournamentDetail.bracketTab.groupIdAriaLabel')} />
                </div>
              )}
              <button
                className="btn btn-success"
                onClick={() => { handleAddMatch(); if (hasGroups && selectedGroupId) setAddGroupId(selectedGroupId); }}
                disabled={!addPlayer1 || !addPlayer2 || addPlayer1 === addPlayer2}
                aria-label={t('admin.tournamentDetail.bracketTab.addAriaLabel')}
              >
                {t('admin.tournamentDetail.bracketTab.addButton')}
              </button>
            </div>
            {addPlayer1 && addPlayer2 && addPlayer1 === addPlayer2 && (
              <p className="text-red-400 text-sm">{t('admin.tournamentDetail.bracketTab.samePlayerError')}</p>
            )}
            {addPlayer1 && p2Options.length === 0 && (
              <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.bracketTab.allDuplicate', '모든 대진이 이미 생성되어 있습니다.')}</p>
            )}
          </div>
        );
      })()}

      {/* 조 편성 (조별 예선이 있을 때, 완료 시 숨김) */}
      {!isCompleted && tournament.qualifyingConfig?.groupCount && tournament.qualifyingConfig.groupCount > 1 && tournamentPlayers.length > 0 && (
        <div className="card space-y-4 mb-4">
          <h3 className="text-lg font-bold text-yellow-400">{t('admin.tournamentDetail.bracketTab.groupAssignmentTitle')}</h3>
          {isManualMode ? (
            <div className="space-y-2">
              <button className="btn btn-primary w-full" onClick={handleAutoGroupAssignment} aria-label={t('admin.tournamentDetail.bracketTab.seedPlacementAriaLabel')}>
                {t('admin.tournamentDetail.bracketTab.seedPlacement')}
              </button>
              <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.bracketTab.seedPlacementHint')}</p>
            </div>
          ) : (
            <button className="btn btn-success w-full" onClick={handleAutoGroupAssignment} aria-label={t('admin.tournamentDetail.bracketTab.autoAssignmentAriaLabel')}>
              {t('admin.tournamentDetail.bracketTab.autoAssignment')}
            </button>
          )}

          {/* 편성 결과 표시 */}
          {groupAssignment.length > 0 && (() => {
            const sizes = groupAssignment.map(g => (g.playerIds?.length || 0) + (g.teamIds?.length || 0));
            const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
            const isUnbalanced = sizes.some(s => Math.abs(s - avgSize) > 1);
            const assignedIds = new Set(groupAssignment.flatMap(g => g.playerIds));
            const unassignedPlayers = tournamentPlayers.filter(p => !assignedIds.has(p.id));
            return (
              <>
                {/* Group size summary */}
                <div className={`text-sm px-3 py-2 rounded ${isUnbalanced ? 'bg-yellow-900/50 border border-yellow-600 text-yellow-300' : 'bg-gray-700 text-gray-300'}`}>
                  {groupAssignment.map((g, i) => (
                    <span key={g.id}>
                      {i > 0 && ' | '}
                      <span className={sizes[i] !== Math.round(avgSize) && isUnbalanced ? 'text-yellow-400 font-bold' : ''}>
                        {g.name} ({t('admin.tournamentDetail.bracketTab.personCount', { count: sizes[i] })})
                      </span>
                    </span>
                  ))}
                  {isUnbalanced && <span className="ml-2 text-yellow-400">{t('admin.tournamentDetail.bracketTab.unbalancedWarning')}</span>}
                </div>

                {/* 미배정 선수 */}
                {unassignedPlayers.length > 0 && (
                  <div className="bg-red-900/30 border border-red-600 rounded p-3">
                    <h4 className="text-sm font-bold text-red-400 mb-2">{t('admin.tournamentDetail.bracketTab.unassignedTitle', { count: unassignedPlayers.length })}</h4>
                    <div className="space-y-1">
                      {unassignedPlayers.map(player => {
                        const seedIdx = toArray(tournament.seeds).findIndex(s => s.playerId === player.id);
                        return (
                          <div key={player.id} className="flex items-center gap-2 text-sm">
                            {seedIdx >= 0 && <span className="text-yellow-400 text-xs font-bold">{String.fromCharCode(65 + seedIdx)}</span>}
                            <span className="flex-1 text-gray-300">{player.name}</span>
                            <select
                              className="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600"
                              value=""
                              onChange={async (e) => {
                                const targetGroupId = e.target.value;
                                if (!targetGroupId) return;
                                const updatedGroups = groupAssignment.map(g =>
                                  g.id === targetGroupId ? { ...g, playerIds: [...g.playerIds, player.id] } : g
                                );
                                setGroupAssignment(updatedGroups);
                                setGroupEditWarning(true);
                                const qualifyingStage = toArray(tournament.stages).find(s => s.type === 'qualifying');
                                if (qualifyingStage) {
                                  const updatedStages = toArray(tournament.stages).map(s =>
                                    s.id === qualifyingStage.id ? { ...s, groups: updatedGroups } : s
                                  );
                                  await updateTournament({ stages: updatedStages });
                                }
                              }}
                              aria-label={t('admin.tournamentDetail.bracketTab.assignGroupAriaLabel', { name: player.name })}
                            >
                              <option value="">{t('admin.tournamentDetail.bracketTab.selectGroupPlaceholder')}</option>
                              {groupAssignment.map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Warning after manual edit */}
                {groupEditWarning && (
                  <div className="text-sm px-3 py-2 rounded bg-orange-900/50 border border-orange-600 text-orange-300">
                    {t('admin.tournamentDetail.bracketTab.groupEditWarning')}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {groupAssignment.map(group => (
                    <div key={group.id} className="bg-gray-800 rounded p-3">
                      <h4 className="text-lg font-bold text-cyan-400 mb-2">{group.name} ({t('admin.tournamentDetail.bracketTab.personCount', { count: (group.playerIds?.length || 0) + (group.teamIds?.length || 0) })})</h4>
                      <ul className="space-y-1">
                        {(isTeamType ? (group.teamIds || []) : (group.playerIds || [])).map((pid) => {
                          const teamData = isTeamType ? teams.find(t => t.id === pid) : undefined;
                          const player = !isTeamType ? tournamentPlayers.find(p => p.id === pid) : undefined;
                          const displayName = isTeamType ? (teamData?.name || pid) : (player?.name || pid);
                          const seedIdx2 = toArray(tournament.seeds).findIndex(s => s.playerId === pid);
                          return (
                            <li key={pid} className="text-sm text-gray-300 flex items-center gap-2">
                              {seedIdx2 >= 0 && <span className="text-yellow-400 text-xs font-bold">{String.fromCharCode(65 + seedIdx2)}</span>}
                              <span className="flex-1">
                                {displayName}
                                {isTeamType && teamData?.memberNames && (
                                  <span className="text-xs text-gray-500 ml-1">({teamData.memberNames.join(', ')})</span>
                                )}
                              </span>
                              {!isTeamType && (
                                <select
                                  className="bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600"
                                  value={group.id}
                                  onChange={e => handleMovePlayer(pid, group.id, e.target.value)}
                                  aria-label={t('admin.tournamentDetail.bracketTab.moveGroupAriaLabel', { name: displayName })}
                                >
                                  {groupAssignment.map(g => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                  ))}
                                </select>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
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

      {/* 본선 대진 생성 (수동 모드: finals 스테이지가 있고, 본선 매치가 없을 때) */}
      {/* 랜덤 팀 리그는 AI가 본선을 별도 관리하므로 버튼 숨김 */}
      {(() => {
        if (tournament.status === 'completed') return null;
        if (tournament.type === 'randomTeamLeague') return null;
        const finalsStage = toArray(tournament.stages).find(s => s.type === 'finals');
        if (!finalsStage) return null;
        const finalsMatches = matches.filter(m => m.stageId === finalsStage.id);
        if (finalsMatches.length > 0) return null; // 이미 본선 매치가 있으면 아래 편성 카드에서 처리

        const qualifyingMatches = matches.filter(m => m.groupId);
        const hasQualifyingMatches = qualifyingMatches.length > 0;

        // 조별 순위 계산
        const qualifyingGroups = (() => {
          const qualifying = toArray(tournament.stages).find(s => s.type === 'qualifying');
          return qualifying ? toArray(qualifying.groups) : [];
        })();
        const groupIdToName = new Map<string, string>();
        qualifyingGroups.forEach(g => { groupIdToName.set(g.id, g.name); });

        const groupRankings = new Map<string, { groupId: string; groupName: string; rank: number }>();
        const groupMap = new Map<string, typeof matches>();
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

        const fc = tournament.finalsConfig as Record<string, unknown> | undefined;
        const advancePerGroup = typeof fc?.advancePerGroup === 'number' ? fc.advancePerGroup : 2;
        const totalAdvance = finalsStage.advanceCount || advancePerGroup * (tournament.qualifyingConfig?.groupCount || 2);
        let matchCount = Math.floor(totalAdvance / 2);
        if (matchCount < 1) matchCount = 1;

        const idToName = new Map<string, string>();
        tournamentPlayers.forEach(p => idToName.set(p.id, p.name));
        teams.forEach(t => idToName.set(t.id, t.name));

        // 조별 순위 요약 표시
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
                      alert(t('admin.tournamentDetail.bracketTab.matchCountExceeded', {
                        max: maxAllowed, current: matches.length, newCount: matchCount, total: totalAfterCreate,
                        defaultValue: `설정된 최대 경기 수(${maxAllowed}경기)를 초과합니다.\n현재 ${matches.length}경기 + 새로 ${matchCount}경기 = ${totalAfterCreate}경기\n대진 생성이 취소되었습니다.`,
                      }));
                      return;
                    }
                    // 본선 대진 중복 검증
                    const existingFinalsMatches = matches.filter(m => m.stageId === finalsStage.id);
                    if (existingFinalsMatches.length > 0) {
                      alert(t('admin.tournamentDetail.bracketTab.finalsDuplicateBlocked', {
                        count: existingFinalsMatches.length,
                        defaultValue: `이미 본선 대진이 ${existingFinalsMatches.length}건 생성되어 있습니다. 중복 생성이 불가합니다.`,
                      }));
                      return;
                    }
                    const now = Date.now();
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
      })()}

      {/* 본선 대진 편성 카드 (랜덤 팀 리그 제외) */}
      {(() => {
        if (tournament.status === 'completed') return null;
        if (tournament.type === 'randomTeamLeague') return null;
        const finalsStageId = toArray(tournament.stages).find(s => s.type === 'finals')?.id;
        const finalsMatches = matches.filter(m => m.stageId === finalsStageId || (m.stageId && m.stageId.includes('finals')));
        if (finalsMatches.length === 0 || !finalsStageId) return null;

        // Build advanced players list with group origin
        const qualifyingGroups = (() => {
          const qualifying = toArray(tournament.stages).find(s => s.type === 'qualifying');
          return qualifying ? toArray(qualifying.groups) : [];
        })();
        const qualifyingMatches = matches.filter(m => m.groupId);
        const groupIdToName = new Map<string, string>();
        qualifyingGroups.forEach(g => { groupIdToName.set(g.id, g.name); });

        // Determine which group each advanced player came from and their rank
        const groupRankings = new Map<string, { groupId: string; groupName: string; rank: number }>();
        const groupMap = new Map<string, typeof matches>();
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

        const idToName = new Map<string, string>();
        tournamentPlayers.forEach(p => idToName.set(p.id, p.name));
        teams.forEach(t => idToName.set(t.id, t.name));

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
          // Collect advanced with group info, sorted by group then rank
          const withInfo = advancedList.map(id => ({ id, ...(groupRankings.get(id) || { groupId: '', groupName: '', rank: 0 }) }));
          const groupIds = [...new Set(withInfo.map(w => w.groupId))].sort();
          const byGroup = new Map<string, typeof withInfo>();
          withInfo.forEach(w => {
            if (!byGroup.has(w.groupId)) byGroup.set(w.groupId, []);
            byGroup.get(w.groupId)!.push(w);
          });
          byGroup.forEach(arr => arr.sort((a, b) => a.rank - b.rank));

          let pairs: [string, string][] = [];

          if (mode === 'cross') {
            // Cross: A1 vs B2, B1 vs A2, C1 vs D2, D1 vs C2
            for (let i = 0; i < groupIds.length; i += 2) {
              const gA = byGroup.get(groupIds[i]) || [];
              const gB = byGroup.get(groupIds[i + 1] || groupIds[i]) || [];
              if (gA[0] && gB[1]) pairs.push([gA[0].id, gB[1].id]);
              if (gB[0] && gA[1]) pairs.push([gB[0].id, gA[1].id]);
              // If more than 2 per group, pair remaining
              for (let k = 2; k < Math.max(gA.length, gB.length); k++) {
                if (gA[k] && gB[k]) pairs.push([gA[k].id, gB[k].id]);
                else if (gA[k]) pairs.push([gA[k].id, gA[k].id]);
              }
            }
          } else if (mode === 'sequential') {
            // Sequential: A1 vs A2, B1 vs B2, ...
            groupIds.forEach(gid => {
              const arr = byGroup.get(gid) || [];
              for (let k = 0; k < arr.length; k += 2) {
                if (arr[k + 1]) pairs.push([arr[k].id, arr[k + 1].id]);
              }
            });
          }

          // Update existing finals matches with new pairings
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
          alert(t('admin.tournamentDetail.bracketTab.finalsArranged'));
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
      })()}

      {matches.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-gray-400 text-center">{t('admin.tournamentDetail.bracketTab.noBracket')}</p>
          {isManualMode && (
            <p className="text-yellow-400 text-sm mt-2">{t('admin.tournamentDetail.bracketTab.manualAddHint')}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3" role="list" aria-label={`${t('admin.tournamentDetail.bracketTab.title')} (${matches.length})`}>
          {[...matches].sort((a, b) => {
            // 예선(groupId 있음) → 본선(stageId에 finals) → 기타
            const aIsQual = a.groupId ? 0 : 1;
            const bIsQual = b.groupId ? 0 : 1;
            if (aIsQual !== bIsQual) return aIsQual - bIsQual;
            return (a.createdAt ?? 0) - (b.createdAt ?? 0);
          }).map((match, matchIdx) => (
            <div key={match.id} className="card space-y-3" role="listitem" aria-setsize={matches.length} aria-posinset={matchIdx + 1}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  {/* Reorder buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      className="text-xs text-gray-400 hover:text-white leading-none px-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleSwapRound(match.id, 'up')}
                      disabled={matchIdx === 0}
                      aria-label={t('admin.tournamentDetail.bracketTab.orderUpAriaLabel')}
                    >
                      &uarr;
                    </button>
                    <button
                      className="text-xs text-gray-400 hover:text-white leading-none px-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleSwapRound(match.id, 'down')}
                      disabled={matchIdx === matches.length - 1}
                      aria-label={t('admin.tournamentDetail.bracketTab.orderDownAriaLabel')}
                    >
                      &darr;
                    </button>
                  </div>
                  <span className="text-gray-400 text-sm">R{match.round}</span>
                  <span className="font-bold text-lg">
                    {match.type === 'team' ? (
                      <div>
                        <span>{match.team1Name ?? '?'} vs {match.team2Name ?? '?'}</span>
                        <div className="text-xs text-gray-400 mt-1 font-normal">
                          {match.team1Name}: {(match.team1 as any)?.memberNames?.join(', ') || ''}
                          {' | '}
                          {match.team2Name}: {(match.team2 as any)?.memberNames?.join(', ') || ''}
                        </div>
                      </div>
                    ) : `${match.player1Name ?? '?'} vs ${match.player2Name ?? '?'}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {match.status === 'pending' && !isCompleted && (
                    <button
                      className="text-xs text-blue-400 hover:text-blue-300 border border-blue-600 rounded px-2 py-1"
                      onClick={() => openEditModal(match)}
                      aria-label={t('admin.tournamentDetail.bracketTab.editMatchAriaLabel')}
                    >
                      {t('admin.tournamentDetail.bracketTab.editMatchButton')}
                    </button>
                  )}
                  {match.status === 'pending' && !isCompleted && (
                    <button
                      className="text-red-500 hover:text-red-400 font-bold text-lg leading-none px-1"
                      onClick={() => handleDeleteMatch(match.id)}
                      aria-label={t('admin.tournamentDetail.bracketTab.deleteMatchAriaLabel')}
                    >
                      &times;
                    </button>
                  )}
                  {match.walkover && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-600 text-white">
                      {t('admin.tournamentDetail.bracketTab.walkoverBadge')} ({match.type === 'individual'
                        ? (match.winnerId === match.player1Id ? match.player1Name : match.player2Name)
                        : (match.winnerId === match.team1Id ? match.team1Name : match.team2Name)} {t('spectator.playerProfile.win')})
                    </span>
                  )}
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[match.status]}`}>
                    {STATUS_ICONS[match.status]} {t(STATUS_LABEL_KEYS[match.status])}
                  </span>
                </div>
              </div>

              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-48">
                  <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.bracketTab.refereeLabel')}</label>
                  <select
                    className="input"
                    value={match.refereeId ?? ''}
                    onChange={e => handleAssign(match.id, 'refereeId', e.target.value)}
                    aria-label={`${match.type === 'individual' ? (match.player1Name ?? '?') + ' vs ' + (match.player2Name ?? '?') : (match.team1Name ?? '?') + ' vs ' + (match.team2Name ?? '?')} ${t('admin.tournamentDetail.bracketTab.refereeLabel')}`}
                  >
                    <option value="">{t('admin.tournamentDetail.bracketTab.refereeUnassigned')}</option>
                    {referees.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-48">
                  <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.bracketTab.assistantRefereeLabel')}</label>
                  <select
                    className="input"
                    value={match.assistantRefereeId ?? ''}
                    onChange={e => handleAssign(match.id, 'assistantRefereeId', e.target.value)}
                    aria-label={`${match.type === 'individual' ? (match.player1Name ?? '?') + ' vs ' + (match.player2Name ?? '?') : (match.team1Name ?? '?') + ' vs ' + (match.team2Name ?? '?')} ${t('admin.tournamentDetail.bracketTab.assistantRefereeLabel')}`}
                  >
                    <option value="">{t('admin.tournamentDetail.bracketTab.assistantRefereeNone')}</option>
                    {referees.filter(r => r.id !== match.refereeId).map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-48">
                  <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.bracketTab.courtLabel')}</label>
                  <select
                    className="input"
                    value={match.courtId ?? ''}
                    onChange={e => handleAssign(match.id, 'courtId', e.target.value)}
                    aria-label={`${match.type === 'individual' ? (match.player1Name ?? '?') + ' vs ' + (match.player2Name ?? '?') : (match.team1Name ?? '?') + ' vs ' + (match.team2Name ?? '?')} ${t('admin.tournamentDetail.bracketTab.courtLabel')}`}
                  >
                    <option value="">{t('admin.tournamentDetail.bracketTab.refereeUnassigned')}</option>
                    {courts.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 경기 수정 모달 */}
      {editingMatchId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setEditingMatchId(null)} onKeyDown={e => { if (e.key === 'Escape') setEditingMatchId(null); }}>
          <div className="bg-gray-900 rounded-xl p-6 w-full max-w-md space-y-4 border border-gray-700" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="edit-match-modal-title">
            <h3 id="edit-match-modal-title" className="text-lg font-bold text-yellow-400">{t('admin.tournamentDetail.bracketTab.editMatchModalTitle')}</h3>
            <div>
              <label className="block text-sm text-gray-300 mb-1">{isTeamType ? t('admin.tournamentDetail.bracketTab.team1Label') : t('admin.tournamentDetail.bracketTab.player1Label')}</label>
              <select className="input w-full" value={editPlayer1} onChange={e => setEditPlayer1(e.target.value)} aria-label={isTeamType ? t('admin.tournamentDetail.bracketTab.team1Label') : t('admin.tournamentDetail.bracketTab.player1Label')}>
                <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                {selectOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">{isTeamType ? t('admin.tournamentDetail.bracketTab.team2Label') : t('admin.tournamentDetail.bracketTab.player2Label')}</label>
              <select className="input w-full" value={editPlayer2} onChange={e => setEditPlayer2(e.target.value)} aria-label={isTeamType ? t('admin.tournamentDetail.bracketTab.team2Label') : t('admin.tournamentDetail.bracketTab.player2Label')}>
                <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                {selectOptions.filter(o => o.id !== editPlayer1).map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            {editPlayer1 && editPlayer2 && editPlayer1 === editPlayer2 && (
              <p className="text-red-400 text-sm">{t('admin.tournamentDetail.bracketTab.samePlayerError')}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={() => setEditingMatchId(null)} aria-label={t('common.cancel')}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={handleEditMatch}
                disabled={!editPlayer1 || !editPlayer2 || editPlayer1 === editPlayer2}
                aria-label={t('common.save')}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
