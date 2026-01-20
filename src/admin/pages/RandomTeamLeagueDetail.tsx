import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRandomTeamLeague, useTeamMatches, usePlayers, useCourts } from '@shared/hooks/useFirebase';
import type { Team, TeamMatch, IndividualMatch } from '@shared/types';

export default function RandomTeamLeagueDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { league, loading, updateLeague } = useRandomTeamLeague(id || null);
  const { teamMatches, setTeamMatchesBulk, updateTeamMatch } = useTeamMatches(id || null);
  const { players } = usePlayers();
  const { courts } = useCourts();

  const [activeTab, setActiveTab] = useState<'teams' | 'fixtures' | 'schedule' | 'history'>('teams');
  const [selectedMatch, setSelectedMatch] = useState<TeamMatch | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // 선수 이름 가져오기
  const getPlayerName = (playerId: string) => {
    return players.find(p => p.id === playerId)?.name || '알 수 없음';
  };

  // 팀 이름 가져오기
  const getTeamName = (teamId: string) => {
    return league?.teams?.find(t => t.id === teamId)?.name || '알 수 없음';
  };

  // 경기장 이름 가져오기
  const getCourtName = (courtId?: string) => {
    if (!courtId) return '미배정';
    return courts.find(c => c.id === courtId)?.name || '알 수 없음';
  };

  // 랜덤 팀 생성
  const handleRandomTeams = async () => {
    if (!league) return;

    const shuffled = [...league.playerIds].sort(() => Math.random() - 0.5);
    const teams: Team[] = [];

    for (let i = 0; i < shuffled.length; i += 3) {
      if (i + 2 < shuffled.length) {
        teams.push({
          id: `team-${i / 3 + 1}`,
          name: `${i / 3 + 1}팀`,
          memberIds: [shuffled[i], shuffled[i + 1], shuffled[i + 2]],
        });
      }
    }

    await updateLeague({
      teams,
      status: 'team_assignment'
    });
  };

  // 풀리그 대진표 자동 생성
  const handleAutoFixtures = async () => {
    if (!league?.teams || league.teams.length < 2) return;

    const fixtures: Omit<TeamMatch, 'id'>[] = [];
    const teams = league.teams;
    let round = 1;

    // 풀리그: 모든 팀 조합
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const matches: IndividualMatch[] = [];
        let matchIndex = 0;

        // 3x3 = 9경기
        for (const p1 of teams[i].memberIds) {
          for (const p2 of teams[j].memberIds) {
            matches.push({
              id: `match-${matchIndex++}`,
              player1Id: p1,
              player2Id: p2,
              player1Score: 0,
              player2Score: 0,
              status: 'pending',
            });
          }
        }

        fixtures.push({
          leagueId: league.id,
          team1Id: teams[i].id,
          team2Id: teams[j].id,
          round: round++,
          status: 'pending',
          matches,
        });
      }
    }

    await setTeamMatchesBulk(fixtures);
    await updateLeague({ status: 'in_progress' });
  };

  // 경기 배정 (경기장 + 시간)
  const handleAssignMatch = async (matchId: string, courtId: string, time: string) => {
    await updateTeamMatch(matchId, {
      courtId,
      scheduledTime: time,
    });
  };

  // 시뮬레이션 (자동 배정)
  const handleAutoAssign = async () => {
    if (!teamMatches.length || !courts.length) return;

    const pendingMatches = teamMatches.filter(m => m.status === 'pending');
    const startHour = 9;
    let currentHour = startHour;
    let courtIndex = 0;

    for (const match of pendingMatches) {
      const court = courts[courtIndex % courts.length];
      const time = `${String(currentHour).padStart(2, '0')}:00`;

      await updateTeamMatch(match.id, {
        courtId: court.id,
        scheduledTime: time,
      });

      courtIndex++;
      if (courtIndex % courts.length === 0) {
        currentHour++;
      }
    }
  };

  if (loading) {
    return <div className="text-center py-20 text-2xl">로딩 중...</div>;
  }

  if (!league) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl text-gray-400 mb-4">리그전을 찾을 수 없습니다</p>
        <button onClick={() => navigate('/team-leagues')} className="btn btn-primary">
          목록으로
        </button>
      </div>
    );
  }

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-primary">{league.name}</h1>
          <p className="text-gray-400">
            {league.date} · {league.playerIds.length}명 · {league.teamMatchSettings.winScore}점제
          </p>
        </div>
        <button onClick={() => navigate('/team-leagues')} className="btn bg-gray-700 hover:bg-gray-600">
          목록
        </button>
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {(['teams', 'fixtures', 'schedule', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg font-bold whitespace-nowrap transition-all ${
              activeTab === tab ? 'bg-primary text-black' : 'bg-gray-800 hover:bg-gray-700'
            }`}
          >
            {tab === 'teams' && '팀 구성'}
            {tab === 'fixtures' && '대진표'}
            {tab === 'schedule' && '경기 배정'}
            {tab === 'history' && '히스토리'}
          </button>
        ))}
      </div>

      {/* 팀 구성 탭 */}
      {activeTab === 'teams' && (
        <div className="space-y-4">
          {!league.teams || league.teams.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-xl text-gray-400 mb-4">아직 팀이 구성되지 않았습니다</p>
              <button onClick={handleRandomTeams} className="btn btn-accent">
                랜덤 팀 생성
              </button>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {league.teams.map(team => (
                  <div key={team.id} className="card">
                    <h3 className="text-xl font-bold text-cyan-400 mb-3">{team.name}</h3>
                    <div className="space-y-2">
                      {team.memberIds.map(playerId => (
                        <div key={playerId} className="bg-gray-800 p-2 rounded">
                          {getPlayerName(playerId)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-4">
                <button onClick={handleRandomTeams} className="btn bg-gray-700 hover:bg-gray-600">
                  팀 재배정
                </button>
                {(!teamMatches || teamMatches.length === 0) && (
                  <button onClick={handleAutoFixtures} className="btn btn-primary">
                    대진표 자동 생성
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* 대진표 탭 */}
      {activeTab === 'fixtures' && (
        <div className="space-y-4">
          {teamMatches.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-xl text-gray-400 mb-4">대진표가 없습니다</p>
              {league.teams && league.teams.length >= 2 && (
                <button onClick={handleAutoFixtures} className="btn btn-primary">
                  자동 대진표 생성
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {teamMatches.map((match, index) => (
                <div key={match.id} className="card">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-gray-400 text-sm">#{index + 1}</span>
                      <h3 className="text-xl font-bold">
                        {getTeamName(match.team1Id)} vs {getTeamName(match.team2Id)}
                      </h3>
                      <p className="text-gray-400">
                        {match.scheduledTime || '시간 미정'} · {getCourtName(match.courtId)}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded font-bold ${
                      match.status === 'completed' ? 'bg-green-600' :
                      match.status === 'in_progress' ? 'bg-orange-600' :
                      'bg-gray-600'
                    }`}>
                      {match.status === 'completed' ? '완료' :
                       match.status === 'in_progress' ? '진행중' : '대기'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 경기 배정 탭 */}
      {activeTab === 'schedule' && (
        <div className="space-y-4">
          {courts.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-xl text-gray-400 mb-4">먼저 경기장을 등록해주세요</p>
              <button onClick={() => navigate('/courts')} className="btn btn-primary">
                경기장 관리
              </button>
            </div>
          ) : teamMatches.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-xl text-gray-400">먼저 대진표를 생성해주세요</p>
            </div>
          ) : (
            <>
              <div className="flex gap-4 mb-4">
                <button onClick={handleAutoAssign} className="btn btn-accent">
                  자동 배정 (시뮬레이션)
                </button>
              </div>
              <div className="space-y-4">
                {teamMatches.map((match, index) => (
                  <MatchScheduleRow
                    key={match.id}
                    match={match}
                    index={index}
                    courts={courts}
                    getTeamName={getTeamName}
                    onAssign={(courtId, time) => handleAssignMatch(match.id, courtId, time)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 히스토리 탭 */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {teamMatches.filter(m => m.status === 'completed' || m.scoreHistory?.length).length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-xl text-gray-400">아직 완료된 경기가 없습니다</p>
            </div>
          ) : (
            <div className="space-y-4">
              {teamMatches
                .filter(m => m.status === 'completed' || m.scoreHistory?.length)
                .map((match, index) => (
                  <div
                    key={match.id}
                    className="card cursor-pointer hover:bg-gray-800 transition-colors"
                    onClick={() => {
                      setSelectedMatch(match);
                      setShowHistoryModal(true);
                    }}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="text-gray-400 text-sm">#{index + 1}</span>
                        <h3 className="text-xl font-bold">
                          {getTeamName(match.team1Id)} vs {getTeamName(match.team2Id)}
                        </h3>
                        <p className="text-cyan-400">
                          클릭하여 히스토리 보기
                        </p>
                      </div>
                      <span className="bg-green-600 px-3 py-1 rounded font-bold">
                        완료
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* 히스토리 모달 */}
      {showHistoryModal && selectedMatch && (
        <div className="modal-backdrop" onClick={() => setShowHistoryModal(false)}>
          <div className="modal-content max-w-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold mb-4 text-primary">
              {getTeamName(selectedMatch.team1Id)} vs {getTeamName(selectedMatch.team2Id)}
            </h2>

            <div className="space-y-4 max-h-96 overflow-y-auto">
              <h3 className="text-lg font-bold text-cyan-400">개인전 결과</h3>
              {selectedMatch.matches.map((m) => (
                <div key={m.id} className="bg-gray-800 p-3 rounded">
                  <div className="flex justify-between items-center">
                    <span>{getPlayerName(m.player1Id)}</span>
                    <span className="text-2xl font-bold">
                      {m.player1Score} - {m.player2Score}
                    </span>
                    <span>{getPlayerName(m.player2Id)}</span>
                  </div>
                </div>
              ))}

              {selectedMatch.scoreHistory && selectedMatch.scoreHistory.length > 0 && (
                <>
                  <h3 className="text-lg font-bold text-cyan-400 mt-6">점수 변화 히스토리</h3>
                  <div className="space-y-2">
                    {selectedMatch.scoreHistory.map((event, i) => (
                      <div key={event.id || i} className="bg-gray-800 p-2 rounded text-sm">
                        <span className="text-gray-400">
                          {new Date(event.timestamp).toLocaleTimeString('ko-KR')}
                        </span>
                        <span className="ml-2">
                          {getPlayerName(event.playerId)} 득점 ({event.player1Score} - {event.player2Score})
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => setShowHistoryModal(false)}
              className="btn btn-primary w-full mt-6"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 경기 배정 행 컴포넌트
function MatchScheduleRow({
  match,
  index,
  courts,
  getTeamName,
  onAssign,
}: {
  match: TeamMatch;
  index: number;
  courts: { id: string; name: string }[];
  getTeamName: (id: string) => string;
  onAssign: (courtId: string, time: string) => void;
}) {
  const [courtId, setCourtId] = useState(match.courtId || '');
  const [time, setTime] = useState(match.scheduledTime || '');

  const handleSave = () => {
    if (courtId && time) {
      onAssign(courtId, time);
    }
  };

  return (
    <div className="card">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1">
          <span className="text-gray-400 text-sm">#{index + 1}</span>
          <h3 className="text-lg font-bold">
            {getTeamName(match.team1Id)} vs {getTeamName(match.team2Id)}
          </h3>
        </div>
        <div className="flex gap-2 items-center">
          <select
            value={courtId}
            onChange={e => setCourtId(e.target.value)}
            className="input w-32"
          >
            <option value="">경기장</option>
            {courts.map(court => (
              <option key={court.id} value={court.id}>
                {court.name}
              </option>
            ))}
          </select>
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            className="input w-28"
          />
          <button
            onClick={handleSave}
            disabled={!courtId || !time}
            className="btn btn-secondary"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
