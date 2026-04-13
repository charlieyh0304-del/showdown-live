import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { showWarning } from '@shared/utils/toast';
import { showConfirm } from '@shared/utils/confirm';
import {
  useTournament,
  useMatches,
  usePlayers,
  useTournamentLocalPlayers,
  useTeams,
  useReferees,
  useCourts,
  useSchedule,
} from '@shared/hooks/useFirebase';
import { simulateTournament } from '@shared/utils/simulation';
import { getSampleNames } from './AdminSettings';
import PlayersTab from '../components/tournament-detail/PlayersTab';
import BracketTab from '../components/tournament-detail/BracketTab';
import ScheduleTab from '../components/tournament-detail/ScheduleTab';
import StatusTab from '../components/tournament-detail/StatusTab';
import RankingTab from '../components/tournament-detail/RankingTab';

import type { Match } from '@shared/types';

type TabKey = 'players' | 'bracket' | 'schedule' | 'status' | 'ranking';

const TAB_KEYS: { key: TabKey; labelKey: string }[] = [
  { key: 'players', labelKey: 'admin.tournamentDetail.tabs.players' },
  { key: 'bracket', labelKey: 'admin.tournamentDetail.tabs.bracket' },
  { key: 'schedule', labelKey: 'admin.tournamentDetail.tabs.schedule' },
  { key: 'status', labelKey: 'admin.tournamentDetail.tabs.status' },
  { key: 'ranking', labelKey: 'admin.tournamentDetail.tabs.ranking' },
];

export default function TournamentDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('players');
  const [simulating, setSimulating] = useState(false);
  const [simProgress, setSimProgress] = useState('');
  const [simCount, setSimCount] = useState<number | ''>('');
  const [simCountInitialized, setSimCountInitialized] = useState(false);
  const [simAutoBracket, setSimAutoBracket] = useState(true);
  const [simAutoReferee, setSimAutoReferee] = useState(true);
  const [simAutoCourt, setSimAutoCourt] = useState(true);

  const { tournament, loading: tLoading, updateTournament } = useTournament(id ?? null);
  const { matches, loading: mLoading, setMatchesBulk, updateMatch, updateMatchesBulk, addMatch, deleteMatch } = useMatches(id ?? null);
  const { players: globalPlayers, loading: gpLoading } = usePlayers();
  const { players: tournamentPlayers, loading: tpLoading, addPlayer: addTournamentPlayer, deletePlayer: deleteTournamentPlayer, addPlayersFromGlobal } = useTournamentLocalPlayers(id ?? null);
  const { teams, setTeamsBulk } = useTeams(id ?? null);
  const { referees, addReferee, updateReferee } = useReferees();
  const { courts, addCourt } = useCourts();
  const { schedule, setScheduleBulk, updateScheduleSlot } = useSchedule(id ?? null);

  // 대회 설정에서 기본 참가자 수 추론 (tournament 로드 후 1회) - 빈 값 유지, 힌트만 제공
  useEffect(() => {
    if (!tournament || simCountInitialized) return;
    setSimCountInitialized(true);
  }, [tournament, simCountInitialized]);

  if (tLoading || mLoading || gpLoading || tpLoading) {
    return (
      <div className="flex items-center justify-center py-20" aria-live="polite">
        <p className="text-2xl text-yellow-400 animate-pulse">{t('common.loading')}</p>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl text-red-500">{t('admin.tournamentDetail.notFound')}</p>
        <button className="btn btn-primary mt-4" onClick={() => navigate('/admin')} aria-label={t('admin.tournamentDetail.backToDashboard')}>
          {t('admin.tournamentDetail.backToDashboard')}
        </button>
      </div>
    );
  }

  const isTeamType = tournament.type === 'team' || tournament.type === 'randomTeamLeague';

  const handleSimulate = async () => {
    if (!tournament) return;
    const hasExistingPlayers = tournamentPlayers.length > 0;
    const hasExistingReferees = referees.length > 0;
    const hasExistingTeams = isTeamType && teams.length > 0;
    // 팀전+기존팀: 팀 수가 곧 참가 단위. 선수 수는 시뮬레이션에 불필요.
    const effectiveSimCount = typeof simCount === 'number' ? simCount : 0;
    const playerCount = hasExistingTeams
      ? teams.length
      : (hasExistingPlayers ? tournamentPlayers.length : effectiveSimCount);

    if (!hasExistingTeams && !hasExistingPlayers && (!effectiveSimCount || effectiveSimCount < 2)) {
      showWarning(isTeamType ? t('admin.tournamentDetail.simulation.enterTeamCount') : t('admin.tournamentDetail.simulation.enterPlayerCount'));
      return;
    }

    const msgParts = [
      t('admin.tournamentDetail.simulationConfirm.intro'),
      hasExistingTeams
        ? t('admin.tournamentDetail.simulationConfirm.existingTeams', { count: teams.length })
        : hasExistingPlayers
          ? t('admin.tournamentDetail.simulationConfirm.existingPlayers', { count: playerCount })
          : t('admin.tournamentDetail.simulationConfirm.virtualPlayers', { count: playerCount }),
      simAutoReferee
        ? (hasExistingReferees
          ? t('admin.tournamentDetail.simulationConfirm.existingReferees', { count: referees.length })
          : t('admin.tournamentDetail.simulationConfirm.virtualReferees'))
        : t('admin.tournamentDetail.simulationConfirm.refereeOff'),
      simAutoCourt
        ? t('admin.tournamentDetail.simulationConfirm.courtOn')
        : t('admin.tournamentDetail.simulationConfirm.courtOff'),
      t('admin.tournamentDetail.simulationConfirm.dataReset'),
      t('admin.tournamentDetail.simulationConfirm.rulesKept'),
      t('admin.tournamentDetail.simulationConfirm.confirmContinue'),
    ];
    if (!await showConfirm({ message: msgParts.join('\n') })) return;

    setSimulating(true);
    try {
      setSimProgress(t('admin.tournamentDetail.simulation.generatingData'));
      const sampleNames = getSampleNames();
      const result = simulateTournament(tournament, playerCount, {
        // 팀전+기존팀: 선수 정보는 팀에 포함되어 있으므로 별도 전달 불필요
        existingPlayers: (!hasExistingTeams && hasExistingPlayers) ? tournamentPlayers.map(p => ({ id: p.id, name: p.name })) : undefined,
        existingTeams: hasExistingTeams ? teams.map(t => ({ id: t.id, name: t.name, memberIds: t.memberIds || [], memberNames: t.memberNames || [] })) : undefined,
        existingReferees: hasExistingReferees ? referees.map(r => ({ id: r.id, name: r.name })) : undefined,
        existingCourts: simAutoCourt && courts.length > 0 ? courts.map(c => ({ id: c.id, name: c.name })) : undefined,
        samplePlayerNames: sampleNames.players.length > 0 ? sampleNames.players : undefined,
        sampleRefereeNames: sampleNames.referees.length > 0 ? sampleNames.referees : undefined,
      });

      // 기존 선수/팀이 없을 때만 새로 등록 + ID 매핑 구축
      const playerIdMap = new Map<string, string>();
      if (!hasExistingPlayers && !hasExistingTeams) {
        setSimProgress(t('admin.tournamentDetail.simulation.registeringPlayers', { count: result.players.length }));
        for (const player of result.players) {
          const newId = await addTournamentPlayer({ name: player.name });
          if (newId) playerIdMap.set(player.id, newId);
        }
      }

      if (result.teams && result.teams.length > 0 && !hasExistingTeams) {
        setSimProgress(t('admin.tournamentDetail.simulation.creatingTeams', { count: result.teams.length }));
        // 팀의 memberIds를 실제 Firebase ID로 교체
        const remappedTeams = playerIdMap.size > 0
          ? result.teams.map(t => ({
              ...t,
              id: `sim_team_${t.id.replace('sim_team_', '')}`,
              memberIds: t.memberIds.map(id => playerIdMap.get(id) || id),
            }))
          : result.teams;
        await setTeamsBulk(remappedTeams);
      }

      // === 코트 ID 매핑 (기존 코트가 있으면 매핑, 없으면 가상 코트 생성) ===
      const courtIdMap = new Map<string, string>();
      if (simAutoCourt) {
        if (courts.length > 0) {
          // 기존 코트가 있으면 sim_court_* → 실제 코트 ID로 매핑
          courts.forEach((court, idx) => {
            courtIdMap.set(`sim_court_${idx + 1}`, court.id);
          });
        } else {
          setSimProgress(t('admin.tournamentDetail.simulation.creatingCourts'));
          for (const simCourt of [{ simId: 'sim_court_1', name: t('admin.tournamentDetail.simulation.courtName', { number: 1 }) }, { simId: 'sim_court_2', name: t('admin.tournamentDetail.simulation.courtName', { number: 2 }) }]) {
            const newId = await addCourt({ name: simCourt.name, assignedReferees: [] });
            if (newId) courtIdMap.set(simCourt.simId, newId);
          }
        }
      }

      // === 가상 심판 생성 (기존 심판이 없을 때, 경기 저장 전) ===
      const refIdMap = new Map<string, string>();
      if (simAutoReferee && referees.length === 0 && result.referees && result.referees.length > 0) {
        setSimProgress(t('admin.tournamentDetail.simulation.creatingReferees', { count: result.referees.length }));
        for (const simRef of result.referees) {
          const newId = await addReferee({ name: simRef.name, role: 'main', assignedMatchIds: [] });
          if (newId) refIdMap.set(simRef.id, newId);
        }
      }

      // === 경기 데이터에서 sim_ ID를 실제 Firebase ID로 교체 후 저장 ===
      setSimProgress(t('admin.tournamentDetail.simulation.creatingMatches', { count: result.matches.length }));
      const remapId = (id: string | null | undefined): string | undefined => {
        if (!id) return undefined;
        return playerIdMap.get(id) || id;
      };
      // courtIdMap에서 sim_court_* → 실제 Firebase ID로 변환
      const courtNameMap = new Map<string, string>();
      if (simAutoCourt && courts.length > 0) {
        courts.forEach((court, idx) => {
          courtNameMap.set(`sim_court_${idx + 1}`, court.name);
        });
      }
      const remapCourtId = (id: string | undefined): string | undefined => {
        if (!simAutoCourt || !id) return undefined;
        return courtIdMap.get(id) || id;
      };
      const remapCourtName = (m: Omit<Match, 'id'>): string | undefined => {
        if (!simAutoCourt) return undefined;
        return courtNameMap.get(m.courtId || '') || m.courtName;
      };
      // Build matchId → schedule time mapping for match objects
      const matchScheduleMap = new Map<string, { scheduledTime?: string; scheduledDate?: string }>();
      if (result.schedule) {
        result.schedule.forEach(slot => {
          matchScheduleMap.set(slot.matchId, {
            scheduledTime: slot.scheduledTime,
            scheduledDate: slot.scheduledDate,
          });
        });
      }
      const remappedMatches = result.matches.map((m, idx) => {
        const schedInfo = matchScheduleMap.get(`sim_match_${idx}`);
        return {
          ...m,
          player1Id: remapId(m.player1Id),
          player2Id: remapId(m.player2Id),
          winnerId: remapId(m.winnerId),
          courtId: remapCourtId(m.courtId),
          courtName: remapCourtName(m),
          refereeId: simAutoReferee ? (refIdMap.get(m.refereeId || '') || m.refereeId) : undefined,
          refereeName: simAutoReferee ? m.refereeName : undefined,
          scheduledTime: schedInfo?.scheduledTime,
          scheduledDate: schedInfo?.scheduledDate,
        };
      });
      const actualMatchIds = await setMatchesBulk(remappedMatches);

      // sim_match_X → 실제 Firebase ID 매핑
      const matchIdMap = new Map<string, string>();
      result.matches.forEach((_, idx) => {
        matchIdMap.set(`sim_match_${idx}`, actualMatchIds[idx]);
      });

      // === 스케줄 저장 (matchId/courtId를 실제 Firebase ID로 교체) ===
      if (result.schedule && result.schedule.length > 0) {
        setSimProgress(t('admin.tournamentDetail.simulation.savingSchedule', { count: result.schedule.length }));
        const remappedSchedule = result.schedule.map(slot => ({
          ...slot,
          matchId: matchIdMap.get(slot.matchId) || slot.matchId,
          courtId: simAutoCourt ? (courtIdMap.get(slot.courtId) || slot.courtId) : '',
          courtName: simAutoCourt ? (courtNameMap.get(slot.courtId) || slot.courtName) : '',
        }));
        await setScheduleBulk(remappedSchedule);
      }

      // === 심판 배정 업데이트 (실제 match ID로, 타임아웃 포함) ===
      const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
        Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
      try {
        if (simAutoReferee) {
          if (referees.length > 0) {
            const refAssignments = referees.map(r => ({ id: r.id, assignedMatchIds: [] as string[] }));
            actualMatchIds.forEach((matchId, idx) => {
              const refIdx = idx % refAssignments.length;
              refAssignments[refIdx].assignedMatchIds.push(matchId);
            });
            setSimProgress(t('admin.tournamentDetail.simulation.savingRefereeAssignment', { count: referees.length }));
            await withTimeout(
              Promise.all(refAssignments.map(ra => updateReferee(ra.id, { assignedMatchIds: ra.assignedMatchIds }))),
              10000,
            );
          } else if (result.referees && result.referees.length > 0) {
            setSimProgress(t('admin.tournamentDetail.simulation.savingAssignment'));
            const refPromises = result.referees
              .map(simRef => {
                const realRefId = refIdMap.get(simRef.id);
                if (!realRefId) return null;
                const remappedIds = simRef.assignedMatchIds.map(id => matchIdMap.get(id) || id);
                return updateReferee(realRefId, { assignedMatchIds: remappedIds });
              })
              .filter(Boolean);
            await withTimeout(Promise.all(refPromises), 10000);
          }
        }
      } catch (refErr) {
        console.error('심판 배정 오류:', refErr);
        setSimProgress('⚠️ 심판 자동 배정 실패 — 경기는 계속 진행됩니다');
      }

      setSimProgress(t('admin.tournamentDetail.simulation.updatingStatus'));
      // 모든 경기가 completed이면 대회 완료, 아니면 in_progress
      const allCompleted = result.matches.every(m => m.status === 'completed');
      await updateTournament({ status: allCompleted ? 'completed' : 'in_progress' });

      setSimProgress(t('admin.tournamentDetail.simulation.completed', { count: result.matches.length, status: allCompleted ? t('common.tournamentStatus.completed') : t('common.tournamentStatus.inProgress') }));
      // 10초 후 메시지 클리어
      setTimeout(() => setSimProgress(''), 10000);
    } catch (err) {
      console.error('시뮬레이션 오류:', err);
      setSimProgress(t('admin.tournamentDetail.simulation.error'));
      // 에러 발생해도 대회 상태는 in_progress로 업데이트 시도
      try {
        await updateTournament({ status: 'in_progress' });
      } catch (statusErr) {
        console.error('상태 업데이트 실패:', statusErr);
      }
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-yellow-400">{tournament.name}</h1>
        <p className="text-gray-400">{tournament.date}{tournament.endDate ? ` ~ ${tournament.endDate}` : ''} | {tournament.type === 'individual' ? t('admin.tournamentDetail.header.typeIndividual') : tournament.type === 'team' ? t('admin.tournamentDetail.header.typeTeam') : t('admin.tournamentDetail.header.typeRandomTeamLeague')}</p>
        {tournament.scheduleDates && tournament.scheduleDates.length > 0 && (
          <p className="text-gray-500 text-sm">{t('admin.tournamentDetail.header.scheduleDates')}: {tournament.scheduleDates.join(', ')}</p>
        )}
        <button className="btn btn-secondary" onClick={() => navigate('/admin')} aria-label={t('common.back')}>
          {t('common.back')}
        </button>
      </div>

      {tournament.status === 'draft' && (
        <div className="card bg-purple-900/30 border-purple-500 p-4">
          <h3 className="text-lg font-bold text-purple-400 mb-2 text-center">{t('admin.tournamentDetail.simulation.title')}</h3>
          <p className="text-gray-400 text-sm mb-4">{t('admin.tournamentDetail.simulation.description')}</p>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {isTeamType ? t('admin.tournamentDetail.simulation.teamCount') : t('admin.tournamentDetail.simulation.playerCount')}
            </label>
            <input
              type="number"
              className="input w-full"
              value={simCount}
              min={2}
              max={64}
              placeholder={isTeamType ? t('admin.tournamentDetail.simulation.teamCountPlaceholder') : t('admin.tournamentDetail.simulation.playerCountPlaceholder')}
              onChange={e => setSimCount(e.target.value === '' ? '' : Number(e.target.value))}
              aria-label={isTeamType ? t('admin.tournamentDetail.simulation.teamCount') : t('admin.tournamentDetail.simulation.playerCount')}
            />
            {isTeamType && (
              <p className="text-xs text-gray-400 mt-1">{t('admin.tournamentDetail.simulation.existingTeamNote')}</p>
            )}
          </div>
          <div className="space-y-3 mb-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={simAutoBracket}
                onChange={e => setSimAutoBracket(e.target.checked)}
                className="mt-1 w-4 h-4 accent-purple-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-200">{t('admin.tournamentDetail.simulation.autoBracket')}</span>
                <p className="text-xs text-gray-400">{t('admin.tournamentDetail.simulation.autoBracketDescription')}</p>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={simAutoReferee}
                onChange={e => setSimAutoReferee(e.target.checked)}
                className="mt-1 w-4 h-4 accent-purple-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-200">{t('admin.tournamentDetail.simulation.autoReferee')}</span>
                <p className="text-xs text-gray-400">{t('admin.tournamentDetail.simulation.autoRefereeDescription')}</p>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={simAutoCourt}
                onChange={e => setSimAutoCourt(e.target.checked)}
                className="mt-1 w-4 h-4 accent-purple-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-200">{t('admin.tournamentDetail.simulation.autoCourt')}</span>
                <p className="text-xs text-gray-400">{t('admin.tournamentDetail.simulation.autoCourtDescription')}</p>
              </div>
            </label>
          </div>
          {simProgress && (
            <p className={`text-sm mb-2 font-semibold ${simProgress.includes(t('common.done')) || simProgress.includes('!') ? 'text-green-400 text-base' : simProgress.includes(t('admin.tournamentDetail.simulation.error')) ? 'text-red-400' : 'text-cyan-400'}`} role="status" aria-live="polite">
              {simProgress}
            </p>
          )}
          <button
            className="btn bg-purple-700 hover:bg-purple-600 text-white w-full"
            onClick={handleSimulate}
            disabled={simulating}
            aria-label={t('admin.tournamentDetail.simulation.runAriaLabel')}
          >
            {simulating ? t('admin.tournamentDetail.simulation.running') : t('admin.tournamentDetail.simulation.runButton')}
          </button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap justify-center border-b border-gray-700 pb-2" role="tablist" aria-label={t('admin.tournamentDetail.tabListAriaLabel')} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const idx = TAB_KEYS.findIndex(tk => tk.key === activeTab); const next = e.key === 'ArrowRight' ? (idx + 1) % TAB_KEYS.length : (idx - 1 + TAB_KEYS.length) % TAB_KEYS.length; setActiveTab(TAB_KEYS[next].key); e.currentTarget.querySelector<HTMLElement>(`#tab-${TAB_KEYS[next].key}`)?.focus(); } }}>
        {TAB_KEYS.map(tab => (
          <button
            key={tab.key}
            id={`tab-${tab.key}`}
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`tabpanel-${tab.key}`}
            tabIndex={activeTab === tab.key ? 0 : -1}
            className={`nav-link ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div id={`tabpanel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
        {activeTab === 'players' && (
          <PlayersTab
            tournament={tournament}
            tournamentPlayers={tournamentPlayers}
            globalPlayers={globalPlayers}
            addTournamentPlayer={addTournamentPlayer}
            deleteTournamentPlayer={deleteTournamentPlayer}
            addPlayersFromGlobal={addPlayersFromGlobal}
            updateTournament={updateTournament}
            isTeamType={isTeamType}
            teams={teams}
            setTeamsBulk={setTeamsBulk}
          />
        )}
        {activeTab === 'bracket' && (
          <BracketTab
            tournament={tournament}
            matches={matches}
            tournamentPlayers={tournamentPlayers}
            teams={teams}
            setMatchesBulk={setMatchesBulk}
            updateMatch={updateMatch}
            addMatch={addMatch}
            deleteMatch={deleteMatch}
            updateTournament={updateTournament}
            referees={referees}
            courts={courts}
            isTeamType={isTeamType}
          />
        )}
        {activeTab === 'schedule' && (
          <ScheduleTab
            tournament={tournament}
            matches={matches}
            courts={courts}
            referees={referees}
            schedule={schedule}
            setScheduleBulk={setScheduleBulk}
            updateMatch={updateMatch}
            updateMatchesBulk={updateMatchesBulk}
            updateScheduleSlot={updateScheduleSlot}
            participantCount={isTeamType ? teams.length : tournamentPlayers.length}
          />
        )}
        {activeTab === 'status' && (
          <StatusTab
            tournament={tournament}
            matches={matches}
            updateTournament={updateTournament}
            updateMatch={updateMatch}
            isTeamType={isTeamType}
            tournamentPlayers={tournamentPlayers}
            teams={teams}
          />
        )}
        {activeTab === 'ranking' && (
          <RankingTab
            tournament={tournament}
            matches={matches}
            isTeamType={isTeamType}
          />
        )}
      </div>
    </div>
  );
}

