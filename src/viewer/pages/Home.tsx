import { useNavigate } from 'react-router-dom';
import { useTournaments } from '@shared/hooks/useFirebase';

export default function Home() {
  const navigate = useNavigate();
  const { tournaments, loading } = useTournaments();

  // 진행중 대회를 먼저 표시
  const sortedTournaments = [...tournaments].sort((a, b) => {
    if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
    if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
    return 0;
  });

  if (loading) {
    return <div className="text-center py-20 text-3xl">로딩 중...</div>;
  }

  return (
    <div className="py-6">
      <h1 className="text-4xl font-bold text-secondary mb-8 text-center">
        대회 목록
      </h1>

      {tournaments.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-2xl text-gray-400">진행 중인 대회가 없습니다</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedTournaments.map(tournament => (
            <button
              key={tournament.id}
              onClick={() => navigate(`/bracket/${tournament.id}`)}
              className="card w-full text-left hover:bg-gray-800 transition-colors"
            >
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-3xl font-bold">{tournament.name}</h2>
                  <p className="text-xl text-gray-400 mt-1">
                    {tournament.date} · {tournament.playerIds?.length || 0}명
                  </p>
                </div>
                <span className={`px-4 py-2 rounded-lg text-xl font-bold ${
                  tournament.status === 'completed' ? 'bg-green-600' :
                  tournament.status === 'in_progress' ? 'bg-orange-600 animate-pulse' :
                  'bg-gray-600'
                }`}>
                  {tournament.status === 'completed' ? '완료' :
                   tournament.status === 'in_progress' ? '진행중' : '준비'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
