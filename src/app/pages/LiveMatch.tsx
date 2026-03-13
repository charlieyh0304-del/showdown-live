import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePlayers, useMatch, useReferees, useCourts } from '@shared/hooks/useFirebase';
import { checkSetWinner, GAME_CONFIG } from '@shared/types';

const TIMEOUT_DURATION = 60;

export default function LiveMatch() {
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { players } = usePlayers();
  const { referees } = useReferees();
  const { courts } = useCourts();
  const { match, loading } = useMatch(tournamentId || null, matchId || null);
  const [timeoutRemaining, setTimeoutRemaining] = useState(0);
  const [showEvent, setShowEvent] = useState(false);

  const getPlayer = (playerId: string | null) => {
    if (!playerId) return null;
    return players.find(p => p.id === playerId);
  };

  const player1 = getPlayer(match?.player1Id || null);
  const player2 = getPlayer(match?.player2Id || null);
  const winner = getPlayer(match?.winnerId || null);

  const currentSet = match?.sets?.[match.currentSet];

  // 타임아웃 카운터
  useEffect(() => {
    if (!match?.activeTimeout) {
      return;
    }

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - match.activeTimeout!.startTime) / 1000);
      setTimeoutRemaining(Math.max(0, TIMEOUT_DURATION - elapsed));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => {
      clearInterval(interval);
      setTimeoutRemaining(0);
    };
  }, [match?.activeTimeout]);

  // 이벤트 애니메이션
  useEffect(() => {
    if (!match?.lastEvent) return;
    const showTimer = setTimeout(() => setShowEvent(true), 0);
    const hideTimer = setTimeout(() => setShowEvent(false), 3000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [match?.lastEvent]);

  // 세트 점수 계산
  const getSetScores = () => {
    if (!match?.sets) return { player1: 0, player2: 0 };
    let p1 = 0, p2 = 0;
    for (const set of match.sets) {
      const setWinner = checkSetWinner(set.player1Score, set.player2Score);
      if (setWinner === 1) p1++;
      if (setWinner === 2) p2++;
    }
    return { player1: p1, player2: p2 };
  };

  const setScores = getSetScores();

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center" role="status" aria-busy="true">
        <div className="text-4xl">로딩 중...</div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center">
        <p className="text-2xl mb-4">경기를 찾을 수 없습니다</p>
        <button onClick={() => navigate(-1)} className="btn btn-secondary">
          뒤로가기
        </button>
      </div>
    );
  }

  const isTimeout = !!match.activeTimeout;

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* 타임아웃 오버레이 */}
      {isTimeout && (
        <div className="fixed inset-0 bg-blue-900/95 flex flex-col items-center justify-center z-50" role="alertdialog" aria-label="타임아웃 진행 중">
          <div className="text-5xl text-white mb-6">타임아웃</div>
          <div className="text-9xl font-bold text-primary mb-8 animate-pulse" role="status" aria-atomic="true" aria-live="assertive">
            <span className="sr-only">남은 시간</span> {timeoutRemaining}<span className="sr-only">초</span>
          </div>
          <div className="text-3xl text-white">
            {getPlayer(match.activeTimeout?.playerId || null)?.name}
          </div>
        </div>
      )}

      {/* 이벤트 알림 */}
      <div aria-live="assertive" aria-atomic="true" role="alert">
        {showEvent && match.lastEvent && (
          <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-40
            px-8 py-4 rounded-xl text-3xl font-bold animate-bounce
            ${match.lastEvent.type === 'score' ? 'bg-green-600' :
              match.lastEvent.type === 'fault' ? 'bg-yellow-600' :
              match.lastEvent.type === 'violation' ? 'bg-red-600' :
              match.lastEvent.type === 'set_end' ? 'bg-purple-600' :
              match.lastEvent.type === 'match_end' ? 'bg-primary text-black' :
              'bg-gray-600'}`}
          >
            {match.lastEvent.description}
          </div>
        )}
      </div>

      {/* 헤더 */}
      <header className="bg-gray-900 p-4">
        <div className="flex justify-between items-center max-w-4xl mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="btn bg-gray-800"
            aria-label="뒤로가기"
          >
            ← 뒤로
          </button>
          <div className="text-center">
            {match.status === 'in_progress' && (
              <span className="text-orange-500 text-2xl font-bold animate-pulse" role="status" aria-label="실시간 경기 진행 중">
                LIVE
              </span>
            )}
            {/* 심판/경기장/시간 정보 */}
            {(match.refereeId || match.courtId || match.scheduledTime) && (
              <div className="flex items-center justify-center gap-3 mt-1 text-sm text-gray-400">
                {match.refereeId && (() => {
                  const referee = referees.find(r => r.id === match.refereeId);
                  return referee ? (
                    <span aria-label={`심판: ${referee.name}`}>심판: {referee.name}</span>
                  ) : null;
                })()}
                {match.courtId && (() => {
                  const court = courts.find(c => c.id === match.courtId);
                  return court ? (
                    <span aria-label={`경기장: ${court.name}`}>| 경기장: {court.name}</span>
                  ) : null;
                })()}
                {match.scheduledTime && (
                  <span aria-label={`시간: ${match.scheduledTime}`}>| 시간: {match.scheduledTime}</span>
                )}
              </div>
            )}
          </div>
          <div className="w-24"></div>
        </div>
      </header>

      {match.status === 'completed' ? (
        /* 경기 종료 화면 */
        <section className="flex-1 flex flex-col items-center justify-center p-8" aria-label="경기 결과">
          <div className="text-4xl text-gray-300 mb-6">경기 종료</div>
          <div className="text-7xl font-bold text-primary mb-8" aria-live="polite">
            {winner?.name} 승리
          </div>
          <div className="text-5xl mb-8" aria-label={`최종 세트 점수 ${setScores.player1} 대 ${setScores.player2}`}>
            {setScores.player1} - {setScores.player2}
          </div>

          {/* 세트별 기록 */}
          <div className="bg-gray-900 rounded-xl p-8 w-full max-w-md">
            <h2 className="text-2xl text-gray-300 mb-6 text-center">세트별 점수</h2>
            <div className="space-y-4" role="list" aria-label="세트별 점수 목록">
              {match.sets.map((set, idx) => (
                <div key={idx} className="flex justify-between text-3xl" role="listitem" aria-label={`세트 ${idx + 1}: ${set.player1Score} 대 ${set.player2Score}`}>
                  <span className="text-gray-300">세트 {idx + 1}</span>
                  <span className="font-bold">
                    {set.player1Score} - {set.player2Score}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : (
        /* 실시간 점수 화면 */
        <section className="flex-1 flex flex-col" aria-label="실시간 점수판">
          {/* 세트 정보 */}
          <div className="text-center py-6 bg-gray-900" aria-live="polite" aria-atomic="true">
            <div className="text-2xl text-gray-300">
              세트 {match.currentSet + 1} / {GAME_CONFIG.MAX_SETS}
            </div>
            <div className="text-5xl font-bold text-primary mt-2" aria-label={`세트 점수: ${player1?.name || '선수 1'} ${setScores.player1}, ${player2?.name || '선수 2'} ${setScores.player2}`}>
              {setScores.player1} - {setScores.player2}
            </div>
          </div>

          {/* 메인 점수판 */}
          <div className="flex-1 grid grid-cols-2" role="region" aria-label="현재 세트 점수">
            {/* Player 1 */}
            <div className="flex flex-col items-center justify-center bg-gray-900 border-r border-gray-800 p-8">
              <div className="text-4xl font-bold text-primary mb-8">
                {player1?.name}
              </div>
              <div className="score-large text-white" aria-live="polite" aria-atomic="true" aria-label={`${player1?.name || '선수 1'} 점수 ${currentSet?.player1Score || 0}`}>
                {currentSet?.player1Score || 0}
              </div>
              {player1?.club && (
                <div className="text-2xl text-gray-300 mt-6">
                  {player1.club}
                </div>
              )}
              {/* 평터/반칙 표시 */}
              <div className="flex gap-4 mt-6 text-xl" aria-live="polite">
                {(currentSet?.player1Faults || 0) > 0 && (
                  <span className="bg-yellow-700 px-3 py-1 rounded" role="status">
                    평터 {currentSet?.player1Faults}
                  </span>
                )}
                {(currentSet?.player1Violations || 0) > 0 && (
                  <span className="bg-red-700 px-3 py-1 rounded" role="alert">
                    반칙 {currentSet?.player1Violations}
                  </span>
                )}
              </div>
            </div>

            {/* Player 2 */}
            <div className="flex flex-col items-center justify-center bg-gray-900 p-8">
              <div className="text-4xl font-bold text-secondary mb-8">
                {player2?.name}
              </div>
              <div className="score-large text-white" aria-live="polite" aria-atomic="true" aria-label={`${player2?.name || '선수 2'} 점수 ${currentSet?.player2Score || 0}`}>
                {currentSet?.player2Score || 0}
              </div>
              {player2?.club && (
                <div className="text-2xl text-gray-300 mt-6">
                  {player2.club}
                </div>
              )}
              {/* 평터/반칙 표시 */}
              <div className="flex gap-4 mt-6 text-xl" aria-live="polite">
                {(currentSet?.player2Faults || 0) > 0 && (
                  <span className="bg-yellow-700 px-3 py-1 rounded" role="status">
                    평터 {currentSet?.player2Faults}
                  </span>
                )}
                {(currentSet?.player2Violations || 0) > 0 && (
                  <span className="bg-red-700 px-3 py-1 rounded" role="alert">
                    반칙 {currentSet?.player2Violations}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 세트 기록 */}
          <div className="bg-gray-900 border-t border-gray-800 p-6">
            <div className="flex justify-center gap-8" role="list" aria-label="세트 기록">
              {match.sets.map((set, idx) => (
                <div
                  key={idx}
                  role="listitem"
                  aria-label={`세트 ${idx + 1}: ${set.player1Score} 대 ${set.player2Score}${idx === match.currentSet ? ', 현재 세트' : ''}`}
                  className={`text-center px-8 py-4 rounded-lg ${
                    idx === match.currentSet
                      ? 'bg-gray-700 ring-2 ring-primary'
                      : 'bg-gray-800'
                  }`}
                  aria-current={idx === match.currentSet ? 'true' : undefined}
                >
                  <div className="text-lg text-gray-300">세트 {idx + 1}</div>
                  <div className="text-4xl font-bold">
                    {set.player1Score} - {set.player2Score}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
