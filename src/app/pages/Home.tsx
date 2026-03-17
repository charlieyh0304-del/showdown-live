import { useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="py-8">
      <h1 className="text-4xl font-bold text-primary text-center mb-12">쇼다운 심판 기록</h1>

      <div className="grid gap-6 max-w-lg mx-auto">
        <button
          onClick={() => navigate('/individual')}
          className="card hover:bg-gray-800 transition-colors text-left p-8"
        >
          <h2 className="text-3xl font-bold text-primary mb-2">개인전</h2>
          <p className="text-gray-400 text-lg">1:1 개인 경기 점수 기록</p>
        </button>

        <button
          onClick={() => navigate('/team-match')}
          className="card hover:bg-gray-800 transition-colors text-left p-8"
        >
          <h2 className="text-3xl font-bold text-secondary mb-2">팀전</h2>
          <p className="text-gray-400 text-lg">팀 대 팀 경기 점수 기록</p>
        </button>

        <button
          onClick={() => navigate('/random-league')}
          className="card hover:bg-gray-800 transition-colors text-left p-8"
        >
          <h2 className="text-3xl font-bold text-accent mb-2">랜덤 팀리그전</h2>
          <p className="text-gray-400 text-lg">랜덤 팀 구성 리그 대회</p>
        </button>
      </div>
    </div>
  );
}
