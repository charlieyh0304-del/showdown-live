import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { database } from '@shared/config/firebase';
import { usePlayers, useMatches } from '@shared/hooks/useFirebase';
import type { Tournament, Match, Player } from '@shared/types';
import { checkSetWinner } from '@shared/types';

export default function Bracket() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const { players } = usePlayers();
  const { matches } = useMatches(id || null);

  useEffect(() => {
    if (!id) return;

    const tournamentRef = ref(database, `tournaments/${id}`);
    const unsubscribe = onValue(tournamentRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setTournament({ id, ...data });
      } else {
        setTournament(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [id]);

  const getPlayer = (playerId: string | null): Player | undefined => {
    if (!playerId) return undefined;
    return players.find(p => p.id === playerId);
  };

  // 라운드별로 경기 그룹화
  const matchesByRound: Record<number, Match[]> = {};
  matches.forEach(match => {
    if (!matchesByRound[match.round]) {
      matchesByRound[match.round] = [];
    }
    matchesByRound[match.round].push(match);
  });

  const getRoundName = (round: number, totalRounds: number): string => {
    const remaining = totalRounds - round + 1;
    if (remaining === 1) return '결승';
    if (remaining === 2) return '준결승';
    if (remaining === 3) return '8강';
    if (remaining === 4) return '16강';
    return `${round}라운드`;
  };

  const getSetScores = (match: Match) => {
    let p1 = 0, p2 = 0;
    for (const set of match.sets || []) {
      const winner = checkSetWinner(set.player1Score, set.player2Score);
      if (winner === 1) p1++;
      if (winner === 2) p2++;
    }
    return { player1: p1, player2: p2 };
  };

  if (loading) {
    return <div className="text-center py-20 text-3xl">로딩 중...</div>;
  }

  if (!tournament) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl text-gray-400 mb-4">대회를 찾을 수 없습니다</p>
        <button onClick={() => navigate('/')} className="btn btn-secondary">
          목록으로
        </button>
      </div>
    );
  }

  const totalRounds = Object.keys(matchesByRound).length;

  // 진행 중인 경기 찾기
  const liveMatches = matches.filter(m => m.status === 'in_progress');

  return (
    <div className="py-6">
      <div className="text-center mb-8">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-white mb-2"
        >
          ← 대회 목록
        </button>
        <h1 className="text-4xl font-bold text-secondary">{tournament.name}</h1>
        <p className="text-xl text-gray-400 mt-2">{tournament.date}</p>
      </div>

      {/* 실시간 경기 */}
      {liveMatches.length > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-primary mb-4 text-center">
            실시간 경기
          </h2>
          <div className="space-y-4">
            {liveMatches.map(match => {
              const player1 = getPlayer(match.player1Id);
              const player2 = getPlayer(match.player2Id);
              const currentSet = match.sets?.[match.currentSet];
              const setScores = getSetScores(match);

              return (
                <Link
                  key={match.id}
                  to={`/live/${tournament.id}/${match.id}`}
                  className="card block hover:bg-gray-800 transition-colors border-2 border-orange-500"
                >
                  <div className="flex justify-between items-center">
                    <div className="flex-1">
                      <div className="text-2xl font-bold">
                        {player1?.name} vs {player2?.name}
                      </div>
                      <div className="text-xl text-gray-400 mt-1">
                        세트 {setScores.player1} - {setScores.player2}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-4xl font-bold text-primary">
                        {currentSet?.player1Score || 0} - {currentSet?.player2Score || 0}
                      </div>
                      <div className="text-orange-500 animate-pulse mt-1">
                        LIVE
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* 대진표 */}
      {matches.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-2xl text-gray-400">대진표가 아직 생성되지 않았습니다</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(matchesByRound)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([round, roundMatches]) => (
              <div key={round} className="card">
                <h2 className="text-2xl font-bold mb-4 text-secondary text-center">
                  {getRoundName(Number(round), totalRounds)}
                </h2>
                <div className="space-y-3">
                  {roundMatches.map(match => {
                    const player1 = getPlayer(match.player1Id);
                    const player2 = getPlayer(match.player2Id);
                    const setScores = getSetScores(match);

                    return (
                      <div
                        key={match.id}
                        className={`bg-gray-800 rounded-lg p-4 ${
                          match.status === 'in_progress' ? 'border-2 border-orange-500' : ''
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <div className={`text-xl ${
                              match.winnerId === match.player1Id ? 'text-primary font-bold' : ''
                            }`}>
                              {player1?.name || (match.player1Id ? '대기' : '-')}
                            </div>
                            <div className={`text-xl mt-1 ${
                              match.winnerId === match.player2Id ? 'text-primary font-bold' : ''
                            }`}>
                              {player2?.name || (match.player2Id ? '대기' : '-')}
                            </div>
                          </div>

                          {match.status !== 'pending' && (
                            <div className="text-center">
                              <div className="text-2xl font-bold">
                                {setScores.player1} - {setScores.player2}
                              </div>
                              {match.status === 'in_progress' && (
                                <Link
                                  to={`/live/${tournament.id}/${match.id}`}
                                  className="text-orange-500 text-sm hover:underline"
                                >
                                  LIVE 보기
                                </Link>
                              )}
                            </div>
                          )}

                          {match.status === 'pending' && (
                            <span className="text-gray-500 text-xl">대기</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
