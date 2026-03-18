import { useNavigate } from 'react-router-dom';
import { usePracticeHistory } from '../../hooks/usePracticeHistory';

export default function PracticeHome() {
  const navigate = useNavigate();
  const { getStats } = usePracticeHistory();
  const stats = getStats();

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-center" style={{ color: '#c084fc' }}>
        심판 연습
      </h1>
      <p className="text-center text-gray-400 text-lg">
        실제 대회 없이 채점을 연습할 수 있습니다
      </p>

      {stats.totalSessions > 0 && (
        <div className="card text-center">
          <p className="text-gray-400">
            총 {stats.totalSessions}회 연습
          </p>
        </div>
      )}

      <div className="grid gap-4">
        <button
          className="card hover:bg-gray-800 transition-colors text-left p-6 border-2 border-transparent hover:border-gray-600"
          style={{ borderLeftColor: '#22c55e', borderLeftWidth: '8px' }}
          onClick={() => navigate('/referee/practice/setup')}
          aria-label="연습 시작"
        >
          <h2 className="text-2xl font-bold" style={{ color: '#22c55e' }}>연습 시작</h2>
          <p className="text-gray-400 mt-1">경기를 설정하고 채점을 연습합니다</p>
        </button>
        <button
          className="card hover:bg-gray-800 transition-colors text-left p-6 border-2 border-transparent hover:border-gray-600"
          style={{ borderLeftColor: '#f59e0b', borderLeftWidth: '8px' }}
          onClick={() => navigate('/referee/practice/history')}
          aria-label="연습 기록"
        >
          <h2 className="text-2xl font-bold" style={{ color: '#f59e0b' }}>연습 기록</h2>
          <p className="text-gray-400 mt-1">지금까지의 연습 기록을 확인합니다</p>
        </button>
      </div>
    </div>
  );
}
