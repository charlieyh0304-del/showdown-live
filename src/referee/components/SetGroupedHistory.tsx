import { useState } from 'react';
import type { ScoreHistoryEntry, SetScore } from '@shared/types';

const DESCRIPTIVE_ACTION_LABELS: Record<string, string> = {
  goal: '골 득점',
  irregular_serve: '부정 서브',
  centerboard: '센터보드 터치',
  body_touch: '바디 터치',
  illegal_defense: '일리걸 디펜스',
  out: '아웃',
  ball_holding: '볼 홀딩',
  mask_touch: '마스크/고글 터치',
  penalty: '기타 벌점',
  penalty_table_pushing: '테이블 푸싱',
  penalty_electronic: '전자기기 소리',
  penalty_talking: '경기 중 말하기',
};

interface SetGroupedHistoryProps {
  history: ScoreHistoryEntry[];
  sets: SetScore[];
  showAll?: boolean;
}

export default function SetGroupedHistory({ history, sets, showAll = false }: SetGroupedHistoryProps) {
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('oldest');

  if (history.length === 0) return null;

  // Known meta-event types that are meaningful even with 0 points
  const META_ACTION_TYPES = new Set([
    'pause', 'resume', 'timeout', 'timeout_player', 'timeout_medical', 'timeout_referee',
    'substitution', 'dead_ball', 'walkover', 'coin_toss', 'warmup_start',
    'match_start', 'player_rotation', 'side_change'
  ]);

  const groups: Record<number, ScoreHistoryEntry[]> = {};
  history.forEach(h => {
    // Filter out 0-point entries that are not meaningful meta-events
    if (h.points === 0 && !META_ACTION_TYPES.has(h.actionType) && !h.penaltyWarning) return;
    // 재개 정보 숨김 - 모든 resume 엔트리 제거
    if (h.actionType === 'resume') return;
    const setNum = h.set || 1;
    if (!groups[setNum]) groups[setNum] = [];
    groups[setNum].push(h);
  });

  // 각 그룹 내 시간순 정렬 (히스토리 원본 순서에 의존하지 않고 명확하게 정렬)
  for (const setNum of Object.keys(groups)) {
    groups[Number(setNum)].sort((a, b) => {
      const sa = a.scoreAfter ? (a.scoreAfter.player1 + a.scoreAfter.player2) : 0;
      const sb = b.scoreAfter ? (b.scoreAfter.player1 + b.scoreAfter.player2) : 0;
      return sa - sb; // 총 점수 오름차순 = 시간순
    });
  }

  const setNums = Object.keys(groups).map(Number).sort((a, b) =>
    sortOrder === 'newest' ? b - a : a - b
  );

  return (
    <div className="space-y-4">
      <button
        className="text-xs text-blue-400 underline"
        onClick={() => setSortOrder(s => s === 'newest' ? 'oldest' : 'newest')}
        aria-label={sortOrder === 'newest' ? '오래된순으로 정렬 변경' : '최신순으로 정렬 변경'}
        style={{ minHeight: '44px', minWidth: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {sortOrder === 'newest' ? '최신순 ↓' : '오래된순 ↑'}
      </button>
      {setNums.map(setNum => {
        let entries = [...groups[setNum]];
        if (sortOrder === 'newest') entries = entries.reverse();
        if (!showAll) entries = entries.slice(0, 10);
        const setScore = sets[setNum - 1];

        return (
          <div key={setNum}>
            <h4 className="text-sm font-bold text-blue-400 border-b border-blue-400/30 pb-1 mb-2" aria-label={`세트 ${setNum} ${setScore ? `스코어 ${setScore.player1Score} 대 ${setScore.player2Score}` : ''}`}>
              세트 {setNum} {setScore ? `(${setScore.player1Score}:${setScore.player2Score})` : ''}
            </h4>
            <ul className="space-y-2 list-none p-0 m-0" aria-label={`세트 ${setNum} 기록`}>
              {entries.map((h, i) => {
                const icon = h.penaltyWarning ? '⚠️' : h.actionType === 'dead_ball' ? '🔵' : h.actionType === 'goal' ? '⚽' : h.actionType === 'pause' ? '⏸️' : h.actionType === 'resume' ? '▶' : h.actionType === 'timeout' ? '⏱️' : h.actionType === 'timeout_player' ? '⏱️' : h.actionType === 'timeout_medical' ? '🏥' : h.actionType === 'timeout_referee' ? '🟨' : h.actionType === 'substitution' ? '🔄' : h.actionType === 'walkover' ? '⚪' : h.actionType === 'coin_toss' ? '🪙' : h.actionType === 'warmup_start' ? '🏃' : h.actionType === 'match_start' ? '🎾' : h.actionType === 'player_rotation' ? '🔄' : h.actionType === 'side_change' ? '🔄' : h.actionType?.startsWith('penalty_') ? '🔴' : h.points >= 2 ? '🔴' : '🟡';

                // h.time is stored as locale string (e.g. "오후 8:19:26") - use directly, don't re-parse
                const timeStr = (() => {
                  if (!h.time) return '--:--';
                  // If already a short locale time string, use as-is
                  if (h.time.includes('오전') || h.time.includes('오후') || h.time.match(/^\d{1,2}:\d{2}/)) {
                    // Strip seconds if present (오후 8:19:26 → 오후 8:19)
                    return h.time.replace(/:\d{2}$/, '');
                  }
                  // Try parsing as Date (ISO format)
                  const d = new Date(h.time);
                  if (!isNaN(d.getTime())) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                  return h.time;
                })();

                // Non-scoring entries (pause, resume, timeout, substitution, dead_ball, walkover, penaltyWarning)
                if (h.points === 0 || h.penaltyWarning) {
                  const actionLabel = DESCRIPTIVE_ACTION_LABELS[h.actionType || ''] || h.actionLabel || '';
                  const desc = h.penaltyWarning ? `${h.actionPlayer || '?'} ${actionLabel} 경고` :
                    h.actionType === 'walkover' ? `${h.actionPlayer || '?'} ${(h.actionLabel || '부전승').replace('부전승 (', '').replace(')', '') || '기권'} → ${h.scoringPlayer || '?'} 부전승` :
                    h.actionType === 'dead_ball' ? `${h.server || '?'} 데드볼 → 재서브` :
                    h.actionType === 'pause' ? `일시정지 (${h.actionPlayer || ''})` :
                    h.actionType === 'resume' ? `재개 (${h.actionPlayer || ''})` :
                    h.actionType === 'timeout' ? `${h.actionPlayer || ''} 타임아웃` :
                    h.actionType === 'timeout_player' ? `${h.actionPlayer || ''} 선수 타임아웃` :
                    h.actionType === 'timeout_medical' ? `${h.actionPlayer || ''} 메디컬 타임아웃` :
                    h.actionType === 'timeout_referee' ? `레프리 타임아웃` :
                    h.actionType === 'substitution' ? (h.actionLabel || '선수 교체') :
                    h.actionType === 'coin_toss' ? (h.actionLabel || '동전던지기') :
                    h.actionType === 'warmup_start' ? (h.actionLabel || '워밍업') :
                    h.actionType === 'match_start' ? (h.actionLabel || '경기 시작') :
                    h.actionType === 'player_rotation' ? (h.actionLabel || '선수 교체') :
                    h.actionType === 'side_change' ? (h.actionLabel || '사이드 체인지') :
                    (h.actionLabel || '');
                  const hideScore = ['timeout', 'timeout_player', 'timeout_medical', 'timeout_referee', 'side_change', 'pause', 'warmup_start', 'coin_toss'].includes(h.actionType) || h.penaltyWarning === true;
                  const scoreStr = !hideScore ? (() => { const p1 = h.scoreAfter?.player1 ?? 0; const p2 = h.scoreAfter?.player2 ?? 0; return h.serverSide === 'player2' ? `${p2}:${p1}` : `${p1}:${p2}`; })() : '';
                  const ariaText = `${timeStr}, ${desc}${scoreStr ? `, 스코어 ${scoreStr}` : ''}`;
                  return (
                    <li key={`${setNum}-${h.time}-${i}`} className="text-xs text-gray-400 bg-gray-800/50 rounded px-3 py-2" tabIndex={0} aria-label={ariaText}>
                      <div className="flex justify-between items-start gap-2" aria-hidden="true">
                        <span className="break-words">{timeStr} {icon} {desc}</span>
                        {scoreStr && <span className="whitespace-nowrap">{scoreStr}</span>}
                      </div>
                    </li>
                  );
                }

                // Scoring entries
                let actionDesc: string;
                const descriptiveLabel = DESCRIPTIVE_ACTION_LABELS[h.actionType || ''];
                if (h.actionType === 'goal') {
                  actionDesc = `${h.scoringPlayer || '?'} 골 득점 +${h.points}점`;
                } else if (h.actionType === 'penalty_table_pushing') {
                  actionDesc = `${h.actionPlayer || '?'} 테이블 푸싱 → ${h.scoringPlayer || '?'} +${h.points}점`;
                } else if (h.actionType === 'penalty_electronic') {
                  actionDesc = `${h.actionPlayer || '?'} 전자기기 소리 → ${h.scoringPlayer || '?'} +${h.points}점`;
                } else if (h.actionType === 'penalty_talking') {
                  actionDesc = `${h.actionPlayer || '?'} 경기 중 말하기 → ${h.scoringPlayer || '?'} +${h.points}점`;
                } else if (descriptiveLabel) {
                  actionDesc = `${h.actionPlayer || '?'} ${descriptiveLabel} → ${h.scoringPlayer || '?'} +${h.points}점`;
                } else {
                  const labelParts = (h.actionLabel || '').split(' ').slice(1).join(' ');
                  actionDesc = `${h.actionPlayer || '?'} ${labelParts} → ${h.scoringPlayer || '?'} +${h.points}점`;
                }
                const scoreDisplay = (() => { const p1 = h.scoreAfter?.player1 ?? 0; const p2 = h.scoreAfter?.player2 ?? 0; return h.serverSide === 'player2' ? `${p2}:${p1}` : `${p1}:${p2}`; })();
                const ariaText = `${timeStr}, ${h.server || '?'} 서브 ${h.serveNumber || ''}회차, ${actionDesc}, 스코어 ${scoreDisplay}`;

                return (
                  <li key={`${setNum}-${h.time}-${i}`} className="text-xs text-gray-400 bg-gray-800 rounded px-3 py-2" tabIndex={0} aria-label={ariaText}>
                    <div className="flex justify-between items-center text-gray-400 mb-1" style={{ fontSize: '0.6875rem' }} aria-hidden="true">
                      <span>{h.server || '?'} {h.serveNumber ? `${h.serveNumber}회차` : ''}</span>
                      <span>{timeStr}</span>
                    </div>
                    <div className="flex justify-between items-center" aria-hidden="true">
                      <span>{icon} {actionDesc}</span>
                      <span className="font-bold text-green-400 ml-2 whitespace-nowrap">{scoreDisplay}</span>
                    </div>
                  </li>
                );
              })}
              {!showAll && groups[setNum].length > 10 && (
                <li className="text-xs text-gray-400 text-center">... 외 {groups[setNum].length - 10}개</li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
