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
};

interface SetGroupedHistoryProps {
  history: ScoreHistoryEntry[];
  sets: SetScore[];
  showAll?: boolean;
}

export default function SetGroupedHistory({ history, sets, showAll = false }: SetGroupedHistoryProps) {
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('oldest');

  if (history.length === 0) return null;

  const groups: Record<number, ScoreHistoryEntry[]> = {};
  history.forEach(h => {
    const setNum = h.set || 1;
    if (!groups[setNum]) groups[setNum] = [];
    groups[setNum].push(h);
  });

  const setNums = Object.keys(groups).map(Number).sort((a, b) =>
    sortOrder === 'newest' ? b - a : a - b
  );

  return (
    <div className="space-y-4">
      <button
        className="text-xs text-blue-400 underline"
        onClick={() => setSortOrder(s => s === 'newest' ? 'oldest' : 'newest')}
        aria-label={sortOrder === 'newest' ? '오래된순으로 정렬 변경' : '최신순으로 정렬 변경'}
      >
        {sortOrder === 'newest' ? '최신순 ↓' : '오래된순 ↑'}
      </button>
      {setNums.map(setNum => {
        let entries = [...groups[setNum]];
        if (sortOrder === 'oldest') entries = entries.reverse();
        if (!showAll) entries = entries.slice(0, 10);
        const setScore = sets[setNum - 1];

        return (
          <div key={setNum}>
            <h4 className="text-sm font-bold text-blue-400 border-b border-blue-400/30 pb-1 mb-2">
              세트 {setNum} {setScore ? `(${setScore.player1Score}:${setScore.player2Score})` : ''}
            </h4>
            <div className="space-y-1">
              {entries.map((h, i) => {
                const icon = h.actionType === 'dead_ball' ? '🔵' : h.actionType === 'goal' ? '⚽' : h.actionType === 'pause' ? '⏸️' : h.actionType === 'resume' ? '▶' : h.actionType === 'timeout' ? '⏱️' : h.actionType === 'substitution' ? '🔄' : h.actionType === 'walkover' ? '⚪' : h.points >= 2 ? '🔴' : '🟡';

                // Non-scoring entries (pause, resume, timeout, substitution, dead_ball, walkover)
                if (h.points === 0) {
                  const desc = h.actionType === 'walkover' ? `${h.actionPlayer || '?'} ${(h.actionLabel || '부전승').replace('부전승 (', '').replace(')', '') || '기권'} → ${h.scoringPlayer || '?'} 부전승` :
                    h.actionType === 'dead_ball' ? `${h.server || '?'} 데드볼 → 재서브` :
                    h.actionType === 'pause' ? `일시정지 (${h.actionPlayer || ''})` :
                    h.actionType === 'resume' ? `재개 (${h.actionPlayer || ''})` :
                    h.actionType === 'timeout' ? `${h.actionPlayer || ''} 타임아웃` :
                    h.actionType === 'substitution' ? (h.actionLabel || '선수 교체') :
                    (h.actionLabel || '');
                  return (
                    <div key={`${setNum}-${h.time}-${i}`} className="text-xs text-gray-500 bg-gray-800/50 rounded px-3 py-1.5 flex justify-between">
                      <span>{h.time || '--:--'} {icon} {desc}</span>
                      <span>{h.scoreAfter?.player1 ?? 0}:{h.scoreAfter?.player2 ?? 0}</span>
                    </div>
                  );
                }

                // Scoring entries: concise single-line format with descriptive labels
                let actionDesc: string;
                const descriptiveLabel = DESCRIPTIVE_ACTION_LABELS[h.actionType || ''];
                if (h.actionType === 'goal') {
                  actionDesc = `${h.scoringPlayer || '?'} 골 득점 +${h.points}점`;
                } else if (descriptiveLabel) {
                  actionDesc = `${h.actionPlayer || '?'} ${descriptiveLabel} → ${h.scoringPlayer || '?'} +${h.points}점`;
                } else {
                  const labelParts = (h.actionLabel || '').split(' ').slice(1).join(' ');
                  actionDesc = `${h.actionPlayer || '?'} ${labelParts} → ${h.scoringPlayer || '?'} +${h.points}점`;
                }

                return (
                  <div key={`${setNum}-${h.time}-${i}`} className="text-xs text-gray-400 bg-gray-800 rounded px-3 py-1.5 flex justify-between items-center">
                    <span>{h.time || '--:--'} {icon} {actionDesc}</span>
                    <span className="font-bold text-green-400 ml-2 whitespace-nowrap">
                      {h.scoreAfter?.player1 ?? 0}:{h.scoreAfter?.player2 ?? 0}
                    </span>
                  </div>
                );
              })}
              {!showAll && groups[setNum].length > 10 && (
                <div className="text-xs text-gray-500 text-center">... 외 {groups[setNum].length - 10}개</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
