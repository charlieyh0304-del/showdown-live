import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { push, set, ref } from 'firebase/database';
import { database } from '@shared/config/firebase';
import { createEmptySet, checkMatchWinner, checkSetWinner, getEffectiveGameConfig } from '@shared/utils/scoring';
import { showSuccess, showError } from '@shared/utils/toast';
import PdfDownloadButton from '@shared/components/PdfDownloadButton';
import type { Match, Team, Player, MatchStatus, SetScore, ScoreHistoryEntry, Tournament } from '@shared/types';

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

export { STATUS_LABEL_KEYS, STATUS_ICONS, STATUS_COLORS };

export interface StatusTabProps {
  tournament: Tournament;
  matches: Match[];
  updateTournament: (data: Record<string, unknown>) => Promise<boolean | void>;
  updateMatch: (matchId: string, data: Partial<Match>) => Promise<boolean | void>;
  isTeamType: boolean;
  tournamentPlayers: Player[];
  teams: Team[];
}

export default function StatusTab({ tournament, matches, updateTournament, updateMatch, isTeamType, tournamentPlayers, teams }: StatusTabProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'all' | MatchStatus>('all');
  const [correctionMatch, setCorrectionMatch] = useState<Match | null>(null);
  const [correctionSets, setCorrectionSets] = useState<SetScore[]>([]);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [walkoverMatch, setWalkoverMatch] = useState<Match | null>(null);
  const [walkoverWinnerId, setWalkoverWinnerId] = useState('');
  const [walkoverReason, setWalkoverReason] = useState('');
  const [walkoverSaving, setWalkoverSaving] = useState(false);

  const filtered = useMemo(() => {
    if (filter === 'all') return matches;
    return matches.filter(m => m.status === filter);
  }, [matches, filter]);

  const counts = useMemo(() => {
    const c = { pending: 0, in_progress: 0, completed: 0 };
    matches.forEach(m => { c[m.status]++; });
    return c;
  }, [matches]);

  // Group filtered matches into sections for display
  const groupedSections = useMemo(() => {
    const qualifying: Match[] = [];
    const finals: Match[] = [];
    const ranking: Match[] = [];
    const other: Match[] = [];

    filtered.forEach(m => {
      if (m.groupId || m.stageId?.includes('qualifying')) {
        qualifying.push(m);
      } else if (m.stageId?.includes('ranking') || m.roundLabel?.includes('결정전')) {
        ranking.push(m);
      } else if (m.stageId?.includes('finals') || m.roundLabel) {
        finals.push(m);
      } else {
        other.push(m);
      }
    });

    // Sub-group qualifying by groupId
    const qualifyingGroups = new Map<string, Match[]>();
    qualifying.forEach(m => {
      const gid = m.groupId || 'default';
      if (!qualifyingGroups.has(gid)) qualifyingGroups.set(gid, []);
      qualifyingGroups.get(gid)!.push(m);
    });
    const qualifyingEntries = Array.from(qualifyingGroups.entries()).sort(([a], [b]) => a.localeCompare(b));

    // Sub-group finals by roundLabel
    const roundOrder = [t('admin.tournamentDetail.statusTab.round128'), t('admin.tournamentDetail.statusTab.round64'), t('admin.tournamentDetail.statusTab.round32'), t('admin.tournamentDetail.statusTab.round16'), t('admin.tournamentDetail.statusTab.quarterFinal'), t('admin.tournamentDetail.statusTab.semiFinal'), t('admin.tournamentDetail.statusTab.final')];
    const finalsMap = new Map<string, Match[]>();
    finals.forEach(m => {
      const label = m.roundLabel || `R${m.round}`;
      if (!finalsMap.has(label)) finalsMap.set(label, []);
      finalsMap.get(label)!.push(m);
    });
    const finalsEntries = Array.from(finalsMap.entries()).sort(([a], [b]) => {
      const ai = roundOrder.indexOf(a);
      const bi = roundOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

    // Sub-group ranking by roundLabel
    const rankingMap = new Map<string, Match[]>();
    ranking.forEach(m => {
      const label = m.roundLabel || t('admin.tournamentDetail.statusTab.rankingMatch');
      if (!rankingMap.has(label)) rankingMap.set(label, []);
      rankingMap.get(label)!.push(m);
    });
    const rankingEntries = Array.from(rankingMap.entries());

    // Build ordered section list: [{heading, matches}]
    const sections: { heading: string; matches: Match[] }[] = [];

    const isFullLeagueFormat = tournament.format === 'full_league' || tournament.formatType === 'round_robin';
    qualifyingEntries.forEach(([gid, gMatches]) => {
      const label = isFullLeagueFormat
        ? (gid === 'default' || gid === 'full_league' ? t('admin.tournamentDetail.statusTab.league') : `${gid}`)
        : (gid === 'default' ? t('admin.tournamentDetail.statusTab.qualifying') : `${gid} ${t('admin.tournamentDetail.statusTab.qualifying')}`);
      sections.push({ heading: label, matches: gMatches });
    });
    finalsEntries.forEach(([roundLabel, rMatches]) => {
      sections.push({ heading: `${t('admin.tournamentDetail.statusTab.finals')} — ${roundLabel}`, matches: rMatches });
    });
    rankingEntries.forEach(([roundLabel, rMatches]) => {
      sections.push({ heading: `${t('admin.tournamentDetail.statusTab.rankingMatch')} — ${roundLabel}`, matches: rMatches });
    });
    if (other.length > 0) {
      sections.push({ heading: t('admin.tournamentDetail.statusTab.other'), matches: other });
    }

    return sections;
  }, [filtered]);

  const handleStatusChange = useCallback(async (newStatus: 'in_progress' | 'paused' | 'completed') => {
    await updateTournament({ status: newStatus });
  }, [updateTournament]);

  const handleAdvanceToFinals = async () => {
    // 1. 조별 순위 계산
    const qualifyingMatches = matches.filter(m => m.groupId);
    const groupMap = new Map<string, typeof matches>();
    qualifyingMatches.forEach(m => {
      const gid = m.groupId!;
      if (!groupMap.has(gid)) groupMap.set(gid, []);
      groupMap.get(gid)!.push(m);
    });

    const qualifyingGroupCount = tournament.qualifyingConfig?.groupCount || 1;
    const totalAdvance = tournament.finalsConfig?.advanceCount || 2;
    const advancePerGroup = qualifyingGroupCount > 1 ? Math.floor(totalAdvance / qualifyingGroupCount) : totalAdvance;
    const advancedIds: string[] = [];

    groupMap.forEach((groupMatches) => {
      const stats = new Map<string, { wins: number; setsWon: number; setsLost: number; pointsFor: number; pointsAgainst: number }>();
      groupMatches.filter(m => m.status === 'completed').forEach(m => {
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

      sorted.slice(0, advancePerGroup).forEach(([id]) => advancedIds.push(id));
    });

    // 2. 본선 Match 생성 (싱글엘리미네이션)
    const idToName = new Map<string, string>();
    tournamentPlayers.forEach(p => idToName.set(p.id, p.name));
    teams.forEach(t => idToName.set(t.id, t.name));

    const finalsStageId = toArray(tournament.stages).find(s => s.type === 'finals')?.id || 'finals';

    let bracketSize = 4;
    while (bracketSize < advancedIds.length) bracketSize *= 2;

    const finalsMatches: Omit<Match, 'id'>[] = [];
    for (let i = 0; i < advancedIds.length; i += 2) {
      if (i + 1 >= advancedIds.length) break;
      const p1 = advancedIds[i];
      const p2 = advancedIds[i + 1];
      const roundLabel = bracketSize >= 16 ? t('admin.tournamentDetail.rankingTab.roundLabel16') : bracketSize >= 8 ? t('admin.tournamentDetail.rankingTab.roundLabel8') : t('admin.tournamentDetail.rankingTab.roundLabel4');

      finalsMatches.push({
        tournamentId: tournament.id,
        type: isTeamType ? 'team' : 'individual',
        status: 'pending',
        round: 1,
        stageId: finalsStageId,
        roundLabel,
        ...(isTeamType ? {
          team1Id: p1, team2Id: p2,
          team1Name: idToName.get(p1) || p1,
          team2Name: idToName.get(p2) || p2,
        } : {
          player1Id: p1, player2Id: p2,
          player1Name: idToName.get(p1) || p1,
          player2Name: idToName.get(p2) || p2,
        }),
        sets: [],
        currentSet: 0,
        player1Timeouts: 0,
        player2Timeouts: 0,
        winnerId: null,
        createdAt: Date.now(),
      });
    }

    // Firebase에 본선 경기 추가
    for (const match of finalsMatches) {
      const matchRef = push(ref(database, `matches/${tournament.id}`));
      await set(matchRef, match);
    }

    await updateTournament({ currentStageId: finalsStageId });
    showSuccess(t('admin.tournamentDetail.statusTab.advanceToFinalsAlert', { count: finalsMatches.length }));
  };

  const openCorrectionModal = (match: Match) => {
    setCorrectionMatch(match);
    setCorrectionSets(
      (match.sets || []).map(s => ({ ...s }))
    );
    setCorrectionReason('');
  };

  const closeCorrectionModal = () => {
    setCorrectionMatch(null);
    setCorrectionSets([]);
    setCorrectionReason('');
  };

  const handleCorrectionSetScore = (setIdx: number, player: 'player1Score' | 'player2Score', value: number) => {
    setCorrectionSets(prev => prev.map((s, i) => i === setIdx ? { ...s, [player]: Math.max(0, value) } : s));
  };

  const correctionWinner = useMemo(() => {
    if (correctionSets.length === 0) return null;
    return checkMatchWinner(correctionSets);
  }, [correctionSets]);

  const handleSaveCorrection = async () => {
    if (!correctionMatch || !correctionReason.trim()) return;
    setCorrectionSaving(true);
    try {
      const newSets: SetScore[] = correctionSets.map(s => {
        const winner = checkSetWinner(s.player1Score, s.player2Score);
        return { ...s, winnerId: winner === 1 ? (correctionMatch.player1Id || correctionMatch.team1Id || null) : winner === 2 ? (correctionMatch.player2Id || correctionMatch.team2Id || null) : null };
      });

      const matchWinner = checkMatchWinner(newSets);
      let newWinnerId: string | null = null;
      if (matchWinner === 1) newWinnerId = correctionMatch.player1Id || correctionMatch.team1Id || null;
      if (matchWinner === 2) newWinnerId = correctionMatch.player2Id || correctionMatch.team2Id || null;

      const historyEntry: ScoreHistoryEntry = {
        time: new Date().toISOString(),
        scoringPlayer: '',
        actionPlayer: 'admin',
        actionType: 'correction',
        actionLabel: `${t('admin.tournamentDetail.statusTab.scoreCorrection')}: ${correctionReason.trim()}`,
        points: 0,
        set: 0,
        server: '',
        serveNumber: 0,
        scoreBefore: {
          player1: (correctionMatch.sets || []).reduce((sum, s) => sum + s.player1Score, 0),
          player2: (correctionMatch.sets || []).reduce((sum, s) => sum + s.player2Score, 0),
        },
        scoreAfter: {
          player1: newSets.reduce((sum, s) => sum + s.player1Score, 0),
          player2: newSets.reduce((sum, s) => sum + s.player2Score, 0),
        },
      };

      const existingHistory = toArray(correctionMatch.scoreHistory);

      await updateMatch(correctionMatch.id, {
        sets: newSets,
        winnerId: newWinnerId,
        scoreHistory: [...existingHistory, historyEntry],
      });

      showSuccess(t('admin.tournamentDetail.statusTab.scoreCorrected'));
      closeCorrectionModal();
    } catch (err) {
      console.error('점수 수정 오류:', err);
      showError(t('admin.tournamentDetail.statusTab.scoreCorrectionError'));
    } finally {
      setCorrectionSaving(false);
    }
  };

  const openWalkoverModal = (match: Match) => {
    setWalkoverMatch(match);
    setWalkoverWinnerId('');
    setWalkoverReason('');
  };

  const closeWalkoverModal = () => {
    setWalkoverMatch(null);
    setWalkoverWinnerId('');
    setWalkoverReason('');
  };

  const handleSaveWalkover = async () => {
    if (!walkoverMatch || !walkoverWinnerId || !walkoverReason.trim()) return;
    setWalkoverSaving(true);
    try {
      const historyEntry: ScoreHistoryEntry = {
        time: new Date().toISOString(),
        scoringPlayer: '',
        actionPlayer: 'admin',
        actionType: 'walkover',
        actionLabel: `${t('admin.tournamentDetail.statusTab.walkoverBadge')}: ${walkoverReason.trim()}`,
        points: 0,
        set: 0,
        server: '',
        serveNumber: 0,
        scoreBefore: { player1: 0, player2: 0 },
        scoreAfter: { player1: 0, player2: 0 },
      };

      const existingHistory = toArray(walkoverMatch.scoreHistory);

      // setsToWin 만큼 부전승 세트 생성 (3세트→2세트, 5세트→3세트)
      const gameConfig = getEffectiveGameConfig(tournament?.gameConfig, walkoverMatch.type);
      const winScore = gameConfig.POINTS_TO_WIN;
      const isP1Winner = walkoverWinnerId === (walkoverMatch.player1Id || walkoverMatch.team1Id || 'player1');
      const walkoverSets = Array.from({ length: gameConfig.SETS_TO_WIN }, () => ({
        ...createEmptySet(),
        player1Score: isP1Winner ? winScore : 0,
        player2Score: isP1Winner ? 0 : winScore,
        winnerId: walkoverWinnerId,
      }));

      await updateMatch(walkoverMatch.id, {
        status: 'completed',
        winnerId: walkoverWinnerId,
        walkover: true,
        walkoverReason: walkoverReason.trim(),
        sets: walkoverSets,
        scoreHistory: [...existingHistory, historyEntry],
      } as Partial<Match>);

      showSuccess(t('admin.tournamentDetail.statusTab.walkoverProcessed'));
      closeWalkoverModal();
    } catch (err) {
      console.error('부전승 처리 오류:', err);
      showError(t('admin.tournamentDetail.statusTab.walkoverError'));
    } finally {
      setWalkoverSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card flex items-center gap-4 flex-wrap">
        <span className="font-semibold text-lg">{t('admin.tournamentDetail.statusTab.tournamentStatus')}</span>
        <span className={`px-3 py-1 rounded-full font-bold ${
          tournament.status === 'draft' ? 'bg-gray-600 text-white' :
          tournament.status === 'registration' ? 'bg-blue-600 text-white' :
          tournament.status === 'in_progress' ? 'bg-orange-500 text-black' :
          tournament.status === 'paused' ? 'bg-red-600 text-white' :
          'bg-green-600 text-white'
        }`}>
          {tournament.status === 'draft' ? t('admin.tournamentDetail.statusTab.statusDraft') :
           tournament.status === 'registration' ? t('admin.tournamentDetail.statusTab.statusRegistration') :
           tournament.status === 'in_progress' ? t('admin.tournamentDetail.statusTab.statusInProgress') :
           tournament.status === 'paused' ? t('admin.tournamentDetail.statusTab.statusPaused') : t('admin.tournamentDetail.statusTab.statusCompleted')}
        </span>

        <div className="flex gap-2 flex-wrap">
          {(tournament.status === 'draft' || tournament.status === 'registration') && (
            <button
              className="btn btn-accent"
              onClick={() => handleStatusChange('in_progress')}
              disabled={matches.length === 0}
              aria-label={t('admin.tournamentDetail.statusTab.startTournament')}
            >
              {t('admin.tournamentDetail.statusTab.startTournament')}
            </button>
          )}
          {tournament.status === 'in_progress' && (
            <button
              className="btn btn-danger"
              onClick={() => handleStatusChange('paused')}
              aria-label={t('admin.tournamentDetail.statusTab.pauseTournament')}
            >
              {t('admin.tournamentDetail.statusTab.pauseTournament')}
            </button>
          )}
          {tournament.status === 'paused' && (
            <button
              className="btn btn-success"
              onClick={() => handleStatusChange('in_progress')}
              aria-label={t('admin.tournamentDetail.statusTab.resumeTournament')}
            >
              {t('admin.tournamentDetail.statusTab.resumeTournament')}
            </button>
          )}
          {(tournament.status === 'in_progress' || tournament.status === 'paused') && (
            <button
              className="btn btn-success"
              onClick={() => handleStatusChange('completed')}
              aria-label={t('admin.tournamentDetail.statusTab.completeTournament')}
            >
              {t('admin.tournamentDetail.statusTab.completeTournament')}
            </button>
          )}
        </div>
      </div>

      {/* 대회 단계 관리 (풀리그는 예선/본선 구분이 없으므로 숨김) */}
      {toArray(tournament.stages).length > 0 && tournament.formatType !== 'round_robin' && (
        <div className="card space-y-4">
          <h3 className="text-xl font-bold text-yellow-400 text-center">{t('admin.tournamentDetail.statusTab.stageManagement')}</h3>
          {toArray(tournament.stages).map((stage) => {
            const stageMatches = matches.filter(m =>
              m.stageId === stage.id ||
              (stage.type === 'qualifying' && m.groupId) ||
              (stage.type === 'finals' && m.roundLabel)
            );
            const completed = stageMatches.filter(m => m.status === 'completed').length;
            const total = stageMatches.length;
            const allDone = total > 0 && completed === total;
            const isCurrent = tournament.currentStageId === stage.id;

            return (
              <div key={stage.id} className={`p-4 rounded-lg border-2 ${isCurrent ? 'border-yellow-400 bg-gray-800' : 'border-gray-700'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h4 className="text-lg font-bold">{stage.name}</h4>
                    <p className="text-sm text-gray-400">{stage.format} · {stage.status}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">{completed}/{total}</p>
                    <p className="text-xs text-gray-400">{t('admin.tournamentDetail.statusTab.matchesComplete')}</p>
                  </div>
                </div>
                {/* 진행률 바 */}
                <div className="w-full bg-gray-700 rounded h-2 mb-3">
                  <div className="bg-yellow-400 h-2 rounded" style={{ width: `${total > 0 ? (completed/total)*100 : 0}%` }} />
                </div>
                {allDone && stage.type === 'qualifying' && (
                  <div className="mt-3 space-y-2">
                    <p className="text-green-400 text-sm font-semibold">{t('admin.tournamentDetail.statusTab.qualifyingDone')}</p>
                    {tournament.type !== 'randomTeamLeague' && (
                      <button className="btn btn-success w-full" onClick={handleAdvanceToFinals} aria-label={t('admin.tournamentDetail.statusTab.createFinalsBracket')}>
                        {t('admin.tournamentDetail.statusTab.createFinalsBracket')}
                      </button>
                    )}
                  </div>
                )}
                {allDone && stage.type === 'finals' && (
                  <p className="text-green-400 text-sm font-semibold">{t('admin.tournamentDetail.statusTab.finalsDone')}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          className={`btn ${filter === 'all' ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
          onClick={() => { setFilter('all'); }}
          aria-pressed={filter === 'all'}
          aria-label={t('admin.tournamentDetail.statusTab.filterAll', { count: '' })}
        >
          {t('admin.tournamentDetail.statusTab.filterAll', { count: matches.length })}
        </button>
        <button
          className={`btn ${filter === 'pending' ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
          onClick={() => { setFilter('pending'); }}
          aria-pressed={filter === 'pending'}
          aria-label={t('admin.tournamentDetail.statusTab.filterPending', { count: '' })}
        >
          {t('admin.tournamentDetail.statusTab.filterPending', { count: counts.pending })}
        </button>
        <button
          className={`btn ${filter === 'in_progress' ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
          onClick={() => { setFilter('in_progress'); }}
          aria-pressed={filter === 'in_progress'}
          aria-label={t('admin.tournamentDetail.statusTab.filterInProgress', { count: '' })}
        >
          {t('admin.tournamentDetail.statusTab.filterInProgress', { count: counts.in_progress })}
        </button>
        <button
          className={`btn ${filter === 'completed' ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
          onClick={() => { setFilter('completed'); }}
          aria-pressed={filter === 'completed'}
          aria-label={t('admin.tournamentDetail.statusTab.filterCompleted', { count: '' })}
        >
          {t('admin.tournamentDetail.statusTab.filterCompleted', { count: counts.completed })}
        </button>
      </div>

      <div className="space-y-3" aria-live="polite">
        {filtered.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-gray-400 text-center">{t('admin.tournamentDetail.statusTab.noMatches')}</p>
          </div>
        ) : (
          groupedSections.map(section => (
            <div key={section.heading} className="space-y-2">
              <h3 className="text-lg font-bold text-yellow-400 mt-4 mb-1 border-b border-gray-700 pb-1">
                {section.heading}
                <span className="text-sm text-gray-400 font-normal ml-2">
                  ({section.matches.filter(m => m.status === 'completed').length}/{section.matches.length})
                </span>
              </h3>
              {section.matches.map(match => (
            <div key={match.id} className="card space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-bold">
                    {match.type === 'individual'
                      ? `${match.player1Name ?? '?'} vs ${match.player2Name ?? '?'}`
                      : `${match.team1Name ?? '?'} vs ${match.team2Name ?? '?'}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {match.courtName && <span className="text-sm text-gray-400">{match.courtName}</span>}
                  {match.scheduledDate && <span className="text-sm text-gray-500">{match.scheduledDate}</span>}
                  {match.scheduledTime && <span className={`text-sm ${match.actualStartTime ? 'text-gray-500 line-through' : 'text-cyan-400'}`}>{match.scheduledTime}</span>}
                  {match.actualStartTime && <span className="text-sm text-green-400">{match.actualStartTime}</span>}
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
                  {match.status !== 'completed' && (
                    <button
                      className="btn bg-orange-600 hover:bg-orange-500 text-white text-xs px-3 py-1"
                      onClick={() => openWalkoverModal(match)}
                      aria-label={`${match.type === 'individual' ? `${match.player1Name ?? '?'} vs ${match.player2Name ?? '?'}` : `${match.team1Name ?? '?'} vs ${match.team2Name ?? '?'}`} ${t('admin.tournamentDetail.statusTab.walkoverButton')}`}
                    >
                      {t('admin.tournamentDetail.statusTab.walkoverButton')}
                    </button>
                  )}
                </div>
              </div>

              {match.status === 'completed' && match.walkover && match.walkoverReason && (
                <div className="text-sm text-orange-300 mt-1">
                  {t('admin.tournamentDetail.statusTab.walkoverReason', { reason: match.walkoverReason })}
                </div>
              )}

              {match.status === 'completed' && match.sets && (
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  <div className="flex gap-2 flex-wrap">
                    {(() => {
                      // 승자 기준으로 스코어 표시 (winnerId가 player2/team2면 스코어 순서 반전)
                      const isP2Winner = match.winnerId === (match.player2Id || match.team2Id);
                      return match.sets.map((s, i) => {
                        const winScore = isP2Winner ? s.player2Score : s.player1Score;
                        const loseScore = isP2Winner ? s.player1Score : s.player2Score;
                        return (
                          <span key={i} className="px-3 py-1 bg-gray-800 rounded text-sm font-mono">
                            {match.sets && match.sets.length > 1 ? `S${i + 1}: ` : ''}{winScore}-{loseScore}
                          </span>
                        );
                      });
                    })()}
                  </div>
                  <button
                    className="btn bg-yellow-700 hover:bg-yellow-600 text-white text-xs px-3 py-1"
                    onClick={() => openCorrectionModal(match)}
                    aria-label={t('admin.tournamentDetail.statusTab.scoreCorrection')}
                  >
                    {t('admin.tournamentDetail.statusTab.scoreCorrection')}
                  </button>
                  <PdfDownloadButton match={match} tournament={{ name: tournament.name, date: tournament.date }} className="btn bg-blue-700 hover:bg-blue-600 text-white text-xs px-3 py-1" />
                </div>
              )}
            </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Total match count summary */}
      {filtered.length > 0 && (
        <div className="text-center text-sm text-gray-400 mt-4">
          {filtered.filter(m => m.status === 'completed').length}/{filtered.length}
        </div>
      )}

      {/* 점수 수정 모달 */}
      {correctionMatch && (
        <div className="modal-backdrop" onClick={closeCorrectionModal} onKeyDown={e => { if (e.key === 'Escape') closeCorrectionModal(); }}>
          <div className="card max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="correction-modal-title">
            <div className="flex items-center justify-between mb-4">
              <h2 id="correction-modal-title" className="text-xl font-bold text-center">{t('admin.tournamentDetail.correctionModal.title')}</h2>
              <button
                className="text-gray-400 hover:text-white font-bold text-xl"
                onClick={closeCorrectionModal}
                aria-label={t('common.close')}
              >
                x
              </button>
            </div>

            <div className="mb-4">
              <p className="font-semibold text-lg">
                {correctionMatch.type === 'individual'
                  ? `${correctionMatch.player1Name ?? '?'} vs ${correctionMatch.player2Name ?? '?'}`
                  : `${correctionMatch.team1Name ?? '?'} vs ${correctionMatch.team2Name ?? '?'}`}
              </p>
            </div>

            <div className="space-y-3 mb-4">
              {correctionSets.map((s, i) => (
                <div key={i} className="flex items-center gap-3 bg-gray-800 rounded-lg p-3">
                  <span className="text-sm text-gray-400 w-10">S{i + 1}</span>
                  <div className="flex items-center gap-2 flex-1">
                    <label className="text-sm text-gray-300">
                      {correctionMatch.type === 'individual' ? (correctionMatch.player1Name ?? 'P1') : (correctionMatch.team1Name ?? 'T1')}
                    </label>
                    <input
                      type="number"
                      min={0}
                      className="input w-20 text-center"
                      value={s.player1Score}
                      onChange={e => handleCorrectionSetScore(i, 'player1Score', parseInt(e.target.value) || 0)}
                      aria-label={`Set ${i + 1} ${correctionMatch.player1Name ?? 'P1'}`}
                    />
                    <span className="text-gray-400">-</span>
                    <input
                      type="number"
                      min={0}
                      className="input w-20 text-center"
                      value={s.player2Score}
                      onChange={e => handleCorrectionSetScore(i, 'player2Score', parseInt(e.target.value) || 0)}
                      aria-label={`Set ${i + 1} ${correctionMatch.player2Name ?? 'P2'}`}
                    />
                    <label className="text-sm text-gray-300">
                      {correctionMatch.type === 'individual' ? (correctionMatch.player2Name ?? 'P2') : (correctionMatch.team2Name ?? 'T2')}
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-4 p-3 bg-gray-800 rounded-lg">
              <span className="text-sm text-gray-400">{t('admin.tournamentDetail.correctionModal.autoWinnerLabel')}</span>
              <span className="font-bold text-yellow-400">
                {correctionWinner === 1
                  ? (correctionMatch.type === 'individual' ? correctionMatch.player1Name : correctionMatch.team1Name) ?? 'P1'
                  : correctionWinner === 2
                  ? (correctionMatch.type === 'individual' ? correctionMatch.player2Name : correctionMatch.team2Name) ?? 'P2'
                  : t('admin.tournamentDetail.correctionModal.undecided')}
              </span>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">{t('admin.tournamentDetail.correctionModal.reasonLabel')}</label>
              <input
                type="text"
                className="input w-full"
                value={correctionReason}
                onChange={e => setCorrectionReason(e.target.value)}
                placeholder={t('admin.tournamentDetail.correctionModal.reasonPlaceholder')}
                aria-label={t('admin.tournamentDetail.correctionModal.reasonLabel')}
              />
            </div>

            <div className="flex gap-2">
              <button
                className="btn btn-accent flex-1"
                onClick={handleSaveCorrection}
                disabled={!correctionReason.trim() || correctionSaving}
                aria-label={t('admin.tournamentDetail.correctionModal.saveButton')}
              >
                {correctionSaving ? t('admin.tournamentDetail.correctionModal.savingButton') : t('admin.tournamentDetail.correctionModal.saveButton')}
              </button>
              <button
                className="btn bg-gray-700 text-white hover:bg-gray-600 flex-1"
                onClick={closeCorrectionModal}
                aria-label={t('common.cancel')}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 부전승 처리 모달 */}
      {walkoverMatch && (
        <div className="modal-backdrop" onClick={closeWalkoverModal} onKeyDown={e => { if (e.key === 'Escape') closeWalkoverModal(); }}>
          <div className="card max-w-md w-full" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="walkover-modal-title">
            <div className="flex items-center justify-between mb-4">
              <h2 id="walkover-modal-title" className="text-xl font-bold text-orange-400 text-center">{t('admin.tournamentDetail.walkoverModal.title')}</h2>
              <button
                className="text-gray-400 hover:text-white font-bold text-xl"
                onClick={closeWalkoverModal}
                aria-label={t('common.close')}
              >
                x
              </button>
            </div>

            <div className="mb-4">
              <p className="font-semibold text-lg">
                {walkoverMatch.type === 'individual'
                  ? `${walkoverMatch.player1Name ?? '?'} vs ${walkoverMatch.player2Name ?? '?'}`
                  : `${walkoverMatch.team1Name ?? '?'} vs ${walkoverMatch.team2Name ?? '?'}`}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold mb-2">{t('admin.tournamentDetail.walkoverModal.selectWinner')}</label>
              <div className="flex gap-2">
                {(() => {
                  const p1Id = walkoverMatch.player1Id || walkoverMatch.team1Id || '';
                  const p1Name = walkoverMatch.type === 'individual' ? (walkoverMatch.player1Name ?? t('admin.tournamentDetail.walkoverModal.player1Default')) : (walkoverMatch.team1Name ?? t('admin.tournamentDetail.walkoverModal.team1Default'));
                  const p2Id = walkoverMatch.player2Id || walkoverMatch.team2Id || '';
                  const p2Name = walkoverMatch.type === 'individual' ? (walkoverMatch.player2Name ?? t('admin.tournamentDetail.walkoverModal.player2Default')) : (walkoverMatch.team2Name ?? t('admin.tournamentDetail.walkoverModal.team2Default'));
                  return (
                    <>
                      <button
                        className={`btn flex-1 ${walkoverWinnerId === p1Id ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                        onClick={() => setWalkoverWinnerId(p1Id)}
                        aria-label={t('admin.tournamentDetail.walkoverModal.winnerButton', { name: p1Name })}
                      >
                        {t('admin.tournamentDetail.walkoverModal.winnerButton', { name: p1Name })}
                      </button>
                      <button
                        className={`btn flex-1 ${walkoverWinnerId === p2Id ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                        onClick={() => setWalkoverWinnerId(p2Id)}
                        aria-label={t('admin.tournamentDetail.walkoverModal.winnerButton', { name: p2Name })}
                      >
                        {t('admin.tournamentDetail.walkoverModal.winnerButton', { name: p2Name })}
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">{t('admin.tournamentDetail.walkoverModal.reasonLabel')}</label>
              <input
                type="text"
                className="input w-full"
                value={walkoverReason}
                onChange={e => setWalkoverReason(e.target.value)}
                placeholder={t('admin.tournamentDetail.walkoverModal.reasonPlaceholder')}
                aria-label={t('admin.tournamentDetail.walkoverModal.reasonLabel')}
              />
            </div>

            <div className="flex gap-2">
              <button
                className="btn bg-orange-600 hover:bg-orange-500 text-white flex-1"
                onClick={handleSaveWalkover}
                disabled={!walkoverWinnerId || !walkoverReason.trim() || walkoverSaving}
                aria-label={t('admin.tournamentDetail.walkoverModal.confirmButton')}
              >
                {walkoverSaving ? t('admin.tournamentDetail.walkoverModal.processing') : t('admin.tournamentDetail.walkoverModal.confirmButton')}
              </button>
              <button
                className="btn bg-gray-700 text-white hover:bg-gray-600 flex-1"
                onClick={closeWalkoverModal}
                aria-label={t('common.cancel')}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
