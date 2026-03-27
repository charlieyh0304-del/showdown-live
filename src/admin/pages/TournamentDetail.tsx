import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import { push, set, ref } from 'firebase/database';
import { database } from '@shared/config/firebase';
import { createEmptySet, checkMatchWinner, checkSetWinner, getEffectiveGameConfig } from '@shared/utils/scoring';
import { calculateIndividualRanking, calculateTeamRanking } from '@shared/utils/ranking';
import { exportResultsCSV, downloadCSV } from '@shared/utils/export';
import PdfDownloadButton from '@shared/components/PdfDownloadButton';
import { simulateTournament } from '@shared/utils/simulation';
import { buildGroupAssignment } from '@shared/utils/tournament';
import { getSampleNames } from './AdminSettings';
import type { Match, Team, Player, MatchStatus, ScheduleSlot, SeedEntry, StageGroup, SetScore, ScoreHistoryEntry }  from '@shared/types';


// Firebase can return arrays as objects with numeric keys; ensure we always get an array
function toArray<T>(val: T[] | Record<string, T> | undefined | null): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [];
}

type TabKey = 'players' | 'bracket' | 'schedule' | 'status' | 'ranking';

const TAB_KEYS: { key: TabKey; labelKey: string }[] = [
  { key: 'players', labelKey: 'admin.tournamentDetail.tabs.players' },
  { key: 'bracket', labelKey: 'admin.tournamentDetail.tabs.bracket' },
  { key: 'schedule', labelKey: 'admin.tournamentDetail.tabs.schedule' },
  { key: 'status', labelKey: 'admin.tournamentDetail.tabs.status' },
  { key: 'ranking', labelKey: 'admin.tournamentDetail.tabs.ranking' },
];

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
  const { matches, loading: mLoading, setMatchesBulk, updateMatch, addMatch, deleteMatch } = useMatches(id ?? null);
  const { players: globalPlayers, loading: gpLoading } = usePlayers();
  const { players: tournamentPlayers, loading: tpLoading, addPlayer: addTournamentPlayer, deletePlayer: deleteTournamentPlayer, addPlayersFromGlobal } = useTournamentLocalPlayers(id ?? null);
  const { teams, setTeamsBulk } = useTeams(id ?? null);
  const { referees, addReferee, updateReferee } = useReferees();
  const { courts, addCourt } = useCourts();
  const { schedule, setScheduleBulk } = useSchedule(id ?? null);

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
      alert(isTeamType ? t('admin.tournamentDetail.simulation.enterTeamCount') : t('admin.tournamentDetail.simulation.enterPlayerCount'));
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
    if (!confirm(msgParts.join('\n'))) return;

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
        console.error('심판 배정 오류 (무시하고 계속):', refErr);
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
      } catch { /* ignore */ }
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-yellow-400">{tournament.name}</h1>
          <p className="text-gray-400 mt-1">{tournament.date}{tournament.endDate ? ` ~ ${tournament.endDate}` : ''} | {tournament.type === 'individual' ? t('admin.tournamentDetail.header.typeIndividual') : tournament.type === 'team' ? t('admin.tournamentDetail.header.typeTeam') : t('admin.tournamentDetail.header.typeRandomTeamLeague')}</p>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate('/admin')} aria-label={t('common.back')}>
          {t('common.back')}
        </button>
      </div>

      {tournament.status === 'draft' && (
        <div className="card bg-purple-900/30 border-purple-500 p-4">
          <h3 className="text-lg font-bold text-purple-400 mb-2">{t('admin.tournamentDetail.simulation.title')}</h3>
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

      <div className="flex gap-2 flex-wrap border-b border-gray-700 pb-2" role="tablist" aria-label={t('admin.tournamentDetail.tabListAriaLabel')} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const idx = TAB_KEYS.findIndex(tk => tk.key === activeTab); const next = e.key === 'ArrowRight' ? (idx + 1) % TAB_KEYS.length : (idx - 1 + TAB_KEYS.length) % TAB_KEYS.length; setActiveTab(TAB_KEYS[next].key); e.currentTarget.querySelector<HTMLElement>(`#tab-${TAB_KEYS[next].key}`)?.focus(); } }}>
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
            matches={matches}
            courts={courts}
            referees={referees}
            schedule={schedule}
            setScheduleBulk={setScheduleBulk}
            updateMatch={updateMatch}
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

// ========================
// 한글 IME 안전 입력 컴포넌트
// React DOM 트리 완전 우회 - 순수 native DOM으로 input 생성
// React의 이벤트 위임/값 추적이 input에 전혀 개입하지 않음
// ========================
function KoreanNameInput({ onSubmit, placeholder, ariaLabel }: {
  onSubmit: (name: string, gender: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const { t: tFn } = useTranslation();
  const tRef = useRef(tFn);
  tRef.current = tFn;
  const containerRef = useRef<HTMLDivElement>(null);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 순수 DOM 생성 - React가 전혀 모르는 요소들
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.gap = '4px';

    const input = document.createElement('input');
    input.className = 'input';
    input.style.flex = '1';
    input.style.fontSize = '0.875rem';
    const t = tRef.current;
    input.placeholder = placeholder || t('admin.tournamentDetail.koreanInput.playerNamePlaceholder');
    if (ariaLabel) input.setAttribute('aria-label', ariaLabel);

    const select = document.createElement('select');
    select.className = 'input';
    select.style.width = '64px';
    select.style.fontSize = '0.875rem';
    select.setAttribute('aria-label', t('admin.tournamentDetail.koreanInput.genderAriaLabel'));
    select.innerHTML = `<option value="">${t('admin.tournamentDetail.koreanInput.genderLabel')}</option><option value="male">${t('admin.tournamentDetail.koreanInput.genderMale')}</option><option value="female">${t('admin.tournamentDetail.koreanInput.genderFemale')}</option>`;

    const btn = document.createElement('button');
    btn.className = 'btn btn-success';
    btn.style.fontSize = '0.875rem';
    btn.style.padding = '0.5rem 0.75rem';
    btn.textContent = '+';
    btn.type = 'button';
    btn.setAttribute('aria-label', t('admin.tournamentDetail.koreanInput.addPlayerAriaLabel'));

    let composing = false;

    const submit = () => {
      const name = input.value.trim();
      if (!name) return;
      onSubmitRef.current(name, select.value || '');
      input.value = '';
      select.value = '';
      input.focus();
    };

    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !composing) submit();
    });
    btn.addEventListener('click', submit);

    wrapper.appendChild(input);
    wrapper.appendChild(select);
    wrapper.appendChild(btn);
    container.appendChild(wrapper);

    return () => { container.innerHTML = ''; };
  }, []); // 마운트 1회만

  return <div ref={containerRef} />;
}

// ========================
// Players Tab
// ========================
interface PlayersTabProps {
  tournament: NonNullable<ReturnType<typeof useTournament>['tournament']>;
  tournamentPlayers: Player[];
  globalPlayers: Player[];
  addTournamentPlayer: (player: Omit<Player, 'id' | 'createdAt'>) => Promise<string | null>;
  deleteTournamentPlayer: (id: string) => Promise<void>;
  addPlayersFromGlobal: (players: Player[]) => Promise<void>;
  updateTournament: (data: Record<string, unknown>) => Promise<boolean | void>;
  isTeamType: boolean;
  teams: Team[];
  setTeamsBulk: (teams: Team[]) => Promise<void>;
}

function PlayersTab({ tournament, tournamentPlayers, globalPlayers, addTournamentPlayer, deleteTournamentPlayer, addPlayersFromGlobal, updateTournament, isTeamType, teams, setTeamsBulk }: PlayersTabProps) {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  const [showGlobalModal, setShowGlobalModal] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerGender, setNewPlayerGender] = useState<'' | 'male' | 'female'>('');
  const [bulkNames, setBulkNames] = useState('');
  const [selectedGlobalIds, setSelectedGlobalIds] = useState<string[]>([]);
  const [seeds, setSeeds] = useState<SeedEntry[]>(toArray(tournament.seeds));
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  // 팀별 설정 편집용 로컬 state (Firebase 즉시 쓰기 대신 로컬에서 편집 후 저장)
  const [editCoachName, setEditCoachName] = useState('');
  const [editMaxReserves, setEditMaxReserves] = useState<string>('');
  const [editGenderMale, setEditGenderMale] = useState<string>('');
  const [editGenderFemale, setEditGenderFemale] = useState<string>('');

  // 편집 모드 진입 시 현재 값 로드
  const startEditing = useCallback((teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    setEditCoachName(team.coachName ?? '');
    setEditMaxReserves(team.maxReserves != null ? String(team.maxReserves) : '');
    setEditGenderMale(team.genderRatio?.male != null ? String(team.genderRatio.male) : '');
    setEditGenderFemale(team.genderRatio?.female != null ? String(team.genderRatio.female) : '');
    setEditingTeamId(teamId);
  }, [teams]);

  // 편집 저장
  const saveTeamSettings = useCallback(async () => {
    if (!editingTeamId) return;
    const male = editGenderMale === '' ? undefined : Number(editGenderMale);
    const female = editGenderFemale === '' ? undefined : Number(editGenderFemale);
    const newRatio = (male == null && female == null) ? undefined : { male: male ?? 0, female: female ?? 0 };
    const updated = teams.map(t => t.id !== editingTeamId ? t : {
      ...t,
      coachName: editCoachName || undefined,
      maxReserves: editMaxReserves === '' ? undefined : Number(editMaxReserves),
      genderRatio: newRatio,
    });
    await setTeamsBulk(updated);
    setEditingTeamId(null);
  }, [editingTeamId, editCoachName, editMaxReserves, editGenderMale, editGenderFemale, teams, setTeamsBulk]);
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamCoach, setNewTeamCoach] = useState('');
  const [newTeamMembers, setNewTeamMembers] = useState<{ name: string; gender: '' | 'male' | 'female' }[]>([]);
  const composingRef = useRef(false);
  const isManualTeam = tournament.type === 'team';

  const openAddTeamModal = useCallback(() => {
    setNewTeamName('');
    setNewTeamCoach('');
    setNewTeamMembers([]);
    setShowAddTeamModal(true);
  }, []);

  const handleAddTeamFromModal = useCallback(async () => {
    const nextIdx = teams.length + 1;
    const name = newTeamName.trim() || t('admin.tournamentDetail.playersTabInline.defaultTeamName', { idx: nextIdx });
    // 모달에서 입력한 멤버들을 선수로 등록하면서 팀에 추가
    const memberIds: string[] = [];
    const memberNames: string[] = [];
    for (const m of newTeamMembers) {
      const id = await addTournamentPlayer({ name: m.name, gender: m.gender || undefined });
      if (id) {
        memberIds.push(id);
        memberNames.push(m.name);
      }
    }
    const newTeam: Team = {
      id: `team_${Date.now()}`,
      name,
      memberIds,
      memberNames,
      ...(newTeamCoach.trim() ? { coachName: newTeamCoach.trim() } : {}),
    };
    await setTeamsBulk([...teams, newTeam]);
    setShowAddTeamModal(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [teams, newTeamName, newTeamMembers, addTournamentPlayer, setTeamsBulk]);

  const handleDeleteTeam = useCallback(async (teamId: string) => {
    if (!confirm(t('admin.tournamentDetail.playersTabInline.deleteTeamConfirm'))) return;
    await setTeamsBulk(teams.filter(t => t.id !== teamId));
  }, [teams, setTeamsBulk]);


  const handleRemoveMemberFromTeam = useCallback(async (memberId: string, teamId: string) => {
    const updated = teams.map(t => {
      if (t.id !== teamId) return t;
      const idx = (t.memberIds || []).indexOf(memberId);
      if (idx === -1) return t;
      return {
        ...t,
        memberIds: (t.memberIds || []).filter((_, i) => i !== idx),
        memberNames: (t.memberNames || []).filter((_, i) => i !== idx),
      };
    });
    await setTeamsBulk(updated);
  }, [teams, setTeamsBulk]);

  const toggleSeed = (playerId: string, name: string) => {
    const existing = seeds.findIndex(s => s.playerId === playerId);
    if (existing >= 0) {
      setSeeds(seeds.filter((_, i) => i !== existing));
    } else {
      setSeeds([...seeds, { position: seeds.length + 1, playerId, name }]);
    }
  };

  const saveSeeds = async () => {
    await updateTournament({ seeds });
  };

  const handleAddPlayer = useCallback(async () => {
    if (!newPlayerName.trim()) return;
    await addTournamentPlayer({ name: newPlayerName.trim(), gender: newPlayerGender || undefined });
    setNewPlayerName('');
    setNewPlayerGender('');
  }, [newPlayerName, newPlayerGender, addTournamentPlayer]);

  const handleBulkAdd = useCallback(async () => {
    const names = bulkNames.split('\n').map(n => n.trim()).filter(n => n);
    for (const name of names) {
      await addTournamentPlayer({ name });
    }
    setBulkNames('');
  }, [bulkNames, addTournamentPlayer]);

  const handleImportGlobal = useCallback(async () => {
    const toImport = globalPlayers.filter(p => selectedGlobalIds.includes(p.id));
    if (toImport.length === 0) return;
    await addPlayersFromGlobal(toImport);
    setSelectedGlobalIds([]);
    setShowGlobalModal(false);
  }, [globalPlayers, selectedGlobalIds, addPlayersFromGlobal]);

  const toggleGlobalSelect = useCallback((playerId: string) => {
    setSelectedGlobalIds(prev =>
      prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]
    );
  }, []);

  const generateRandomTeams = useCallback(async () => {
    if (tournamentPlayers.length < 3) return;
    setGenerating(true);
    try {
      const teamSize = tournament.teamRules?.teamSize || 3;
      const genderRatio = tournament.teamRules?.genderRatio;

      if (genderRatio && (genderRatio.male > 0 || genderRatio.female > 0)) {
        const males = tournamentPlayers.filter(p => p.gender === 'male');
        const females = tournamentPlayers.filter(p => p.gender === 'female');
        const teamCount = Math.floor(tournamentPlayers.length / teamSize);
        const requiredMales = genderRatio.male * teamCount;
        const requiredFemales = genderRatio.female * teamCount;

        if (males.length < requiredMales || females.length < requiredFemales) {
          alert(t('admin.tournamentDetail.playersTabInline.genderShortageAlert', { requiredMale: requiredMales, requiredFemale: requiredFemales, currentMale: males.length, currentFemale: females.length }));
          setGenerating(false);
          return;
        }

        const shuffledMales = [...males].sort(() => Math.random() - 0.5);
        const shuffledFemales = [...females].sort(() => Math.random() - 0.5);

        const newTeams: Team[] = [];
        for (let i = 0; i < teamCount; i++) {
          const members = [
            ...shuffledMales.splice(0, genderRatio.male),
            ...shuffledFemales.splice(0, genderRatio.female),
          ];
          newTeams.push({
            id: `team_${i + 1}`,
            name: t('admin.tournamentDetail.playersTabInline.defaultTeamName', { idx: i + 1 }),
            memberIds: members.map(m => m.id),
            memberNames: members.map(m => m.name),
          });
        }
        await setTeamsBulk(newTeams);
      } else {
        const shuffled = [...tournamentPlayers].sort(() => Math.random() - 0.5);
        const newTeams: Team[] = [];
        let teamIdx = 1;
        for (let i = 0; i < shuffled.length; i += teamSize) {
          const members = shuffled.slice(i, i + teamSize);
          if (members.length === 0) continue;
          newTeams.push({
            id: `team_${teamIdx}`,
            name: t('admin.tournamentDetail.playersTabInline.defaultTeamName', { idx: teamIdx }),
            memberIds: members.map(m => m.id),
            memberNames: members.map(m => m.name),
          });
          teamIdx++;
        }
        await setTeamsBulk(newTeams);
      }
    } finally {
      setGenerating(false);
    }
  }, [tournamentPlayers, tournament.teamRules, setTeamsBulk]);

  return (
    <div className="space-y-6">
      {/* 개인전 또는 랜덤 팀리그: 전역 선수 등록 */}
      {!isManualTeam && (
      <div className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h2 className="text-xl font-bold">{t('admin.tournamentDetail.playersTab.tournamentPlayers')} ({tournamentPlayers.length}{t('common.units.person')})</h2>
          <button
            className="btn btn-secondary"
            onClick={() => setShowGlobalModal(true)}
            aria-label={t('admin.tournamentDetail.playersTab.importFromGlobal')}
          >
            {t('admin.tournamentDetail.playersTab.importFromGlobal')}
          </button>
        </div>

        {/* 선수 추가 */}
        <div className="card space-y-4">
          <h3 className="text-lg font-bold">{t('admin.tournamentDetail.playersTab.addPlayerTitle')}</h3>

          {/* 개별 추가 */}
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={newPlayerName}
              onChange={e => setNewPlayerName(e.target.value)}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              placeholder={t('admin.tournamentDetail.playersTabInline.playerNamePlaceholder')}
              aria-label={t('admin.tournamentDetail.playersTabInline.playerNameAriaLabel')}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && newPlayerName.trim()) handleAddPlayer(); }}
            />
            {isTeamType && (
            <select
              className="input w-24"
              value={newPlayerGender}
              onChange={e => setNewPlayerGender(e.target.value as '' | 'male' | 'female')}
              aria-label={t('admin.tournamentDetail.playersTabInline.genderAriaLabel')}
            >
              <option value="">{t('admin.tournamentDetail.playersTabInline.genderLabel')}</option>
              <option value="male">{t('admin.tournamentDetail.playersTabInline.genderMale')}</option>
              <option value="female">{t('admin.tournamentDetail.playersTabInline.genderFemale')}</option>
            </select>
            )}
            <button className="btn btn-success" onClick={handleAddPlayer} disabled={!newPlayerName.trim()} aria-label={t('admin.tournamentDetail.playersTabInline.addPlayerAriaLabel')}>
              {t('admin.tournamentDetail.playersTabInline.addButton')}
            </button>
          </div>

          {/* 일괄 추가 */}
          <details>
            <summary className="text-sm text-blue-400 cursor-pointer">{t('admin.tournamentDetail.playersTabInline.bulkAddSummary')}</summary>
            <div className="mt-2 space-y-2">
              <textarea
                className="input w-full h-32"
                value={bulkNames}
                onChange={e => setBulkNames(e.target.value)}
                placeholder={t('admin.tournamentDetail.playersTabInline.bulkAddPlaceholder')}
                aria-label={t('admin.tournamentDetail.playersTabInline.bulkAddAriaLabel')}
              />
              <button
                className="btn btn-success w-full"
                onClick={handleBulkAdd}
                disabled={!bulkNames.trim()}
              >
                {t('admin.tournamentDetail.playersTabInline.bulkAddButton', { count: bulkNames.trim() ? bulkNames.trim().split('\n').filter(n => n.trim()).length : 0 })}
              </button>
            </div>
          </details>
        </div>

        {tournamentPlayers.length === 0 ? (
          <p className="text-gray-400">{t('admin.tournamentDetail.playersTab.noPlayers')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {tournamentPlayers.map(p => (
              <div key={p.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3 border border-gray-600">
                <div>
                  <span className="font-bold">{p.name}</span>
                  {isTeamType && p.gender === 'male' && <span className="ml-1 text-xs text-blue-400">{t('common.gender.male')}</span>}
                  {isTeamType && p.gender === 'female' && <span className="ml-1 text-xs text-pink-400">{t('common.gender.female')}</span>}
                  {p.club && <span className="ml-2 text-sm opacity-75">({p.club})</span>}
                  {p.class && <span className="ml-2 text-sm opacity-75">[{p.class}]</span>}
                </div>
                <button
                  className="text-red-400 hover:text-red-300 font-bold text-lg"
                  onClick={() => deleteTournamentPlayer(p.id)}
                  aria-label={t('admin.tournamentDetail.playersTabInline.deletePlayerAriaLabel', { name: p.name })}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {isTeamType && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h2 className="text-xl font-bold">{t('admin.tournamentDetail.playersTabInline.teamCompositionTitle', { count: teams.length })}</h2>
            <div className="flex gap-2">
              {tournament.type === 'randomTeamLeague' && (
                <button
                  className="btn btn-accent"
                  onClick={generateRandomTeams}
                  disabled={generating || tournamentPlayers.length < 3}
                  aria-label={t('admin.tournamentDetail.playersTabInline.randomTeamAriaLabel')}
                >
                  {generating ? t('admin.tournamentDetail.playersTabInline.generating') : t('admin.tournamentDetail.playersTabInline.randomTeamGenerate')}
                </button>
              )}
              <button className="btn btn-success" onClick={openAddTeamModal} aria-label={t('admin.tournamentDetail.playersTabInline.addNewTeamAriaLabel')}>
                {t('admin.tournamentDetail.playersTabInline.addNewTeam')}
              </button>
            </div>
          </div>

          {/* 팀 카드 목록 */}
          {teams.length === 0 ? (
            <p className="text-gray-400">{t('admin.tournamentDetail.playersTabInline.noTeams')}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {teams.map(team => {
                const isEditing = editingTeamId === team.id;
                const globalMaxReserves = tournament.teamRules?.maxReserves;
                const globalGenderRatio = tournament.teamRules?.genderRatio;
                const memberCount = (team.memberIds || []).length;
                return (
                  <div key={team.id} className="bg-gray-800 rounded-lg p-4 border border-gray-600">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-cyan-400">{team.coachName ? t('admin.tournamentDetail.playersTabInline.teamHeaderWithCoach', { name: team.name, count: memberCount, coach: team.coachName }) : t('admin.tournamentDetail.playersTabInline.teamHeader', { name: team.name, count: memberCount })}</h3>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-sm text-blue-400 hover:text-blue-300"
                          onClick={() => isEditing ? setEditingTeamId(null) : startEditing(team.id)}
                          aria-label={isEditing ? t('admin.tournamentDetail.playersTabInline.foldAriaLabel', { name: team.name }) : t('admin.tournamentDetail.playersTabInline.editAriaLabel', { name: team.name })}
                        >
                          {isEditing ? t('admin.tournamentDetail.playersTabInline.foldButton') : t('admin.tournamentDetail.playersTabInline.editButton')}
                        </button>
                        <button
                          className="text-sm text-red-400 hover:text-red-300"
                          onClick={() => handleDeleteTeam(team.id)}
                          aria-label={t('admin.tournamentDetail.playersTabInline.deleteAriaLabel', { name: team.name })}
                        >
                          {t('admin.tournamentDetail.playersTabInline.deleteButton')}
                        </button>
                      </div>
                    </div>
                    {/* 편집 모드에서만 상세 표시 */}
                    {isEditing && <>
                    {/* 팀 내 선수 목록 */}
                    <ul className="mt-3 space-y-1">
                      {(team.memberIds ?? []).map((memberId, i) => {
                        const memberName = (team.memberNames ?? [])[i] ?? memberId;
                        const player = tournamentPlayers.find(p => p.id === memberId);
                        return (
                          <li key={memberId} className="flex items-center justify-between bg-gray-700 rounded px-3 py-1.5">
                            <span className="text-gray-200">
                              {memberName}
                              {player?.gender === 'male' && <span className="ml-1 text-xs text-blue-400">{t('common.gender.male')}</span>}
                              {player?.gender === 'female' && <span className="ml-1 text-xs text-pink-400">{t('common.gender.female')}</span>}
                            </span>
                            <button
                              className="text-red-400 hover:text-red-300 font-bold text-sm"
                              onClick={() => handleRemoveMemberFromTeam(memberId, team.id)}
                              aria-label={t('admin.tournamentDetail.playersTabInline.removeMemberAriaLabel', { name: memberName })}
                            >
                              x
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {memberCount === 0 && (
                      <p className="text-gray-400 text-sm mt-2">{t('admin.tournamentDetail.playersTabInline.addMemberPlaceholder')}</p>
                    )}
                    {/* 팀 내 선수 추가 */}
                    <div className="mt-3">
                      <KoreanNameInput
                        placeholder={t('admin.tournamentDetail.playersTabInline.playerNamePlaceholder')}
                        ariaLabel={t('admin.tournamentDetail.playersTabInline.addMemberToTeamAriaLabel', { team: team.name })}
                        onSubmit={async (name, gender) => {
                          const id = await addTournamentPlayer({ name, gender: (gender as 'male' | 'female') || undefined });
                          if (!id) return;
                          const updated = teams.map(t => t.id !== team.id ? t : {
                            ...t,
                            memberIds: [...(t.memberIds || []), id],
                            memberNames: [...(t.memberNames || []), name],
                          });
                          await setTeamsBulk(updated);
                        }}
                      />
                    </div>
                    {/* Per-team settings editor (로컬 state로 편집, 저장 버튼으로 한번에 반영) */}
                      <div className="mt-3 pt-3 border-t border-gray-700 space-y-3">
                        <p className="text-xs text-gray-400">
                          {t('admin.tournamentDetail.playersTabInline.teamSettingsHint')}{globalMaxReserves != null || globalGenderRatio ? t('admin.tournamentDetail.playersTabInline.teamSettingsHintDefaults', { reserves: globalMaxReserves ?? '-', male: globalGenderRatio?.male ?? '-', female: globalGenderRatio?.female ?? '-' }) : ''})
                        </p>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.playersTabInline.coachLabel')}</label>
                          <input
                            type="text"
                            className="input w-full"
                            value={editCoachName}
                            placeholder={t('admin.tournamentDetail.playersTabInline.coachPlaceholder')}
                            onChange={e => setEditCoachName(e.target.value)}
                            aria-label={t('admin.tournamentDetail.playersTabInline.coachAriaLabel', { team: team.name })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.playersTabInline.reserveCountLabel')}</label>
                          <input
                            type="number"
                            className="input w-full"
                            min={0}
                            max={20}
                            value={editMaxReserves}
                            placeholder={globalMaxReserves != null ? t('admin.tournamentDetail.playersTabInline.reservePlaceholderDefault', { value: globalMaxReserves }) : t('admin.tournamentDetail.playersTabInline.reservePlaceholderNone')}
                            onChange={e => setEditMaxReserves(e.target.value)}
                            aria-label={t('admin.tournamentDetail.playersTabInline.reserveAriaLabel', { team: team.name })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.playersTabInline.genderRatioLabel')}</label>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="block text-xs text-gray-300 mb-0.5">{t('admin.tournamentDetail.playersTabInline.maleLabel')}</label>
                              <input
                                type="number"
                                className="input w-full"
                                min={0}
                                max={20}
                                value={editGenderMale}
                                placeholder={globalGenderRatio ? t('admin.tournamentDetail.playersTabInline.genderPlaceholderDefault', { value: globalGenderRatio.male }) : t('admin.tournamentDetail.playersTabInline.genderPlaceholderNone')}
                                onChange={e => setEditGenderMale(e.target.value)}
                                aria-label={t('admin.tournamentDetail.playersTabInline.maleAriaLabel', { team: team.name })}
                              />
                            </div>
                            <div className="flex-1">
                              <label className="block text-xs text-gray-300 mb-0.5">{t('admin.tournamentDetail.playersTabInline.femaleLabel')}</label>
                              <input
                                type="number"
                                className="input w-full"
                                min={0}
                                max={20}
                                value={editGenderFemale}
                                placeholder={globalGenderRatio ? t('admin.tournamentDetail.playersTabInline.genderPlaceholderDefault', { value: globalGenderRatio.female }) : t('admin.tournamentDetail.playersTabInline.genderPlaceholderNone')}
                                onChange={e => setEditGenderFemale(e.target.value)}
                                aria-label={t('admin.tournamentDetail.playersTabInline.femaleAriaLabel', { team: team.name })}
                              />
                            </div>
                          </div>
                        </div>
                        <button
                          className="btn btn-primary w-full"
                          onClick={saveTeamSettings}
                          aria-label={t('admin.tournamentDetail.playersTabInline.saveSettingsAriaLabel')}
                        >
                          {t('admin.tournamentDetail.playersTabInline.saveSettingsButton')}
                        </button>
                      </div>
                    </>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 수동 모드: 탑시드 지정 → 시드 수만큼 조 자동 생성 */}
      {tournament.formatType === 'manual' && tournamentPlayers.length >= 4 && (() => {
        const seedLabel = (idx: number) => String.fromCharCode(65 + idx);
        const maxSeeds = Math.min(16, Math.floor(tournamentPlayers.length / 2));
        const currentGroupCount = tournament.qualifyingConfig?.groupCount || 0;
        return (
          <div className="card space-y-4">
            <h3 className="text-lg font-bold text-yellow-400">{t('admin.tournamentDetail.topSeedSection.title')}</h3>
            <p className="text-gray-400 text-sm">
              {t('admin.tournamentDetail.topSeedSection.descriptionManual')}
            </p>
            <div className="space-y-2">
              {tournamentPlayers.map((player) => {
                const seedIdx = seeds.findIndex(s => s.playerId === player.id);
                const hasSeed = seedIdx >= 0;
                const label = hasSeed ? seedLabel(seedIdx) : '-';
                return (
                  <div key={player.id} className="flex items-center gap-3 bg-gray-800 rounded p-2">
                    <button
                      className={`w-8 h-8 rounded-full text-sm font-bold ${
                        hasSeed ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-400'
                      }`}
                      aria-label={hasSeed ? t('admin.tournamentDetail.topSeedSection.seedRemoveAriaLabel', { name: player.name, label }) : t('admin.tournamentDetail.topSeedSection.seedAssignAriaLabel', { name: player.name })}
                      onClick={() => {
                        if (hasSeed) {
                          toggleSeed(player.id, player.name);
                        } else if (seeds.length < maxSeeds) {
                          toggleSeed(player.id, player.name);
                        }
                      }}
                      disabled={!hasSeed && seeds.length >= maxSeeds}
                    >
                      {label}
                    </button>
                    <span className="text-white flex-1">{player.name}</span>
                    {hasSeed && (
                      <span className="text-yellow-400 text-xs font-bold">{t('admin.tournamentDetail.topSeedSection.seedBadge', { label })}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {seeds.length >= 2 && (
              <div className="bg-cyan-900/20 rounded-lg p-3">
                <p className="text-cyan-300 text-sm font-semibold">
                  {t('admin.tournamentDetail.topSeedSection.seedInfoText', { count: seeds.length, perGroup: Math.ceil(tournamentPlayers.length / seeds.length) })}
                </p>
              </div>
            )}
            <button
              className="btn btn-primary w-full"
              disabled={seeds.length < 2}
              onClick={async () => {
                const groupCount = seeds.length;
                await saveSeeds();

                const now = Date.now();
                const existingStages = toArray(tournament.stages);
                const existingQualifying = existingStages.find(s => s.type === 'qualifying');
                const qualifyingStage = existingQualifying || {
                  id: `stage_qualifying_${now}`,
                  name: t('admin.tournamentDetail.bracketTab.qualifyingStageName'),
                  order: 0,
                  type: 'qualifying' as const,
                  format: 'group_knockout' as const,
                  groupCount,
                  status: 'pending' as const,
                };
                const updatedStage = { ...qualifyingStage, groupCount };
                const stages = existingQualifying
                  ? existingStages.map(s => s.id === existingQualifying.id ? updatedStage : s)
                  : [updatedStage, ...existingStages];
                await updateTournament({
                  seeds,
                  stages,
                  qualifyingConfig: {
                    ...(tournament.qualifyingConfig || {}),
                    groupCount,
                    format: 'group_round_robin',
                  },
                });
              }}
              aria-label={t('admin.tournamentDetail.topSeedSection.saveAndCreateGroupsAriaLabel')}
            >
              {seeds.length < 2 ? t('admin.tournamentDetail.topSeedSection.minSeedRequired') : t('admin.tournamentDetail.topSeedSection.saveAndCreateGroups', { count: seeds.length })}
            </button>
            {currentGroupCount > 0 && (
              <p className="text-green-400 text-sm">{t('admin.tournamentDetail.topSeedSection.currentGroupCount', { count: currentGroupCount })}</p>
            )}
          </div>
        );
      })()}

      {/* 수동 모드: 본선 설정 (조가 있을 때) */}
      {tournament.formatType === 'manual' && tournament.qualifyingConfig?.groupCount && tournament.qualifyingConfig.groupCount > 1 && (
        <div className="card space-y-3">
          <h4 className="text-md font-bold text-cyan-400">{t('admin.tournamentDetail.finalsSetup.title')}</h4>
          <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.finalsSetup.description')}</p>
          <div className="flex items-center gap-4">
            <label className="text-gray-300">{t('admin.tournamentDetail.finalsSetup.advancePerGroup')}</label>
            <input
              type="number"
              className="input w-24"
              min={1}
              max={Math.ceil(tournamentPlayers.length / (tournament.qualifyingConfig.groupCount || 2))}
              value={(() => {
                const fc = tournament.finalsConfig as Record<string, unknown> | undefined;
                const apc = fc?.advancePerGroup;
                return typeof apc === 'number' ? apc : 2;
              })()}
              onChange={async (e) => {
                const advancePerGroup = Math.max(1, Number(e.target.value) || 1);
                const groupCount = tournament.qualifyingConfig?.groupCount || 2;
                const totalAdvance = advancePerGroup * groupCount;
                let startRound = 4;
                while (startRound < totalAdvance) startRound *= 2;

                const existingStages = toArray(tournament.stages);
                const existingFinals = existingStages.find(s => s.type === 'finals');
                const now = Date.now();
                const finalsStage = existingFinals || {
                  id: `stage_finals_${now}`,
                  name: t('admin.tournamentDetail.bracketTab.finalsStageName'),
                  order: 1,
                  type: 'finals' as const,
                  format: 'single_elimination' as const,
                  status: 'pending' as const,
                };
                const updatedFinals = { ...finalsStage, advanceCount: totalAdvance };
                const stages = existingFinals
                  ? existingStages.map(s => s.id === existingFinals.id ? updatedFinals : s)
                  : [...existingStages, updatedFinals];

                await updateTournament({
                  stages,
                  finalsConfig: {
                    ...(typeof tournament.finalsConfig === 'object' && tournament.finalsConfig ? tournament.finalsConfig : {}),
                    advancePerGroup,
                    advanceCount: totalAdvance,
                    format: 'single_elimination',
                    startingRound: startRound,
                    seedMethod: 'manual',
                  },
                });
              }}
              aria-label={t('admin.tournamentDetail.finalsSetupInline.advancePerGroupAriaLabel')}
            />
            <span className="text-gray-400 text-sm">
              {t('admin.tournamentDetail.finalsSetupInline.totalAdvance', { count: (() => {
                const fc = tournament.finalsConfig as Record<string, unknown> | undefined;
                const apc = fc?.advancePerGroup;
                const adv = typeof apc === 'number' ? apc : 2;
                return adv * (tournament.qualifyingConfig?.groupCount || 2);
              })() })}
            </span>
          </div>
          {toArray(tournament.stages).find(s => s.type === 'finals') && (
            <p className="text-green-400 text-sm">{t('admin.tournamentDetail.finalsSetupInline.finalsReady')}</p>
          )}
        </div>
      )}

      {/* 자동 모드: 탑시드 지정 */}
      {tournament.formatType !== 'manual' && tournament.qualifyingConfig?.groupCount && tournament.qualifyingConfig.groupCount > 1 && tournamentPlayers.length > 0 && (() => {
        const groupCount = tournament.qualifyingConfig!.groupCount;
        const seedLabel = (idx: number) => String.fromCharCode(65 + idx);
        const maxSeeds = groupCount;
        return (
          <div className="card space-y-4">
            <h3 className="text-lg font-bold text-yellow-400">{t('admin.tournamentDetail.topSeedSection.title')}</h3>
            <p className="text-gray-400 text-sm">
              {t('admin.tournamentDetail.topSeedSection.descriptionAuto', { max: maxSeeds })}
            </p>
            <div className="space-y-2">
              {tournamentPlayers.map((player) => {
                const seedIdx = seeds.findIndex(s => s.playerId === player.id);
                const hasSeed = seedIdx >= 0;
                const label = hasSeed ? seedLabel(seedIdx) : '-';
                return (
                  <div key={player.id} className="flex items-center gap-3 bg-gray-800 rounded p-2">
                    <button
                      className={`w-8 h-8 rounded-full text-sm font-bold ${
                        hasSeed ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-400'
                      }`}
                      aria-label={hasSeed ? t('admin.tournamentDetail.topSeedSection.seedRemoveAutoAriaLabel', { name: player.name, label }) : t('admin.tournamentDetail.topSeedSection.seedAssignAriaLabel', { name: player.name })}
                      onClick={() => {
                        if (hasSeed) {
                          toggleSeed(player.id, player.name);
                        } else if (seeds.length < maxSeeds) {
                          toggleSeed(player.id, player.name);
                        }
                      }}
                      disabled={!hasSeed && seeds.length >= maxSeeds}
                    >
                      {label}
                    </button>
                    <span className="text-white flex-1">{player.name}</span>
                    {hasSeed && (
                      <span className="text-yellow-400 text-xs font-bold">{t('admin.tournamentDetail.topSeedSection.seedBadge', { label })}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {seeds.length >= maxSeeds && (
              <p className="text-gray-400 text-xs">{t('admin.tournamentDetail.topSeedSection.seedsFull', { current: seeds.length, max: maxSeeds })}</p>
            )}
            <button className="btn btn-primary w-full" onClick={saveSeeds} aria-label={t('admin.tournamentDetail.topSeedSection.saveSeedsAriaLabel')}>{t('admin.tournamentDetail.topSeedSection.saveSeedsButton')}</button>
          </div>
        );
      })()}

      {/* 새 팀 추가 모달 */}
      {showAddTeamModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowAddTeamModal(false)} onKeyDown={e => { if (e.key === 'Escape') setShowAddTeamModal(false); }}>
          <div
            className="bg-gray-900 rounded-xl p-6 w-full max-w-md space-y-4 border border-gray-700 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-team-modal-title"
          >
            <h3 id="add-team-modal-title" className="text-xl font-bold text-yellow-400">{t('admin.tournamentDetail.addTeamModal.title')}</h3>

            <div>
              <label htmlFor="new-team-name" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.addTeamModal.teamNameLabel')}</label>
              <input
                id="new-team-name"
                className="input w-full"
                value={newTeamName}
                onChange={e => setNewTeamName(e.target.value)}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                placeholder={t('admin.tournamentDetail.playersTabInline.defaultTeamName', { idx: teams.length + 1 })}
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="new-team-coach" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.addTeamModal.coachNameLabel')}</label>
              <input
                id="new-team-coach"
                className="input w-full"
                value={newTeamCoach}
                onChange={e => setNewTeamCoach(e.target.value)}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                placeholder={t('admin.tournamentDetail.addTeamModal.coachPlaceholder')}
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">{t('admin.tournamentDetail.addTeamModal.playerRegistration')}</label>
              <div className="mb-3">
                <KoreanNameInput
                  placeholder={t('admin.tournamentDetail.addTeamModal.playerNamePlaceholder')}
                  ariaLabel={t('admin.tournamentDetail.addTeamModal.playerNameAriaLabel')}
                  onSubmit={(name, gender) => {
                    setNewTeamMembers(prev => [...prev, { name, gender: gender as '' | 'male' | 'female' }]);
                  }}
                />
              </div>

              {newTeamMembers.length > 0 && (
                <ul className="space-y-1">
                  {newTeamMembers.map((m, i) => (
                    <li key={i} className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                      <span className="text-gray-200">
                        {m.name}
                        {m.gender === 'male' && <span className="ml-1 text-xs text-blue-400">{t('common.gender.male')}</span>}
                        {m.gender === 'female' && <span className="ml-1 text-xs text-pink-400">{t('common.gender.female')}</span>}
                      </span>
                      <button
                        className="text-red-400 hover:text-red-300 font-bold text-sm"
                        onClick={() => setNewTeamMembers(prev => prev.filter((_, j) => j !== i))}
                        aria-label={t('admin.tournamentDetail.addTeamModal.removePlayerAriaLabel', { name: m.name })}
                      >
                        x
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {newTeamMembers.length === 0 && (
                <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.addTeamModal.addPlayersPrompt')}</p>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                className="btn btn-success flex-1"
                onClick={handleAddTeamFromModal}
                aria-label={t('admin.tournamentDetail.addTeamModal.createTeamAriaLabel')}
              >
                {t('admin.tournamentDetail.addTeamModal.createTeamButton', { count: newTeamMembers.length })}
              </button>
              <button
                className="btn btn-secondary flex-1"
                onClick={() => setShowAddTeamModal(false)}
                aria-label={t('common.cancel')}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 전역 선수 가져오기 모달 */}
      {showGlobalModal && (
        <div className="modal-backdrop" onClick={() => setShowGlobalModal(false)} onKeyDown={e => { if (e.key === 'Escape') setShowGlobalModal(false); }}>
          <div className="card max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="global-player-modal-title">
            <div className="flex items-center justify-between mb-4">
              <h2 id="global-player-modal-title" className="text-xl font-bold">{t('admin.tournamentDetail.playersTab.importFromGlobal')}</h2>
              <button
                className="text-gray-400 hover:text-white font-bold text-xl"
                onClick={() => setShowGlobalModal(false)}
                aria-label={t('common.close')}
              >
                x
              </button>
            </div>
            {globalPlayers.length === 0 ? (
              <p className="text-gray-400">{t('admin.tournamentDetail.globalPlayerModal.noGlobalPlayers')}</p>
            ) : (
              <div className="space-y-2 mb-4">
                {globalPlayers.map(p => {
                  const selected = selectedGlobalIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      className={`btn text-left w-full ${selected ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                      onClick={() => toggleGlobalSelect(p.id)}
                      aria-pressed={selected}
                      aria-label={selected ? t('admin.tournamentDetail.globalPlayerModal.selectedAriaLabel', { name: p.name }) : t('admin.tournamentDetail.globalPlayerModal.unselectedAriaLabel', { name: p.name })}
                    >
                      <span className="font-bold">{p.name}</span>
                      {p.club && <span className="ml-2 text-sm opacity-75">({p.club})</span>}
                      {p.class && <span className="ml-2 text-sm opacity-75">[{p.class}]</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <button
                className="btn btn-accent flex-1"
                onClick={handleImportGlobal}
                disabled={selectedGlobalIds.length === 0}
                aria-label={t('admin.tournamentDetail.globalPlayerModal.importAriaLabel')}
              >
                {t('admin.tournamentDetail.globalPlayerModal.importButton', { count: selectedGlobalIds.length })}
              </button>
              <button
                className="btn bg-gray-700 text-white hover:bg-gray-600 flex-1"
                onClick={() => setShowGlobalModal(false)}
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

// ========================
// Bracket Tab
// ========================
interface BracketTabProps {
  tournament: NonNullable<ReturnType<typeof useTournament>['tournament']>;
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

function BracketTab({ tournament, matches, tournamentPlayers, teams, setMatchesBulk, updateMatch, addMatch, deleteMatch, updateTournament, referees, courts, isTeamType }: BracketTabProps) {
  const { t } = useTranslation();
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
        return { ...g, playerIds: g.playerIds.filter(pid => pid !== playerId) };
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
      const hasGroups = groupAssignment.length > 0 && groupAssignment.some(g => g.playerIds.length > 0);

      if (hasGroups && !isTeamType) {
        // 조별 라운드로빈: 각 조 내에서 라운드로빈
        let round = 1;
        for (const group of groupAssignment) {
          const playerIds = group.playerIds;
          for (let i = 0; i < playerIds.length; i++) {
            for (let j = i + 1; j < playerIds.length; j++) {
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
              round++;
            }
          }
        }
      } else if (!isTeamType) {
        // Individual round-robin (전체 풀리그)
        const players = [...tournamentPlayers];
        let round = 1;
        for (let i = 0; i < players.length; i++) {
          for (let j = i + 1; j < players.length; j++) {
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
            round++;
          }
        }
      } else {
        // Team round-robin: single 31-point match per team vs team
        let round = 1;
        for (let i = 0; i < teams.length; i++) {
          for (let j = i + 1; j < teams.length; j++) {
            const t1 = teams[i];
            const t2 = teams[j];

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
            round++;
          }
        }
      }

      await setMatchesBulk(newMatches);
    } finally {
      setGenerating(false);
    }
  }, [isTeamType, tournamentPlayers, teams, tournament.id, setMatchesBulk, groupAssignment, tournament.stages]);

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
  }, [addPlayer1, addPlayer2, addGroupId, isTeamType, teams, tournamentPlayers, matches, tournament.id, addMatch]);

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
  const selectOptions = isTeamType
    ? teams.map(t => ({ id: t.id, name: t.name }))
    : tournamentPlayers.map(p => ({ id: p.id, name: p.name }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-xl font-bold">{t('admin.tournamentDetail.bracketTab.title')}</h2>
        <div className="flex gap-2 flex-wrap">
          {!isManualMode && (
            <button
              className="btn btn-accent"
              onClick={generateBracket}
              disabled={generating || !canGenerate}
              aria-label={t('admin.tournamentDetail.bracketTab.autoGenerateAriaLabel')}
            >
              {generating ? t('admin.tournamentDetail.bracketTab.generatingText') : (groupAssignment.length > 0 && groupAssignment.some(g => g.playerIds.length > 0) ? t('admin.tournamentDetail.bracketTab.groupRoundRobinGenerate') : t('admin.tournamentDetail.bracketTab.autoGenerateText'))}
            </button>
          )}
          <button
            className="btn btn-success"
            onClick={() => setShowAddForm(v => !v)}
            aria-label={t('admin.tournamentDetail.bracketTab.addMatchAriaLabel')}
          >
            {t('admin.tournamentDetail.bracketTab.addMatchButton')}
          </button>
        </div>
      </div>

      {/* 경기 추가 폼 */}
      {showAddForm && (
        <div className="card space-y-3 border-green-600">
          <h3 className="font-bold text-green-400">{t('admin.tournamentDetail.bracketTab.addMatchTitle')}</h3>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-40">
              <label className="block text-sm text-gray-300 mb-1">{isTeamType ? t('admin.tournamentDetail.bracketTab.team1Label') : t('admin.tournamentDetail.bracketTab.player1Label')}</label>
              <select className="input w-full" value={addPlayer1} onChange={e => setAddPlayer1(e.target.value)} aria-label={isTeamType ? t('admin.tournamentDetail.bracketTab.team1SelectAriaLabel') : t('admin.tournamentDetail.bracketTab.player1SelectAriaLabel')}>
                <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                {selectOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-40">
              <label className="block text-sm text-gray-300 mb-1">{isTeamType ? t('admin.tournamentDetail.bracketTab.team2Label') : t('admin.tournamentDetail.bracketTab.player2Label')}</label>
              <select className="input w-full" value={addPlayer2} onChange={e => setAddPlayer2(e.target.value)} aria-label={isTeamType ? t('admin.tournamentDetail.bracketTab.team2SelectAriaLabel') : t('admin.tournamentDetail.bracketTab.player2SelectAriaLabel')}>
                <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                {selectOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-32">
              <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.bracketTab.groupIdLabel')}</label>
              <input className="input w-full" value={addGroupId} onChange={e => setAddGroupId(e.target.value)} placeholder={t('admin.tournamentDetail.bracketTab.groupIdPlaceholder')} aria-label={t('admin.tournamentDetail.bracketTab.groupIdAriaLabel')} />
            </div>
            <button
              className="btn btn-success"
              onClick={handleAddMatch}
              disabled={!addPlayer1 || !addPlayer2 || addPlayer1 === addPlayer2}
              aria-label={t('admin.tournamentDetail.bracketTab.addAriaLabel')}
            >
              {t('admin.tournamentDetail.bracketTab.addButton')}
            </button>
          </div>
          {addPlayer1 && addPlayer2 && addPlayer1 === addPlayer2 && (
            <p className="text-red-400 text-sm">{t('admin.tournamentDetail.bracketTab.samePlayerError')}</p>
          )}
        </div>
      )}

      {/* 조 편성 (조별 예선이 있을 때) */}
      {tournament.qualifyingConfig?.groupCount && tournament.qualifyingConfig.groupCount > 1 && tournamentPlayers.length > 0 && (
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
            const sizes = groupAssignment.map(g => g.playerIds.length);
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
                      <h4 className="text-lg font-bold text-cyan-400 mb-2">{group.name} ({t('admin.tournamentDetail.bracketTab.personCount', { count: group.playerIds.length })})</h4>
                      <ul className="space-y-1">
                        {group.playerIds.map((pid) => {
                          const player = tournamentPlayers.find(p => p.id === pid);
                          const seedIdx2 = toArray(tournament.seeds).findIndex(s => s.playerId === pid);
                          return (
                            <li key={pid} className="text-sm text-gray-300 flex items-center gap-2">
                              {seedIdx2 >= 0 && <span className="text-yellow-400 text-xs font-bold">{String.fromCharCode(65 + seedIdx2)}</span>}
                              <span className="flex-1">{player?.name || pid}</span>
                              <select
                                className="bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600"
                                value={group.id}
                                onChange={e => handleMovePlayer(pid, group.id, e.target.value)}
                                aria-label={t('admin.tournamentDetail.bracketTab.moveGroupAriaLabel', { name: player?.name || pid })}
                              >
                                {groupAssignment.map(g => (
                                  <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                              </select>
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

      {matches.length > 0 && referees.length > 0 && (
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
      {(() => {
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

      {/* 본선 대진 편성 카드 */}
      {(() => {
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
          <p className="text-gray-400">{t('admin.tournamentDetail.bracketTab.noBracket')}</p>
          {isManualMode && (
            <p className="text-yellow-400 text-sm mt-2">{t('admin.tournamentDetail.bracketTab.manualAddHint')}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3" role="list" aria-label={`${t('admin.tournamentDetail.bracketTab.title')} (${matches.length})`}>
          {matches.map((match, matchIdx) => (
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
                  {match.status === 'pending' && (
                    <button
                      className="text-xs text-blue-400 hover:text-blue-300 border border-blue-600 rounded px-2 py-1"
                      onClick={() => openEditModal(match)}
                      aria-label={t('admin.tournamentDetail.bracketTab.editMatchAriaLabel')}
                    >
                      {t('admin.tournamentDetail.bracketTab.editMatchButton')}
                    </button>
                  )}
                  {match.status === 'pending' && (
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
                      {t('admin.tournamentDetail.bracketTab.walkoverBadge')}
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
                {selectOptions.map(o => (
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

// ========================
// Schedule Tab
// ========================
interface ScheduleTabProps {
  matches: Match[];
  courts: { id: string; name: string }[];
  referees: { id: string; name: string }[];
  schedule: ScheduleSlot[];
  setScheduleBulk: (slots: Omit<ScheduleSlot, 'id'>[]) => Promise<void>;
  updateMatch: (matchId: string, data: Partial<Match>) => Promise<boolean | void>;
}

function ScheduleTab({ matches, courts, referees, schedule, setScheduleBulk, updateMatch }: ScheduleTabProps) {
  const { t } = useTranslation();
  const [startTime, setStartTime] = useState('09:00');
  const [interval, setInterval_] = useState(30);
  const [endTime, setEndTime] = useState('23:00');
  const [restInterval, setRestInterval] = useState(interval);
  const [nextDayStartTime, setNextDayStartTime] = useState(startTime);
  const [generating, setGenerating] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0]);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);


  // Manual schedule editing state
  const [manualEdits, setManualEdits] = useState<Record<string, { scheduledDate: string; scheduledTime: string; courtId: string; courtName: string }>>({});
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);
  const [resettingSchedule, setResettingSchedule] = useState(false);

  const getManualEdit = (match: Match) => {
    if (manualEdits[match.id]) return manualEdits[match.id];
    return {
      scheduledDate: match.scheduledDate || '',
      scheduledTime: match.scheduledTime || '',
      courtId: match.courtId || '',
      courtName: match.courtName || '',
    };
  };

  const setManualEdit = (matchId: string, field: string, value: string) => {
    setManualEdits(prev => {
      const current = prev[matchId] || {
        scheduledDate: matches.find(m => m.id === matchId)?.scheduledDate || '',
        scheduledTime: matches.find(m => m.id === matchId)?.scheduledTime || '',
        courtId: matches.find(m => m.id === matchId)?.courtId || '',
        courtName: matches.find(m => m.id === matchId)?.courtName || '',
      };
      if (field === 'courtId') {
        const court = courts.find(c => c.id === value);
        return { ...prev, [matchId]: { ...current, courtId: value, courtName: court?.name || '' } };
      }
      return { ...prev, [matchId]: { ...current, [field]: value } };
    });
  };

  const handleSaveManualEdit = useCallback(async (matchId: string) => {
    const edit = manualEdits[matchId];
    if (!edit) return;
    setSavingMatchId(matchId);
    try {
      await updateMatch(matchId, {
        scheduledDate: edit.scheduledDate || undefined,
        scheduledTime: edit.scheduledTime || undefined,
        courtId: edit.courtId || undefined,
        courtName: edit.courtName || undefined,
      });
      const existingSlots = schedule.map(s => {
        if (s.matchId === matchId) {
          return { matchId: s.matchId, courtId: edit.courtId || s.courtId, courtName: edit.courtName || s.courtName, scheduledTime: edit.scheduledTime || s.scheduledTime, scheduledDate: edit.scheduledDate || s.scheduledDate, label: s.label, status: s.status };
        }
        return { matchId: s.matchId, courtId: s.courtId, courtName: s.courtName, scheduledTime: s.scheduledTime, scheduledDate: s.scheduledDate, label: s.label, status: s.status };
      });
      if (!schedule.find(s => s.matchId === matchId)) {
        const match = matches.find(m => m.id === matchId);
        if (match && edit.scheduledTime) {
          const label = match.type === 'individual'
            ? `${match.player1Name ?? ''} vs ${match.player2Name ?? ''}`
            : `${match.team1Name ?? ''} vs ${match.team2Name ?? ''}`;
          existingSlots.push({ matchId, courtId: edit.courtId, courtName: edit.courtName, scheduledTime: edit.scheduledTime, scheduledDate: edit.scheduledDate, label, status: match.status });
        }
      }
      await setScheduleBulk(existingSlots);
      setManualEdits(prev => { const next = { ...prev }; delete next[matchId]; return next; });
    } finally {
      setSavingMatchId(null);
    }
  }, [manualEdits, matches, schedule, setScheduleBulk, updateMatch]);

  const handleResetSchedule = useCallback(async () => {
    if (!confirm(t('admin.tournamentDetail.scheduleTab.resetConfirm'))) return;
    setResettingSchedule(true);
    try {
      for (const match of matches) {
        if (match.scheduledDate || match.scheduledTime) {
          await updateMatch(match.id, { scheduledDate: undefined, scheduledTime: undefined, courtId: undefined, courtName: undefined });
        }
      }
      await setScheduleBulk([]);
      setManualEdits({});
    } finally {
      setResettingSchedule(false);
    }
  }, [matches, updateMatch, setScheduleBulk]);

  const sortedMatches = useMemo(() => {
    return [...matches].sort((a, b) => {
      const dateA = a.scheduledDate || '';
      const dateB = b.scheduledDate || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const timeA = a.scheduledTime || '';
      const timeB = b.scheduledTime || '';
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return (a.round || 0) - (b.round || 0);
    });
  }, [matches]);

  const generateSchedule = useCallback(async () => {
    if (courts.length === 0 || matches.length === 0) return;
    setGenerating(true);
    try {
      const targetMatches = onlyUnassigned
        ? matches.filter(m => (m.status === 'pending' || m.status === 'in_progress') && !m.scheduledDate)
        : matches.filter(m => m.status === 'pending' || m.status === 'in_progress');
      const newSlots: Omit<ScheduleSlot, 'id'>[] = [];

      // Track per-court: { courtId, courtName, date, timeMinutes }
      const courtSlots = courts.map(c => {
        const [h, m] = startTime.split(':').map(Number);
        return { courtId: c.id, courtName: c.name, date: scheduleDate, timeMinutes: h * 60 + m };
      });

      // Track per-player last end time: { date, timeMinutes }
      const playerLastEnd = new Map<string, { date: string; time: number }>();

      const getPlayerIds = (match: Match): string[] => {
        const ids: string[] = [];
        if (match.player1Id) ids.push(match.player1Id);
        if (match.player2Id) ids.push(match.player2Id);
        if (match.team1Id) ids.push(match.team1Id);
        if (match.team2Id) ids.push(match.team2Id);
        return ids;
      };

      const dayStartMinutes = (() => { const [h, m] = startTime.split(':').map(Number); return h * 60 + m; })();
      const dayEndMinutes = (() => { const [h, m] = endTime.split(':').map(Number); return h * 60 + m; })();
      const nextDayStart = (() => { const [h, m] = nextDayStartTime.split(':').map(Number); return h * 60 + m; })();

      const formatTime = (minutes: number): string => {
        const hh = Math.floor(minutes / 60).toString().padStart(2, '0');
        const mm = (minutes % 60).toString().padStart(2, '0');
        return `${hh}:${mm}`;
      };

      const addDays = (dateStr: string, days: number): string => {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
      };

      let refereeIndex = 0;
      for (const match of targetMatches) {
        const playerIds = getPlayerIds(match);

        // Find the earliest time this match can start:
        // 1. Court must be free
        // 2. Both players must have rested (interval minutes since their last match)
        let bestCourtIdx = 0;
        let bestDate = scheduleDate;
        let bestTime = Infinity;

        for (let ci = 0; ci < courtSlots.length; ci++) {
          const court = courtSlots[ci];
          let candidateDate = court.date;
          let candidateTime = court.timeMinutes;

          // Check player rest time
          for (const pid of playerIds) {
            const last = playerLastEnd.get(pid);
            if (last) {
              if (last.date === candidateDate && last.time > candidateTime) {
                candidateTime = last.time;
              } else if (last.date > candidateDate) {
                candidateDate = last.date;
                candidateTime = Math.max(dayStartMinutes, last.time);
              }
            }
          }

          // Compare: prefer earliest date+time
          const candidateTotal = new Date(candidateDate).getTime() + candidateTime;
          const bestTotal = new Date(bestDate).getTime() + bestTime;
          if (ci === 0 || candidateTotal < bestTotal) {
            bestCourtIdx = ci;
            bestDate = candidateDate;
            bestTime = candidateTime;
          }
        }

        // If past day end, roll to next day
        if (bestTime >= dayEndMinutes) {
          bestDate = addDays(bestDate, 1);
          bestTime = nextDayStart;
        }

        const court = courtSlots[bestCourtIdx];
        const timeStr = formatTime(bestTime);

        const label = match.type === 'individual'
          ? `${match.player1Name ?? ''} vs ${match.player2Name ?? ''}`
          : `${match.team1Name ?? ''} vs ${match.team2Name ?? ''}`;

        newSlots.push({
          matchId: match.id,
          courtId: court.courtId,
          courtName: court.courtName,
          scheduledTime: timeStr,
          scheduledDate: bestDate,
          label,
          status: match.status,
        });

        const matchUpdate: Partial<Match> = {
          scheduledTime: timeStr,
          scheduledDate: bestDate,
          courtId: court.courtId,
          courtName: court.courtName,
        };
        // Auto-assign referee round-robin (only if not already assigned)
        if (!match.refereeId && referees.length > 0) {
          const ref = referees[refereeIndex % referees.length];
          matchUpdate.refereeId = ref.id;
          matchUpdate.refereeName = ref.name;
          refereeIndex++;
        }
        await updateMatch(match.id, matchUpdate);

        // Update court next available time
        const courtEndTime = bestTime + interval;
        court.date = bestDate;
        court.timeMinutes = courtEndTime >= dayEndMinutes ? (court.date = addDays(bestDate, 1), nextDayStart) : courtEndTime;

        // Update player last end time (uses restInterval for player rest)
        const playerEndTime = bestTime + restInterval;
        const playerEnd = playerEndTime >= dayEndMinutes ? { date: addDays(bestDate, 1), time: nextDayStart } : { date: bestDate, time: playerEndTime };
        for (const pid of playerIds) {
          playerLastEnd.set(pid, playerEnd);
        }
      }

      // If only assigning unassigned, keep existing schedule slots
      if (onlyUnassigned) {
        const existingSlots = schedule.map(s => ({
          matchId: s.matchId,
          courtId: s.courtId,
          courtName: s.courtName,
          scheduledTime: s.scheduledTime,
          scheduledDate: s.scheduledDate,
          label: s.label,
          status: s.status,
        }));
        await setScheduleBulk([...existingSlots, ...newSlots]);
      } else {
        await setScheduleBulk(newSlots);
      }
    } finally {
      setGenerating(false);
    }
  }, [matches, courts, startTime, interval, endTime, restInterval, nextDayStartTime, scheduleDate, onlyUnassigned, schedule, setScheduleBulk, updateMatch]);

  // Group schedule by date, then by time
  const dates = useMemo(() => {
    const dateSet = [...new Set(schedule.map(s => s.scheduledDate || ''))].sort();
    return dateSet;
  }, [schedule]);

  const hasMultipleDates = dates.length > 1 || (dates.length === 1 && dates[0] !== '');

  const timeSlotsByDate = useMemo(() => {
    return dates.map(date => {
      const dateSlots = schedule.filter(s => (s.scheduledDate || '') === date);
      const times = [...new Set(dateSlots.map(s => s.scheduledTime))].sort();
      const rows = times.map(time => ({
        time,
        slots: courts.map(court => dateSlots.find(s => s.scheduledTime === time && s.courtId === court.id) ?? null),
      }));
      return { date, rows };
    });
  }, [schedule, courts, dates]);

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <h2 className="text-xl font-bold">{t('admin.tournamentDetail.scheduleTab.title')}</h2>
        <div className="flex gap-4 flex-wrap">
          <div>
            <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.dateLabel')}</label>
            <div className="flex items-center gap-2">
              <select
                className="input"
                value={scheduleDate.split('-')[0] || ''}
                onChange={e => { const [, m, d] = scheduleDate.split('-'); setScheduleDate(`${e.target.value}-${m || '01'}-${d || '01'}`); }}
                aria-label={t('admin.tournamentDetail.scheduleTab.dateLabel')}
              >
                {[...Array(5)].map((_, i) => { const y = new Date().getFullYear() + i - 1; return <option key={y} value={y}>{y}</option>; })}
              </select>
              <select
                className="input"
                value={parseInt(scheduleDate.split('-')[1] || '1', 10).toString()}
                onChange={e => { const [y, , d] = scheduleDate.split('-'); setScheduleDate(`${y}-${e.target.value.padStart(2, '0')}-${d || '01'}`); }}
                aria-label={t('admin.tournamentDetail.scheduleTab.dateLabel')}
              >
                {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
              <select
                className="input"
                value={parseInt(scheduleDate.split('-')[2] || '1', 10).toString()}
                onChange={e => { const [y, m] = scheduleDate.split('-'); setScheduleDate(`${y}-${m}-${e.target.value.padStart(2, '0')}`); }}
                aria-label={t('admin.tournamentDetail.scheduleTab.dateLabel')}
              >
                {[...Array(31)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
              <button type="button" className="btn px-3 py-2 text-sm" onClick={() => setScheduleDate(new Date().toISOString().split('T')[0])} aria-label={t('admin.tournamentDetail.scheduleTab.todayButton')}>{t('admin.tournamentDetail.scheduleTab.todayButton')}</button>
            </div>
          </div>
          <div>
            <label htmlFor="start-time" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.startTimeLabel')}</label>
            <div className="flex items-center gap-1">
              <select
                className="input"
                value={startTime.split(':')[0]}
                onChange={e => setStartTime(`${e.target.value}:${startTime.split(':')[1]}`)}
                aria-label={t('admin.tournamentDetail.scheduleTab.startTimeLabel')}
              >
                {[...Array(24)].map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i}:00</option>)}
              </select>
              <select
                className="input"
                value={startTime.split(':')[1]}
                onChange={e => setStartTime(`${startTime.split(':')[0]}:${e.target.value}`)}
                aria-label={t('admin.tournamentDetail.scheduleTab.startTimeLabel')}
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => <option key={m} value={m.toString().padStart(2, '0')}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="interval" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.intervalLabel')}</label>
            <div className="flex items-center gap-1">
              <select
                id="interval"
                className="input"
                value={interval}
                onChange={e => setInterval_(Number(e.target.value))}
                aria-label={t('admin.tournamentDetail.scheduleTab.intervalLabel')}
              >
                {[10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-4 flex-wrap">
          <div>
            <label htmlFor="end-time" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.endTimeLabel')}</label>
            <div className="flex items-center gap-1">
              <select
                className="input"
                value={endTime.split(':')[0]}
                onChange={e => setEndTime(`${e.target.value}:${endTime.split(':')[1]}`)}
                aria-label={t('admin.tournamentDetail.scheduleTab.endTimeLabel')}
              >
                {[...Array(24)].map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i}:00</option>)}
              </select>
              <select
                className="input"
                value={endTime.split(':')[1]}
                onChange={e => setEndTime(`${endTime.split(':')[0]}:${e.target.value}`)}
                aria-label={t('admin.tournamentDetail.scheduleTab.endTimeLabel')}
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => <option key={m} value={m.toString().padStart(2, '0')}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="rest-interval" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.restIntervalLabel')}</label>
            <div className="flex items-center gap-1">
              <select
                id="rest-interval"
                className="input"
                value={restInterval}
                onChange={e => setRestInterval(Number(e.target.value))}
                aria-label={t('admin.tournamentDetail.scheduleTab.restIntervalLabel')}
              >
                {[10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120, 150, 180, 210, 240].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="next-day-start" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.nextDayStartLabel')}</label>
            <div className="flex items-center gap-1">
              <select
                className="input"
                value={nextDayStartTime.split(':')[0]}
                onChange={e => setNextDayStartTime(`${e.target.value}:${nextDayStartTime.split(':')[1]}`)}
                aria-label={t('admin.tournamentDetail.scheduleTab.nextDayStartLabel')}
              >
                {[...Array(24)].map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i}:00</option>)}
              </select>
              <select
                className="input"
                value={nextDayStartTime.split(':')[1]}
                onChange={e => setNextDayStartTime(`${nextDayStartTime.split(':')[0]}:${e.target.value}`)}
                aria-label={t('admin.tournamentDetail.scheduleTab.nextDayStartLabel')}
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => <option key={m} value={m.toString().padStart(2, '0')}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyUnassigned}
            onChange={e => setOnlyUnassigned(e.target.checked)}
            aria-label={t('admin.tournamentDetail.scheduleTab.onlyUnassigned')}
          />
          {t('admin.tournamentDetail.scheduleTab.onlyUnassigned')}
        </label>
        <button
          className="btn btn-accent"
          onClick={generateSchedule}
          disabled={generating || courts.length === 0 || matches.length === 0}
          aria-label={t('admin.tournamentDetail.scheduleTab.generateButton')}
        >
          {generating ? t('admin.tournamentDetail.scheduleTab.generating') : t('admin.tournamentDetail.scheduleTab.generateButton')}
        </button>
        {courts.length === 0 && <p className="text-gray-400">{t('admin.tournamentDetail.scheduleTab.noCourts')}</p>}
      </div>

      {timeSlotsByDate.length > 0 && timeSlotsByDate.some(d => d.rows.length > 0) && (
        <div className="card overflow-x-auto">
          <h2 className="text-xl font-bold mb-4">{t('admin.tournamentDetail.scheduleTab.scheduleGridTitle')}</h2>
          {timeSlotsByDate.map(({ date, rows }) => {
            if (rows.length === 0) return null;
            return (
              <div key={date || 'no-date'} className="mb-6">
                {hasMultipleDates && (
                  <h3 className="text-lg font-bold text-yellow-400 mb-2">
                    {date || t('admin.tournamentDetail.scheduleTab.dateUnspecified')}
                  </h3>
                )}
                <table className="w-full border-collapse mb-4" aria-label={t('admin.tournamentDetail.scheduleTab.scheduleGridTitle') + (date ? ` - ${date}` : '')}>
                  <thead>
                    <tr>
                      {hasMultipleDates && <th scope="col" className="border border-gray-600 p-3 text-left bg-gray-800">{t('admin.tournamentDetail.scheduleTab.dateColumnHeader')}</th>}
                      <th scope="col" className="border border-gray-600 p-3 text-left bg-gray-800">{t('admin.tournamentDetail.scheduleTab.timeColumnHeader')}</th>
                      {courts.map(c => (
                        <th scope="col" key={c.id} className="border border-gray-600 p-3 text-center bg-gray-800">{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.time}>
                        {hasMultipleDates && <td className="border border-gray-600 p-3 text-sm text-gray-400">{date || '-'}</td>}
                        <td className="border border-gray-600 p-3 font-semibold text-cyan-400">{row.time}</td>
                        {row.slots.map((slot, i) => (
                          <td key={i} className="border border-gray-600 p-3 text-center">
                            {slot ? (
                              <div>
                                <p className="font-semibold text-sm">{slot.label}</p>
                                <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold ${STATUS_COLORS[slot.status]}`}>
                                  {STATUS_ICONS[slot.status]} {t(STATUS_LABEL_KEYS[slot.status])}
                                </span>
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual schedule editing */}
      {matches.length > 0 && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-xl font-bold">{t('admin.tournamentDetail.scheduleTab.individualScheduleTitle')}</h2>
            <button
              className="btn bg-red-700 hover:bg-red-600 text-white"
              onClick={handleResetSchedule}
              disabled={resettingSchedule || matches.length === 0}
              aria-label={t('admin.tournamentDetail.scheduleTab.resetScheduleButton')}
            >
              {resettingSchedule ? t('admin.tournamentDetail.scheduleTab.resetting') : t('admin.tournamentDetail.scheduleTab.resetScheduleButton')}
            </button>
          </div>
          <div className="space-y-3">
            {sortedMatches.map(match => {
              const edit = getManualEdit(match);
              const matchLabel = match.type === 'individual'
                ? `${match.player1Name ?? '?'} vs ${match.player2Name ?? '?'}`
                : `${match.team1Name ?? '?'} vs ${match.team2Name ?? '?'}`;
              const hasEdits = !!manualEdits[match.id];
              return (
                <div key={match.id} className="bg-gray-800 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-xs">R{match.round}</span>
                      <span className="font-semibold text-sm">{matchLabel}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATUS_COLORS[match.status]}`}>
                        {STATUS_ICONS[match.status]} {t(STATUS_LABEL_KEYS[match.status])}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      {match.scheduledDate && <span>{match.scheduledDate}</span>}
                      {match.scheduledTime && <span>{match.scheduledTime}</span>}
                      {match.courtName && <span>/ {match.courtName}</span>}
                      {!match.scheduledDate && !match.scheduledTime && <span className="text-gray-400">{t('admin.tournamentDetail.scheduleTab.unassignedLabel')}</span>}
                    </div>
                  </div>
                  <div className="flex gap-3 flex-wrap items-end">
                    <div>
                      <label className="block text-xs text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.scheduleDateLabel')}</label>
                      <input
                        type="date"
                        className="input text-sm"
                        value={edit.scheduledDate}
                        onChange={e => setManualEdit(match.id, 'scheduledDate', e.target.value)}
                        aria-label={`${matchLabel} ${t('admin.tournamentDetail.scheduleTab.scheduleDateLabel')}`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.scheduleTimeLabel')}</label>
                      <div className="flex items-center gap-1">
                        <select
                          className="input text-sm"
                          value={(edit.scheduledTime || '09:00').split(':')[0]}
                          onChange={e => setManualEdit(match.id, 'scheduledTime', `${e.target.value}:${(edit.scheduledTime || '09:00').split(':')[1]}`)}
                          aria-label={`${matchLabel} ${t('admin.tournamentDetail.scheduleTab.scheduleTimeLabel')}`}
                        >
                          {[...Array(24)].map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i}:00</option>)}
                        </select>
                        <select
                          className="input text-sm"
                          value={(edit.scheduledTime || '09:00').split(':')[1]}
                          onChange={e => setManualEdit(match.id, 'scheduledTime', `${(edit.scheduledTime || '09:00').split(':')[0]}:${e.target.value}`)}
                          aria-label={`${matchLabel} ${t('admin.tournamentDetail.scheduleTab.scheduleTimeLabel')}`}
                        >
                          {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => <option key={m} value={m.toString().padStart(2, '0')}>{m}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.courtLabel')}</label>
                      <select
                        className="input text-sm"
                        value={edit.courtId}
                        onChange={e => setManualEdit(match.id, 'courtId', e.target.value)}
                        aria-label={`${matchLabel} ${t('admin.tournamentDetail.scheduleTab.courtLabel')}`}
                      >
                        <option value="">{t('admin.tournamentDetail.bracketTab.refereeUnassigned')}</option>
                        {courts.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      className="btn btn-accent text-sm px-4 py-2"
                      onClick={() => handleSaveManualEdit(match.id)}
                      disabled={!hasEdits || savingMatchId === match.id}
                      aria-label={`${matchLabel} ${t('common.save')}`}
                    >
                      {savingMatchId === match.id ? t('admin.tournamentDetail.scheduleTab.savingButton') : t('admin.tournamentDetail.scheduleTab.saveButton')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ========================
// Status Tab
// ========================
interface StatusTabProps {
  tournament: NonNullable<ReturnType<typeof useTournament>['tournament']>;
  matches: Match[];
  updateTournament: (data: Record<string, unknown>) => Promise<boolean | void>;
  updateMatch: (matchId: string, data: Partial<Match>) => Promise<boolean | void>;
  isTeamType: boolean;
  tournamentPlayers: Player[];
  teams: Team[];
}

function StatusTab({ tournament, matches, updateTournament, updateMatch, isTeamType, tournamentPlayers, teams }: StatusTabProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'all' | MatchStatus>('all');
  const [statusPage, setStatusPage] = useState(1);
  const STATUS_PAGE_SIZE = 30;
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
    alert(t('admin.tournamentDetail.statusTab.advanceToFinalsAlert', { count: finalsMatches.length }));
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

      alert(t('admin.tournamentDetail.statusTab.scoreCorrected'));
      closeCorrectionModal();
    } catch (err) {
      console.error('점수 수정 오류:', err);
      alert(t('admin.tournamentDetail.statusTab.scoreCorrectionError'));
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

      alert(t('admin.tournamentDetail.statusTab.walkoverProcessed'));
      closeWalkoverModal();
    } catch (err) {
      console.error('부전승 처리 오류:', err);
      alert(t('admin.tournamentDetail.statusTab.walkoverError'));
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

      {/* 대회 단계 관리 */}
      {toArray(tournament.stages).length > 0 && (
        <div className="card space-y-4">
          <h3 className="text-xl font-bold text-yellow-400">{t('admin.tournamentDetail.statusTab.stageManagement')}</h3>
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
                    <button className="btn btn-success w-full" onClick={handleAdvanceToFinals} aria-label={t('admin.tournamentDetail.statusTab.createFinalsBracket')}>
                      {t('admin.tournamentDetail.statusTab.createFinalsBracket')}
                    </button>
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
          onClick={() => { setFilter('all'); setStatusPage(1); }}
          aria-pressed={filter === 'all'}
          aria-label={t('admin.tournamentDetail.statusTab.filterAll', { count: '' })}
        >
          {t('admin.tournamentDetail.statusTab.filterAll', { count: matches.length })}
        </button>
        <button
          className={`btn ${filter === 'pending' ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
          onClick={() => { setFilter('pending'); setStatusPage(1); }}
          aria-pressed={filter === 'pending'}
          aria-label={t('admin.tournamentDetail.statusTab.filterPending', { count: '' })}
        >
          {t('admin.tournamentDetail.statusTab.filterPending', { count: counts.pending })}
        </button>
        <button
          className={`btn ${filter === 'in_progress' ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
          onClick={() => { setFilter('in_progress'); setStatusPage(1); }}
          aria-pressed={filter === 'in_progress'}
          aria-label={t('admin.tournamentDetail.statusTab.filterInProgress', { count: '' })}
        >
          {t('admin.tournamentDetail.statusTab.filterInProgress', { count: counts.in_progress })}
        </button>
        <button
          className={`btn ${filter === 'completed' ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
          onClick={() => { setFilter('completed'); setStatusPage(1); }}
          aria-pressed={filter === 'completed'}
          aria-label={t('admin.tournamentDetail.statusTab.filterCompleted', { count: '' })}
        >
          {t('admin.tournamentDetail.statusTab.filterCompleted', { count: counts.completed })}
        </button>
      </div>

      <div className="space-y-3" aria-live="polite">
        {filtered.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-gray-400">{t('admin.tournamentDetail.statusTab.noMatches')}</p>
          </div>
        ) : (
          filtered.slice((statusPage - 1) * STATUS_PAGE_SIZE, statusPage * STATUS_PAGE_SIZE).map(match => (
            <div key={match.id} className="card space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 text-sm">R{match.round}</span>
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
                      {t('admin.tournamentDetail.bracketTab.walkoverBadge')}
                    </span>
                  )}
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[match.status]}`}>
                    {STATUS_ICONS[match.status]} {t(STATUS_LABEL_KEYS[match.status])}
                  </span>
                  {match.status !== 'completed' && (
                    <button
                      className="btn bg-orange-600 hover:bg-orange-500 text-white text-xs px-3 py-1"
                      onClick={() => openWalkoverModal(match)}
                      aria-label={t('admin.tournamentDetail.statusTab.walkoverButton')}
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
          ))
        )}
      </div>

      {(() => {
        const totalStatusPages = Math.ceil(filtered.length / STATUS_PAGE_SIZE);
        return totalStatusPages > 1 ? (
          <div className="flex items-center justify-center gap-4 mt-4">
            <button className="btn btn-sm btn-secondary" disabled={statusPage === 1} onClick={() => setStatusPage(p => p - 1)}>{t('common.previous')}</button>
            <span className="text-gray-400 text-sm">{t('common.pageInfo', { page: statusPage, total: totalStatusPages })}</span>
            <button className="btn btn-sm btn-secondary" disabled={statusPage >= totalStatusPages} onClick={() => setStatusPage(p => p + 1)}>{t('common.next')}</button>
          </div>
        ) : null;
      })()}

      {/* 점수 수정 모달 */}
      {correctionMatch && (
        <div className="modal-backdrop" onClick={closeCorrectionModal} onKeyDown={e => { if (e.key === 'Escape') closeCorrectionModal(); }}>
          <div className="card max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="correction-modal-title">
            <div className="flex items-center justify-between mb-4">
              <h2 id="correction-modal-title" className="text-xl font-bold">{t('admin.tournamentDetail.correctionModal.title')}</h2>
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
              <h2 id="walkover-modal-title" className="text-xl font-bold text-orange-400">{t('admin.tournamentDetail.walkoverModal.title')}</h2>
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

// ========================
// Ranking Tab
// ========================
interface RankingTabProps {
  tournament: NonNullable<ReturnType<typeof useTournament>['tournament']>;
  matches: Match[];
  isTeamType: boolean;
}

function RankingTab({ tournament, matches, isTeamType }: RankingTabProps) {
  const { t } = useTranslation();
  const [copySuccess, setCopySuccess] = useState(false);
  const completedMatches = matches.filter(m => m.status === 'completed');
  const totalPoints = completedMatches.reduce((sum, m) => {
    return sum + (m.sets || []).reduce((s, set) => s + set.player1Score + set.player2Score, 0);
  }, 0);
  const avgPointsPerMatch = completedMatches.length > 0 ? (totalPoints / completedMatches.length).toFixed(1) : '0';

  // Completed matches sorted by most recent first
  const completedMatchesSorted = [...completedMatches].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const formatDiff = (val: number) => val > 0 ? `+${val}` : `${val}`;

  const handleExportCSV = () => {
    const csv = exportResultsCSV(tournament as Parameters<typeof exportResultsCSV>[0], matches, [], []);
    const filename = `${tournament.name}_${t('admin.tournamentDetail.tabs.ranking')}_${tournament.date || 'export'}.csv`;
    downloadCSV(csv, filename);
  };

  const handleCopyResults = async () => {
    const lines: string[] = [];
    lines.push(`[${tournament.name}] ${t('admin.tournamentDetail.rankingTab.resultText')}`);
    lines.push(`${tournament.date}${tournament.endDate ? ` ~ ${tournament.endDate}` : ''}`);
    lines.push(`${isTeamType ? t('admin.tournamentDetail.rankingTab.typeTeam') : t('admin.tournamentDetail.rankingTab.typeIndividual')}`);
    lines.push('');

    if (isTeamType) {
      const teamRankings = calculateTeamRanking(matches);
      teamRankings.forEach(r => {
        lines.push(`${r.rank}: ${r.teamName || r.teamId} (${r.wins}W ${r.losses}L, ${formatDiff(r.pointsFor - r.pointsAgainst)})`);
      });
    } else {
      const indivRankings = calculateIndividualRanking(matches);
      indivRankings.forEach(r => {
        lines.push(`${r.rank}: ${r.playerName || r.playerId} (${r.wins}W ${r.losses}L)`);
      });
    }

    lines.push('');
    lines.push(t('admin.tournamentDetail.rankingTab.totalCompleted', { completed: completedMatches.length, total: matches.length }));

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = lines.join('\n');
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const exportButtons = (
    <div className="card flex items-center gap-3 flex-wrap">
      <span className="font-semibold text-gray-300">{t('admin.tournamentDetail.rankingTab.exportLabel')}</span>
      <button
        className="btn btn-secondary"
        onClick={handleExportCSV}
        disabled={completedMatches.length === 0}
        aria-label={t('admin.tournamentDetail.rankingTab.csvExport')}
      >
        {t('admin.tournamentDetail.rankingTab.csvExport')}
      </button>
      <button
        className="btn btn-secondary"
        onClick={handleCopyResults}
        disabled={completedMatches.length === 0}
        aria-label={t('admin.tournamentDetail.rankingTab.copyResults')}
      >
        {copySuccess ? t('admin.tournamentDetail.rankingTab.copied') : t('admin.tournamentDetail.rankingTab.copyResults')}
      </button>
    </div>
  );

  if (isTeamType) {
    const rankings = calculateTeamRanking(matches);
    return (
      <div className="space-y-6">
        {exportButtons}

        {/* Summary stats */}
        <div className="card flex gap-6 flex-wrap">
          <div>
            <span className="text-gray-400 text-sm">{t('admin.tournamentDetail.rankingTab.matchProgress')}</span>
            <p className="text-lg font-bold">{completedMatches.length} / {matches.length}</p>
          </div>
          <div>
            <span className="text-gray-400 text-sm">{t('admin.tournamentDetail.rankingTab.avgPointsPerMatch')}</span>
            <p className="text-lg font-bold">{avgPointsPerMatch}</p>
          </div>
        </div>

        <div className="card overflow-x-auto">
          <h2 className="text-xl font-bold mb-4">{t('admin.tournamentDetail.rankingTab.teamRankingTitle')}</h2>
          {rankings.length === 0 ? (
            <p className="text-gray-400">{t('admin.tournamentDetail.rankingTab.noCompletedMatches')}</p>
          ) : (
            <table className="w-full border-collapse" aria-label={t('admin.tournamentDetail.rankingTab.teamRankingAriaLabel')}>
              <thead>
                <tr>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.rankHeader')}</th>
                  <th scope="col" className="border border-gray-600 p-3 text-left bg-gray-800">{t('admin.tournamentDetail.rankingTab.teamNameHeader')}</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.matchCountHeader')}</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.winsHeader')}</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.lossesHeader')}</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.pointsHeader')}</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.pointDiffHeader')}</th>
                </tr>
              </thead>
              <tbody>
                {rankings.map(r => (
                  <tr key={r.teamId} className={r.rank <= 3 ? 'bg-gray-800' : ''}>
                    <td className="border border-gray-600 p-3 text-center font-bold text-yellow-400">{r.rank}</td>
                    <td className="border border-gray-600 p-3 font-semibold">{r.teamName}</td>
                    <td className="border border-gray-600 p-3 text-center">{r.played}</td>
                    <td className="border border-gray-600 p-3 text-center text-green-400">{r.wins}</td>
                    <td className="border border-gray-600 p-3 text-center text-red-400">{r.losses}</td>
                    <td className="border border-gray-600 p-3 text-center">{r.pointsFor}-{r.pointsAgainst}</td>
                    <td className="border border-gray-600 p-3 text-center">{formatDiff(r.pointsFor - r.pointsAgainst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Completed matches list (most recent first) */}
        {completedMatchesSorted.length > 0 && (
          <div className="card">
            <h2 className="text-xl font-bold mb-4">{t('admin.tournamentDetail.rankingTab.completedMatchesTitle')}</h2>
            <div className="space-y-2">
              {completedMatchesSorted.map(match => (
                <div key={match.id} className="bg-gray-800 rounded-lg px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                  <span className="font-semibold">{match.team1Name ?? '?'} vs {match.team2Name ?? '?'}</span>
                  <div className="flex gap-2">
                    {(() => {
                      const isP2W = match.winnerId === (match.player2Id || match.team2Id);
                      return (match.sets || []).map((s, i) => (
                        <span key={i} className="px-2 py-0.5 bg-gray-700 rounded text-sm font-mono">
                          {isP2W ? s.player2Score : s.player1Score}-{isP2W ? s.player1Score : s.player2Score}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const rankings = calculateIndividualRanking(matches);
  return (
    <div className="space-y-6">
      {exportButtons}

      {/* Summary stats */}
      <div className="card flex gap-6 flex-wrap">
        <div>
          <span className="text-gray-400 text-sm">{t('admin.tournamentDetail.rankingTab.matchProgress')}</span>
          <p className="text-lg font-bold">{completedMatches.length} / {matches.length}</p>
        </div>
        <div>
          <span className="text-gray-400 text-sm">{t('admin.tournamentDetail.rankingTab.avgPointsPerMatch')}</span>
          <p className="text-lg font-bold">{avgPointsPerMatch}</p>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="text-xl font-bold mb-4">{t('admin.tournamentDetail.rankingTab.individualRankingTitle')}</h2>
        {rankings.length === 0 ? (
          <p className="text-gray-400">{t('admin.tournamentDetail.rankingTab.noCompletedMatches')}</p>
        ) : (
          <table className="w-full border-collapse" aria-label={t('admin.tournamentDetail.rankingTab.individualRankingAriaLabel')}>
            <thead>
              <tr>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.rankHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-left bg-gray-800">{t('admin.tournamentDetail.rankingTab.nameHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.matchCountHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.winsHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.lossesHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.setWonLostHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.setDiffHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.pointWonLostHeader')}</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">{t('admin.tournamentDetail.rankingTab.pointDiffHeader')}</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(r => (
                <tr key={r.playerId} className={r.rank <= 3 ? 'bg-gray-800' : ''}>
                  <td className="border border-gray-600 p-3 text-center font-bold text-yellow-400">{r.rank}</td>
                  <td className="border border-gray-600 p-3 font-semibold">{r.playerName}</td>
                  <td className="border border-gray-600 p-3 text-center">{r.played}</td>
                  <td className="border border-gray-600 p-3 text-center text-green-400">{r.wins}</td>
                  <td className="border border-gray-600 p-3 text-center text-red-400">{r.losses}</td>
                  <td className="border border-gray-600 p-3 text-center">{r.setsWon}-{r.setsLost}</td>
                  <td className="border border-gray-600 p-3 text-center">{formatDiff(r.setsWon - r.setsLost)}</td>
                  <td className="border border-gray-600 p-3 text-center">{r.pointsFor}-{r.pointsAgainst}</td>
                  <td className="border border-gray-600 p-3 text-center">{formatDiff(r.pointsFor - r.pointsAgainst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Completed matches list (most recent first) */}
      {completedMatchesSorted.length > 0 && (
        <div className="card">
          <h2 className="text-xl font-bold mb-4">{t('admin.tournamentDetail.rankingTab.completedMatchesTitle')}</h2>
          <div className="space-y-2">
            {completedMatchesSorted.map(match => (
              <div key={match.id} className="bg-gray-800 rounded-lg px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                <span className="font-semibold">{match.player1Name ?? '?'} vs {match.player2Name ?? '?'}</span>
                <div className="flex gap-2">
                  {(() => {
                    const isP2W = match.winnerId === (match.player2Id || match.team2Id);
                    return (match.sets || []).map((s, i) => (
                      <span key={i} className="px-2 py-0.5 bg-gray-700 rounded text-sm font-mono">
                        {isP2W ? s.player2Score : s.player1Score}-{isP2W ? s.player1Score : s.player2Score}
                      </span>
                    ));
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
