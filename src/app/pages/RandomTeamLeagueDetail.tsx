import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRandomTeamLeague, useTeamMatches, usePlayers, useCourts, useReferees } from '@shared/hooks/useFirebase';
import type { Team, TeamMatch, IndividualMatch, Court } from '@shared/types';

export default function RandomTeamLeagueDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { league, loading, updateLeague } = useRandomTeamLeague(id || null);
  const { teamMatches, setTeamMatchesBulk, updateTeamMatch, updateIndividualMatch } = useTeamMatches(id || null);
  const { players } = usePlayers();
  const { courts } = useCourts();
  const { referees } = useReferees();

  // 심판 배정 가능한 경기장 목록
  const courtsWithReferees = courts.filter(c => c.assignedReferees && c.assignedReferees.length > 0);

  // 경기장에서 주심(main) 우선으로 심판 ID를 가져오는 헬퍼
  const getMainRefereeForCourt = (court: Court): string | undefined => {
    if (!court.assignedReferees || court.assignedReferees.length === 0) return undefined;
    const mainRef = court.assignedReferees.find(rId => {
      const r = referees.find(ref => ref.id === rId);
      return r?.role === 'main';
    });
    if (mainRef) return mainRef;
    return court.assignedReferees[0];
  };

  // 경기 시간 설정
  const [startTime, setStartTime] = useState('09:00');
  const [matchInterval, setMatchInterval] = useState(30);

  const [activeTab, setActiveTab] = useState<'teams' | 'fixtures' | 'schedule' | 'history'>('teams');
  const [selectedMatch, setSelectedMatch] = useState<TeamMatch | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  // Inline scoring state for individual matches
  const [scoringKey, setScoringKey] = useState<string | null>(null);
  const [iScoreP1, setIScoreP1] = useState(0);
  const [iScoreP2, setIScoreP2] = useState(0);
  const historyModalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showHistoryModal) return;
    document.body.style.overflow = 'hidden';
    const el = historyModalRef.current;
    if (el) {
      const focusable = el.querySelectorAll<HTMLElement>('button, input, select, [tabindex]:not([tabindex="-1"])');
      if (focusable.length > 0) focusable[0].focus();
    }
    return () => { document.body.style.overflow = ''; };
  }, [showHistoryModal]);

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

  // 심판 이름 가져오기
  const getRefereeName = (refId?: string) => {
    if (!refId) return null;
    return referees.find(r => r.id === refId)?.name || null;
  };

  // 개별 경기 점수 입력 시작
  const handleStartIndividualScoring = (teamMatchId: string, matchIndex: number, m: IndividualMatch) => {
    setScoringKey(`${teamMatchId}-${matchIndex}`);
    setIScoreP1(m.player1Score);
    setIScoreP2(m.player2Score);
  };

  // 개별 경기 점수 저장 (자동 팀 승자 결정 포함)
  const handleSaveIndividualScore = async (teamMatch: TeamMatch, matchIndex: number) => {
    const m = teamMatch.matches[matchIndex];
    const winnerId = iScoreP1 > iScoreP2 ? m.player1Id : iScoreP2 > iScoreP1 ? m.player2Id : undefined;
    await updateIndividualMatch(teamMatch.id, matchIndex, {
      player1Score: iScoreP1,
      player2Score: iScoreP2,
      winnerId,
      status: winnerId ? 'completed' : 'in_progress',
    }, teamMatch);
    setScoringKey(null);
  };

  // 랜덤 팀 생성
  const handleRandomTeams = async () => {
    if (!league) return;

    const remainder = league.playerIds.length % 3;
    if (remainder !== 0) {
      const proceed = confirm(
        `${league.playerIds.length}명은 3의 배수가 아닙니다. ${remainder}명이 팀에 배정되지 않습니다. 계속하시겠습니까?`
      );
      if (!proceed) return;
    }

    // Fisher-Yates shuffle (unbiased)
    const shuffled = [...league.playerIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const teams: Team[] = [];
    for (let i = 0; i + 2 < shuffled.length; i += 3) {
      const teamNumber = i / 3 + 1;
      teams.push({
        id: `team-${teamNumber}`,
        name: `${teamNumber}팀`,
        memberIds: [shuffled[i], shuffled[i + 1], shuffled[i + 2]],
      });
    }

    try {
      await updateLeague({
        teams,
        status: 'team_assignment'
      });
    } catch (error) {
      console.error('Failed to create teams:', error);
    }
  };

  function calcScheduledTime(start: string, intervalMin: number, slotIndex: number): string {
    const [h, m] = start.split(':').map(Number);
    const totalMin = h * 60 + m + intervalMin * slotIndex;
    return `${String(Math.floor(totalMin / 60) % 24).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
  }

  // 풀리그 대진표 자동 생성
  const handleAutoFixtures = async () => {
    if (!league?.teams || league.teams.length < 2) return;

    const fixtures: Omit<TeamMatch, 'id'>[] = [];
    const teams = league.teams;
    let round = 1;
    let courtIdx = 0;

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

        const fixture: Omit<TeamMatch, 'id'> = {
          leagueId: league.id,
          team1Id: teams[i].id,
          team2Id: teams[j].id,
          round: round++,
          status: 'pending',
          matches,
        };

        // 경기장/심판 라운드로빈 배정
        if (courtsWithReferees.length > 0) {
          const court = courtsWithReferees[courtIdx % courtsWithReferees.length];
          fixture.courtId = court.id;
          const refId = getMainRefereeForCourt(court);
          if (refId) fixture.refereeId = refId;
          courtIdx++;
        }

        // 시간 자동 배정
        const courtCount = courtsWithReferees.length || 1;
        const fixtureIndex = fixtures.length;
        const slot = Math.floor(fixtureIndex / courtCount);
        fixture.scheduledTime = calcScheduledTime(startTime, matchInterval, slot);

        fixtures.push(fixture);
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
    const courtCount = courts.length;

    for (let i = 0; i < pendingMatches.length; i++) {
      const match = pendingMatches[i];
      const court = courts[i % courtCount];
      const slot = Math.floor(i / courtCount);
      const time = calcScheduledTime(startTime, matchInterval, slot);

      const updateData: Partial<TeamMatch> = {
        courtId: court.id,
        scheduledTime: time,
      };

      // 해당 경기장의 심판 배정 (main 우선)
      if (court.assignedReferees && court.assignedReferees.length > 0) {
        const refId = getMainRefereeForCourt(court);
        if (refId) updateData.refereeId = refId;
      }

      await updateTeamMatch(match.id, updateData);
    }
  };

  if (loading) {
    return <div className="text-center py-20 text-2xl" role="status" aria-live="polite">로딩 중...</div>;
  }

  if (!league) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl text-gray-400 mb-4">리그전을 찾을 수 없습니다</p>
        <button onClick={() => navigate('/')} className="btn btn-primary">
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
        <button onClick={() => navigate('/')} className="btn bg-gray-700 hover:bg-gray-600">
          목록
        </button>
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex gap-2 mb-6 overflow-x-auto" role="tablist" aria-label="리그전 탭">
        {(['teams', 'fixtures', 'schedule', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            role="tab"
            aria-selected={activeTab === tab}
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
              {(!teamMatches || teamMatches.length === 0) && (
                <div className="flex gap-4 items-end mb-4">
                  <div>
                    <label className="block text-sm mb-1">시작 시간</label>
                    <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                      className="input w-32" aria-label="경기 시작 시간" />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">경기 간격</label>
                    <select value={matchInterval} onChange={e => setMatchInterval(Number(e.target.value))}
                      className="input w-24" aria-label="경기 간격 (분)">
                      <option value={20}>20분</option>
                      <option value={30}>30분</option>
                      <option value={40}>40분</option>
                      <option value={60}>60분</option>
                    </select>
                  </div>
                </div>
              )}
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
              {teamMatches.map((match, index) => {
                const team1Wins = match.matches.filter(m => m.status === 'completed' && m.winnerId === m.player1Id).length;
                const team2Wins = match.matches.filter(m => m.status === 'completed' && m.winnerId === m.player2Id).length;
                const winnerTeam = match.winnerId ? league.teams?.find(t => t.id === match.winnerId) : null;

                return (
                  <div key={match.id} className="card">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <span className="text-gray-400 text-sm">#{index + 1}</span>
                        <h3 className="text-xl font-bold">
                          {getTeamName(match.team1Id)} vs {getTeamName(match.team2Id)}
                        </h3>
                        <p className="text-lg text-cyan-400 font-bold">{team1Wins} - {team2Wins}</p>
                        <p className="text-gray-400 text-sm">
                          {match.scheduledTime || '시간 미정'} · {getCourtName(match.courtId)}
                          {getRefereeName(match.refereeId) && ` · 심판: ${getRefereeName(match.refereeId)}`}
                        </p>
                      </div>
                      <div className="text-right">
                        {winnerTeam && (
                          <div className="text-green-400 font-bold mb-1">{winnerTeam.name} 승리</div>
                        )}
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
                    <div className="space-y-1">
                      {match.matches.map((m, mIdx) => {
                        const key = `${match.id}-${mIdx}`;
                        const isScoring = scoringKey === key;

                        return (
                          <div key={m.id} className="bg-gray-800 p-2 rounded flex justify-between items-center text-sm">
                            <span className={m.status === 'completed' && m.winnerId === m.player1Id ? 'text-primary font-bold' : ''}>
                              {getPlayerName(m.player1Id)}
                            </span>
                            {isScoring ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  value={iScoreP1}
                                  onChange={e => setIScoreP1(Math.max(0, Number(e.target.value)))}
                                  className="input w-14 text-center text-sm"
                                  aria-label={`${getPlayerName(m.player1Id)} 점수`}
                                />
                                <span className="text-gray-400">-</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={iScoreP2}
                                  onChange={e => setIScoreP2(Math.max(0, Number(e.target.value)))}
                                  className="input w-14 text-center text-sm"
                                  aria-label={`${getPlayerName(m.player2Id)} 점수`}
                                />
                                <button
                                  onClick={() => handleSaveIndividualScore(match, mIdx)}
                                  disabled={iScoreP1 === iScoreP2}
                                  className="btn btn-success text-xs px-2 py-1"
                                >
                                  저장
                                </button>
                                <button
                                  onClick={() => setScoringKey(null)}
                                  className="btn bg-gray-600 text-xs px-2 py-1"
                                >
                                  취소
                                </button>
                              </div>
                            ) : m.status === 'completed' ? (
                              <span className="font-bold">{m.player1Score} - {m.player2Score}</span>
                            ) : (
                              <button
                                onClick={() => handleStartIndividualScoring(match.id, mIdx, m)}
                                className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded"
                                disabled={match.status === 'completed'}
                                aria-label={`${getPlayerName(m.player1Id)} vs ${getPlayerName(m.player2Id)} 점수입력`}
                              >
                                점수입력
                              </button>
                            )}
                            <span className={m.status === 'completed' && m.winnerId === m.player2Id ? 'text-primary font-bold' : ''}>
                              {getPlayerName(m.player2Id)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
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
              <div className="flex gap-4 items-end mb-4">
                <div>
                  <label className="block text-sm mb-1">시작 시간</label>
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                    className="input w-32" aria-label="경기 시작 시간" />
                </div>
                <div>
                  <label className="block text-sm mb-1">경기 간격</label>
                  <select value={matchInterval} onChange={e => setMatchInterval(Number(e.target.value))}
                    className="input w-24" aria-label="경기 간격 (분)">
                    <option value={20}>20분</option>
                    <option value={30}>30분</option>
                    <option value={40}>40분</option>
                    <option value={60}>60분</option>
                  </select>
                </div>
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
        <div className="modal-backdrop" onClick={() => setShowHistoryModal(false)} onKeyDown={e => { if (e.key === 'Escape') setShowHistoryModal(false); }}>
          <div
            ref={historyModalRef}
            className="modal-content max-w-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="history-modal-title" className="text-2xl font-bold mb-4 text-primary">
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
            aria-label={`${getTeamName(match.team1Id)} vs ${getTeamName(match.team2Id)} 경기장 선택`}
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
            aria-label={`${getTeamName(match.team1Id)} vs ${getTeamName(match.team2Id)} 경기 시간`}
          />
          <button
            onClick={handleSave}
            disabled={!courtId || !time}
            className="btn btn-secondary"
            aria-label={`${getTeamName(match.team1Id)} vs ${getTeamName(match.team2Id)} 배정 저장`}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
