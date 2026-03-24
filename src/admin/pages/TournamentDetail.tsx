import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { createEmptySet, checkMatchWinner, checkSetWinner } from '@shared/utils/scoring';
import { calculateIndividualRanking, calculateTeamRanking } from '@shared/utils/ranking';
import { exportResultsCSV, downloadCSV } from '@shared/utils/export';
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

const TABS: { key: TabKey; label: string }[] = [
  { key: 'players', label: '참가자' },
  { key: 'bracket', label: '대진표' },
  { key: 'schedule', label: '스케줄' },
  { key: 'status', label: '경기 현황' },
  { key: 'ranking', label: '순위' },
];

const STATUS_LABELS: Record<MatchStatus, string> = {
  pending: '대기',
  in_progress: '진행중',
  completed: '완료',
};

const STATUS_COLORS: Record<MatchStatus, string> = {
  pending: 'bg-gray-600 text-white',
  in_progress: 'bg-orange-500 text-black',
  completed: 'bg-green-600 text-white',
};

export default function TournamentDetail() {
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
        <p className="text-2xl text-yellow-400 animate-pulse">로딩 중...</p>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl text-red-500">대회를 찾을 수 없습니다.</p>
        <button className="btn btn-primary mt-4" onClick={() => navigate('/admin')} aria-label="대시보드로 돌아가기">
          대시보드로 돌아가기
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
      alert(isTeamType ? '참가 팀 수를 입력해주세요.' : '참가 인원을 입력해주세요.');
      return;
    }

    const msgParts = [
      `시뮬레이션을 실행합니다.\n`,
      hasExistingTeams
        ? `• 등록된 ${teams.length}개 팀으로 진행`
        : hasExistingPlayers
          ? `• 등록된 선수 ${playerCount}명으로 진행`
          : `• 가상 참가자 ${playerCount}명 생성`,
      simAutoReferee
        ? (hasExistingReferees
          ? `• 등록된 심판 ${referees.length}명 배정`
          : `• 가상 심판 3명 생성`)
        : `• 심판 자동 배정: OFF`,
      simAutoCourt
        ? `• 경기장 자동 배정: ON`
        : `• 경기장 자동 배정: OFF`,
      `• 기존 경기 데이터가 초기화됩니다`,
      `• 대회 규칙 설정은 유지됩니다`,
      `\n계속하시겠습니까?`,
    ];
    if (!confirm(msgParts.join('\n'))) return;

    setSimulating(true);
    try {
      setSimProgress('시뮬레이션 데이터 생성 중...');
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
        setSimProgress(`참가자 ${result.players.length}명 등록 중...`);
        for (const player of result.players) {
          const newId = await addTournamentPlayer({ name: player.name });
          if (newId) playerIdMap.set(player.id, newId);
        }
      }

      if (result.teams && result.teams.length > 0 && !hasExistingTeams) {
        setSimProgress(`팀 ${result.teams.length}개 생성 중...`);
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
          setSimProgress('가상 코트 생성 중...');
          for (const simCourt of [{ simId: 'sim_court_1', name: '1코트' }, { simId: 'sim_court_2', name: '2코트' }]) {
            const newId = await addCourt({ name: simCourt.name, assignedReferees: [] });
            if (newId) courtIdMap.set(simCourt.simId, newId);
          }
        }
      }

      // === 가상 심판 생성 (기존 심판이 없을 때, 경기 저장 전) ===
      const refIdMap = new Map<string, string>();
      if (simAutoReferee && referees.length === 0 && result.referees && result.referees.length > 0) {
        setSimProgress(`가상 심판 ${result.referees.length}명 생성 중...`);
        for (const simRef of result.referees) {
          const newId = await addReferee({ name: simRef.name, role: 'main', assignedMatchIds: [] });
          if (newId) refIdMap.set(simRef.id, newId);
        }
      }

      // === 경기 데이터에서 sim_ ID를 실제 Firebase ID로 교체 후 저장 ===
      setSimProgress(`경기 ${result.matches.length}건 생성 중...`);
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
        setSimProgress(`스케줄 ${result.schedule.length}건 저장 중...`);
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
            setSimProgress(`심판 ${referees.length}명 배정 정보 저장 중...`);
            await withTimeout(
              Promise.all(refAssignments.map(ra => updateReferee(ra.id, { assignedMatchIds: ra.assignedMatchIds }))),
              10000,
            );
          } else if (result.referees && result.referees.length > 0) {
            setSimProgress(`심판 배정 정보 저장 중...`);
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

      setSimProgress('대회 상태 업데이트 중...');
      // 모든 경기가 completed이면 대회 완료, 아니면 in_progress
      const allCompleted = result.matches.every(m => m.status === 'completed');
      await updateTournament({ status: allCompleted ? 'completed' : 'in_progress' });

      setSimProgress(`시뮬레이션 완료! 경기 ${result.matches.length}건 생성, 대회 상태: ${allCompleted ? '완료' : '진행중'}`);
      // 10초 후 메시지 클리어
      setTimeout(() => setSimProgress(''), 10000);
    } catch (err) {
      console.error('시뮬레이션 오류:', err);
      setSimProgress('시뮬레이션 중 오류 발생');
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
          <p className="text-gray-400 mt-1">{tournament.date}{tournament.endDate ? ` ~ ${tournament.endDate}` : ''} | {tournament.type === 'individual' ? '개인전' : tournament.type === 'team' ? '팀전' : '랜덤 팀리그전'}</p>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate('/admin')} aria-label="뒤로가기">
          뒤로
        </button>
      </div>

      {tournament.status === 'draft' && (
        <div className="card bg-purple-900/30 border-purple-500 p-4">
          <h3 className="text-lg font-bold text-purple-400 mb-2">테스트 시뮬레이션</h3>
          <p className="text-gray-400 text-sm mb-4">가상 참가자, 경기 결과, 순위를 자동으로 생성합니다.</p>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {isTeamType ? '참가 팀 수' : '참가 인원'}
            </label>
            <input
              type="number"
              className="input w-full"
              value={simCount}
              min={2}
              max={64}
              placeholder={isTeamType ? '팀 수 입력' : '인원 수 입력'}
              onChange={e => setSimCount(e.target.value === '' ? '' : Number(e.target.value))}
              aria-label={isTeamType ? '참가 팀 수' : '참가 인원'}
            />
            {isTeamType && (
              <p className="text-xs text-gray-400 mt-1">등록된 팀이 있으면 해당 팀으로 시뮬레이션됩니다.</p>
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
                <span className="text-sm font-medium text-gray-200">대진표 자동 배정</span>
                <p className="text-xs text-gray-400">조별 라운드로빈 대진을 자동으로 생성합니다.</p>
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
                <span className="text-sm font-medium text-gray-200">심판 자동 배정</span>
                <p className="text-xs text-gray-400">가상 심판을 생성하고 경기에 배정합니다.</p>
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
                <span className="text-sm font-medium text-gray-200">경기장 자동 배정</span>
                <p className="text-xs text-gray-400">가상 경기장을 생성하고 스케줄에 배정합니다.</p>
              </div>
            </label>
          </div>
          {simProgress && (
            <p className={`text-sm mb-2 font-semibold ${simProgress.includes('완료') ? 'text-green-400 text-base' : simProgress.includes('오류') ? 'text-red-400' : 'text-cyan-400'}`} role="status" aria-live="polite">
              {simProgress}
            </p>
          )}
          <button
            className="btn bg-purple-700 hover:bg-purple-600 text-white w-full"
            onClick={handleSimulate}
            disabled={simulating}
            aria-label="시뮬레이션 실행"
          >
            {simulating ? '시뮬레이션 진행 중...' : '시뮬레이션 실행'}
          </button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap border-b border-gray-700 pb-2" role="tablist" aria-label="대회 상세 탭" onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const idx = TABS.findIndex(t => t.key === activeTab); const next = e.key === 'ArrowRight' ? (idx + 1) % TABS.length : (idx - 1 + TABS.length) % TABS.length; setActiveTab(TABS[next].key); e.currentTarget.querySelector<HTMLElement>(`#tab-${TABS[next].key}`)?.focus(); } }}>
        {TABS.map(tab => (
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
            {tab.label}
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
    input.placeholder = placeholder || '선수 이름';
    if (ariaLabel) input.setAttribute('aria-label', ariaLabel);

    const select = document.createElement('select');
    select.className = 'input';
    select.style.width = '64px';
    select.style.fontSize = '0.875rem';
    select.setAttribute('aria-label', '성별');
    select.innerHTML = '<option value="">성별</option><option value="male">남</option><option value="female">여</option>';

    const btn = document.createElement('button');
    btn.className = 'btn btn-success';
    btn.style.fontSize = '0.875rem';
    btn.style.padding = '0.5rem 0.75rem';
    btn.textContent = '+';
    btn.type = 'button';
    btn.setAttribute('aria-label', '선수 추가');

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
  updateTournament: (data: Record<string, unknown>) => Promise<void>;
  isTeamType: boolean;
  teams: Team[];
  setTeamsBulk: (teams: Team[]) => Promise<void>;
}

function PlayersTab({ tournament, tournamentPlayers, globalPlayers, addTournamentPlayer, deleteTournamentPlayer, addPlayersFromGlobal, updateTournament, isTeamType, teams, setTeamsBulk }: PlayersTabProps) {
  const [generating, setGenerating] = useState(false);
  const [showGlobalModal, setShowGlobalModal] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerGender, setNewPlayerGender] = useState<'' | 'male' | 'female'>('');
  const [bulkNames, setBulkNames] = useState('');
  const [selectedGlobalIds, setSelectedGlobalIds] = useState<string[]>([]);
  const [seeds, setSeeds] = useState<SeedEntry[]>(toArray(tournament.seeds));
  const [manualGroupCount, setManualGroupCount] = useState<number>(
    tournament.qualifyingConfig?.groupCount
      || toArray(tournament.stages).find(s => s.type === 'qualifying')?.groupCount
      || 4
  );
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
    const name = newTeamName.trim() || `${nextIdx}팀`;
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
    if (!confirm('이 팀을 삭제하시겠습니까?')) return;
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
          alert(`성별 비율에 맞는 선수가 부족합니다.\n필요: 남자 ${requiredMales}명, 여자 ${requiredFemales}명\n현재: 남자 ${males.length}명, 여자 ${females.length}명`);
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
            name: `${i + 1}팀`,
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
            name: `${teamIdx}팀`,
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
          <h2 className="text-xl font-bold">대회 참가 선수 ({tournamentPlayers.length}명)</h2>
          <button
            className="btn btn-secondary"
            onClick={() => setShowGlobalModal(true)}
            aria-label="전역 선수에서 가져오기"
          >
            전역 선수에서 가져오기
          </button>
        </div>

        {/* 선수 추가 */}
        <div className="card space-y-4">
          <h3 className="text-lg font-bold">선수 추가</h3>

          {/* 개별 추가 */}
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={newPlayerName}
              onChange={e => setNewPlayerName(e.target.value)}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              placeholder="선수 이름"
              aria-label="선수 이름"
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && newPlayerName.trim()) handleAddPlayer(); }}
            />
            {isTeamType && (
            <select
              className="input w-24"
              value={newPlayerGender}
              onChange={e => setNewPlayerGender(e.target.value as '' | 'male' | 'female')}
              aria-label="성별"
            >
              <option value="">성별</option>
              <option value="male">남</option>
              <option value="female">여</option>
            </select>
            )}
            <button className="btn btn-success" onClick={handleAddPlayer} disabled={!newPlayerName.trim()} aria-label="선수 추가">
              추가
            </button>
          </div>

          {/* 일괄 추가 */}
          <details>
            <summary className="text-sm text-blue-400 cursor-pointer">여러 명 한번에 등록</summary>
            <div className="mt-2 space-y-2">
              <textarea
                className="input w-full h-32"
                value={bulkNames}
                onChange={e => setBulkNames(e.target.value)}
                placeholder={"이름을 줄바꿈으로 구분하여 입력\n홍길동\n김철수\n이영희"}
                aria-label="일괄 등록할 선수 이름 목록"
              />
              <button
                className="btn btn-success w-full"
                onClick={handleBulkAdd}
                disabled={!bulkNames.trim()}
              >
                {bulkNames.trim() ? bulkNames.trim().split('\n').filter(n => n.trim()).length : 0}명 일괄 등록
              </button>
            </div>
          </details>
        </div>

        {tournamentPlayers.length === 0 ? (
          <p className="text-gray-400">참가 선수가 없습니다. 선수를 등록해주세요.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {tournamentPlayers.map(p => (
              <div key={p.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3 border border-gray-600">
                <div>
                  <span className="font-bold">{p.name}</span>
                  {isTeamType && p.gender === 'male' && <span className="ml-1 text-xs text-blue-400">남</span>}
                  {isTeamType && p.gender === 'female' && <span className="ml-1 text-xs text-pink-400">여</span>}
                  {p.club && <span className="ml-2 text-sm opacity-75">({p.club})</span>}
                  {p.class && <span className="ml-2 text-sm opacity-75">[{p.class}]</span>}
                </div>
                <button
                  className="text-red-400 hover:text-red-300 font-bold text-lg"
                  onClick={() => deleteTournamentPlayer(p.id)}
                  aria-label={`${p.name} 삭제`}
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
            <h2 className="text-xl font-bold">팀 구성 ({teams.length}팀)</h2>
            <div className="flex gap-2">
              {tournament.type === 'randomTeamLeague' && (
                <button
                  className="btn btn-accent"
                  onClick={generateRandomTeams}
                  disabled={generating || tournamentPlayers.length < 3}
                  aria-label="랜덤 팀 생성"
                >
                  {generating ? '생성 중...' : '랜덤 팀 생성'}
                </button>
              )}
              <button className="btn btn-success" onClick={openAddTeamModal} aria-label="새 팀 추가">
                + 새 팀 추가
              </button>
            </div>
          </div>

          {/* 팀 카드 목록 */}
          {teams.length === 0 ? (
            <p className="text-gray-400">팀이 아직 생성되지 않았습니다.</p>
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
                      <h3 className="text-lg font-bold text-cyan-400">{team.name} ({memberCount}명){team.coachName ? ` / 코치: ${team.coachName}` : ''}</h3>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-sm text-blue-400 hover:text-blue-300"
                          onClick={() => isEditing ? setEditingTeamId(null) : startEditing(team.id)}
                          aria-label={`${team.name} ${isEditing ? '접기' : '편집'}`}
                        >
                          {isEditing ? '접기' : '편집'}
                        </button>
                        <button
                          className="text-sm text-red-400 hover:text-red-300"
                          onClick={() => handleDeleteTeam(team.id)}
                          aria-label={`${team.name} 삭제`}
                        >
                          삭제
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
                              {player?.gender === 'male' && <span className="ml-1 text-xs text-blue-400">남</span>}
                              {player?.gender === 'female' && <span className="ml-1 text-xs text-pink-400">여</span>}
                            </span>
                            <button
                              className="text-red-400 hover:text-red-300 font-bold text-sm"
                              onClick={() => handleRemoveMemberFromTeam(memberId, team.id)}
                              aria-label={`${memberName} 제거`}
                            >
                              x
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {memberCount === 0 && (
                      <p className="text-gray-400 text-sm mt-2">선수를 추가해주세요.</p>
                    )}
                    {/* 팀 내 선수 추가 */}
                    <div className="mt-3">
                      <KoreanNameInput
                        placeholder="선수 이름"
                        ariaLabel={`${team.name} 선수 추가`}
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
                          팀별 설정 (비워두면 대회 기본값 적용{globalMaxReserves != null || globalGenderRatio ? `: 예비 ${globalMaxReserves ?? '-'}명, 남 ${globalGenderRatio?.male ?? '-'} / 여 ${globalGenderRatio?.female ?? '-'}` : ''})
                        </p>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">코치</label>
                          <input
                            type="text"
                            className="input w-full"
                            value={editCoachName}
                            placeholder="코치 이름"
                            onChange={e => setEditCoachName(e.target.value)}
                            aria-label={`${team.name} 코치`}
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">예비 선수 수</label>
                          <input
                            type="number"
                            className="input w-full"
                            min={0}
                            max={20}
                            value={editMaxReserves}
                            placeholder={globalMaxReserves != null ? `기본값: ${globalMaxReserves}` : '미설정'}
                            onChange={e => setEditMaxReserves(e.target.value)}
                            aria-label={`${team.name} 예비 선수 수`}
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">성별 비율</label>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="block text-xs text-gray-300 mb-0.5">남</label>
                              <input
                                type="number"
                                className="input w-full"
                                min={0}
                                max={20}
                                value={editGenderMale}
                                placeholder={globalGenderRatio ? `기본: ${globalGenderRatio.male}` : '미설정'}
                                onChange={e => setEditGenderMale(e.target.value)}
                                aria-label={`${team.name} 남자 선수 수`}
                              />
                            </div>
                            <div className="flex-1">
                              <label className="block text-xs text-gray-300 mb-0.5">여</label>
                              <input
                                type="number"
                                className="input w-full"
                                min={0}
                                max={20}
                                value={editGenderFemale}
                                placeholder={globalGenderRatio ? `기본: ${globalGenderRatio.female}` : '미설정'}
                                onChange={e => setEditGenderFemale(e.target.value)}
                                aria-label={`${team.name} 여자 선수 수`}
                              />
                            </div>
                          </div>
                        </div>
                        <button
                          className="btn btn-primary w-full"
                          onClick={saveTeamSettings}
                          aria-label="팀 설정 저장"
                        >
                          설정 저장
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

      {/* 수동 모드: 조별 리그 설정 */}
      {tournament.formatType === 'manual' && tournamentPlayers.length >= 4 && (
        <div className="card space-y-4">
          <h3 className="text-lg font-bold text-yellow-400">조별 리그 설정</h3>
          <p className="text-gray-400 text-sm">조 수를 설정하면 참가자를 조별로 배정하고 조별 라운드로빈 대진을 생성할 수 있습니다.</p>
          <div className="flex items-center gap-4">
            <label className="text-gray-300">조 수</label>
            <input
              type="number"
              className="input w-24"
              min={2}
              max={Math.min(16, Math.floor(tournamentPlayers.length / 2))}
              value={manualGroupCount}
              onChange={e => setManualGroupCount(Math.max(2, Math.min(16, Number(e.target.value) || 2)))}
              aria-label="조 수"
            />
            <span className="text-gray-400 text-sm">
              (조당 약 {Math.ceil(tournamentPlayers.length / manualGroupCount)}명)
            </span>
          </div>
          <button
            className="btn btn-primary w-full"
            onClick={async () => {
              const now = Date.now();
              const existingStages = toArray(tournament.stages);
              const existingQualifying = existingStages.find(s => s.type === 'qualifying');
              const qualifyingStage = existingQualifying || {
                id: `stage_qualifying_${now}`,
                name: '조별 예선',
                order: 0,
                type: 'qualifying' as const,
                format: 'group_knockout' as const,
                groupCount: manualGroupCount,
                status: 'pending' as const,
              };
              const updatedStage = { ...qualifyingStage, groupCount: manualGroupCount };
              const stages = existingQualifying
                ? existingStages.map(s => s.id === existingQualifying.id ? updatedStage : s)
                : [updatedStage, ...existingStages];
              await updateTournament({
                stages,
                qualifyingConfig: {
                  ...(tournament.qualifyingConfig || {}),
                  groupCount: manualGroupCount,
                  format: 'group_round_robin',
                },
              });
            }}
            aria-label="조별 리그 설정 저장"
          >
            {tournament.qualifyingConfig?.groupCount ? '조 설정 업데이트' : '조별 리그 설정 저장'}
          </button>
          {tournament.qualifyingConfig?.groupCount && (
            <p className="text-green-400 text-sm">현재 {tournament.qualifyingConfig.groupCount}개 조 설정됨. 대진표 탭에서 조 편성 및 대진 생성이 가능합니다.</p>
          )}

          {/* 본선 설정 */}
          {tournament.qualifyingConfig?.groupCount && (
            <div className="border-t border-gray-700 pt-4 mt-4 space-y-3">
              <h4 className="text-md font-bold text-cyan-400">본선 토너먼트 설정</h4>
              <p className="text-gray-400 text-sm">조별 예선 후 본선에 진출할 인원 수와 형식을 설정합니다.</p>
              <div className="flex items-center gap-4">
                <label className="text-gray-300">조당 진출 인원</label>
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
                    // 2의 거듭제곱으로 본선 시작 라운드 결정
                    let startRound = 4;
                    while (startRound < totalAdvance) startRound *= 2;

                    const existingStages = toArray(tournament.stages);
                    const existingFinals = existingStages.find(s => s.type === 'finals');
                    const now = Date.now();
                    const finalsStage = existingFinals || {
                      id: `stage_finals_${now}`,
                      name: '본선 토너먼트',
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
                  aria-label="조당 진출 인원"
                />
                <span className="text-gray-400 text-sm">
                  (총 {(() => {
                    const fc = tournament.finalsConfig as Record<string, unknown> | undefined;
                    const apc = fc?.advancePerGroup;
                    const adv = typeof apc === 'number' ? apc : 2;
                    return adv * (tournament.qualifyingConfig?.groupCount || 2);
                  })()}명 본선 진출)
                </span>
              </div>
              {toArray(tournament.stages).find(s => s.type === 'finals') && (
                <p className="text-green-400 text-sm">본선 설정 완료. 대진표 탭에서 조별 예선 대진 생성 → 예선 완료 후 본선 대진을 수동 편성할 수 있습니다.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 탑시드 지정 */}
      {tournament.qualifyingConfig?.groupCount && tournament.qualifyingConfig.groupCount > 1 && tournamentPlayers.length > 0 && (() => {
        const groupCount = tournament.qualifyingConfig!.groupCount;
        const seedLabel = (idx: number) => String.fromCharCode(65 + idx); // 0→A, 1→B, ...
        const maxSeeds = groupCount; // 시드 수 = 조 수
        return (
          <div className="card space-y-4">
            <h3 className="text-lg font-bold text-yellow-400">탑시드 지정</h3>
            <p className="text-gray-400 text-sm">
              시드 선수는 해당 조에 배치됩니다 (시드 A → A조, 시드 B → B조).
              {maxSeeds > 0 && ` 최대 ${maxSeeds}명까지 지정 가능합니다.`}
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
                      aria-label={hasSeed ? `${player.name} 시드 ${label} (${label}조 배치, 해제하려면 클릭)` : `${player.name} 시드 지정`}
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
                      <span className="text-yellow-400 text-xs font-bold">시드 {label} → {label}조</span>
                    )}
                  </div>
                );
              })}
            </div>
            {seeds.length >= maxSeeds && (
              <p className="text-gray-400 text-xs">시드가 모두 지정되었습니다 ({seeds.length}/{maxSeeds}). 해제 후 다시 지정할 수 있습니다.</p>
            )}
            <button className="btn btn-primary w-full" onClick={saveSeeds} aria-label="시드 저장">시드 저장</button>
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
            <h3 id="add-team-modal-title" className="text-xl font-bold text-yellow-400">새 팀 추가</h3>

            <div>
              <label htmlFor="new-team-name" className="block text-sm text-gray-300 mb-1">팀 이름</label>
              <input
                id="new-team-name"
                className="input w-full"
                value={newTeamName}
                onChange={e => setNewTeamName(e.target.value)}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                placeholder={`${teams.length + 1}팀`}
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="new-team-coach" className="block text-sm text-gray-300 mb-1">코치 이름 (선택)</label>
              <input
                id="new-team-coach"
                className="input w-full"
                value={newTeamCoach}
                onChange={e => setNewTeamCoach(e.target.value)}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                placeholder="코치 이름"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">선수 등록</label>
              <div className="mb-3">
                <KoreanNameInput
                  placeholder="선수 이름"
                  ariaLabel="선수 이름"
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
                        {m.gender === 'male' && <span className="ml-1 text-xs text-blue-400">남</span>}
                        {m.gender === 'female' && <span className="ml-1 text-xs text-pink-400">여</span>}
                      </span>
                      <button
                        className="text-red-400 hover:text-red-300 font-bold text-sm"
                        onClick={() => setNewTeamMembers(prev => prev.filter((_, j) => j !== i))}
                        aria-label={`${m.name} 제거`}
                      >
                        x
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {newTeamMembers.length === 0 && (
                <p className="text-gray-400 text-sm">선수를 추가해주세요.</p>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                className="btn btn-success flex-1"
                onClick={handleAddTeamFromModal}
                aria-label="팀 생성"
              >
                팀 생성 ({newTeamMembers.length}명)
              </button>
              <button
                className="btn btn-secondary flex-1"
                onClick={() => setShowAddTeamModal(false)}
                aria-label="취소"
              >
                취소
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
              <h2 id="global-player-modal-title" className="text-xl font-bold">전역 선수에서 가져오기</h2>
              <button
                className="text-gray-400 hover:text-white font-bold text-xl"
                onClick={() => setShowGlobalModal(false)}
                aria-label="닫기"
              >
                x
              </button>
            </div>
            {globalPlayers.length === 0 ? (
              <p className="text-gray-400">등록된 전역 선수가 없습니다.</p>
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
                      aria-label={`${p.name} ${selected ? '선택됨' : '선택안됨'}`}
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
                aria-label="선택한 선수 가져오기"
              >
                {selectedGlobalIds.length}명 가져오기
              </button>
              <button
                className="btn bg-gray-700 text-white hover:bg-gray-600 flex-1"
                onClick={() => setShowGlobalModal(false)}
                aria-label="취소"
              >
                취소
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
  updateMatch: (matchId: string, data: Partial<Match>) => Promise<void>;
  addMatch: (match: Omit<Match, 'id'>) => Promise<string | null>;
  deleteMatch: (matchId: string) => Promise<void>;
  updateTournament: (data: Record<string, unknown>) => Promise<void>;
  referees: { id: string; name: string }[];
  courts: { id: string; name: string }[];
  isTeamType: boolean;
}

function BracketTab({ tournament, matches, tournamentPlayers, teams, setMatchesBulk, updateMatch, addMatch, deleteMatch, updateTournament, referees, courts, isTeamType }: BracketTabProps) {
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

    const groups = buildGroupAssignment(playerIds, groupCount, seedIds);
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

  const handleAssign = useCallback(async (matchId: string, field: 'refereeId' | 'courtId', value: string) => {
    const data: Partial<Match> = { [field]: value || undefined };
    if (field === 'refereeId') {
      const found = referees.find(r => r.id === value);
      data.refereeName = found?.name ?? undefined;
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
    alert(`${unassigned.length}경기에 심판이 배정되었습니다.`);
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
    if (!confirm('이 경기를 삭제하시겠습니까?')) return;
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

  const canGenerate = isTeamType ? teams.length >= 2 : tournamentPlayers.length >= 2;
  const selectOptions = isTeamType
    ? teams.map(t => ({ id: t.id, name: t.name }))
    : tournamentPlayers.map(p => ({ id: p.id, name: p.name }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-xl font-bold">대진표</h2>
        <div className="flex gap-2 flex-wrap">
          {!isManualMode && (
            <button
              className="btn btn-accent"
              onClick={generateBracket}
              disabled={generating || !canGenerate}
              aria-label="대진표 자동 생성"
            >
              {generating ? '생성 중...' : (groupAssignment.length > 0 && groupAssignment.some(g => g.playerIds.length > 0) ? '조별 라운드로빈 대진 생성' : '대진표 자동 생성')}
            </button>
          )}
          <button
            className="btn btn-success"
            onClick={() => setShowAddForm(v => !v)}
            aria-label="경기 추가"
          >
            경기 추가
          </button>
        </div>
      </div>

      {/* 경기 추가 폼 */}
      {showAddForm && (
        <div className="card space-y-3 border-green-600">
          <h3 className="font-bold text-green-400">경기 추가</h3>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-40">
              <label className="block text-sm text-gray-300 mb-1">{isTeamType ? '팀 1' : '선수 1'}</label>
              <select className="input w-full" value={addPlayer1} onChange={e => setAddPlayer1(e.target.value)} aria-label={isTeamType ? '팀 1 선택' : '선수 1 선택'}>
                <option value="">선택</option>
                {selectOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-40">
              <label className="block text-sm text-gray-300 mb-1">{isTeamType ? '팀 2' : '선수 2'}</label>
              <select className="input w-full" value={addPlayer2} onChange={e => setAddPlayer2(e.target.value)} aria-label={isTeamType ? '팀 2 선택' : '선수 2 선택'}>
                <option value="">선택</option>
                {selectOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-32">
              <label className="block text-sm text-gray-300 mb-1">조 ID (선택)</label>
              <input className="input w-full" value={addGroupId} onChange={e => setAddGroupId(e.target.value)} placeholder="예: group_1" aria-label="조 ID" />
            </div>
            <button
              className="btn btn-success"
              onClick={handleAddMatch}
              disabled={!addPlayer1 || !addPlayer2 || addPlayer1 === addPlayer2}
              aria-label="추가"
            >
              추가
            </button>
          </div>
          {addPlayer1 && addPlayer2 && addPlayer1 === addPlayer2 && (
            <p className="text-red-400 text-sm">같은 선수/팀을 선택할 수 없습니다.</p>
          )}
        </div>
      )}

      {/* 조 편성 (조별 예선이 있을 때) */}
      {tournament.qualifyingConfig?.groupCount && tournament.qualifyingConfig.groupCount > 1 && tournamentPlayers.length > 0 && (
        <div className="card space-y-4 mb-4">
          <h3 className="text-lg font-bold text-yellow-400">조 편성</h3>
          {isManualMode ? (
            <p className="text-gray-400 text-sm">각 선수를 원하는 조로 직접 배정하세요. 드롭다운에서 조를 선택하여 이동합니다.</p>
          ) : (
            <button className="btn btn-success w-full" onClick={handleAutoGroupAssignment} aria-label="자동 편성 (Snake Draft)">
              자동 편성 (Snake Draft)
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
                        {g.name} ({sizes[i]}명)
                      </span>
                    </span>
                  ))}
                  {isUnbalanced && <span className="ml-2 text-yellow-400"> -- 조별 인원이 불균형합니다</span>}
                </div>

                {/* 미배정 선수 */}
                {unassignedPlayers.length > 0 && (
                  <div className="bg-red-900/30 border border-red-600 rounded p-3">
                    <h4 className="text-sm font-bold text-red-400 mb-2">미배정 선수 ({unassignedPlayers.length}명)</h4>
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
                              aria-label={`${player.name} 조 배정`}
                            >
                              <option value="">조 선택</option>
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
                    조 편성이 수동으로 변경되었습니다. 대진표를 다시 생성해야 변경 사항이 반영됩니다.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {groupAssignment.map(group => (
                    <div key={group.id} className="bg-gray-800 rounded p-3">
                      <h4 className="text-lg font-bold text-cyan-400 mb-2">{group.name} ({group.playerIds.length}명)</h4>
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
                                aria-label={`${player?.name || pid} 조 이동`}
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
          {isTeamType ? '팀이 2개 이상 필요합니다.' : '참가 선수가 2명 이상 필요합니다.'}
        </p>
      )}

      {matches.length > 0 && referees.length > 0 && (
        <div className="card p-4 space-y-3">
          <h3 className="font-bold">일괄 심판 배정</h3>
          <p className="text-gray-400 text-sm">심판을 선택하면 배정되지 않은 모든 경기에 순서대로 배정됩니다.</p>
          <div className="flex gap-2 flex-wrap">
            <button
              className="btn btn-primary"
              onClick={handleBulkAssignReferees}
              aria-label="심판 자동 배정 (라운드로빈)"
            >
              자동 배정 (라운드로빈)
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
            <h3 className="text-lg font-bold text-cyan-400">본선 대진 생성</h3>

            {!hasQualifyingMatches ? (
              <p className="text-gray-400 text-sm">먼저 조별 예선 대진을 생성하세요.</p>
            ) : (
              <>
                <div className="text-sm text-gray-400">
                  예선 진행: {completedCount}/{totalCount}경기 완료 | 조당 {advancePerGroup}명 진출 (총 {totalAdvance}명) | 본선 {matchCount}경기
                </div>

                {/* 조별 순위 현황 */}
                {completedCount > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-bold text-gray-300">조별 순위 현황</h4>
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
                                <span className="w-6">{info.rank}위</span>
                                <span>{idToName.get(pid) || pid}</span>
                                {info.rank <= advancePerGroup && <span className="text-green-500 ml-auto">진출</span>}
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
                        player1Name: '미정',
                        player2Name: '미정',
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
                  aria-label="본선 대진 슬롯 생성"
                >
                  본선 {matchCount}경기 슬롯 생성 (이후 수동 편성)
                </button>
                <p className="text-gray-400 text-xs">슬롯 생성 후 각 경기에 조/순위별 선수를 직접 배정할 수 있습니다.</p>
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
          if (info) return `${info.groupName} ${info.rank}위: ${name}`;
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
          alert('본선 대진이 변경되었습니다.');
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
            <h3 className="text-lg font-bold text-yellow-400">본선 대진 편성</h3>

            {/* Preset buttons (자동 모드만) */}
            {!isManualMode && (
              <div className="flex gap-2 flex-wrap">
                <button className="btn btn-primary" onClick={() => applyArrangement('cross')} aria-label="교차 편성">
                  교차 편성
                </button>
                <button className="btn btn-secondary" onClick={() => applyArrangement('sequential')} aria-label="순차 편성">
                  순차 편성
                </button>
              </div>
            )}
            {isManualMode && (
              <p className="text-gray-400 text-sm">각 경기에서 조와 순위를 직접 선택하여 수동으로 대진을 편성하세요.</p>
            )}

            {/* Manual arrangement: group+rank selectors per match */}
            <div className="space-y-2">
              <p className="text-gray-400 text-sm">각 경기에서 조와 순위를 직접 선택하여 편성할 수 있습니다.</p>
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
                        aria-label={`경기${i + 1} ${slot === 'player1' ? '선수1' : '선수2'} 조 선택`}
                      >
                        <option value="">조</option>
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
                        aria-label={`경기${i + 1} ${slot === 'player1' ? '선수1' : '선수2'} 순위 선택`}
                      >
                        <option value="">순위</option>
                        {Array.from({ length: maxRank }, (_, k) => k + 1).map(r => {
                          const pid = groupVal ? findByGroupRank(groupVal, r) : null;
                          return (
                            <option key={r} value={r} disabled={!pid}>
                              {r}위{pid ? ` (${idToName.get(pid) || ''})` : ''}
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
                      <span className="text-gray-400 text-sm font-mono w-16">경기{i + 1}</span>
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
                            aria-label={`경기${i + 1} 선수1 선택`}
                          >
                            <option value="">선택</option>
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
                            aria-label={`경기${i + 1} 선수2 선택`}
                          >
                            <option value="">선택</option>
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
                        {p1Id ? getLabel(p1Id) : '미정'} vs {p2Id ? getLabel(p2Id) : '미정'}
                      </div>
                    )}
                    {m.status !== 'pending' && (
                      <span className="text-xs text-orange-400 ml-16">진행중/완료 경기는 변경 불가</span>
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
          <p className="text-gray-400">생성된 대진표가 없습니다.</p>
          {isManualMode && (
            <p className="text-yellow-400 text-sm mt-2">상단 "경기 추가" 버튼으로 경기를 하나씩 등록하세요.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map((match, matchIdx) => (
            <div key={match.id} className="card space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  {/* Reorder buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      className="text-xs text-gray-400 hover:text-white leading-none px-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleSwapRound(match.id, 'up')}
                      disabled={matchIdx === 0}
                      aria-label="순서 위로"
                    >
                      &uarr;
                    </button>
                    <button
                      className="text-xs text-gray-400 hover:text-white leading-none px-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleSwapRound(match.id, 'down')}
                      disabled={matchIdx === matches.length - 1}
                      aria-label="순서 아래로"
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
                      aria-label="경기 수정"
                    >
                      수정
                    </button>
                  )}
                  {match.status === 'pending' && (
                    <button
                      className="text-red-500 hover:text-red-400 font-bold text-lg leading-none px-1"
                      onClick={() => handleDeleteMatch(match.id)}
                      aria-label="경기 삭제"
                    >
                      &times;
                    </button>
                  )}
                  {match.walkover && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-600 text-white">
                      부전승
                    </span>
                  )}
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[match.status]}`}>
                    {STATUS_LABELS[match.status]}
                  </span>
                </div>
              </div>

              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-48">
                  <label className="block text-sm text-gray-300 mb-1">심판</label>
                  <select
                    className="input"
                    value={match.refereeId ?? ''}
                    onChange={e => handleAssign(match.id, 'refereeId', e.target.value)}
                    aria-label={`${match.type === 'individual' ? (match.player1Name ?? '?') + ' vs ' + (match.player2Name ?? '?') : (match.team1Name ?? '?') + ' vs ' + (match.team2Name ?? '?')} 심판 배정`}
                  >
                    <option value="">미배정</option>
                    {referees.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-48">
                  <label className="block text-sm text-gray-300 mb-1">경기장</label>
                  <select
                    className="input"
                    value={match.courtId ?? ''}
                    onChange={e => handleAssign(match.id, 'courtId', e.target.value)}
                    aria-label={`${match.type === 'individual' ? (match.player1Name ?? '?') + ' vs ' + (match.player2Name ?? '?') : (match.team1Name ?? '?') + ' vs ' + (match.team2Name ?? '?')} 경기장 배정`}
                  >
                    <option value="">미배정</option>
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
            <h3 id="edit-match-modal-title" className="text-lg font-bold text-yellow-400">경기 수정</h3>
            <div>
              <label className="block text-sm text-gray-300 mb-1">{isTeamType ? '팀 1' : '선수 1'}</label>
              <select className="input w-full" value={editPlayer1} onChange={e => setEditPlayer1(e.target.value)} aria-label={isTeamType ? '팀 1 변경' : '선수 1 변경'}>
                <option value="">선택</option>
                {selectOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">{isTeamType ? '팀 2' : '선수 2'}</label>
              <select className="input w-full" value={editPlayer2} onChange={e => setEditPlayer2(e.target.value)} aria-label={isTeamType ? '팀 2 변경' : '선수 2 변경'}>
                <option value="">선택</option>
                {selectOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            {editPlayer1 && editPlayer2 && editPlayer1 === editPlayer2 && (
              <p className="text-red-400 text-sm">같은 선수/팀을 선택할 수 없습니다.</p>
            )}
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={() => setEditingMatchId(null)} aria-label="취소">취소</button>
              <button
                className="btn btn-primary"
                onClick={handleEditMatch}
                disabled={!editPlayer1 || !editPlayer2 || editPlayer1 === editPlayer2}
                aria-label="저장"
              >
                저장
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
  schedule: ScheduleSlot[];
  setScheduleBulk: (slots: Omit<ScheduleSlot, 'id'>[]) => Promise<void>;
  updateMatch: (matchId: string, data: Partial<Match>) => Promise<void>;
}

function ScheduleTab({ matches, courts, schedule, setScheduleBulk, updateMatch }: ScheduleTabProps) {
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
    if (!confirm('모든 경기의 스케줄(날짜, 시간)을 초기화하시겠습니까?')) return;
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

        await updateMatch(match.id, {
          scheduledTime: timeStr,
          scheduledDate: bestDate,
          courtId: court.courtId,
          courtName: court.courtName,
        });

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
        <h2 className="text-xl font-bold">스케줄 설정</h2>
        <div className="flex gap-4 flex-wrap">
          <div>
            <label className="block text-sm text-gray-300 mb-1">날짜</label>
            <input
              type="date"
              className="input"
              value={scheduleDate}
              onChange={e => setScheduleDate(e.target.value)}
              aria-label="경기 날짜"
            />
          </div>
          <div>
            <label htmlFor="start-time" className="block text-sm text-gray-300 mb-1">시작 시간</label>
            <input
              id="start-time"
              type="time"
              className="input"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              aria-label="시작 시간"
            />
          </div>
          <div>
            <label htmlFor="interval" className="block text-sm text-gray-300 mb-1">경기 간격 (분)</label>
            <input
              id="interval"
              type="number"
              className="input"
              value={interval}
              onChange={e => setInterval_(Number(e.target.value))}
              min={10}
              max={120}
              aria-label="경기 간격"
            />
          </div>
        </div>
        <div className="flex gap-4 flex-wrap">
          <div>
            <label htmlFor="end-time" className="block text-sm text-gray-300 mb-1">마감 시간</label>
            <input
              id="end-time"
              type="time"
              className="input"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              aria-label="마감 시간"
            />
          </div>
          <div>
            <label htmlFor="rest-interval" className="block text-sm text-gray-300 mb-1">선수 휴식 시간 (분)</label>
            <input
              id="rest-interval"
              type="number"
              className="input"
              value={restInterval}
              onChange={e => setRestInterval(Number(e.target.value))}
              min={10}
              max={240}
              aria-label="선수 휴식 시간"
            />
          </div>
          <div>
            <label htmlFor="next-day-start" className="block text-sm text-gray-300 mb-1">다음날 시작 시간</label>
            <input
              id="next-day-start"
              type="time"
              className="input"
              value={nextDayStartTime}
              onChange={e => setNextDayStartTime(e.target.value)}
              aria-label="다음날 시작 시간"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyUnassigned}
            onChange={e => setOnlyUnassigned(e.target.checked)}
            aria-label="미배정 경기만 배정"
          />
          미배정 경기만 배정 (기존 스케줄 유지)
        </label>
        <button
          className="btn btn-accent"
          onClick={generateSchedule}
          disabled={generating || courts.length === 0 || matches.length === 0}
          aria-label="스케줄 자동 배정"
        >
          {generating ? '배정 중...' : '스케줄 자동 배정'}
        </button>
        {courts.length === 0 && <p className="text-gray-400">경기장을 먼저 등록해주세요.</p>}
      </div>

      {timeSlotsByDate.length > 0 && timeSlotsByDate.some(d => d.rows.length > 0) && (
        <div className="card overflow-x-auto">
          <h2 className="text-xl font-bold mb-4">스케줄 표</h2>
          {timeSlotsByDate.map(({ date, rows }) => {
            if (rows.length === 0) return null;
            return (
              <div key={date || 'no-date'} className="mb-6">
                {hasMultipleDates && (
                  <h3 className="text-lg font-bold text-yellow-400 mb-2">
                    {date || '날짜 미지정'}
                  </h3>
                )}
                <table className="w-full border-collapse mb-4" aria-label={`스케줄 그리드${date ? ` - ${date}` : ''}`}>
                  <thead>
                    <tr>
                      {hasMultipleDates && <th scope="col" className="border border-gray-600 p-3 text-left bg-gray-800">날짜</th>}
                      <th scope="col" className="border border-gray-600 p-3 text-left bg-gray-800">시간</th>
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
                                  {STATUS_LABELS[slot.status]}
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
            <h2 className="text-xl font-bold">개별 경기 스케줄</h2>
            <button
              className="btn bg-red-700 hover:bg-red-600 text-white"
              onClick={handleResetSchedule}
              disabled={resettingSchedule || matches.length === 0}
              aria-label="스케줄 초기화"
            >
              {resettingSchedule ? '초기화 중...' : '스케줄 초기화'}
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
                        {STATUS_LABELS[match.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      {match.scheduledDate && <span>{match.scheduledDate}</span>}
                      {match.scheduledTime && <span>{match.scheduledTime}</span>}
                      {match.courtName && <span>/ {match.courtName}</span>}
                      {!match.scheduledDate && !match.scheduledTime && <span className="text-gray-400">미배정</span>}
                    </div>
                  </div>
                  <div className="flex gap-3 flex-wrap items-end">
                    <div>
                      <label className="block text-xs text-gray-300 mb-1">날짜</label>
                      <input
                        type="date"
                        className="input text-sm"
                        value={edit.scheduledDate}
                        onChange={e => setManualEdit(match.id, 'scheduledDate', e.target.value)}
                        aria-label={`${matchLabel} 날짜`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-300 mb-1">시간</label>
                      <input
                        type="time"
                        className="input text-sm"
                        value={edit.scheduledTime}
                        onChange={e => setManualEdit(match.id, 'scheduledTime', e.target.value)}
                        aria-label={`${matchLabel} 시간`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-300 mb-1">경기장</label>
                      <select
                        className="input text-sm"
                        value={edit.courtId}
                        onChange={e => setManualEdit(match.id, 'courtId', e.target.value)}
                        aria-label={`${matchLabel} 경기장`}
                      >
                        <option value="">미배정</option>
                        {courts.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      className="btn btn-accent text-sm px-4 py-2"
                      onClick={() => handleSaveManualEdit(match.id)}
                      disabled={!hasEdits || savingMatchId === match.id}
                      aria-label={`${matchLabel} 스케줄 저장`}
                    >
                      {savingMatchId === match.id ? '저장 중...' : '저장'}
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
  updateTournament: (data: Record<string, unknown>) => Promise<void>;
  updateMatch: (matchId: string, data: Partial<Match>) => Promise<void>;
  isTeamType: boolean;
  tournamentPlayers: Player[];
  teams: Team[];
}

function StatusTab({ tournament, matches, updateTournament, updateMatch, isTeamType, tournamentPlayers, teams }: StatusTabProps) {
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
      const roundLabel = bracketSize >= 16 ? '16강' : bracketSize >= 8 ? '8강' : '4강';

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
    alert(`본선 대진표 생성 완료! ${finalsMatches.length}경기가 생성되었습니다.`);
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
        actionLabel: `점수 수정: ${correctionReason.trim()}`,
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

      alert('점수가 수정되었습니다.');
      closeCorrectionModal();
    } catch (err) {
      console.error('점수 수정 오류:', err);
      alert('점수 수정 중 오류가 발생했습니다.');
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
        actionLabel: `부전승: ${walkoverReason.trim()}`,
        points: 0,
        set: 0,
        server: '',
        serveNumber: 0,
        scoreBefore: { player1: 0, player2: 0 },
        scoreAfter: { player1: 0, player2: 0 },
      };

      const existingHistory = toArray(walkoverMatch.scoreHistory);

      await updateMatch(walkoverMatch.id, {
        status: 'completed',
        winnerId: walkoverWinnerId,
        walkover: true,
        walkoverReason: walkoverReason.trim(),
        sets: [{ player1Score: 0, player2Score: 0, player1Faults: 0, player2Faults: 0, player1Violations: 0, player2Violations: 0, winnerId: walkoverWinnerId }],
        scoreHistory: [...existingHistory, historyEntry],
      } as Partial<Match>);

      alert('부전승 처리가 완료되었습니다.');
      closeWalkoverModal();
    } catch (err) {
      console.error('부전승 처리 오류:', err);
      alert('부전승 처리 중 오류가 발생했습니다.');
    } finally {
      setWalkoverSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card flex items-center gap-4 flex-wrap">
        <span className="font-semibold text-lg">대회 상태:</span>
        <span className={`px-3 py-1 rounded-full font-bold ${
          tournament.status === 'draft' ? 'bg-gray-600 text-white' :
          tournament.status === 'registration' ? 'bg-blue-600 text-white' :
          tournament.status === 'in_progress' ? 'bg-orange-500 text-black' :
          tournament.status === 'paused' ? 'bg-red-600 text-white' :
          'bg-green-600 text-white'
        }`}>
          {tournament.status === 'draft' ? '초안' :
           tournament.status === 'registration' ? '접수중' :
           tournament.status === 'in_progress' ? '진행중' :
           tournament.status === 'paused' ? '일시정지' : '완료'}
        </span>

        <div className="flex gap-2 flex-wrap">
          {(tournament.status === 'draft' || tournament.status === 'registration') && (
            <button
              className="btn btn-accent"
              onClick={() => handleStatusChange('in_progress')}
              disabled={matches.length === 0}
              aria-label="대회 시작"
            >
              대회 시작
            </button>
          )}
          {tournament.status === 'in_progress' && (
            <button
              className="btn btn-danger"
              onClick={() => handleStatusChange('paused')}
              aria-label="대회 일시정지"
            >
              일시정지
            </button>
          )}
          {tournament.status === 'paused' && (
            <button
              className="btn btn-success"
              onClick={() => handleStatusChange('in_progress')}
              aria-label="대회 재개"
            >
              재개
            </button>
          )}
          {(tournament.status === 'in_progress' || tournament.status === 'paused') && (
            <button
              className="btn btn-success"
              onClick={() => handleStatusChange('completed')}
              aria-label="대회 완료"
            >
              대회 완료
            </button>
          )}
        </div>
      </div>

      {/* 대회 단계 관리 */}
      {toArray(tournament.stages).length > 0 && (
        <div className="card space-y-4">
          <h3 className="text-xl font-bold text-yellow-400">대회 단계 관리</h3>
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
                    <p className="text-xs text-gray-400">경기 완료</p>
                  </div>
                </div>
                {/* 진행률 바 */}
                <div className="w-full bg-gray-700 rounded h-2 mb-3">
                  <div className="bg-yellow-400 h-2 rounded" style={{ width: `${total > 0 ? (completed/total)*100 : 0}%` }} />
                </div>
                {allDone && stage.type === 'qualifying' && (
                  <div className="mt-3 space-y-2">
                    <p className="text-green-400 text-sm font-semibold">예선 완료 - 본선 진출자가 결정되었습니다</p>
                    <button className="btn btn-success w-full" onClick={handleAdvanceToFinals} aria-label="본선 대진표 생성">
                      본선 대진표 생성
                    </button>
                  </div>
                )}
                {allDone && stage.type === 'finals' && (
                  <p className="text-green-400 text-sm font-semibold">본선 완료</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          className={`btn ${filter === 'all' ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
          aria-label="전체 경기 필터"
        >
          전체 ({matches.length})
        </button>
        <button
          className={`btn ${filter === 'pending' ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
          onClick={() => setFilter('pending')}
          aria-pressed={filter === 'pending'}
          aria-label="대기 경기 필터"
        >
          대기 ({counts.pending})
        </button>
        <button
          className={`btn ${filter === 'in_progress' ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
          onClick={() => setFilter('in_progress')}
          aria-pressed={filter === 'in_progress'}
          aria-label="진행중 경기 필터"
        >
          진행중 ({counts.in_progress})
        </button>
        <button
          className={`btn ${filter === 'completed' ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
          onClick={() => setFilter('completed')}
          aria-pressed={filter === 'completed'}
          aria-label="완료 경기 필터"
        >
          완료 ({counts.completed})
        </button>
      </div>

      <div className="space-y-3" aria-live="polite">
        {filtered.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-gray-400">표시할 경기가 없습니다.</p>
          </div>
        ) : (
          filtered.map(match => (
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
                  {match.scheduledTime && <span className="text-sm text-cyan-400">{match.scheduledTime}</span>}
                  {match.walkover && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-600 text-white">
                      부전승
                    </span>
                  )}
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[match.status]}`}>
                    {STATUS_LABELS[match.status]}
                  </span>
                  {match.status !== 'completed' && (
                    <button
                      className="btn bg-orange-600 hover:bg-orange-500 text-white text-xs px-3 py-1"
                      onClick={() => openWalkoverModal(match)}
                      aria-label="부전승 처리"
                    >
                      부전승
                    </button>
                  )}
                </div>
              </div>

              {match.status === 'completed' && match.walkover && match.walkoverReason && (
                <div className="text-sm text-orange-300 mt-1">
                  부전승 사유: {match.walkoverReason}
                </div>
              )}

              {match.status === 'completed' && match.sets && (
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  <div className="flex gap-2 flex-wrap">
                    {match.sets.map((s, i) => (
                      <span key={i} className="px-3 py-1 bg-gray-800 rounded text-sm font-mono">
                        {match.sets && match.sets.length > 1 ? `S${i + 1}: ` : ''}{s.player1Score}-{s.player2Score}
                      </span>
                    ))}
                  </div>
                  <button
                    className="btn bg-yellow-700 hover:bg-yellow-600 text-white text-xs px-3 py-1"
                    onClick={() => openCorrectionModal(match)}
                    aria-label="점수 수정"
                  >
                    점수 수정
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 점수 수정 모달 */}
      {correctionMatch && (
        <div className="modal-backdrop" onClick={closeCorrectionModal} onKeyDown={e => { if (e.key === 'Escape') closeCorrectionModal(); }}>
          <div className="card max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="correction-modal-title">
            <div className="flex items-center justify-between mb-4">
              <h2 id="correction-modal-title" className="text-xl font-bold">점수 수정</h2>
              <button
                className="text-gray-400 hover:text-white font-bold text-xl"
                onClick={closeCorrectionModal}
                aria-label="닫기"
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
                      aria-label={`세트 ${i + 1} ${correctionMatch.player1Name ?? 'P1'} 점수`}
                    />
                    <span className="text-gray-400">-</span>
                    <input
                      type="number"
                      min={0}
                      className="input w-20 text-center"
                      value={s.player2Score}
                      onChange={e => handleCorrectionSetScore(i, 'player2Score', parseInt(e.target.value) || 0)}
                      aria-label={`세트 ${i + 1} ${correctionMatch.player2Name ?? 'P2'} 점수`}
                    />
                    <label className="text-sm text-gray-300">
                      {correctionMatch.type === 'individual' ? (correctionMatch.player2Name ?? 'P2') : (correctionMatch.team2Name ?? 'T2')}
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-4 p-3 bg-gray-800 rounded-lg">
              <span className="text-sm text-gray-400">자동 계산 승자: </span>
              <span className="font-bold text-yellow-400">
                {correctionWinner === 1
                  ? (correctionMatch.type === 'individual' ? correctionMatch.player1Name : correctionMatch.team1Name) ?? 'P1'
                  : correctionWinner === 2
                  ? (correctionMatch.type === 'individual' ? correctionMatch.player2Name : correctionMatch.team2Name) ?? 'P2'
                  : '미정 (세트 승수 부족)'}
              </span>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">수정 사유 (필수)</label>
              <input
                type="text"
                className="input w-full"
                value={correctionReason}
                onChange={e => setCorrectionReason(e.target.value)}
                placeholder="예: 심판 기록 오류 수정"
                aria-label="수정 사유"
              />
            </div>

            <div className="flex gap-2">
              <button
                className="btn btn-accent flex-1"
                onClick={handleSaveCorrection}
                disabled={!correctionReason.trim() || correctionSaving}
                aria-label="점수 수정 저장"
              >
                {correctionSaving ? '저장 중...' : '저장'}
              </button>
              <button
                className="btn bg-gray-700 text-white hover:bg-gray-600 flex-1"
                onClick={closeCorrectionModal}
                aria-label="취소"
              >
                취소
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
              <h2 id="walkover-modal-title" className="text-xl font-bold text-orange-400">부전승 처리</h2>
              <button
                className="text-gray-400 hover:text-white font-bold text-xl"
                onClick={closeWalkoverModal}
                aria-label="닫기"
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
              <label className="block text-sm font-semibold mb-2">승자 선택</label>
              <div className="flex gap-2">
                {(() => {
                  const p1Id = walkoverMatch.player1Id || walkoverMatch.team1Id || '';
                  const p1Name = walkoverMatch.type === 'individual' ? (walkoverMatch.player1Name ?? '선수1') : (walkoverMatch.team1Name ?? '팀1');
                  const p2Id = walkoverMatch.player2Id || walkoverMatch.team2Id || '';
                  const p2Name = walkoverMatch.type === 'individual' ? (walkoverMatch.player2Name ?? '선수2') : (walkoverMatch.team2Name ?? '팀2');
                  return (
                    <>
                      <button
                        className={`btn flex-1 ${walkoverWinnerId === p1Id ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                        onClick={() => setWalkoverWinnerId(p1Id)}
                        aria-label={`${p1Name} 승`}
                      >
                        {p1Name} 승
                      </button>
                      <button
                        className={`btn flex-1 ${walkoverWinnerId === p2Id ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                        onClick={() => setWalkoverWinnerId(p2Id)}
                        aria-label={`${p2Name} 승`}
                      >
                        {p2Name} 승
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">사유 (필수)</label>
              <input
                type="text"
                className="input w-full"
                value={walkoverReason}
                onChange={e => setWalkoverReason(e.target.value)}
                placeholder="예: 기권, 부상, 노쇼"
                aria-label="부전승 사유"
              />
            </div>

            <div className="flex gap-2">
              <button
                className="btn bg-orange-600 hover:bg-orange-500 text-white flex-1"
                onClick={handleSaveWalkover}
                disabled={!walkoverWinnerId || !walkoverReason.trim() || walkoverSaving}
                aria-label="부전승 확인"
              >
                {walkoverSaving ? '처리 중...' : '확인'}
              </button>
              <button
                className="btn bg-gray-700 text-white hover:bg-gray-600 flex-1"
                onClick={closeWalkoverModal}
                aria-label="취소"
              >
                취소
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
    const filename = `${tournament.name}_결과_${tournament.date || 'export'}.csv`;
    downloadCSV(csv, filename);
  };

  const handleCopyResults = async () => {
    const lines: string[] = [];
    lines.push(`[${tournament.name}] 결과`);
    lines.push(`날짜: ${tournament.date}${tournament.endDate ? ` ~ ${tournament.endDate}` : ''}`);
    lines.push(`유형: ${isTeamType ? '팀전' : '개인전'}`);
    lines.push('');

    if (isTeamType) {
      const teamRankings = calculateTeamRanking(matches);
      teamRankings.forEach(r => {
        lines.push(`${r.rank}위: ${r.teamName || r.teamId} (${r.wins}승 ${r.losses}패, 득실차 ${formatDiff(r.pointsFor - r.pointsAgainst)})`);
      });
    } else {
      const indivRankings = calculateIndividualRanking(matches);
      indivRankings.forEach(r => {
        lines.push(`${r.rank}위: ${r.playerName || r.playerId} (${r.wins}승 ${r.losses}패)`);
      });
    }

    lines.push('');
    lines.push(`총 ${completedMatches.length}/${matches.length} 경기 완료`);

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
      <span className="font-semibold text-gray-300">내보내기</span>
      <button
        className="btn btn-secondary"
        onClick={handleExportCSV}
        disabled={completedMatches.length === 0}
        aria-label="CSV 내보내기"
      >
        CSV 내보내기
      </button>
      <button
        className="btn btn-secondary"
        onClick={handleCopyResults}
        disabled={completedMatches.length === 0}
        aria-label="결과 복사"
      >
        {copySuccess ? '복사됨!' : '결과 복사'}
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
            <span className="text-gray-400 text-sm">경기 진행</span>
            <p className="text-lg font-bold">{completedMatches.length} / {matches.length}</p>
          </div>
          <div>
            <span className="text-gray-400 text-sm">평균 득점 (경기당)</span>
            <p className="text-lg font-bold">{avgPointsPerMatch}</p>
          </div>
        </div>

        <div className="card overflow-x-auto">
          <h2 className="text-xl font-bold mb-4">팀 순위</h2>
          {rankings.length === 0 ? (
            <p className="text-gray-400">완료된 경기가 없습니다.</p>
          ) : (
            <table className="w-full border-collapse" aria-label="팀 순위표">
              <thead>
                <tr>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">순위</th>
                  <th scope="col" className="border border-gray-600 p-3 text-left bg-gray-800">팀명</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">경기수</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">승</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">패</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">득실점</th>
                  <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">득실차</th>
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
            <h2 className="text-xl font-bold mb-4">완료된 경기</h2>
            <div className="space-y-2">
              {completedMatchesSorted.map(match => (
                <div key={match.id} className="bg-gray-800 rounded-lg px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                  <span className="font-semibold">{match.team1Name ?? '?'} vs {match.team2Name ?? '?'}</span>
                  <div className="flex gap-2">
                    {(match.sets || []).map((s, i) => (
                      <span key={i} className="px-2 py-0.5 bg-gray-700 rounded text-sm font-mono">{s.player1Score}-{s.player2Score}</span>
                    ))}
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
          <span className="text-gray-400 text-sm">경기 진행</span>
          <p className="text-lg font-bold">{completedMatches.length} / {matches.length}</p>
        </div>
        <div>
          <span className="text-gray-400 text-sm">평균 득점 (경기당)</span>
          <p className="text-lg font-bold">{avgPointsPerMatch}</p>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="text-xl font-bold mb-4">개인 순위</h2>
        {rankings.length === 0 ? (
          <p className="text-gray-400">완료된 경기가 없습니다.</p>
        ) : (
          <table className="w-full border-collapse" aria-label="개인 순위표">
            <thead>
              <tr>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">순위</th>
                <th scope="col" className="border border-gray-600 p-3 text-left bg-gray-800">이름</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">경기수</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">승</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">패</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">세트득실</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">세트차</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">포인트득실</th>
                <th scope="col" className="border border-gray-600 p-3 text-center bg-gray-800">득실차</th>
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
          <h2 className="text-xl font-bold mb-4">완료된 경기</h2>
          <div className="space-y-2">
            {completedMatchesSorted.map(match => (
              <div key={match.id} className="bg-gray-800 rounded-lg px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                <span className="font-semibold">{match.player1Name ?? '?'} vs {match.player2Name ?? '?'}</span>
                <div className="flex gap-2">
                  {(match.sets || []).map((s, i) => (
                    <span key={i} className="px-2 py-0.5 bg-gray-700 rounded text-sm font-mono">{s.player1Score}-{s.player2Score}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
