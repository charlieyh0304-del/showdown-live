import { useState, useMemo } from 'react';
import type { ScoreHistoryEntry } from '@shared/types';

const ACTION_LABELS: Record<string, string> = {
  goal: '골 득점', irregular_serve: '부정 서브', centerboard: '센터보드 터치',
  body_touch: '바디 터치', illegal_defense: '일리걸 디펜스', out: '아웃',
  ball_holding: '볼 홀딩', mask_touch: '마스크/고글 터치', penalty: '기타 벌점',
  penalty_table_pushing: '테이블 푸싱', penalty_electronic: '전자기기 소리',
  penalty_talking: '경기 중 말하기', walkover: '부전승',
};

const META_ACTION_TYPES = new Set([
  'pause', 'resume', 'timeout', 'timeout_player', 'timeout_medical', 'timeout_referee',
  'substitution', 'dead_ball', 'walkover', 'side_change', 'coin_toss', 'warmup_start',
  'match_start', 'player_rotation'
]);

function parseTimeStr(time: string | undefined): string {
  if (!time) return '';
  if (time.includes('오전') || time.includes('오후') || time.match(/^\d{1,2}:\d{2}/)) {
    return time.replace(/:\d{2}$/, '');
  }
  const d = new Date(time);
  if (!isNaN(d.getTime())) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return time;
}

interface ScoreHistoryViewProps {
  history: ScoreHistoryEntry[];
  sets?: { player1Score: number; player2Score: number; winnerId?: string | null }[];
}

export default function ScoreHistoryView({ history, sets }: ScoreHistoryViewProps) {
  const [order, setOrder] = useState<'newest' | 'oldest'>('oldest');

  const meaningfulHistory = useMemo(() => {
    return history.filter(h => h.points > 0 || META_ACTION_TYPES.has(h.actionType) || h.penaltyWarning);
  }, [history]);

  const sortedHistory = useMemo(() => {
    if (order === 'newest') return meaningfulHistory;
    return [...meaningfulHistory].reverse();
  }, [meaningfulHistory, order]);

  if (meaningfulHistory.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 style={{ fontWeight: 'bold', color: '#facc15', margin: 0, fontSize: '1.125rem' }}>
          경기 기록 ({meaningfulHistory.length})
        </h2>
        <button
          className="btn"
          onClick={() => setOrder(o => o === 'newest' ? 'oldest' : 'newest')}
          style={{ fontSize: '0.75rem', padding: '4px 10px', background: '#374151' }}
          aria-label={order === 'newest' ? '시간순으로 정렬 변경' : '최신순으로 정렬 변경'}
        >
          {order === 'newest' ? '최신순' : '시간순'}
        </button>
      </div>
      <HistoryBySet history={sortedHistory} sets={sets} order={order} />
    </div>
  );
}

function HistoryBySet({ history, sets, order }: {
  history: ScoreHistoryEntry[];
  sets?: { player1Score: number; player2Score: number }[];
  order: 'newest' | 'oldest';
}) {
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
    <div style={{ maxHeight: '400px', overflowY: 'auto' }} role="list" aria-label="세트별 경기 기록" tabIndex={0}>
      {order === 'oldest' && (
        <div style={{
          textAlign: 'center', padding: '0.5rem', marginBottom: '0.5rem',
          background: 'linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%)',
          borderRadius: '0.5rem', color: '#93c5fd', fontSize: '0.9rem',
        }} role="listitem">
          경기 시작
        </div>
      )}
      {setGroups.map(([setNum, entries]) => {
        const setData = sets?.[setNum - 1];
        return (
          <div key={setNum}>
            <div style={{
              padding: '0.5rem 0.75rem', fontWeight: 'bold', fontSize: '0.875rem',
              color: '#60a5fa', borderBottom: '2px solid rgba(96,165,250,0.3)',
              backgroundColor: '#111827', position: 'sticky', top: 0, zIndex: 1,
            }} role="listitem" tabIndex={0} aria-label={`세트 ${setNum} ${setData ? `스코어 ${setData.player1Score} 대 ${setData.player2Score}` : ''}`}>
              제{setNum}세트 {setData ? `(${setData.player1Score} : ${setData.player2Score})` : ''}
            </div>
            {entries.map((h, i) => {
              const isMeta = h.points === 0 || h.penaltyWarning === true;
              const icon = h.penaltyWarning ? '⚠️' : h.actionType === 'dead_ball' ? '🔵' : h.actionType === 'goal' ? '⚽' : h.actionType === 'pause' ? '⏸️' : h.actionType === 'resume' ? '▶' : h.actionType === 'timeout' || h.actionType === 'timeout_player' ? '⏱️' : h.actionType === 'timeout_medical' ? '🏥' : h.actionType === 'timeout_referee' ? '🟨' : h.actionType === 'substitution' || h.actionType === 'player_rotation' || h.actionType === 'side_change' ? '🔄' : h.actionType === 'walkover' ? '⚪' : h.actionType === 'coin_toss' ? '🪙' : h.actionType === 'warmup_start' ? '🏃' : h.actionType === 'match_start' ? '🎾' : h.actionType?.startsWith('penalty_') ? '🔴' : h.points >= 2 ? '🔴' : '🟡';
              const timeStr = parseTimeStr(h.time);

              if (isMeta) {
                const actionLabel = ACTION_LABELS[h.actionType || ''] || h.actionLabel || '';
                const desc = h.penaltyWarning ? `${h.actionPlayer || '?'} ${actionLabel} 경고`
                  : h.actionType === 'dead_ball' ? `${h.server || '?'} 데드볼 → 재서브`
                  : h.actionType === 'timeout' ? `${h.actionPlayer || ''} 타임아웃`
                  : h.actionType === 'timeout_player' ? `${h.actionPlayer || ''} 선수 타임아웃`
                  : h.actionType === 'timeout_medical' ? `${h.actionPlayer || ''} 메디컬 타임아웃`
                  : h.actionType === 'timeout_referee' ? `레프리 타임아웃`
                  : h.actionType === 'pause' ? `일시정지 (${h.actionPlayer || ''})`
                  : h.actionType === 'substitution' ? (h.actionLabel || '선수 교체')
                  : h.actionType === 'walkover' ? `${h.scoringPlayer || '?'} 부전승`
                  : h.actionType === 'coin_toss' ? (h.actionLabel || '동전던지기')
                  : h.actionType === 'warmup_start' ? (h.actionLabel || '워밍업')
                  : h.actionType === 'match_start' ? (h.actionLabel || '경기 시작')
                  : h.actionType === 'player_rotation' ? (h.actionLabel || '선수 교체')
                  : h.actionType === 'side_change' ? (h.actionLabel || '사이드 체인지')
                  : (h.actionLabel || '');
                return (
                  <div key={`${setNum}-${i}`} role="listitem" tabIndex={0} aria-label={`${timeStr} ${desc}`} style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem', color: '#d1d5db', borderBottom: '1px solid #1f2937', backgroundColor: '#0d1117' }}>
                    <div aria-hidden="true">{timeStr} {icon} {desc}</div>
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
              const scoreStr = (() => { const p1 = h.scoreAfter?.player1 ?? 0; const p2 = h.scoreAfter?.player2 ?? 0; return h.serverSide === 'player2' ? `${p2}:${p1}` : `${p1}:${p2}`; })();

              return (
                <div key={`${setNum}-${i}`} role="listitem" tabIndex={0} aria-label={`${timeStr}, ${h.server || '?'} 서브 ${h.serveNumber || ''}회차, ${actionDesc}, 스코어 ${scoreStr}`} style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #1f2937', fontSize: '0.875rem' }}>
                  <div aria-hidden="true" style={{ fontSize: '0.75rem', color: '#d1d5db' }}>
                    {h.server || '?'} 서브 {h.serveNumber ? `${h.serveNumber}회차` : ''} {timeStr && `· ${timeStr}`}
                  </div>
                  <div aria-hidden="true" style={{ color: actionColor, fontWeight: 'bold' }}>
                    {icon} {actionDesc}
                  </div>
                  <div aria-hidden="true" style={{ fontSize: '0.8125rem', color: '#d1d5db' }}>
                    점수: {scoreStr}
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
