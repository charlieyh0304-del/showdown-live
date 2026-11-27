import { useState, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { push, update, ref } from 'firebase/database';
import { database } from '@shared/config/firebase';
import { byeSetsFactory, computeFinalsSeeding, correctionResult, retirementSetsFor, walkoverSetsFor } from '@shared/utils/competition';
import { showSuccess, showError } from '@shared/utils/toast';
import { combineWriteResults, notifyWriteOutcome, notifyTournamentWrite, toFirebaseValue, type WriteResult } from '@shared/utils/dataWrites';
import { buildSingleEliminationSkeleton, fifthToEighthStageId, thirdPlaceStageId } from '@shared/utils/bracketSkeleton';
import { resolveCompetitionRules } from '@shared/rules/competitionRules';
import { retirementMatchFlags } from '@shared/rules/walkover';
import PdfDownloadButton from '@shared/components/PdfDownloadButton';
import TieDecisionPanel from './TieDecisionPanel';
import type { Match, MatchUpdate, Team, Player, MatchStatus, SetScore, ScoreHistoryEntry, Tournament } from '@shared/types';

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
  updateMatch: (matchId: string, data: MatchUpdate) => Promise<WriteResult>;
  isTeamType: boolean;
  tournamentPlayers: Player[];
  teams: Team[];
}

export default function StatusTab({ tournament, matches, updateTournament, updateMatch, isTeamType, tournamentPlayers, teams }: StatusTabProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'all' | MatchStatus>('all');
  // 본선 생성 중복 실행 방지 (연타 시 상태 갱신 전에도 막도록 ref도 함께 쓴다)
  const [creatingFinals, setCreatingFinals] = useState(false);
  const creatingFinalsRef = useRef(false);
  const [correctionMatch, setCorrectionMatch] = useState<Match | null>(null);
  const [correctionSets, setCorrectionSets] = useState<SetScore[]>([]);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [walkoverMatch, setWalkoverMatch] = useState<Match | null>(null);
  const [walkoverWinnerId, setWalkoverWinnerId] = useState('');
  const [walkoverReason, setWalkoverReason] = useState('');
  const [walkoverSaving, setWalkoverSaving] = useState(false);
  /** 결과 종류: forfeit = 규정 불이행 패(부전승), retired = 경기 포기(얻은 점수 유지) */
  const [walkoverKind, setWalkoverKind] = useState<'forfeit' | 'retired'>('forfeit');

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
    notifyTournamentWrite(await updateTournament({ status: newStatus }), t);
  }, [updateTournament, t]);

  // 진출 경계 미해결 동률 (예선 완료 후 관리자가 순서를 정한다)
  const qualifyingTies = useMemo(() => {
    const qs = toArray(tournament.stages).find(s => s.type === 'qualifying');
    const qm = matches.filter(m => m.groupId || (qs && m.stageId === qs.id));
    if (qm.length === 0) return [];
    return computeFinalsSeeding(tournament, qm, qs?.id, toArray(tournament.stages).find(s => s.type === 'finals')?.id || 'finals').qualification.blockingTies;
  }, [tournament, matches]);
  const participantName = useMemo(() => {
    const map = new Map<string, string>();
    tournamentPlayers.forEach(p => map.set(p.id, p.name));
    teams.forEach(tm => map.set(tm.id, tm.name));
    return map;
  }, [tournamentPlayers, teams]);
  const qualifyingGroupNames = useMemo(() => {
    const map = new Map<string, string>();
    toArray(toArray(tournament.stages).find(s => s.type === 'qualifying')?.groups).forEach(g => map.set(g.id, g.name));
    return map;
  }, [tournament.stages]);

  const handleAdvanceToFinals = async () => {
    if (creatingFinalsRef.current) return;
    const finalsStageId = toArray(tournament.stages).find(s => s.type === 'finals')?.id || 'finals';
    // 이미 본선(또는 3/4위전) 경기가 있으면 다시 만들지 않는다: 링크된 대진 전체가 중복된다
    const existingFinals = matches.filter(m => m.stageId === finalsStageId || m.stageId === thirdPlaceStageId(finalsStageId) || m.stageId === fifthToEighthStageId(finalsStageId)).length;
    if (existingFinals > 0) {
      showError(t('admin.tournamentDetail.bracketTab.finalsDuplicateBlocked', { count: existingFinals }));
      return;
    }
    creatingFinalsRef.current = true;
    setCreatingFinals(true);
    try {
      await createFinalsBracket(finalsStageId);
    } finally {
      creatingFinalsRef.current = false;
      setCreatingFinals(false);
    }
  };

  const createFinalsBracket = async (finalsStageId: string) => {
    // 1. 진출자와 시드: 대회 규칙(진출 인원·동률·조 교차·같은 조 회피)으로 계산 (서버 generate_finals와 같은 모듈)
    const qualifyingStage = toArray(tournament.stages).find(s => s.type === 'qualifying');
    const qualifyingMatches = matches.filter(m => m.groupId || (qualifyingStage && m.stageId === qualifyingStage.id));
    const seeding = computeFinalsSeeding(tournament, qualifyingMatches, qualifyingStage?.id, finalsStageId);
    if (!seeding.qualification.complete) {
      showError(t('common.competitionRules.finals.incomplete', { count: seeding.qualification.incompleteCount }));
      return;
    }
    if (seeding.qualification.blockingTies.length > 0) {
      showError(t('common.competitionRules.finals.tieBlocking'));
      return;
    }
    const advancedCount = seeding.qualification.qualifiers.length;

    // 2. 본선 Match 생성 (싱글엘리미네이션 전체 골격: 1라운드 ~ 결승 + 3/4위전, 진출 링크 포함)
    const idToName = new Map<string, string>();
    tournamentPlayers.forEach(p => idToName.set(p.id, p.name));
    teams.forEach(t => idToName.set(t.id, t.name));

    if (advancedCount < 2) {
      showError(t(isTeamType ? 'admin.tournamentDetail.bracketTab.needMoreTeams' : 'admin.tournamentDetail.bracketTab.needMorePlayers'));
      return;
    }

    const matchesPath = `matches/${tournament.id}`;

    // 1라운드: 표준 시드 위치(1·2번 시드는 결승에서만) + 조 교차. BYE는 상위 시드가 받고 부전승 점수(기본 11:0)로 완료된다
    const matchType = isTeamType ? 'team' : 'individual';
    const finalRankingRules = resolveCompetitionRules(tournament, finalsStageId).finalRanking;
    const entries = buildSingleEliminationSkeleton({
      tournamentId: tournament.id,
      stageId: finalsStageId,
      matchType,
      slots: seeding.slots.map(q => (q ? { id: q.id, name: idToName.get(q.id) || q.name || q.id } : null)),
      byeSets: byeSetsFactory(tournament, finalsStageId, matchType),
      // 3/4위전·5~8위 결정전은 대회 규칙(finalRanking, 레거시 rankingMatchConfig 포함)에서 읽는다 (서버 generate_finals와 같음)
      thirdPlace: finalRankingRules.thirdPlace === 'match',
      fifthToEighth: finalRankingRules.fifthToEighthMatches,
      makeKey: () => push(ref(database, matchesPath)).key!,
      now: Date.now(),
      labels: {
        undecided: t('admin.tournamentDetail.bracketTab.undecided'),
        bye: t('admin.tournamentDetail.bracketTab.byeSlot'),
      },
    });
    const finalsMatches = entries.filter(e => !e.match.isBye);

    // Firebase에 본선 경기를 한 번에 추가 (링크된 경기가 일부만 저장되지 않도록 multi-path update)
    const bulk: Record<string, unknown> = {};
    for (const { key, match } of entries) bulk[key] = toFirebaseValue(match);
    await update(ref(database, matchesPath), bulk);

    // 단계 전환이 저장되지 않았으면 성공 알림을 띄우지 않는다 (경기는 이미 생성됨을 알림)
    if (await updateTournament({ currentStageId: finalsStageId }) === false) {
      showError(t('admin.tournamentDetail.statusTab.advanceToFinalsStageNotSaved', { count: finalsMatches.length }));
      return;
    }
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
    if (correctionSets.length === 0 || !correctionMatch) return null;
    // 그 경기의 유효 규칙(라운드·스테이지·팀 31점·듀스 캡)으로 판정한다 (B12)
    return correctionResult(correctionMatch, correctionSets, tournament, correctionMatch.sets).winner;
  }, [correctionSets, correctionMatch, tournament]);

  const handleSaveCorrection = async () => {
    if (!correctionMatch || !correctionReason.trim()) return;
    setCorrectionSaving(true);
    try {
      const corrected = correctionResult(correctionMatch, correctionSets, tournament, correctionMatch.sets);
      const newSets: SetScore[] = corrected.sets;
      const newWinnerId = corrected.winnerId;

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

      const result = await updateMatch(correctionMatch.id, {
        sets: newSets,
        winnerId: newWinnerId,
        scoreHistory: [...existingHistory, historyEntry],
      });

      // 큐에 저장된 경우 "저장됨"이 아니라 "연결되면 동기화"로 안내. 실패 시 모달 유지.
      const outcome = combineWriteResults([result]);
      if (outcome === 'failed') {
        showError(t('admin.tournamentDetail.statusTab.scoreCorrectionError'));
        return;
      }
      notifyWriteOutcome(outcome, t, t('admin.tournamentDetail.statusTab.scoreCorrected'));
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
    setWalkoverKind('forfeit');
  };

  const closeWalkoverModal = () => {
    setWalkoverMatch(null);
    setWalkoverWinnerId('');
    setWalkoverReason('');
    setWalkoverKind('forfeit');
  };

  /** 선택한 결과 종류로 기록될 세트 */
  const walkoverResultSets = (m: Match, winnerId: string): SetScore[] => {
    const p1Id = m.player1Id || m.team1Id || 'player1';
    const p2Id = m.player2Id || m.team2Id || 'player2';
    const isP1Winner = winnerId === p1Id;
    if (walkoverKind === 'retired') {
      return retirementSetsFor(m, tournament, isP1Winner ? 2 : 1, winnerId, isP1Winner ? p2Id : p1Id);
    }
    // 부전승 = 대회 규칙의 부전승 점수 × 이겨야 하는 세트 수 (기본 11:0, 3세트제 → 2세트, 팀 31:0)
    return walkoverSetsFor(m, tournament, isP1Winner ? 1 : 2, winnerId);
  };

  const handleSaveWalkover = async () => {
    if (!walkoverMatch || !walkoverWinnerId || !walkoverReason.trim()) return;
    setWalkoverSaving(true);
    try {
      const historyEntry: ScoreHistoryEntry = {
        time: new Date().toISOString(),
        scoringPlayer: '',
        actionPlayer: 'admin',
        actionType: walkoverKind === 'retired' ? 'retired' : 'walkover',
        actionLabel: `${walkoverKind === 'retired' ? t('admin.tournamentDetail.walkoverModal.resultRetired') : t('admin.tournamentDetail.statusTab.walkoverBadge')}: ${walkoverReason.trim()}`,
        points: 0,
        set: 0,
        server: '',
        serveNumber: 0,
        scoreBefore: { player1: 0, player2: 0 },
        scoreAfter: { player1: 0, player2: 0 },
      };

      const existingHistory = toArray(walkoverMatch.scoreHistory);

      const resultSets = walkoverResultSets(walkoverMatch, walkoverWinnerId);
      const reason = walkoverReason.trim();
      // 경기 포기: 대회 규칙의 처리 방식을 따른다. '규정 불이행 패처럼'이면 부전승으로도 표시해 부전승 규칙으로 집계하고,
      // 그 밖에는 실제 경기로 집계한다(부전승 표시를 지우고 기권 표시만 남긴다).
      const flags = walkoverKind === 'retired'
        ? retirementMatchFlags(resolveCompetitionRules(tournament, walkoverMatch.stageId), reason)
        : { walkover: true as const, walkoverReason: reason, retired: null, retiredReason: null };

      const result = await updateMatch(walkoverMatch.id, {
        status: 'completed',
        winnerId: walkoverWinnerId,
        ...flags,
        sets: resultSets,
        scoreHistory: [...existingHistory, historyEntry],
      });

      // 큐에 저장된 경우 "처리됨"이 아니라 "연결되면 동기화"로 안내. 실패 시 모달 유지.
      const outcome = combineWriteResults([result]);
      if (outcome === 'failed') {
        showError(t('admin.tournamentDetail.statusTab.walkoverError'));
        return;
      }
      notifyWriteOutcome(outcome, t, t(walkoverKind === 'retired' ? 'admin.tournamentDetail.statusTab.retiredProcessed' : 'admin.tournamentDetail.statusTab.walkoverProcessed'));
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
                    <TieDecisionPanel
                      ties={qualifyingTies}
                      nameOf={id => participantName.get(id) || id}
                      groupLabel={scope => qualifyingGroupNames.get(scope) || scope || t('common.competitionRules.tie.league')}
                      updateTournament={updateTournament}
                    />
                    {tournament.type !== 'randomTeamLeague' && (
                      <button className="btn btn-success w-full" onClick={handleAdvanceToFinals} disabled={creatingFinals} aria-busy={creatingFinals} aria-label={t('admin.tournamentDetail.statusTab.createFinalsBracket')}>
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

              {match.status === 'completed' && match.walkover && match.walkoverReason && !match.retired && (
                <div className="text-sm text-orange-300 mt-1">
                  {t('admin.tournamentDetail.statusTab.walkoverReason', { reason: match.walkoverReason })}
                </div>
              )}
              {match.status === 'completed' && match.retired && (
                <div className="text-sm text-orange-300 mt-1">
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-700 text-white mr-2">{t('admin.tournamentDetail.statusTab.retiredBadge')}</span>
                  {match.retiredReason && t('admin.tournamentDetail.statusTab.retiredReason', { reason: match.retiredReason })}
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
                        aria-pressed={walkoverWinnerId === p1Id}
                        aria-label={t('admin.tournamentDetail.walkoverModal.winnerButton', { name: p1Name })}
                      >
                        {t('admin.tournamentDetail.walkoverModal.winnerButton', { name: p1Name })}
                      </button>
                      <button
                        className={`btn flex-1 ${walkoverWinnerId === p2Id ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                        onClick={() => setWalkoverWinnerId(p2Id)}
                        aria-pressed={walkoverWinnerId === p2Id}
                        aria-label={t('admin.tournamentDetail.walkoverModal.winnerButton', { name: p2Name })}
                      >
                        {t('admin.tournamentDetail.walkoverModal.winnerButton', { name: p2Name })}
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>

            <fieldset className="mb-4 space-y-2">
              <legend className="block text-sm font-semibold mb-1">{t('admin.tournamentDetail.walkoverModal.resultLegend')}</legend>
              {(['forfeit', 'retired'] as const).map(kind => (
                <label key={kind} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="walkover-result-kind"
                    className="mt-1 w-5 h-5"
                    value={kind}
                    checked={walkoverKind === kind}
                    onChange={() => setWalkoverKind(kind)}
                    aria-describedby={`walkover-kind-${kind}-help`}
                  />
                  <span>
                    <span className="font-semibold block">{t(kind === 'forfeit' ? 'admin.tournamentDetail.walkoverModal.resultForfeit' : 'admin.tournamentDetail.walkoverModal.resultRetired')}</span>
                    <span id={`walkover-kind-${kind}-help`} className="text-gray-400 text-xs">{t(kind === 'forfeit' ? 'admin.tournamentDetail.walkoverModal.resultForfeitHelp' : 'admin.tournamentDetail.walkoverModal.resultRetiredHelp')}</span>
                  </span>
                </label>
              ))}
              {walkoverWinnerId && (
                <p className="text-sm text-cyan-300" aria-live="polite">
                  {t('admin.tournamentDetail.walkoverModal.retiredPreview', {
                    sets: walkoverResultSets(walkoverMatch, walkoverWinnerId).map(s => `${s.player1Score}:${s.player2Score}`).join(', '),
                  })}
                </p>
              )}
            </fieldset>

            <div className="mb-4">
              <label htmlFor="walkover-reason" className="block text-sm font-semibold mb-1">{t('admin.tournamentDetail.walkoverModal.reasonLabel')}</label>
              <input
                id="walkover-reason"
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
