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

  // Set document title for screen readers
  useEffect(() => {
    if (match) {
      const p1 = match.type === 'team' ? (match.team1Name || '팀1') : (match.player1Name || '선수1');
      const p2 = match.type === 'team' ? (match.team2Name || '팀2') : (match.player2Name || '선수2');
      document.title = `${p1} vs ${p2} - 경기 관람`;
    } else {
      document.title = '경기 관람 - 쇼다운';
    }
  }, [match]);

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
    return <div style={{ textAlign: 'center', padding: '3rem 1rem' }} role="status" aria-live="polite"><p style={{ fontSize: '1.5rem' }}>데이터 로딩 중...</p></div>;
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }} role="status" aria-live="polite">
        {isLive && (
          <>
            <span className="animate-pulse" style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#ef4444' }} aria-hidden="true" />
            <h1 style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '1.25rem', margin: 0 }}>실시간 진행중</h1>
          </>
        )}
        {isCompleted && <h1 style={{ color: '#22c55e', fontWeight: 'bold', fontSize: '1.25rem', margin: 0 }}><span aria-hidden="true">{'● '}</span>경기 완료</h1>}
        {match.status === 'pending' && <h1 style={{ color: '#d1d5db', fontWeight: 'bold', fontSize: '1.25rem', margin: 0 }}>대기중</h1>}
        {match.isPaused && <span style={{ color: '#fbbf24', fontWeight: 'bold', marginLeft: '0.5rem' }}><span aria-hidden="true">{'⏸ '}</span>일시정지 중</span>}
      </div>

      {tournament && <p style={{ color: '#d1d5db', marginBottom: '1rem' }}>{tournament.name}</p>}

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
      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', color: '#d1d5db' }}>
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
    }} role="status" aria-live="polite">
      <span aria-hidden="true">{'🎾 '}</span>{serverName} 서브 {serveCount + 1}/{maxServes}회차
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
  // Known meta-event types that are meaningful even with 0 points
  const META_ACTION_TYPES = new Set(['pause', 'resume', 'timeout', 'substitution', 'dead_ball', 'walkover', 'side_change', 'coin_toss', 'warmup_start', 'match_start', 'player_rotation']);
  // Keep scoring entries AND meaningful meta events, filter out only serve-start 0-point entries
  const meaningfulHistory = useMemo(() => {
    return history.filter(h => h.points > 0 || META_ACTION_TYPES.has(h.actionType));
  }, [history]);

  const sortedHistory = useMemo(() => {
    if (order === 'newest') return meaningfulHistory;
    return [...meaningfulHistory].reverse();
  }, [meaningfulHistory, order]);

  if (meaningfulHistory.length === 0) {
    return (
      <div className="card" style={{ marginTop: '1.5rem', padding: '1rem' }}>
        <p style={{ color: '#d1d5db', textAlign: 'center' }}>상세 경기 기록이 없습니다.</p>
        {Array.isArray(sets) && sets.length > 0 && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#d1d5db' }}>세트 결과</h3>
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
        <h2 style={{ fontWeight: 'bold', color: 'var(--color-primary)', margin: 0 }}>
          경기 기록 ({meaningfulHistory.length})
        </h2>
        <button
          className="btn"
          onClick={onToggle}
          style={{ fontSize: '0.75rem', padding: '4px 10px', background: '#374151' }}
          aria-label={order === 'newest' ? '시간순으로 정렬 변경' : '최신순으로 정렬 변경'}
        >
          <span aria-hidden="true">{order === 'newest' ? '🔽 ' : '🔼 '}</span>{order === 'newest' ? '최신순' : '시간순'}
        </button>
      </div>

      <HistoryBySet history={sortedHistory} sets={sets} order={order} />
    </div>
  );
}

// ===== 세트별 그룹 히스토리 (관람용) =====
const ACTION_LABELS: Record<string, string> = {
  goal: '골 득점', irregular_serve: '부정 서브', centerboard: '센터보드 터치',
  body_touch: '바디 터치', illegal_defense: '일리걸 디펜스', out: '아웃',
  ball_holding: '볼 홀딩', mask_touch: '마스크/고글 터치', penalty: '기타 벌점', walkover: '부전승',
};

function parseTimeStr(time: string | undefined): string {
  if (!time) return '';
  if (time.includes('오전') || time.includes('오후') || time.match(/^\d{1,2}:\d{2}/)) {
    return time.replace(/:\d{2}$/, '');
  }
  const d = new Date(time);
  if (!isNaN(d.getTime())) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return time;
}

function HistoryBySet({ history, sets, order }: {
  history: ScoreHistoryEntry[];
  sets?: { player1Score: number; player2Score: number }[];
  order: 'newest' | 'oldest';
}) {
  // Group by set
  const setGroups = useMemo(() => {
    const groups = new Map<number, ScoreHistoryEntry[]>();
    history.forEach(h => {
      const s = h.set || 1;
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s)!.push(h);
    });
    const entries = Array.from(groups.entries());
    return order === 'newest' ? entries.sort((a, b) => b[0] - a[0]) : entries.sort((a, b) => a[0] - b[0]);
  }, [history, order]);

  if (history.length === 0) return null;

  return (
    <div style={{ maxHeight: '400px', overflowY: 'auto' }} role="region" aria-label="세트별 경기 기록" tabIndex={0}>
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
      {setGroups.map(([setNum, entries]) => {
        const setData = sets?.[setNum - 1];
        return (
          <div key={setNum}>
            {/* 세트 헤딩 */}
            <div style={{
              padding: '0.5rem 0.75rem', fontWeight: 'bold', fontSize: '0.875rem',
              color: '#60a5fa', borderBottom: '2px solid rgba(96,165,250,0.3)',
              backgroundColor: '#111827', position: 'sticky', top: 0, zIndex: 1,
            }}>
              제{setNum}세트 {setData ? `(${setData.player1Score} : ${setData.player2Score})` : ''}
            </div>
            {entries.map((h, i) => {
              const isMeta = h.points === 0;
              const icon = h.actionType === 'dead_ball' ? '🔵' : h.actionType === 'goal' ? '⚽' : h.actionType === 'pause' ? '⏸️' : h.actionType === 'resume' ? '▶' : h.actionType === 'timeout' ? '⏱️' : h.actionType === 'substitution' ? '🔄' : h.actionType === 'walkover' ? '⚪' : h.actionType === 'coin_toss' ? '🪙' : h.actionType === 'warmup_start' ? '🏃' : h.actionType === 'match_start' ? '🎾' : h.actionType === 'player_rotation' ? '🔄' : h.actionType === 'side_change' ? '🔄' : h.points >= 2 ? '🔴' : '🟡';
              const timeStr = parseTimeStr(h.time);

              if (isMeta) {
                const desc = h.actionType === 'dead_ball' ? `${h.server || '?'} 데드볼 → 재서브`
                  : h.actionType === 'timeout' ? `${h.actionPlayer || ''} 타임아웃`
                  : h.actionType === 'pause' ? `일시정지 (${h.actionPlayer || ''})`
                  : h.actionType === 'resume' ? `재개 (${h.actionPlayer || ''})`
                  : h.actionType === 'substitution' ? (h.actionLabel || '선수 교체')
                  : h.actionType === 'walkover' ? `${h.scoringPlayer || '?'} 부전승`
                  : h.actionType === 'coin_toss' ? (h.actionLabel || '동전던지기')
                  : h.actionType === 'warmup_start' ? (h.actionLabel || '워밍업')
                  : h.actionType === 'match_start' ? (h.actionLabel || '경기 시작')
                  : h.actionType === 'player_rotation' ? (h.actionLabel || '선수 교체')
                  : h.actionType === 'side_change' ? (h.actionLabel || '사이드 체인지')
                  : (h.actionLabel || '');
                const hideScore = h.actionType === 'timeout' || h.actionType === 'side_change' || h.actionType === 'pause' || h.actionType === 'warmup_start' || h.actionType === 'coin_toss';
                return (
                  <div key={`${setNum}-${i}`} style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem', color: '#d1d5db', borderBottom: '1px solid #1f2937', backgroundColor: '#0d1117' }}>
                    <div>{timeStr} {icon} {desc}</div>
                    {!hideScore && <div style={{ fontSize: '0.75rem' }}>점수: {(() => { const p1 = h.scoreAfter?.player1 ?? 0; const p2 = h.scoreAfter?.player2 ?? 0; return h.serverSide === 'player2' ? `${p2} : ${p1}` : `${p1} : ${p2}`; })()}</div>}
                  </div>
                );
              }

              const isGoal = h.actionType === 'goal';
              const label = ACTION_LABELS[h.actionType || ''] || h.actionType || '';
              const actionDesc = isGoal
                ? `${h.scoringPlayer} 골 득점 +${h.points}점`
                : h.actionType === 'walkover'
                ? `${h.scoringPlayer || '?'} 부전승`
                : `${h.actionPlayer} ${label} → ${h.scoringPlayer} +${h.points}점`;
              const actionColor = isGoal ? '#22c55e' : h.points >= 2 ? '#ef4444' : '#eab308';

              return (
                <div key={`${setNum}-${i}`} style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #1f2937', fontSize: '0.875rem' }}>
                  {/* Line 1: 서브권 */}
                  <div style={{ fontSize: '0.75rem', color: '#d1d5db' }}>
                    <span aria-hidden="true">🎾</span> {h.server || '?'} 서브 {h.serveNumber ? `${h.serveNumber}회차` : ''} {timeStr && `· ${timeStr}`}
                  </div>
                  {/* Line 2: 득점 기록 */}
                  <div style={{ color: actionColor, fontWeight: 'bold' }}>
                    {icon} {actionDesc}
                  </div>
                  {/* Line 3: 점수 */}
                  <div style={{ fontSize: '0.8125rem', color: '#d1d5db' }}>
                    점수: {(() => { const p1 = h.scoreAfter?.player1 ?? 0; const p2 = h.scoreAfter?.player2 ?? 0; return h.serverSide === 'player2' ? `${p2} : ${p1}` : `${p1} : ${p2}`; })()}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
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
      <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem', marginBottom: '1rem', border: '2px solid #374151' }} aria-live="polite" aria-atomic="true">
        <p style={{ color: '#d1d5db', marginBottom: '0.5rem', fontSize: '1rem' }}>제{currentSet}세트</p>
        <div className="score-display" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }} aria-label={`${match.player1Name || '선수1'} ${currentSetData?.player1Score ?? 0}점 대 ${match.player2Name || '선수2'} ${currentSetData?.player2Score ?? 0}점`}>
          <span style={{ color: 'var(--color-primary)' }}>{currentSetData?.player1Score ?? 0}</span>
          <span style={{ color: '#9ca3af', fontSize: '3rem' }} aria-hidden="true">-</span>
          <span style={{ color: 'var(--color-secondary)' }}>{currentSetData?.player2Score ?? 0}</span>
        </div>
        <p style={{ color: '#d1d5db', marginTop: '0.5rem', fontSize: '1.25rem' }}>세트 {setWins.player1} - {setWins.player2}</p>
      </div>

      {/* 세트 기록 */}
      {sets.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontWeight: 'bold', color: 'var(--color-primary)', marginBottom: '0.75rem' }}>세트 기록</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption className="sr-only">세트별 점수 기록</caption>
            <thead>
              <tr>
                <th scope="col" style={thStyle}>세트</th>
                <th scope="col" style={thStyle}>{match.player1Name || '선수1'}</th>
                <th scope="col" style={thStyle}>{match.player2Name || '선수2'}</th>
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

      <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem', marginBottom: '1rem', border: '2px solid #374151' }} aria-live="polite" aria-atomic="true">
        <p style={{ color: '#d1d5db', marginBottom: '0.5rem' }}>31점 경기</p>
        <div className="score-display" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }} aria-label={`${match.team1Name || '팀1'} ${team1Score}점 대 ${match.team2Name || '팀2'} ${team2Score}점`}>
          <span style={{ color: 'var(--color-primary)' }}>{team1Score}</span>
          <span style={{ color: '#9ca3af', fontSize: '3rem' }} aria-hidden="true">-</span>
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
