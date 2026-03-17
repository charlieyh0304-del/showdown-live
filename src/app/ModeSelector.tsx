import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ModeSelector() {
  const navigate = useNavigate();
  const [confirmMode, setConfirmMode] = useState<'admin' | 'referee' | null>(null);

  const handleConfirm = () => {
    if (confirmMode) {
      navigate(`/${confirmMode}`);
      setConfirmMode(null);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
      <h1 className="text-4xl font-bold text-primary mb-4">쇼다운</h1>
      <p className="text-gray-400 text-lg mb-12">시각장애인 테이블 스포츠 대회 관리</p>

      <div className="grid gap-6 w-full max-w-md">
        <button
          onClick={() => setConfirmMode('admin')}
          className="card hover:bg-gray-800 transition-colors text-left p-8 border-2 border-transparent hover:border-primary"
          style={{ borderLeft: '8px solid var(--color-primary)' }}
          aria-label="관리자 모드 진입"
        >
          <h2 className="text-3xl font-bold text-primary mb-2">관리자</h2>
          <p className="text-gray-400">대회 생성, 선수/심판 관리, 스케줄 설정</p>
        </button>

        <button
          onClick={() => setConfirmMode('referee')}
          className="card hover:bg-gray-800 transition-colors text-left p-8 border-2 border-transparent hover:border-secondary"
          style={{ borderLeft: '8px solid var(--color-secondary)' }}
          aria-label="심판 모드 진입"
        >
          <h2 className="text-3xl font-bold text-secondary mb-2">심판</h2>
          <p className="text-gray-400">배정된 경기 점수 기록, 연습 모드</p>
        </button>

        <button
          onClick={() => navigate('/spectator')}
          className="card hover:bg-gray-800 transition-colors text-left p-8 border-2 border-transparent hover:border-green-400"
          style={{ borderLeft: '8px solid #00ff00' }}
          aria-label="관람 모드 진입"
        >
          <h2 className="text-3xl font-bold text-green-400 mb-2">관람</h2>
          <p className="text-gray-400">실시간 경기 관람, 즐겨찾기, 알림</p>
        </button>
      </div>

      {/* 확인 모달 */}
      {confirmMode && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="mode-confirm-title">
          <div className="modal-content">
            <h2
              id="mode-confirm-title"
              className="text-2xl font-bold"
              style={{ color: confirmMode === 'admin' ? '#ffff00' : '#00ffff' }}
            >
              {confirmMode === 'admin' ? '관리자' : '심판'} 모드로 이동합니다
            </h2>
            <p className="text-lg text-gray-300 mt-4">
              {confirmMode === 'admin'
                ? '관리자 PIN이 필요합니다.'
                : '심판 인증이 필요합니다. 연습 모드는 인증 없이 이용 가능합니다.'}
            </p>
            <div className="flex gap-4 mt-8">
              <button
                className="btn btn-primary btn-large flex-1"
                onClick={handleConfirm}
                aria-label="확인, 이동"
                autoFocus
              >
                이동
              </button>
              <button
                className="btn btn-danger btn-large flex-1"
                onClick={() => setConfirmMode(null)}
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
