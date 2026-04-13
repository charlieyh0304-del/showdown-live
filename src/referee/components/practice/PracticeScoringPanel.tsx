import { useTranslation } from 'react-i18next';
import type { ScoreActionType, PracticeMatch, SetScore } from '@shared/types';
import ScoreHistoryView from '@shared/components/ScoreHistoryView';

export interface PracticeScoringPanelProps {
  p1Name: string;
  p2Name: string;
  matchType: 'individual' | 'team';
  match: PracticeMatch;
  sets: SetScore[];
  scoringDisabled: boolean;
  showSideChange: boolean;
  showHistory: boolean;
  expandedSection: string | null;
  onToggleSection: (key: string) => void;
  onToggleHistory: () => void;
  onIBSAScore: (actingPlayer: 1 | 2, actionType: ScoreActionType, points: number, toOpponent: boolean, label: string) => void;
  onQuickFoul: (player: 1 | 2) => void;
  onDeadBall: (player: 1 | 2) => void;
  onServeMiss: () => void;
  onUndo: () => void;
  onTimeout: (player: 1 | 2, type: 'player' | 'medical' | 'referee') => void;
  onPenalty: (player: 1 | 2, penaltyType: 'penalty_table_pushing' | 'penalty_electronic' | 'penalty_talking') => void;
  onOpenSubModal: (team: 1 | 2) => void;
  shortWhistle: () => void;
  goalWhistle: () => void;
  longWhistle: () => void;
}

export default function PracticeScoringPanel({
  p1Name,
  p2Name,
  matchType,
  match,
  sets,
  scoringDisabled,
  showSideChange,
  showHistory,
  expandedSection,
  onToggleSection,
  onToggleHistory,
  onIBSAScore,
  onQuickFoul,
  onDeadBall,
  onServeMiss,
  onUndo,
  onTimeout,
  onPenalty,
  onOpenSubModal,
  shortWhistle,
  goalWhistle,
  longWhistle,
}: PracticeScoringPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {/* Whistle buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button className="btn bg-gray-700 hover:bg-gray-600 text-white py-3 text-sm font-bold"
          onClick={shortWhistle}
          aria-label={t('referee.scoring.whistleServeAriaLabel')}
          style={{ minHeight: '44px' }}
        >
          📣 {t('referee.scoring.whistleServeButton')}
        </button>
        <button className="btn bg-gray-700 hover:bg-gray-600 text-white py-3 text-sm font-bold"
          onClick={goalWhistle}
          aria-label={t('referee.scoring.whistleGoalAriaLabel')}
          style={{ minHeight: '44px' }}
        >
          🎯 {t('referee.scoring.whistleGoalButton')}
        </button>
        <button className="btn bg-gray-700 hover:bg-gray-600 text-white py-3 text-sm font-bold"
          onClick={longWhistle}
          aria-label={t('referee.scoring.whistleEndAriaLabel')}
          style={{ minHeight: '44px' }}
        >
          📢 {t('referee.scoring.whistleEndButton')}
        </button>
      </div>

      {/* Row 1: Goal +2 */}
      <div className="grid grid-cols-2 gap-3">
        <button className="btn btn-success text-lg py-5 font-bold" disabled={scoringDisabled}
          onClick={() => onIBSAScore(1, 'goal', 2, false, `${p1Name} ${t('common.scoreActions.goal')}`)}
          aria-label={`${p1Name} ${t('common.scoreActions.goal')} +2`}>
          ⚽ {p1Name}<br/>{t('common.scoreActions.goal')} +2
        </button>
        <button className="btn btn-success text-lg py-5 font-bold" disabled={scoringDisabled}
          onClick={() => onIBSAScore(2, 'goal', 2, false, `${p2Name} ${t('common.scoreActions.goal')}`)}
          aria-label={`${p2Name} ${t('common.scoreActions.goal')} +2`}>
          ⚽ {p2Name}<br/>{t('common.scoreActions.goal')} +2
        </button>
      </div>

      {/* Row 2: Foul +1 */}
      <div className="grid grid-cols-2 gap-3">
        <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-base py-4 font-bold" disabled={scoringDisabled}
          onClick={() => onQuickFoul(1)}
          aria-label={`${p1Name} ${t('common.scoreActions.foul')}, ${p2Name} +1`}>
          🟡 {p1Name} {t('common.scoreActions.foul')}<br/><span className="text-sm font-normal">→ {p2Name} +1</span>
        </button>
        <button className="btn bg-yellow-900 hover:bg-yellow-800 text-yellow-200 text-base py-4 font-bold" disabled={scoringDisabled}
          onClick={() => onQuickFoul(2)}
          aria-label={`${p2Name} ${t('common.scoreActions.foul')}, ${p1Name} +1`}>
          🟡 {p2Name} {t('common.scoreActions.foul')}<br/><span className="text-sm font-normal">→ {p1Name} +1</span>
        </button>
      </div>

      {/* Dead ball & Serve miss */}
      <div className="grid grid-cols-2 gap-3">
        <button className="btn bg-purple-700 hover:bg-purple-600 text-white py-3" disabled={scoringDisabled || match.status !== 'in_progress'}
          onClick={() => onDeadBall(match.currentServe === 'player1' ? 1 : 2)}
          aria-label={t('common.matchHistory.deadBall', { server: '' }).trim()}>
          🔵 {t('common.matchHistory.deadBall', { server: '' }).trim()}
        </button>
        <button className="btn bg-orange-700 hover:bg-orange-600 text-white py-3" disabled={scoringDisabled || match.status !== 'in_progress'}
          onClick={onServeMiss}
          aria-label={t('common.scoreActions.serveMiss')}>
          🎾 {t('common.scoreActions.serveMiss')}
        </button>
      </div>

      {/* Undo */}
      <button className="btn btn-danger py-3 w-full" onClick={onUndo} disabled={match.scoreHistory.length === 0}
        aria-label={t('common.undo')}>↩️ {t('referee.practice.scoring.undoButton')}</button>

      {/* Collapsible: Timeout (player/medical/referee) */}
      <div className="border border-gray-700 rounded-lg overflow-hidden">
        <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 text-left" onClick={() => onToggleSection('timeout')} aria-expanded={expandedSection === 'timeout'}
          aria-label={t('referee.scoring.timeoutTitle.player')}>
          <span className="text-sm font-bold text-gray-300" aria-hidden="true">⏱️ {t('referee.scoring.timeoutTitle.player')}</span>
          <span className="text-gray-400" aria-hidden="true">{expandedSection === 'timeout' ? '▲' : '▼'}</span>
        </button>
        {expandedSection === 'timeout' && (
          <div className="px-3 py-3 space-y-2 bg-gray-900/50">
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-secondary text-sm py-2" onClick={() => onTimeout(1, 'player')} disabled={match.player1Timeouts >= 1 || !!match.activeTimeout}
                aria-label={`${p1Name} ${t('referee.scoring.timeoutTitle.player')} (${1 - match.player1Timeouts}/1)`}>
                ⏱️ {p1Name} {t('referee.scoring.timeoutTitle.player')} ({1 - match.player1Timeouts}/1)
              </button>
              <button className="btn btn-secondary text-sm py-2" onClick={() => onTimeout(2, 'player')} disabled={match.player2Timeouts >= 1 || !!match.activeTimeout}
                aria-label={`${p2Name} ${t('referee.scoring.timeoutTitle.player')} (${1 - match.player2Timeouts}/1)`}>
                ⏱️ {p2Name} {t('referee.scoring.timeoutTitle.player')} ({1 - match.player2Timeouts}/1)
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-2" onClick={() => onTimeout(1, 'medical')} disabled={!!match.activeTimeout || match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p1Name).length >= 1}
                aria-label={`${p1Name} ${t('referee.scoring.timeoutTitle.medical')} (${1 - match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p1Name).length}/1)`}>
                🏥 {p1Name} {t('referee.scoring.timeoutTitle.medical')} ({1 - match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p1Name).length}/1)
              </button>
              <button className="btn bg-teal-800 hover:bg-teal-700 text-white text-sm py-2" onClick={() => onTimeout(2, 'medical')} disabled={!!match.activeTimeout || match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p2Name).length >= 1}
                aria-label={`${p2Name} ${t('referee.scoring.timeoutTitle.medical')} (${1 - match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p2Name).length}/1)`}>
                🏥 {p2Name} {t('referee.scoring.timeoutTitle.medical')} ({1 - match.scoreHistory.filter(h => h.actionType === 'timeout_medical' && h.actionPlayer === p2Name).length}/1)
              </button>
            </div>
            <button className="btn bg-yellow-800 hover:bg-yellow-700 text-white text-sm py-2 w-full" onClick={() => onTimeout(1, 'referee')} disabled={!!match.activeTimeout}
              aria-label={t('referee.scoring.timeoutTitle.referee')}>
              🟨 {t('referee.scoring.timeoutTitle.referee')}
            </button>
          </div>
        )}
      </div>

      {/* Collapsible: Penalties */}
      <div className="border border-gray-700 rounded-lg overflow-hidden">
        <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 text-left" onClick={() => onToggleSection('penalty')} aria-expanded={expandedSection === 'penalty'}
          aria-label={t('referee.scoring.penaltySection')}>
          <span className="text-sm font-bold text-gray-300" aria-hidden="true">🔴 {t('referee.scoring.penaltySection')}</span>
          <span className="text-gray-400" aria-hidden="true">{expandedSection === 'penalty' ? '▲' : '▼'}</span>
        </button>
        {expandedSection === 'penalty' && (
          <div className="px-3 py-3 bg-gray-900/50 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {(['penalty_table_pushing', 'penalty_electronic', 'penalty_talking'] as const).map(pType => {
                const label = t(`common.scoreActions.${pType === 'penalty_table_pushing' ? 'penaltyTablePushing' : pType === 'penalty_electronic' ? 'penaltyElectronic' : 'penaltyTalking'}`);
                return (
                <button key={`p1-${pType}`} className="btn bg-red-900/70 hover:bg-red-800 text-red-200 text-xs py-2 rounded"
                  disabled={scoringDisabled}
                  onClick={() => onPenalty(1, pType)}
                  aria-label={`${p1Name} ${label}`}>
                  {p1Name} {label}
                </button>
                );
              })}
              {(['penalty_table_pushing', 'penalty_electronic', 'penalty_talking'] as const).map(pType => {
                const label = t(`common.scoreActions.${pType === 'penalty_table_pushing' ? 'penaltyTablePushing' : pType === 'penalty_electronic' ? 'penaltyElectronic' : 'penaltyTalking'}`);
                return (
                <button key={`p2-${pType}`} className="btn bg-red-900/70 hover:bg-red-800 text-red-200 text-xs py-2 rounded"
                  disabled={scoringDisabled}
                  onClick={() => onPenalty(2, pType)}
                  aria-label={`${p2Name} ${label}`}>
                  {p2Name} {label}
                </button>
                );
              })}
            </div>
            {/* Goggles touch: instant 2pt */}
            <div className="border-t border-red-800 pt-2">
              <p className="text-[10px] text-red-400 mb-1">{t('referee.scoring.gogglesTouchHint')}</p>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn bg-red-800 hover:bg-red-700 text-white text-xs py-2 rounded font-bold"
                  disabled={scoringDisabled}
                  onClick={() => onIBSAScore(1, 'mask_touch', 2, true, t('referee.scoring.gogglesTouchButton', { name: p1Name }))}
                  aria-label={t('referee.scoring.gogglesTouchAriaLabel', { name: p1Name, opponent: p2Name })}
                  style={{ minHeight: '44px' }}
                >
                  🥽 {t('referee.scoring.gogglesTouchButton', { name: p1Name })}
                </button>
                <button className="btn bg-red-800 hover:bg-red-700 text-white text-xs py-2 rounded font-bold"
                  disabled={scoringDisabled}
                  onClick={() => onIBSAScore(2, 'mask_touch', 2, true, t('referee.scoring.gogglesTouchButton', { name: p2Name }))}
                  aria-label={t('referee.scoring.gogglesTouchAriaLabel', { name: p2Name, opponent: p1Name })}
                  style={{ minHeight: '44px' }}
                >
                  🥽 {t('referee.scoring.gogglesTouchButton', { name: p2Name })}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Team: Substitution buttons */}
      {matchType === 'team' && ((match.team1Members?.length ?? 0) > 3 || (match.team2Members?.length ?? 0) > 3) && (
        <div className="grid grid-cols-2 gap-2">
          {(match.team1Members?.length ?? 0) > 3 && !match.team1SubUsed && (
            <button className="btn bg-purple-800 hover:bg-purple-700 text-white py-2 text-sm" onClick={() => onOpenSubModal(1)} disabled={scoringDisabled}>
              🔄 {p1Name} {t('common.matchHistory.substitution')}
            </button>
          )}
          {(match.team2Members?.length ?? 0) > 3 && !match.team2SubUsed && (
            <button className="btn bg-purple-800 hover:bg-purple-700 text-white py-2 text-sm" onClick={() => onOpenSubModal(2)} disabled={scoringDisabled}>
              🔄 {p2Name} {t('common.matchHistory.substitution')}
            </button>
          )}
        </div>
      )}

      {/* History */}
      <div>
        <button className="text-sm text-gray-400 underline mb-2" onClick={onToggleHistory} style={{ minHeight: '44px' }}>
          {showHistory ? `▲ ${t('referee.practice.scoring.historyClose')}` : `▼ ${t('referee.practice.scoring.historyToggle', { count: match.scoreHistory.length })}`}
        </button>
        {showHistory && match.scoreHistory.length > 0 && (
          <div className="w-full">
            <ScoreHistoryView history={match.scoreHistory} sets={sets} />
          </div>
        )}
      </div>
    </div>
  );
}
