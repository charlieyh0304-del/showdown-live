import { useNavigate } from 'react-router-dom';

export default function ModeSelector() {
  const navigate = useNavigate();

  return (
    <main id="main-content" className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
      <h1 className="text-4xl font-bold text-primary mb-4">쇼다운</h1>
      <p className="text-gray-400 text-lg mb-12">시각장애인 테이블 스포츠 대회 관리</p>

      <nav className="grid gap-6 w-full max-w-md" aria-label="모드 선택">
        <button
          onClick={() => navigate('/admin')}
          className="card hover:bg-gray-800 transition-colors text-left p-8 border-2 border-transparent hover:border-primary"
          style={{ borderLeft: '8px solid var(--color-primary)' }}
          aria-label="관리자 모드 진입 - 대회 생성, 선수/심판 관리, 스케줄 설정"
        >
          <span className="text-3xl font-bold text-primary mb-2 block">관리자</span>
          <span className="text-gray-400 block">대회 생성, 선수/심판 관리, 스케줄 설정</span>
        </button>

        <button
          onClick={() => navigate('/referee')}
          className="card hover:bg-gray-800 transition-colors text-left p-8 border-2 border-transparent hover:border-secondary"
          style={{ borderLeft: '8px solid var(--color-secondary)' }}
          aria-label="심판 모드 진입 - 배정된 경기 점수 기록, 연습 모드"
        >
          <span className="text-3xl font-bold text-secondary mb-2 block">심판</span>
          <span className="text-gray-400 block">배정된 경기 점수 기록, 연습 모드</span>
        </button>

        <button
          onClick={() => navigate('/spectator')}
          className="card hover:bg-gray-800 transition-colors text-left p-8 border-2 border-transparent hover:border-green-400"
          style={{ borderLeft: '8px solid #00ff00' }}
          aria-label="관람 모드 진입 - 실시간 경기 관람, 즐겨찾기, 알림"
        >
          <span className="text-3xl font-bold text-green-400 mb-2 block">관람</span>
          <span className="text-gray-400 block">실시간 경기 관람, 즐겨찾기, 알림</span>
        </button>
      </nav>
    </main>
  );
}
