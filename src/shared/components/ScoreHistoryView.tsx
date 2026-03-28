import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScoreHistoryEntry } from '@shared/types';
import { parseTimeDisplay } from '@shared/utils/locale';

const ACTION_KEY_MAP: Record<string, string> = {
  goal: 'common.scoreActions.goal',
  foul: 'common.scoreActions.foul',
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
  walkover: 'common.scoreActions.walkover',
};

const META_ACTION_TYPES = new Set([
  'pause', 'resume', 'timeout', 'timeout_player', 'timeout_medical', 'timeout_referee',
  'substitution', 'dead_ball', 'walkover', 'side_change', 'coin_toss', 'warmup_start',
  'match_start', 'player_rotation'
]);

function parseTimeStr(time: string | undefined): string {
  if (!time) return '';
  return parseTimeDisplay(time);
}

interface ScoreHistoryViewProps {
  history: ScoreHistoryEntry[];
  sets?: { player1Score: number; player2Score: number; winnerId?: string | null }[];
}

/**
 * Score history view — identical structure to the spectator LiveMatchView history.
 * No custom ARIA attributes; relies on plain HTML semantics for screen reader compatibility.
 */
export default function ScoreHistoryView({ history, sets }: ScoreHistoryViewProps) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<'newest' | 'oldest'>('oldest');
  const [showAll, setShowAll] = useState(false);

  const getActionLabel = (actionType: string) => {
    const key = ACTION_KEY_MAP[actionType];
    return key ? t(key) : actionType;
  };

  const meaningfulHistory = useMemo(() => {
    return history.filter(h => {
      // Skip "set 0" entries
      if (h.set === 0) return false;
      // Skip match_start entries with 0:0 score (no useful info)
      if (h.actionType === 'match_start' && h.scoreAfter?.player1 === 0 && h.scoreAfter?.player2 === 0) return false;
      return h.points > 0 || META_ACTION_TYPES.has(h.actionType) || h.penaltyWarning;
    });
  }, [history]);

  const sortedHistory = useMemo(() => {
    if (order === 'newest') return meaningfulHistory;
    return [...meaningfulHistory].reverse();
  }, [meaningfulHistory, order]);

  const displayedHistory = useMemo(() => {
    if (showAll || meaningfulHistory.length <= 50) return sortedHistory;
    return sortedHistory.slice(0, 50);
  }, [sortedHistory, showAll, meaningfulHistory.length]);

  const setGroups = useMemo(() => {
    const groups = new Map<number, ScoreHistoryEntry[]>();
    displayedHistory.forEach(h => {
      const s = h.set || 1;
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s)!.push(h);
    });
    const entries = Array.from(groups.entries());
    return order === 'newest' ? entries.sort((a, b) => b[0] - a[0]) : entries.sort((a, b) => a[0] - b[0]);
  }, [displayedHistory, order]);

  if (meaningfulHistory.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 style={{ fontWeight: 'bold', color: '#facc15', margin: 0 }}>
          {t('common.matchHistory.titleWithCount', { count: meaningfulHistory.length })}
        </h2>
        <button
          className="btn"
          onClick={() => setOrder(o => o === 'newest' ? 'oldest' : 'newest')}
          style={{ fontSize: '0.75rem', padding: '4px 10px', background: '#374151' }}
        >
          {order === 'newest' ? t('common.matchHistory.newestFirst') : t('common.matchHistory.oldestFirst')}
        </button>
      </div>

      {!showAll && meaningfulHistory.length > 50 && (
        <button
          className="btn"
          onClick={() => setShowAll(true)}
          style={{ width: '100%', marginBottom: '0.5rem', fontSize: '0.8rem', padding: '6px 12px', background: '#1e40af' }}
        >
          {t('common.matchHistory.showAll', { count: meaningfulHistory.length, defaultValue: `Show all ${meaningfulHistory.length} entries` })}
        </button>
      )}

      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {order === 'oldest' && (
          <div style={{
            textAlign: 'center', padding: '0.5rem', marginBottom: '0.5rem',
            background: 'linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%)',
            borderRadius: '0.5rem', color: '#93c5fd', fontSize: '0.9rem',
          }}>
            {t('common.matchHistory.matchStart')}
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
              }}>
                {t('common.matchHistory.setLabel', { num: setNum })} {setData ? `(${setData.player1Score} : ${setData.player2Score})` : ''}
              </div>
              {entries.map((h, i) => {
                const isMeta = h.points === 0 || h.penaltyWarning === true;
                const icon = h.penaltyWarning ? '⚠️' : h.actionType === 'dead_ball' ? '🔵' : h.actionType === 'goal' ? '⚽' : h.actionType === 'pause' ? '⏸️' : h.actionType === 'resume' ? '▶' : h.actionType === 'timeout' || h.actionType === 'timeout_player' ? '⏱️' : h.actionType === 'timeout_medical' ? '🏥' : h.actionType === 'timeout_referee' ? '🟨' : h.actionType === 'substitution' || h.actionType === 'player_rotation' || h.actionType === 'side_change' ? '🔄' : h.actionType === 'walkover' ? '⚪' : h.actionType === 'coin_toss' ? '🪙' : h.actionType === 'warmup_start' ? '🏃' : h.actionType === 'match_start' ? '🎾' : h.actionType?.startsWith('penalty_') ? '🔴' : h.points >= 2 ? '🔴' : '🟡';
                const timeStr = parseTimeStr(h.time);

                if (isMeta) {
                  const actionLabel = getActionLabel(h.actionType || '');
                  const desc = h.penaltyWarning ? t('common.matchHistory.warning', { player: h.actionPlayer || '?', action: actionLabel || h.actionType || '' })
                    : h.actionType === 'dead_ball' ? t('common.matchHistory.deadBall', { server: h.server || '?' })
                    : h.actionType === 'timeout' ? t('common.matchHistory.timeout', { player: h.actionPlayer || '' })
                    : h.actionType === 'timeout_player' ? t('common.matchHistory.playerTimeout', { player: h.actionPlayer || '' })
                    : h.actionType === 'timeout_medical' ? t('common.matchHistory.medicalTimeout', { player: h.actionPlayer || '' })
                    : h.actionType === 'timeout_referee' ? t('common.matchHistory.refereeTimeout')
                    : h.actionType === 'pause' ? t('common.matchHistory.pause', { player: h.actionPlayer || '' })
                    : h.actionType === 'substitution' ? t('common.matchHistory.substitution')
                    : h.actionType === 'walkover' ? `${h.scoringPlayer || '?'} ${t('common.scoreActions.walkover')}`
                    : h.actionType === 'coin_toss' ? (h.actionLabel || t('common.matchHistory.coinToss'))
                    : h.actionType === 'warmup_start' ? t('common.matchHistory.warmup')
                    : h.actionType === 'match_start' ? t('common.matchHistory.matchStart')
                    : h.actionType === 'player_rotation' ? t('common.matchHistory.playerRotation')
                    : h.actionType === 'side_change' ? t('common.matchHistory.sideChange')
                    : (actionLabel || h.actionType || '');
                  const hideScore = ['timeout', 'timeout_player', 'timeout_medical', 'timeout_referee', 'side_change', 'pause', 'warmup_start', 'coin_toss'].includes(h.actionType) || h.penaltyWarning === true;
                  return (
                    <div key={`${setNum}-${i}`} style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem', color: '#d1d5db', borderBottom: '1px solid #1f2937', backgroundColor: '#0d1117', contentVisibility: 'auto', containIntrinsicSize: '0 40px' }}>
                      <div>{timeStr} {icon} {desc}</div>
                      {!hideScore && <div style={{ fontSize: '0.75rem' }}>{t('common.matchHistory.score')}: {(() => { const p1 = h.scoreAfter?.player1 ?? 0; const p2 = h.scoreAfter?.player2 ?? 0; return h.serverSide === 'player2' ? `${p2} : ${p1}` : `${p1} : ${p2}`; })()}</div>}
                    </div>
                  );
                }

                const isGoal = h.actionType === 'goal';
                const label = getActionLabel(h.actionType || '') || h.actionType || '';
                const actionDesc = isGoal
                  ? t('common.matchHistory.goalScored', { player: h.scoringPlayer, points: h.points })
                  : h.actionType === 'walkover'
                  ? `${h.scoringPlayer || '?'} ${t('common.scoreActions.walkover')}`
                  : t('common.matchHistory.penaltyScored', { actionPlayer: h.actionPlayer, action: label, scoringPlayer: h.scoringPlayer, points: h.points });
                const actionColor = isGoal ? '#22c55e' : h.points >= 2 ? '#ef4444' : '#eab308';

                return (
                  <div key={`${setNum}-${i}`} style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #1f2937', fontSize: '0.875rem', contentVisibility: 'auto', containIntrinsicSize: '0 40px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#d1d5db' }}>
                      🎾 {h.server || '?'} {t('common.matchHistory.serve')} {h.serveNumber ? t('common.matchHistory.serveNumber', { num: h.serveNumber }) : ''} {timeStr && `· ${timeStr}`}
                    </div>
                    <div style={{ color: actionColor, fontWeight: 'bold' }}>
                      {icon} {actionDesc}
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: '#d1d5db' }}>
                      {t('common.matchHistory.score')}: {(() => { const p1 = h.scoreAfter?.player1 ?? 0; const p2 = h.scoreAfter?.player2 ?? 0; return h.serverSide === 'player2' ? `${p2} : ${p1}` : `${p1} : ${p2}`; })()}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
