import { Outlet, useNavigate } from 'react-router-dom';
import ModeBadge from '@shared/components/ModeBadge';

export default function PracticeLayout() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col">
      <div
        role="status"
        style={{
          backgroundColor: '#7c3aed',
          color: '#ffffff',
          textAlign: 'center',
          padding: '0.5rem',
          fontSize: '1rem',
          fontWeight: 'bold',
        }}
      >
        연습 모드 - 실제 대회에 영향 없음
      </div>
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-900" role="banner">
        <ModeBadge mode="practice" />
        <button
          className="btn btn-accent"
          onClick={() => navigate('/referee')}
          aria-label="연습 모드 나가기"
        >
          나가기
        </button>
      </header>
      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
