import { useRef, useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMatch, useTournament } from '@shared/hooks/useFirebase';
import { countSetWins, getEffectiveGameConfig, getMaxServes } from '@shared/utils/scoring';
import type { ScoreHistoryEntry } from '@shared/types';

export default function LiveMatchView() {
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { match, loading: mLoading } = useMatch(tournamentId || null, matchId || null);
  const { tournament, loading: tLoading } = useTournament(tournamentId || null);
  const [announcement, setAnnouncement] = useState('');
  const [historyOrder, setHistoryOrder] = useState<'newest' | 'oldest'>('oldest');
  const prevScoreRef = useRef('');

  const loading = mLoading || tLoading;

  // 점수 변경 감지 → 음성 안내
  useEffect(() => {
    if (!match || !Array.isArray(match.sets) || match.sets.length === 0) return;
    const currentSetData = match.type === 'team'
      ? match.sets[0]
      : match.sets[(match.currentSet ?? 1) - 1];
    if (!currentSetData) return;

    const scoreStr = `${currentSetData.player1Score}-${currentSetData.player2Score}-${match.currentSet}`;
    if (prevScoreRef.current && prevScoreRef.current !== scoreStr) {
      const p1 = match.type === 'team' ? (match.team1Name || '팀1') : (match.player1Name || '선수1');
      const p2 = match.type === 'team' ? (match.team2Name || '팀2') : (match.player2Name || '선수2');
      setAnnouncement(`${p1} ${currentSetData.player1Score}점, ${p2} ${currentSetData.player2Score}점`);
    }
    prevScoreRef.current = scoreStr;
  }, [match]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem 1rem' }}><p style={{ fontSize: '1.5rem' }}>데이터 로딩 중...</p></div>;
  }

  if (!match) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.5rem', color: '#ef4444' }}>경기를 찾을 수 없습니다</p>
        <button className="btn btn-primary" onClick={() => navigate(-1)} style={{ marginTop: '1rem' }}>뒤로 가기</button>
      </div>
    );
  }

  const isLive = match.status === 'in_progress';
  const isCompleted = match.status === 'completed';

  return (
    <div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only">{announcement}</div>

      <button className="btn" onClick={() => navigate(`/spectator/tournament/${tournamentId}`)}
        style={{ background: 'none', color: 'var(--color-secondary)', padding: '0.5rem 0', marginBottom: '1rem', fontSize: '1rem' }}>
        ← 대회로 돌아가기
      </button>

      {/* 상태 표시 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        {isLive && (
          <>
            <span className="animate-pulse" style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#ef4444' }} aria-hidden="true" />
            <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '1.25rem' }}>실시간 진행중</span>
          </>
        )}
        {isCompleted && <span style={{ color: '#16a34a', fontWeight: 'bold', fontSize: '1.25rem' }}>● 경기 완료</span>}
        {match.status === 'pending' && <span style={{ color: '#9ca3af', fontWeight: 'bold', fontSize: '1.25rem' }}>대기중</span>}
        {match.isPaused && <span style={{ color: '#f59e0b', fontWeight: 'bold', marginLeft: '0.5rem' }}>⏸ 일시정지 중</span>}
      </div>

      {tournament && <p style={{ color: '#6b7280', marginBottom: '1rem' }}>{tournament.name}</p>}

      {match.type === 'individual' ? (
        <IndividualMatchDetail match={match} gameConfig={tournament?.gameConfig} />
      ) : (
        <TeamMatchDetail match={match} />
      )}

      {/* 서브 정보 */}
      {isLive && match.currentServe && match.serveSelected && (
        <ServeIndicator match={match} />
      )}

      {/* 경기장/심판 */}
      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', color: '#9ca3af' }}>
        {match.courtName && <span>경기장: {match.courtName}</span>}
        {match.refereeName && <span>심판: {match.refereeName}</span>}
      </div>

      {/* 경기 기록 (최신순/시간순 토글) */}
      <ScoreHistorySection
        history={Array.isArray(match.scoreHistory) ? match.scoreHistory : []}
        sets={Array.isArray(match.sets) ? match.sets : undefined}
        order={historyOrder}
        onToggle={() => setHistoryOrder(o => o === 'newest' ? 'oldest' : 'newest')}
      />
    </div>
  );
}

// ===== 서브 표시 =====
function ServeIndicator({ match }: { match: NonNullable<ReturnType<typeof useMatch>['match']> }) {
  const isTeam = match.type === 'team';
  const p1 = isTeam ? (match.team1Name ?? '팀1') : (match.player1Name ?? '선수1');
  const p2 = isTeam ? (match.team2Name ?? '팀2') : (match.player2Name ?? '선수2');
  const serverName = match.currentServe === 'player1' ? p1 : p2;
  const maxServes = getMaxServes(match.type ?? 'individual');
  const serveCount = match.serveCount ?? 0;

  return (
    <div style={{
      backgroundColor: '#1e3a5f', padding: '0.75rem', borderRadius: '0.5rem',
      textAlign: 'center', marginTop: '1rem', fontSize: '1.1rem', color: '#93c5fd',
    }}>
      🎾 {serverName} 서브 {serveCount + 1}/{maxServes}회차
    </div>
  );
}

// ===== 경기 기록 (최신순/시간순) =====
function ScoreHistorySection({
  history, sets, order, onToggle,
}: {
  history: ScoreHistoryEntry[];
  sets?: { player1Score: number; player2Score: number; winnerId?: string | null }[];
  order: 'newest' | 'oldest';
  onToggle: () => void;
}) {
  // Filter out non-scoring meta entries (0-point serve, pause, resume, timeout, dead_ball, substitution)
  // Keep only entries that actually changed the score (points > 0) or walkover
  const meaningfulHistory = useMemo(() => {
    return history.filter(h => h.points > 0 || h.actionType === 'walkover');
  }, [history]);

  const sortedHistory = useMemo(() => {
    if (order === 'newest') return meaningfulHistory;
    return [...meaningfulHistory].reverse();
  }, [meaningfulHistory, order]);

  if (meaningfulHistory.length === 0) {
    return (
      <div className="card" style={{ marginTop: '1.5rem', padding: '1rem' }}>
        <p style={{ color: '#9ca3af', textAlign: 'center' }}>상세 경기 기록이 없습니다.</p>
        {Array.isArray(sets) && sets.length > 0 && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#9ca3af' }}>세트 결과</h4>
            {sets.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', backgroundColor: '#1f2937', borderRadius: '0.5rem', padding: '0.75rem' }}>
                <span>세트 {i + 1}</span>
                <span style={{ fontWeight: 'bold' }}>{s.player1Score} - {s.player2Score}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ fontWeight: 'bold', color: 'var(--color-primary)', margin: 0 }}>
          경기 기록 ({meaningfulHistory.length})
        </h3>
        <button
          className="btn"
          onClick={onToggle}
          style={{ fontSize: '0.75rem', padding: '4px 10px', background: '#374151' }}
        >
          {order === 'newest' ? '🔽 최신순' : '🔼 시간순'}
        </button>
      </div>

      {/* 시간순일 때 경기 시작 마커 */}
      {order === 'oldest' && (
        <div style={{
          textAlign: 'center', padding: '0.5rem', marginBottom: '0.5rem',
          background: 'linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%)',
          borderRadius: '0.5rem', color: '#93c5fd', fontSize: '0.9rem',
        }}>
          🎾 경기 시작
        </div>
      )}

      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {sortedHistory.map((h, i) => {
          const icon = h.actionType === 'goal' ? '⚽' : h.actionType === 'walkover' ? '⚪' : h.points >= 2 ? '🔴' : '🟡';
          const isGoal = h.actionType === 'goal';
          const isWalkover = h.actionType === 'walkover';

          const ACTION_LABELS: Record<string, string> = {
            goal: '골 득점',
            irregular_serve: '부정 서브',
            centerboard: '센터보드 터치',
            body_touch: '바디 터치',
            illegal_defense: '일리걸 디펜스',
            out: '아웃',
            ball_holding: '볼 홀딩',
            mask_touch: '마스크/고글 터치',
            penalty: '기타 벌점',
            walkover: '부전승',
          };

          let actionDesc: string;
          if (isWalkover) {
            actionDesc = `${h.scoringPlayer || '?'} 부전승`;
          } else if (isGoal) {
            actionDesc = `${h.scoringPlayer} 골 득점 +${h.points}점`;
          } else {
            const label = ACTION_LABELS[h.actionType || ''] || h.actionType || '';
            actionDesc = `${h.actionPlayer} ${label} → ${h.scoringPlayer} +${h.points}점`;
          }

          const timeStr = h.time ? new Date(h.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';

          return (
            <div
              key={i}
              style={{
                padding: '0.5rem 0.75rem',
                borderBottom: '1px solid #1f2937',
                fontSize: '0.875rem',
                backgroundColor: i % 2 === 0 ? 'transparent' : '#111827',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ marginRight: '0.5rem' }}>{icon}</span>
                  {isGoal ? (
                    <span style={{ color: '#22c55e', fontWeight: 'bold' }}>{actionDesc}</span>
                  ) : isWalkover ? (
                    <span style={{ color: '#d1d5db', fontWeight: 'bold' }}>{actionDesc}</span>
                  ) : (
                    <span style={{ color: h.points >= 2 ? '#ef4444' : '#eab308' }}>{actionDesc}</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 'bold', color: '#d1d5db', whiteSpace: 'nowrap' }}>
                    {h.scoreAfter?.player1 ?? 0} : {h.scoreAfter?.player2 ?? 0}
                  </span>
                  {timeStr && <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{timeStr}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== 개인전 상세 =====
function IndividualMatchDetail({
  match, gameConfig,
}: {
  match: NonNullable<ReturnType<typeof useMatch>['match']>;
  gameConfig?: { winScore: number; setsToWin: number };
}) {
  const sets = Array.isArray(match.sets) ? match.sets : [];
  const currentSet = match.currentSet ?? 1;
  const currentSetData = sets[currentSet - 1];
  const effectiveConfig = gameConfig ? getEffectiveGameConfig(gameConfig) : undefined;
  const setWins = countSetWins(sets, effectiveConfig);
  const hasTimeout = match.activeTimeout != null;

  return (
    <div>
      {hasTimeout && (
        <div style={{ backgroundColor: '#92400e', color: '#fbbf24', padding: '0.75rem', borderRadius: '0.5rem', textAlign: 'center', fontWeight: 'bold', fontSize: '1.25rem', marginBottom: '1rem' }}>
          타임아웃 진행중
        </div>
      )}

      {/* 선수 이름 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '1.75rem', fontWeight: 'bold', flex: 1 }}>
          {match.status === 'in_progress' && match.currentServe === 'player1' && match.serveSelected ? '🎾 ' : ''}{match.player1Name || '선수1'}
        </span>
        <span style={{ fontSize: '1.75rem', fontWeight: 'bold', flex: 1, textAlign: 'right' }}>
          {match.status === 'in_progress' && match.currentServe === 'player2' && match.serveSelected ? '🎾 ' : ''}{match.player2Name || '선수2'}
        </span>
      </div>

      {/* 현재 세트 점수 */}
      <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem', marginBottom: '1rem', border: '2px solid #374151' }}>
        <p style={{ color: '#9ca3af', marginBottom: '0.5rem', fontSize: '1rem' }}>제{currentSet}세트</p>
        <div className="score-display" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: 'var(--color-primary)' }}>{currentSetData?.player1Score ?? 0}</span>
          <span style={{ color: '#6b7280', fontSize: '3rem' }}>-</span>
          <span style={{ color: 'var(--color-secondary)' }}>{currentSetData?.player2Score ?? 0}</span>
        </div>
        <p style={{ color: '#d1d5db', marginTop: '0.5rem', fontSize: '1.25rem' }}>세트 {setWins.player1} - {setWins.player2}</p>
      </div>

      {/* 세트 기록 */}
      {sets.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontWeight: 'bold', color: 'var(--color-primary)', marginBottom: '0.75rem' }}>세트 기록</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption className="sr-only">세트별 점수 기록</caption>
            <thead>
              <tr>
                <th style={thStyle}>세트</th>
                <th style={thStyle}>{match.player1Name || '선수1'}</th>
                <th style={thStyle}>{match.player2Name || '선수2'}</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={tdStyle}>제{i + 1}세트</td>
                  <td style={{ ...tdStyle, fontWeight: 'bold', color: s.winnerId && s.player1Score > s.player2Score ? 'var(--color-success)' : undefined }}>{s.player1Score}</td>
                  <td style={{ ...tdStyle, fontWeight: 'bold', color: s.winnerId && s.player2Score > s.player1Score ? 'var(--color-success)' : undefined }}>{s.player2Score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ===== 팀전 상세 =====
function TeamMatchDetail({ match }: { match: NonNullable<ReturnType<typeof useMatch>['match']> }) {
  const safeSets = Array.isArray(match.sets) ? match.sets : [];
  const setData = safeSets.length > 0 ? safeSets[0] : null;
  const team1Score = setData?.player1Score ?? 0;
  const team2Score = setData?.player2Score ?? 0;
  const hasTimeout = match.activeTimeout != null;

  return (
    <div>
      {hasTimeout && (
        <div style={{ backgroundColor: '#92400e', color: '#fbbf24', padding: '0.75rem', borderRadius: '0.5rem', textAlign: 'center', fontWeight: 'bold', fontSize: '1.25rem', marginBottom: '1rem' }}>
          타임아웃 진행중
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '1.75rem', fontWeight: 'bold', flex: 1 }}>
          {match.status === 'in_progress' && match.currentServe === 'player1' && match.serveSelected ? '🎾 ' : ''}{match.team1Name || '팀1'}
        </span>
        <span style={{ fontSize: '1.75rem', fontWeight: 'bold', flex: 1, textAlign: 'right' }}>
          {match.status === 'in_progress' && match.currentServe === 'player2' && match.serveSelected ? '🎾 ' : ''}{match.team2Name || '팀2'}
        </span>
      </div>

      <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem', marginBottom: '1rem', border: '2px solid #374151' }}>
        <p style={{ color: '#9ca3af', marginBottom: '0.5rem' }}>31점 경기</p>
        <div className="score-display" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: 'var(--color-primary)' }}>{team1Score}</span>
          <span style={{ color: '#6b7280', fontSize: '3rem' }}>-</span>
          <span style={{ color: 'var(--color-secondary)' }}>{team2Score}</span>
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '0.5rem', textAlign: 'center', fontWeight: 'bold',
  color: 'var(--color-secondary)', borderBottom: '2px solid #374151', fontSize: '0.875rem',
};

const tdStyle: React.CSSProperties = {
  padding: '0.5rem', textAlign: 'center',
};
