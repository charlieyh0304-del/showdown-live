import { useNavigate } from 'react-router-dom';

interface AccessDeniedProps {
  mode: 'admin' | 'referee';
  message?: string;
}

export default function AccessDenied({ mode, message }: AccessDeniedProps) {
  const navigate = useNavigate();

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen p-8 text-center"
      role="alert"
    >
      <div
        style={{
          width: '120px',
          height: '120px',
          borderRadius: '50%',
          backgroundColor: '#7f1d1d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '2rem',
          border: '4px solid #dc2626',
          fontSize: '4rem',
        }}
        aria-hidden="true"
      >
        !
      </div>

      <h1 className="text-3xl font-bold text-red-400 mb-4">접근 권한이 없습니다</h1>
      <p className="text-xl text-gray-300 mb-8">
        {message || `${mode === 'admin' ? '관리자' : '심판'} 인증이 필요합니다.`}
      </p>

      <div className="flex flex-col gap-4 w-full max-w-sm">
        <button
          className="btn btn-primary btn-large w-full"
          onClick={() => navigate(mode === 'admin' ? '/admin' : '/referee')}
          aria-label={`${mode === 'admin' ? '관리자' : '심판'} 로그인으로 이동`}
        >
          로그인하기
        </button>
        <button
          className="btn btn-secondary btn-large w-full"
          onClick={() => navigate('/')}
          aria-label="홈으로 이동"
        >
          홈으로
        </button>
      </div>
    </div>
  );
}
