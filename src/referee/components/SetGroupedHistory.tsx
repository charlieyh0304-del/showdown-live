import { useState } from 'react';
import type { ScoreHistoryEntry, SetScore } from '@shared/types';

interface SetGroupedHistoryProps {
  history: ScoreHistoryEntry[];
  sets: SetScore[];
  showAll?: boolean;
}

export default function SetGroupedHistory({ history, sets, showAll = false }: SetGroupedHistoryProps) {
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

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
                // HTML 원본과 동일한 actionDesc 생성
                let actionDesc: string;
                if (h.actionType === 'goal') {
                  actionDesc = `${h.scoringPlayer || '?'} 골`;
                } else {
                  const labelParts = (h.actionLabel || '').split(' ').slice(1).join(' ');
                  actionDesc = `${h.actionPlayer || '?'} ${labelParts} (${h.scoringPlayer || '?'} 득점)`;
                }

                return (
                  <div key={`${setNum}-${h.time}-${i}`} className="text-xs text-gray-400 bg-gray-800 rounded px-3 py-2">
                    <div className="flex justify-between mb-1">
                      <span className="text-gray-500">
                        {h.time || '--:--'} - {h.server || '?'} 서브 {h.serveNumber ?? 0}회차
                      </span>
                      {h.scoreBefore != null && (
                        <span className="text-gray-500">
                          ({h.scoreBefore.player1 ?? 0}:{h.scoreBefore.player2 ?? 0})
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between items-center">
                      <span>{h.actionType === 'goal' ? '⚽' : h.points >= 2 ? '🔴' : '🟡'} {actionDesc}</span>
                      <span className="font-bold text-blue-400">+{h.points}점</span>
                    </div>
                    <div className="mt-1 pt-1 border-t border-gray-700">
                      <span className="text-green-400 font-semibold">
                        → 스코어: {h.scoreAfter?.player1 ?? 0}:{h.scoreAfter?.player2 ?? 0}
                      </span>
                    </div>
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
