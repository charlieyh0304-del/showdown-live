import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScoreHistoryEntry, SetScore } from '@shared/types';
import { parseTimeDisplay } from '@shared/utils/locale';

const ACTION_TYPE_TO_KEY: Record<string, string> = {
  goal: 'common.scoreActions.goal',
  irregular_serve: 'common.scoreActions.irregularServe',
  centerboard: 'common.scoreActions.centerboard',
  body_touch: 'common.scoreActions.bodyTouch',
  illegal_defense: 'common.scoreActions.illegalDefense',
  out: 'common.scoreActions.out',
  ball_holding: 'common.scoreActions.ballHolding',
  mask_touch: 'common.scoreActions.maskTouch',
  penalty: 'common.scoreActions.penalty',
  penalty_table_pushing: 'common.scoreActions.penaltyTablePushing',
  penalty_electronic: 'common.scoreActions.penaltyElectronic',
  penalty_talking: 'common.scoreActions.penaltyTalking',
};

interface SetGroupedHistoryProps {
  history: ScoreHistoryEntry[];
  sets: SetScore[];
  showAll?: boolean;
}

export default function SetGroupedHistory({ history, sets, showAll = false }: SetGroupedHistoryProps) {
  const { t } = useTranslation();
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
    // Skip set 0 entries
    if (h.set === 0) return;
    // Skip match_start with 0:0 score
    if (h.actionType === 'match_start' && h.scoreAfter?.player1 === 0 && h.scoreAfter?.player2 === 0) return;
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
      <div className="text-center">
        <button
          className="text-xs text-blue-400 underline"
          onClick={() => setSortOrder(s => s === 'newest' ? 'oldest' : 'newest')}
          aria-label={sortOrder === 'newest' ? t('common.matchHistory.sortNewestAriaLabel') : t('common.matchHistory.sortOldestAriaLabel')}
          style={{ minHeight: '44px', minWidth: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {sortOrder === 'newest' ? t('common.matchHistory.newestSortButton') : t('common.matchHistory.oldestSortButton')}
        </button>
      </div>
      {setNums.map(setNum => {
        let entries = [...groups[setNum]];
        if (sortOrder === 'newest') entries = entries.reverse();
        if (!showAll) entries = entries.slice(0, 10);
        const setScore = sets[setNum - 1];

        return (
          <div key={setNum}>
            <h4 className="text-sm font-bold text-blue-400 border-b border-blue-400/30 pb-1 mb-2" aria-label={`${t('common.matchHistory.setLabel', { num: setNum })} ${setScore ? `${t('common.matchHistory.score')} ${setScore.player1Score} : ${setScore.player2Score}` : ''}`}>
              {t('common.matchHistory.setLabel', { num: setNum })} {setScore ? `(${setScore.player1Score}:${setScore.player2Score})` : ''}
            </h4>
            <ul className="space-y-2 list-none p-0 m-0" aria-label={`${t('common.matchHistory.setLabel', { num: setNum })} ${t('common.matchHistory.title')}`}>
              {entries.map((h, i) => {
                const icon = h.penaltyWarning ? '⚠️' : h.actionType === 'dead_ball' ? '🔵' : h.actionType === 'goal' ? '⚽' : h.actionType === 'pause' ? '⏸️' : h.actionType === 'resume' ? '▶' : h.actionType === 'timeout' ? '⏱️' : h.actionType === 'timeout_player' ? '⏱️' : h.actionType === 'timeout_medical' ? '🏥' : h.actionType === 'timeout_referee' ? '🟨' : h.actionType === 'substitution' ? '🔄' : h.actionType === 'walkover' ? '⚪' : h.actionType === 'coin_toss' ? '🪙' : h.actionType === 'warmup_start' ? '🏃' : h.actionType === 'match_start' ? '🎾' : h.actionType === 'player_rotation' ? '🔄' : h.actionType === 'side_change' ? '🔄' : h.actionType?.startsWith('penalty_') ? '🔴' : h.points >= 2 ? '🔴' : '🟡';

                const timeStr = h.time ? parseTimeDisplay(h.time) : '--:--';

                // Non-scoring entries (pause, resume, timeout, substitution, dead_ball, walkover, penaltyWarning)
                if (h.points === 0 || h.penaltyWarning) {
                  const actionLabel = ACTION_TYPE_TO_KEY[h.actionType || ''] ? t(ACTION_TYPE_TO_KEY[h.actionType || '']) : (h.actionType || '');
                  const desc = h.penaltyWarning ? t('common.matchHistory.warning', { player: h.actionPlayer || '?', action: actionLabel }) :
                    h.actionType === 'walkover' ? `${h.actionPlayer || '?'} → ${h.scoringPlayer || '?'} ${t('common.scoreActions.walkover')}` :
                    h.actionType === 'dead_ball' ? t('common.matchHistory.deadBall', { server: h.server || '?' }) :
                    h.actionType === 'pause' ? t('common.matchHistory.pause', { player: h.actionPlayer || '' }) :
                    h.actionType === 'resume' ? `${h.actionPlayer || ''}` :
                    h.actionType === 'timeout' ? t('common.matchHistory.timeout', { player: h.actionPlayer || '' }) :
                    h.actionType === 'timeout_player' ? t('common.matchHistory.playerTimeout', { player: h.actionPlayer || '' }) :
                    h.actionType === 'timeout_medical' ? t('common.matchHistory.medicalTimeout', { player: h.actionPlayer || '' }) :
                    h.actionType === 'timeout_referee' ? t('common.matchHistory.refereeTimeout') :
                    h.actionType === 'substitution' ? t('common.matchHistory.substitution') :
                    h.actionType === 'coin_toss' ? (h.actionLabel || t('common.matchHistory.coinToss')) :
                    h.actionType === 'warmup_start' ? t('common.matchHistory.warmup') :
                    h.actionType === 'match_start' ? (h.actionLabel || t('common.matchHistory.matchStart')) :
                    h.actionType === 'player_rotation' ? t('common.matchHistory.playerRotation') :
                    h.actionType === 'side_change' ? t('common.matchHistory.sideChange') :
                    (actionLabel || h.actionType || '');
                  const hideScore = ['timeout', 'timeout_player', 'timeout_medical', 'timeout_referee', 'side_change', 'pause', 'warmup_start', 'coin_toss'].includes(h.actionType) || h.penaltyWarning === true;
                  const scoreStr = !hideScore ? (() => { const p1 = h.scoreAfter?.player1 ?? 0; const p2 = h.scoreAfter?.player2 ?? 0; return h.serverSide === 'player2' ? `${p2}:${p1}` : `${p1}:${p2}`; })() : '';
                  const ariaText = `${timeStr}, ${desc}${scoreStr ? `, ${t('common.matchHistory.score')} ${scoreStr}` : ''}`;
                  return (
                    <li key={`${setNum}-${h.time}-${i}`} className="text-xs text-gray-400 bg-gray-800/50 rounded px-3 py-2 space-y-0.5" tabIndex={0} aria-label={ariaText}>
                      <div aria-hidden="true">
                        <div className="text-gray-500" style={{ fontSize: '0.6875rem' }}>{timeStr}</div>
                        <div>{icon} {desc}</div>
                        {scoreStr && <div className="text-gray-300">{t('common.matchHistory.score')}: {scoreStr}</div>}
                      </div>
                    </li>
                  );
                }

                // Scoring entries
                let actionDesc: string;
                const descriptiveLabel = ACTION_TYPE_TO_KEY[h.actionType || ''] ? t(ACTION_TYPE_TO_KEY[h.actionType || '']) : '';
                if (h.actionType === 'goal') {
                  actionDesc = t('common.matchHistory.goalScored', { player: h.scoringPlayer || '?', points: h.points });
                } else if (descriptiveLabel) {
                  actionDesc = t('common.matchHistory.penaltyScored', { actionPlayer: h.actionPlayer || '?', action: descriptiveLabel, scoringPlayer: h.scoringPlayer || '?', points: h.points });
                } else {
                  actionDesc = t('common.matchHistory.penaltyScored', { actionPlayer: h.actionPlayer || '?', action: h.actionType || '?', scoringPlayer: h.scoringPlayer || '?', points: h.points });
                }
                const scoreDisplay = (() => { const p1 = h.scoreAfter?.player1 ?? 0; const p2 = h.scoreAfter?.player2 ?? 0; return h.serverSide === 'player2' ? `${p2}:${p1}` : `${p1}:${p2}`; })();
                const ariaText = `${timeStr}, ${h.server || '?'} ${t('common.matchHistory.serve')} ${t('common.matchHistory.serveNumber', { num: h.serveNumber || '' })}, ${actionDesc}, ${t('common.matchHistory.score')} ${scoreDisplay}`;

                return (
                  <li key={`${setNum}-${h.time}-${i}`} className="text-xs text-gray-400 bg-gray-800 rounded px-3 py-2 space-y-0.5" tabIndex={0} aria-label={ariaText}>
                    <div aria-hidden="true">
                      <div className="flex justify-between text-gray-500" style={{ fontSize: '0.6875rem' }}>
                        <span>{h.server || '?'} {h.serveNumber ? t('common.matchHistory.serveNumber', { num: h.serveNumber }) : ''}</span>
                        <span>{timeStr}</span>
                      </div>
                      <div style={{ color: h.actionType === 'goal' ? '#22c55e' : h.points >= 2 ? '#ef4444' : '#eab308' }}>
                        {icon} {actionDesc}
                      </div>
                      <div className="text-gray-300">{t('common.matchHistory.score')}: {scoreDisplay}</div>
                    </div>
                  </li>
                );
              })}
              {!showAll && groups[setNum].length > 10 && (
                <li className="text-xs text-gray-400 text-center">{t('common.matchHistory.andMore', { count: groups[setNum].length - 10 })}</li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
