import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ref, onValue, update } from 'firebase/database';
import { database } from '@shared/config/firebase';
import { usePlayers, useMatches } from '@shared/hooks/useFirebase';
import type { Tournament as TournamentType, Match, Player } from '@shared/types';
import { createEmptySet } from '@shared/types';

export default function Tournament() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState<TournamentType | null>(null);
  const [loading, setLoading] = useState(true);
  const { players } = usePlayers();
  const { matches, setMatches } = useMatches(id || null);

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

  const generateBracket = async () => {
    if (!tournament || !id) return;

    const playerIds = [...tournament.playerIds];
    // 랜덤 시드
    for (let i = playerIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    }

    // 2의 거듭제곱으로 맞추기 (부전승)
    const bracketSize = Math.pow(2, Math.ceil(Math.log2(playerIds.length)));
    const byes = bracketSize - playerIds.length;

    // 부전승 추가 (빈 슬롯)
    const slots: (string | null)[] = [...playerIds];
    for (let i = 0; i < byes; i++) {
      slots.push(null);
    }

    // 라운드 수 계산
    const totalRounds = Math.log2(bracketSize);

    // 1라운드 경기 생성
    const newMatches: Omit<Match, 'id'>[] = [];
    for (let i = 0; i < bracketSize / 2; i++) {
      const player1Id = slots[i * 2];
      const player2Id = slots[i * 2 + 1];

      // 부전승 처리
      let winnerId = null;
      let status: Match['status'] = 'pending';
      if (player1Id && !player2Id) {
        winnerId = player1Id;
        status = 'completed';
      } else if (!player1Id && player2Id) {
        winnerId = player2Id;
        status = 'completed';
      }

      newMatches.push({
        tournamentId: id,
        round: 1,
        position: i,
        player1Id,
        player2Id,
        winnerId,
        sets: [createEmptySet()],
        currentSet: 0,
        status,
        player1Timeouts: 0,
        player2Timeouts: 0,
      });
    }

    // 이후 라운드 경기 생성 (빈 상태)
    for (let round = 2; round <= totalRounds; round++) {
      const matchesInRound = Math.pow(2, totalRounds - round);
      for (let i = 0; i < matchesInRound; i++) {
        newMatches.push({
          tournamentId: id,
          round,
          position: i,
          player1Id: null,
          player2Id: null,
          winnerId: null,
          sets: [createEmptySet()],
          currentSet: 0,
          status: 'pending',
          player1Timeouts: 0,
          player2Timeouts: 0,
        });
      }
    }

    await setMatches(newMatches);

    // 대회 상태 업데이트
    const tournamentRef = ref(database, `tournaments/${id}`);
    await update(tournamentRef, { status: 'in_progress' });
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

  if (loading) {
    return <div className="text-center py-20 text-2xl">로딩 중...</div>;
  }

  if (!tournament) {
    return (
      <div className="text-center py-20">
        <p className="text-2xl text-gray-400 mb-4">대회를 찾을 수 없습니다</p>
        <button onClick={() => navigate('/')} className="btn btn-primary">
          홈으로
        </button>
      </div>
    );
  }

  const totalRounds = Object.keys(matchesByRound).length;

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <button
            onClick={() => navigate('/')}
            className="text-gray-400 hover:text-white mb-2"
          >
            ← 목록으로
          </button>
          <h1 className="text-3xl font-bold text-primary">{tournament.name}</h1>
          <p className="text-gray-400">{tournament.date} · {tournament.playerIds?.length || 0}명</p>
        </div>
        <span className={`px-4 py-2 rounded-lg text-xl font-bold ${
          tournament.status === 'completed' ? 'bg-green-600' :
          tournament.status === 'in_progress' ? 'bg-orange-600' :
          'bg-gray-600'
        }`}>
          {tournament.status === 'completed' ? '완료' :
           tournament.status === 'in_progress' ? '진행중' : '준비'}
        </span>
      </div>

      {matches.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-2xl text-gray-400 mb-6">대진표가 생성되지 않았습니다</p>
          <button
            onClick={generateBracket}
            className="btn btn-accent btn-large"
          >
            대진표 생성
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(matchesByRound)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([round, roundMatches]) => (
              <div key={round} className="card">
                <h2 className="text-2xl font-bold mb-4 text-secondary">
                  {getRoundName(Number(round), totalRounds)}
                </h2>
                <div className="space-y-4">
                  {roundMatches.map(match => {
                    const player1 = getPlayer(match.player1Id);
                    const player2 = getPlayer(match.player2Id);
                    const winner = getPlayer(match.winnerId);

                    return (
                      <div
                        key={match.id}
                        className="bg-gray-800 rounded-lg p-4"
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <div className={`text-xl mb-2 ${
                              match.winnerId === match.player1Id ? 'text-primary font-bold' : ''
                            }`}>
                              {player1?.name || (match.player1Id ? '...' : '부전승')}
                            </div>
                            <div className={`text-xl ${
                              match.winnerId === match.player2Id ? 'text-primary font-bold' : ''
                            }`}>
                              {player2?.name || (match.player2Id ? '...' : '부전승')}
                            </div>
                          </div>

                          {match.sets && match.status !== 'pending' && (
                            <div className="text-center mx-4">
                              {match.sets.map((set, idx) => (
                                <div key={idx} className="text-lg">
                                  {set.player1Score} - {set.player2Score}
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex gap-2">
                            {match.status === 'completed' ? (
                              <span className="text-green-500 text-xl">
                                {winner?.name} 승
                              </span>
                            ) : match.player1Id && match.player2Id ? (
                              <Link
                                to={`/match/${tournament.id}/${match.id}`}
                                className="btn btn-accent"
                              >
                                {match.status === 'in_progress' ? '계속' : '시작'}
                              </Link>
                            ) : (
                              <span className="text-gray-500">대기</span>
                            )}
                          </div>
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
