import { useState, useMemo, useCallback } from 'react';
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
import { createEmptySet } from '@shared/utils/scoring';
import { calculateIndividualRanking, calculateTeamRanking } from '@shared/utils/ranking';
import { simulateTournament } from '@shared/utils/simulation';
import type { Match, Team, Player, MatchStatus, ScheduleSlot } from '@shared/types';
import NumberStepper from '../components/tournament-create/NumberStepper';

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
  const [simCount, setSimCount] = useState(16);

  const { tournament, loading: tLoading, updateTournament } = useTournament(id ?? null);
  const { matches, loading: mLoading, setMatchesBulk, updateMatch } = useMatches(id ?? null);
  const { players: globalPlayers, loading: gpLoading } = usePlayers();
  const { players: tournamentPlayers, loading: tpLoading, addPlayer: addTournamentPlayer, deletePlayer: deleteTournamentPlayer, addPlayersFromGlobal } = useTournamentLocalPlayers(id ?? null);
  const { teams, setTeamsBulk } = useTeams(id ?? null);
  const { referees, updateReferee } = useReferees();
  const { courts } = useCourts();
  const { schedule, setScheduleBulk } = useSchedule(id ?? null);

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
    const playerCount = tournamentPlayers.length > 0 ? tournamentPlayers.length : simCount;
    if (!confirm(`시뮬레이션을 실행합니다.\n\n• 참가자 ${playerCount}명 ${tournamentPlayers.length > 0 ? '(등록된 선수 사용)' : '(가상 생성)'}\n• 기존 경기 데이터가 초기화됩니다\n• 대회 규칙 설정은 유지됩니다\n\n계속하시겠습니까?`)) return;

    setSimulating(true);
    try {
      setSimProgress('시뮬레이션 데이터 생성 중...');
      const result = simulateTournament(tournament, playerCount);

      setSimProgress(`참가자 ${result.players.length}명 등록 중...`);
      for (const player of result.players) {
        await addTournamentPlayer({ name: player.name });
      }

      if (result.teams && result.teams.length > 0) {
        setSimProgress(`팀 ${result.teams.length}개 생성 중...`);
        await setTeamsBulk(result.teams);
      }

      setSimProgress(`경기 ${result.matches.length}건 생성 중...`);
      await setMatchesBulk(result.matches);

      if (result.schedule && result.schedule.length > 0) {
        setSimProgress(`스케줄 ${result.schedule.length}건 저장 중...`);
        await setScheduleBulk(result.schedule);
      }

      // 심판 자동 배정: 기존 등록된 심판이 있으면 사용, 없으면 가상 심판 사용
      const existingReferees = referees;
      const simReferees = existingReferees.length > 0
        ? existingReferees.map(r => ({ id: r.id, name: r.name, assignedMatchIds: [] as string[] }))
        : result.referees;

      if (simReferees && simReferees.length > 0) {
        // 기존 심판에게 경기 배정
        if (existingReferees.length > 0) {
          result.matches.forEach((_, idx) => {
            const refIdx = idx % simReferees.length;
            simReferees[refIdx].assignedMatchIds.push(`sim_match_${idx}`);
          });
        }
        setSimProgress(`심판 ${simReferees.length}명 배정 정보 저장 중...`);
        for (const ref of simReferees) {
          await updateReferee(ref.id, { assignedMatchIds: ref.assignedMatchIds });
        }
      }

      setSimProgress('대회 상태 업데이트 중...');
      await updateTournament({ status: 'completed' });

      setSimProgress('시뮬레이션 완료! ✅');
      // 3초 후 메시지 클리어
      setTimeout(() => setSimProgress(''), 3000);
    } catch (err) {
      console.error('시뮬레이션 오류:', err);
      setSimProgress('시뮬레이션 중 오류 발생');
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-yellow-400">{tournament.name}</h1>
          <p className="text-gray-400 mt-1">{tournament.date} | {tournament.type === 'individual' ? '개인전' : tournament.type === 'team' ? '팀전' : '랜덤 팀리그전'}</p>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate('/admin')} aria-label="뒤로가기">
          뒤로
        </button>
      </div>

      {tournament.status === 'draft' && (
        <div className="card bg-purple-900/30 border-purple-500 p-4">
          <h3 className="text-lg font-bold text-purple-400 mb-2">테스트 시뮬레이션</h3>
          <p className="text-gray-400 text-sm mb-3">가상 참가자, 경기 결과, 순위를 자동으로 생성합니다.</p>
          <div className="mb-3">
            <NumberStepper
              label="시뮬레이션 참가자 수"
              value={simCount}
              min={4}
              max={64}
              onChange={setSimCount}
              ariaLabel="시뮬레이션 참가자 수"
            />
          </div>
          {simProgress && <p className="text-cyan-400 text-sm mb-2">{simProgress}</p>}
          <button
            className="btn bg-purple-700 hover:bg-purple-600 text-white w-full"
            onClick={handleSimulate}
            disabled={simulating}
          >
            {simulating ? '시뮬레이션 진행 중...' : '시뮬레이션 실행'}
          </button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap border-b border-gray-700 pb-2" role="tablist" aria-label="대회 상세 탭">
        {TABS.map(tab => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`nav-link ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            aria-label={tab.label}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TABS.find(t => t.key === activeTab)?.label}>
        {activeTab === 'players' && (
          <PlayersTab
            tournamentPlayers={tournamentPlayers}
            globalPlayers={globalPlayers}
            addTournamentPlayer={addTournamentPlayer}
            deleteTournamentPlayer={deleteTournamentPlayer}
            addPlayersFromGlobal={addPlayersFromGlobal}
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
            isTeamType={isTeamType}
          />
        )}
        {activeTab === 'ranking' && (
          <RankingTab
            matches={matches}
            isTeamType={isTeamType}
          />
        )}
      </div>
    </div>
  );
}

// ========================
// Players Tab
// ========================
interface PlayersTabProps {
  tournamentPlayers: Player[];
  globalPlayers: Player[];
  addTournamentPlayer: (player: Omit<Player, 'id' | 'createdAt'>) => Promise<string | null>;
  deleteTournamentPlayer: (id: string) => Promise<void>;
  addPlayersFromGlobal: (players: Player[]) => Promise<void>;
  isTeamType: boolean;
  teams: Team[];
  setTeamsBulk: (teams: Team[]) => Promise<void>;
}

function PlayersTab({ tournamentPlayers, globalPlayers, addTournamentPlayer, deleteTournamentPlayer, addPlayersFromGlobal, isTeamType, teams, setTeamsBulk }: PlayersTabProps) {
  const [generating, setGenerating] = useState(false);
  const [showGlobalModal, setShowGlobalModal] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [bulkNames, setBulkNames] = useState('');
  const [selectedGlobalIds, setSelectedGlobalIds] = useState<string[]>([]);

  const handleAddPlayer = useCallback(async () => {
    if (!newPlayerName.trim()) return;
    await addTournamentPlayer({ name: newPlayerName.trim() });
    setNewPlayerName('');
  }, [newPlayerName, addTournamentPlayer]);

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
      const shuffled = [...tournamentPlayers];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const newTeams: Team[] = [];
      let teamIdx = 1;
      for (let i = 0; i < shuffled.length; i += 3) {
        const members = shuffled.slice(i, i + 3);
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
    } finally {
      setGenerating(false);
    }
  }, [tournamentPlayers, setTeamsBulk]);

  return (
    <div className="space-y-6">
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
              placeholder="선수 이름"
              aria-label="선수 이름"
              onKeyDown={e => { if (e.key === 'Enter' && newPlayerName.trim()) handleAddPlayer(); }}
            />
            <button className="btn btn-success" onClick={handleAddPlayer} disabled={!newPlayerName.trim()}>
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

      {isTeamType && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h2 className="text-xl font-bold">팀 구성</h2>
            <button
              className="btn btn-accent"
              onClick={generateRandomTeams}
              disabled={generating || tournamentPlayers.length < 3}
              aria-label="랜덤 팀 생성"
            >
              {generating ? '생성 중...' : '랜덤 팀 생성'}
            </button>
          </div>
          {teams.length === 0 ? (
            <p className="text-gray-400">팀이 아직 생성되지 않았습니다.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {teams.map(team => (
                <div key={team.id} className="bg-gray-800 rounded-lg p-4 border border-gray-600">
                  <h3 className="text-lg font-bold text-cyan-400">{team.name}</h3>
                  <ul className="mt-2 space-y-1">
                    {(team.memberNames ?? []).map((name, i) => (
                      <li key={i} className="text-gray-300">{name}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 전역 선수 가져오기 모달 */}
      {showGlobalModal && (
        <div className="modal-backdrop" onClick={() => setShowGlobalModal(false)}>
          <div className="card max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">전역 선수에서 가져오기</h2>
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
  setMatchesBulk: (matches: Omit<Match, 'id'>[]) => Promise<void>;
  updateMatch: (matchId: string, data: Partial<Match>) => Promise<void>;
  referees: { id: string; name: string }[];
  courts: { id: string; name: string }[];
  isTeamType: boolean;
}

function BracketTab({ tournament, matches, tournamentPlayers, teams, setMatchesBulk, updateMatch, referees, courts, isTeamType }: BracketTabProps) {
  const [generating, setGenerating] = useState(false);

  const generateBracket = useCallback(async () => {
    setGenerating(true);
    try {
      const newMatches: Omit<Match, 'id'>[] = [];
      const now = Date.now();

      if (!isTeamType) {
        // Individual round-robin
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
  }, [isTeamType, tournamentPlayers, teams, tournament.id, setMatchesBulk]);

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

  const canGenerate = isTeamType ? teams.length >= 2 : tournamentPlayers.length >= 2;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-xl font-bold">대진표</h2>
        <button
          className="btn btn-accent"
          onClick={generateBracket}
          disabled={generating || !canGenerate}
          aria-label="대진표 자동 생성"
        >
          {generating ? '생성 중...' : '대진표 자동 생성'}
        </button>
      </div>

      {!canGenerate && (
        <p className="text-gray-400">
          {isTeamType ? '팀이 2개 이상 필요합니다.' : '참가 선수가 2명 이상 필요합니다.'}
        </p>
      )}

      {matches.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-gray-400">생성된 대진표가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map(match => (
            <div key={match.id} className="card space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 text-sm">R{match.round}</span>
                  <span className="font-bold text-lg">
                    {match.type === 'individual'
                      ? `${match.player1Name} vs ${match.player2Name}`
                      : `${match.team1Name} vs ${match.team2Name}`}
                  </span>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[match.status]}`}>
                  {STATUS_LABELS[match.status]}
                </span>
              </div>

              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-48">
                  <label className="block text-sm text-gray-400 mb-1">심판</label>
                  <select
                    className="input"
                    value={match.refereeId ?? ''}
                    onChange={e => handleAssign(match.id, 'refereeId', e.target.value)}
                    aria-label={`${match.type === 'individual' ? match.player1Name + ' vs ' + match.player2Name : match.team1Name + ' vs ' + match.team2Name} 심판 배정`}
                  >
                    <option value="">미배정</option>
                    {referees.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-48">
                  <label className="block text-sm text-gray-400 mb-1">경기장</label>
                  <select
                    className="input"
                    value={match.courtId ?? ''}
                    onChange={e => handleAssign(match.id, 'courtId', e.target.value)}
                    aria-label={`${match.type === 'individual' ? match.player1Name + ' vs ' + match.player2Name : match.team1Name + ' vs ' + match.team2Name} 경기장 배정`}
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
  const [generating, setGenerating] = useState(false);

  const generateSchedule = useCallback(async () => {
    if (courts.length === 0 || matches.length === 0) return;
    setGenerating(true);
    try {
      const pendingMatches = matches.filter(m => m.status === 'pending' || m.status === 'in_progress');
      const slots: Omit<ScheduleSlot, 'id'>[] = [];
      const courtSlots = courts.map(c => ({ courtId: c.id, courtName: c.name, nextTime: startTime }));

      const addMinutes = (time: string, mins: number): string => {
        const [h, m] = time.split(':').map(Number);
        const total = h * 60 + m + mins;
        const hh = Math.floor(total / 60).toString().padStart(2, '0');
        const mm = (total % 60).toString().padStart(2, '0');
        return `${hh}:${mm}`;
      };

      for (const match of pendingMatches) {
        courtSlots.sort((a, b) => a.nextTime.localeCompare(b.nextTime));
        const court = courtSlots[0];

        const label = match.type === 'individual'
          ? `${match.player1Name ?? ''} vs ${match.player2Name ?? ''}`
          : `${match.team1Name ?? ''} vs ${match.team2Name ?? ''}`;

        slots.push({
          matchId: match.id,
          courtId: court.courtId,
          courtName: court.courtName,
          scheduledTime: court.nextTime,
          label,
          status: match.status,
        });

        await updateMatch(match.id, {
          scheduledTime: court.nextTime,
          courtId: court.courtId,
          courtName: court.courtName,
        });

        court.nextTime = addMinutes(court.nextTime, interval);
      }

      await setScheduleBulk(slots);
    } finally {
      setGenerating(false);
    }
  }, [matches, courts, startTime, interval, setScheduleBulk, updateMatch]);

  const timeSlots = useMemo(() => {
    const times = [...new Set(schedule.map(s => s.scheduledTime))].sort();
    return times.map(time => ({
      time,
      slots: courts.map(court => schedule.find(s => s.scheduledTime === time && s.courtId === court.id) ?? null),
    }));
  }, [schedule, courts]);

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <h2 className="text-xl font-bold">스케줄 설정</h2>
        <div className="flex gap-4 flex-wrap">
          <div>
            <label htmlFor="start-time" className="block text-sm text-gray-400 mb-1">시작 시간</label>
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
            <label htmlFor="interval" className="block text-sm text-gray-400 mb-1">경기 간격 (분)</label>
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

      {timeSlots.length > 0 && (
        <div className="card overflow-x-auto">
          <h2 className="text-xl font-bold mb-4">스케줄 표</h2>
          <table className="w-full border-collapse" aria-label="스케줄 그리드">
            <thead>
              <tr>
                <th className="border border-gray-600 p-3 text-left bg-gray-800">시간</th>
                {courts.map(c => (
                  <th key={c.id} className="border border-gray-600 p-3 text-center bg-gray-800">{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeSlots.map(row => (
                <tr key={row.time}>
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
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
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
  isTeamType: boolean;
}

function StatusTab({ tournament, matches, updateTournament }: StatusTabProps) {
  const [filter, setFilter] = useState<'all' | MatchStatus>('all');

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
                      ? `${match.player1Name} vs ${match.player2Name}`
                      : `${match.team1Name} vs ${match.team2Name}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {match.courtName && <span className="text-sm text-gray-400">{match.courtName}</span>}
                  {match.scheduledTime && <span className="text-sm text-cyan-400">{match.scheduledTime}</span>}
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[match.status]}`}>
                    {STATUS_LABELS[match.status]}
                  </span>
                </div>
              </div>

              {match.status === 'completed' && match.sets && (
                <div className="flex gap-2 flex-wrap mt-2">
                  {match.sets.map((s, i) => (
                    <span key={i} className="px-3 py-1 bg-gray-800 rounded text-sm font-mono">
                      {match.sets && match.sets.length > 1 ? `S${i + 1}: ` : ''}{s.player1Score}-{s.player2Score}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ========================
// Ranking Tab
// ========================
interface RankingTabProps {
  matches: Match[];
  isTeamType: boolean;
}

function RankingTab({ matches, isTeamType }: RankingTabProps) {
  if (isTeamType) {
    const rankings = calculateTeamRanking(matches);
    return (
      <div className="card overflow-x-auto">
        <h2 className="text-xl font-bold mb-4">팀 순위</h2>
        {rankings.length === 0 ? (
          <p className="text-gray-400">완료된 경기가 없습니다.</p>
        ) : (
          <table className="w-full border-collapse" aria-label="팀 순위표">
            <thead>
              <tr>
                <th className="border border-gray-600 p-3 text-center bg-gray-800">순위</th>
                <th className="border border-gray-600 p-3 text-left bg-gray-800">팀명</th>
                <th className="border border-gray-600 p-3 text-center bg-gray-800">경기</th>
                <th className="border border-gray-600 p-3 text-center bg-gray-800">승</th>
                <th className="border border-gray-600 p-3 text-center bg-gray-800">패</th>
                <th className="border border-gray-600 p-3 text-center bg-gray-800">득실점</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  const rankings = calculateIndividualRanking(matches);
  return (
    <div className="card overflow-x-auto">
      <h2 className="text-xl font-bold mb-4">개인 순위</h2>
      {rankings.length === 0 ? (
        <p className="text-gray-400">완료된 경기가 없습니다.</p>
      ) : (
        <table className="w-full border-collapse" aria-label="개인 순위표">
          <thead>
            <tr>
              <th className="border border-gray-600 p-3 text-center bg-gray-800">순위</th>
              <th className="border border-gray-600 p-3 text-left bg-gray-800">이름</th>
              <th className="border border-gray-600 p-3 text-center bg-gray-800">승</th>
              <th className="border border-gray-600 p-3 text-center bg-gray-800">패</th>
              <th className="border border-gray-600 p-3 text-center bg-gray-800">세트득실</th>
              <th className="border border-gray-600 p-3 text-center bg-gray-800">포인트득실</th>
            </tr>
          </thead>
          <tbody>
            {rankings.map(r => (
              <tr key={r.playerId} className={r.rank <= 3 ? 'bg-gray-800' : ''}>
                <td className="border border-gray-600 p-3 text-center font-bold text-yellow-400">{r.rank}</td>
                <td className="border border-gray-600 p-3 font-semibold">{r.playerName}</td>
                <td className="border border-gray-600 p-3 text-center text-green-400">{r.wins}</td>
                <td className="border border-gray-600 p-3 text-center text-red-400">{r.losses}</td>
                <td className="border border-gray-600 p-3 text-center">{r.setsWon}-{r.setsLost}</td>
                <td className="border border-gray-600 p-3 text-center">{r.pointsFor}-{r.pointsAgainst}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
