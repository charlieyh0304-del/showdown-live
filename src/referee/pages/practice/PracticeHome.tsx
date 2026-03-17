import { useNavigate } from 'react-router-dom';
import { usePracticeHistory } from '../../hooks/usePracticeHistory';

export default function PracticeHome() {
  const navigate = useNavigate();
  const { getStats } = usePracticeHistory();
  const stats = getStats();

  const menuItems = [
    {
      title: '자유 연습',
      description: '직접 경기를 설정하고 채점을 연습합니다',
      path: '/referee/practice/setup',
      color: '#22c55e',
    },
    {
      title: '시나리오 훈련',
      description: '사전 정의된 상황에서 판정을 연습합니다',
      path: '/referee/practice/scenarios',
      color: '#3b82f6',
    },
    {
      title: '연습 기록',
      description: '지금까지의 연습 기록과 통계를 확인합니다',
      path: '/referee/practice/history',
      color: '#f59e0b',
    },
  ];

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
            {stats.avgAccuracy > 0 && ` | 평균 정확도 ${stats.avgAccuracy}%`}
            {stats.improvement !== 0 && ` | 향상도 ${stats.improvement > 0 ? '+' : ''}${stats.improvement}%`}
          </p>
        </div>
      )}

      <div className="grid gap-4">
        {menuItems.map(item => (
          <button
            key={item.path}
            className="card hover:bg-gray-800 transition-colors text-left p-6 border-2 border-transparent hover:border-gray-600"
            style={{ borderLeftColor: item.color, borderLeftWidth: '8px' }}
            onClick={() => navigate(item.path)}
            aria-label={item.title}
          >
            <h2 className="text-2xl font-bold" style={{ color: item.color }}>{item.title}</h2>
            <p className="text-gray-400 mt-1">{item.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
