import { useNavigate } from 'react-router-dom';
import { usePracticeHistory } from '../../hooks/usePracticeHistory';

export default function PracticeHistory() {
  const navigate = useNavigate();
  const { sessions, clearHistory, getStats } = usePracticeHistory();
  const stats = getStats();

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}분 ${s}초`;
  };

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-center" style={{ color: '#c084fc' }}>연습 기록</h1>

      <div className="card text-center">
        <p className="text-2xl font-bold text-white">총 {stats.totalSessions}회 연습</p>
        {stats.avgAccuracy > 0 && (
          <p className="text-lg text-gray-300 mt-2">
            평균 정확도: <span className="text-green-400 font-bold">{stats.avgAccuracy}%</span>
            {stats.improvement !== 0 && (
              <span className={stats.improvement > 0 ? 'text-green-400' : 'text-red-400'} aria-label={`${stats.improvement > 0 ? '향상' : '하락'} ${Math.abs(stats.improvement)}%`}>
                {' '}({stats.improvement > 0 ? '↑+' : '↓'}{stats.improvement}%)
              </span>
            )}
          </p>
        )}
      </div>

      {sessions.length === 0 ? (
        <p className="text-center text-gray-400 text-xl">아직 연습 기록이 없습니다.</p>
      ) : (
        <div className="space-y-3" role="list" aria-label="연습 기록 목록">
          {sessions.map(session => (
            <div key={session.id} className="card" role="listitem">
              <div className="flex items-center justify-between mb-1">
                <span className="text-gray-400 text-sm">{formatDate(session.date)}</span>
                <span className="text-sm" style={{
                  backgroundColor: session.sessionType === 'scenario' ? '#1e3a5f' : '#1a1a2e',
                  color: session.sessionType === 'scenario' ? '#60a5fa' : '#9ca3af',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                }}>
                  {session.sessionType === 'scenario' ? '시나리오' : '자유연습'}
                </span>
              </div>
              <p className="text-lg text-white font-bold">
                {session.scenarioName || (session.matchType === 'individual' ? '개인전 연습' : '팀전 연습')}
              </p>
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-400">
                {session.accuracy !== undefined && (
                  <span>정확도: <span className="text-green-400 font-bold">{session.accuracy}%</span></span>
                )}
                <span>소요시간: {formatDuration(session.duration)}</span>
                <span>스코어: {session.finalScore}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-4">
        <button className="btn btn-accent flex-1" onClick={() => navigate('/referee/practice')} aria-label="뒤로">뒤로</button>
        {sessions.length > 0 && (
          <button className="btn btn-danger flex-1" onClick={() => { clearHistory(); localStorage.removeItem('showdown_practice_completed'); }} aria-label="기록 전체 삭제">기록 삭제</button>
        )}
      </div>
    </div>
  );
}
