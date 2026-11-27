import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ScoreHistoryView from '@shared/components/ScoreHistoryView';
import { setWinnerOf, setWinsByRules, type ScoringRuleSet } from '@shared/rules/competitionRules';
import type { ScoreHistoryEntry } from '@shared/types';

interface MatchLike {
  winnerId?: string | null;
  team2Id?: string | null;
  sets?: Array<{ player1Score: number; player2Score: number; decidedBy?: 'time_limit' | 'golden_goal'; decidedWinner?: 1 | 2 }>;
  scoreHistory?: ScoreHistoryEntry[];
  /** 시간 제한·골든골로 끝난 경기 (M0f) */
  decidedBy?: 'time_limit' | 'golden_goal' | null;
}

interface Props {
  match: MatchLike;
  team1Name: string;
  team2Name: string;
  /** 이 경기의 규칙 (resolveMatchScoring) — 여러 세트 경기의 세트 승수 계산용 */
  rules: ScoringRuleSet;
}

/**
 * 팀전 점수판 — 완료(completed) 상태 뷰
 * 우승팀, 최종 스코어(1세트 경기) 또는 세트 승수 + 세트별 점수(여러 세트 경기), 상세 경기 기록 표시.
 */
export default function TeamMatchCompletedView({ match, team1Name, team2Name, rules }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const isT2Winner = match.winnerId === match.team2Id;
  const winnerName = isT2Winner ? team2Name : team1Name;
  const loserName = isT2Winner ? team1Name : team2Name;
  const sets = match.sets ?? [];
  const multiSet = sets.length > 1;
  const onlySet = sets.length === 1 ? sets[0] : undefined;
  const winScore = onlySet ? (isT2Winner ? onlySet.player2Score : onlySet.player1Score) : 0;
  const loseScore = onlySet ? (isT2Winner ? onlySet.player1Score : onlySet.player2Score) : 0;
  const setWins = multiSet ? setWinsByRules(sets, rules) : { player1: 0, player2: 0 };
  const winSets = isT2Winner ? setWins.player2 : setWins.player1;
  const loseSets = isT2Winner ? setWins.player1 : setWins.player2;
  const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];

  return (
    <div className="min-h-screen flex flex-col p-4">
      <div className="text-center mb-4">
        <h1 className="text-3xl font-bold text-yellow-400">{t('common.matchStatus.completed')}</h1>
        <div className="text-4xl font-bold text-green-400 mt-2" role="status" aria-live="assertive">🏆 {winnerName}!</div>
        {onlySet && (
          <div className="mt-2">
            <div className="inline-flex items-center bg-gray-800 rounded-lg px-6 py-3 gap-4" aria-label={`${t('common.matchHistory.score')} ${winnerName} ${winScore} : ${loserName} ${loseScore}`}>
              <span className="text-lg text-gray-300">{winnerName}</span>
              <span className="text-3xl font-bold">
                <span className="text-green-400">{winScore}</span>
                <span className="text-gray-400"> - </span>
                <span className="text-gray-300">{loseScore}</span>
              </span>
              <span className="text-lg text-gray-300">{loserName}</span>
            </div>
          </div>
        )}
        {match.decidedBy && <div className="text-lg text-yellow-300 mt-1">{t(`common.matchClock.decidedBy.${match.decidedBy}`)}</div>}
        {multiSet && (
          <div className="text-2xl text-gray-300 mt-1" aria-label={`${t('common.units.set')} ${winnerName} ${winSets} : ${loserName} ${loseSets}`}>{t('common.units.set')}: {winSets} - {loseSets}</div>
        )}
      </div>
      {/* 여러 세트 경기: 세트별 결과 - 승자 점수가 먼저 */}
      {multiSet && (
        <div className="w-full max-w-lg mx-auto mb-4">
          <div className="grid grid-cols-1 gap-2">
            {sets.map((s, i) => {
              const setWinScore = isT2Winner ? s.player2Score : s.player1Score;
              const setLoseScore = isT2Winner ? s.player1Score : s.player2Score;
              const setWinner = setWinnerOf(s, rules);
              const setWinnerName = setWinner === 2 ? team2Name : setWinner === 1 ? team1Name : null;
              return (
                <div key={i} className="flex justify-between items-center bg-gray-800 rounded px-4 py-2" aria-label={`${t('common.matchHistory.setLabel', { num: i + 1 })}: ${winnerName} ${setWinScore} : ${loserName} ${setLoseScore}`}>
                  <span className="text-sm text-gray-400">{t('common.matchHistory.setLabel', { num: i + 1 })}</span>
                  <span className="text-lg font-bold">
                    <span className="text-green-400">{setWinScore}</span>
                    <span className="text-gray-400"> - </span>
                    <span className="text-gray-300">{setLoseScore}</span>
                  </span>
                  <span className="text-sm text-green-400">{setWinnerName ? `🏆 ${setWinnerName}` : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* 상세 경기 기록 */}
      {history.length > 0 && (
        <div className="w-full max-w-lg mx-auto flex-1 flex flex-col min-h-0">
          <h3 className="text-lg font-bold text-gray-300 mb-2 text-center">{t('common.matchHistory.titleWithCount', { count: history.length })}</h3>
          <div className="flex-1 min-h-0">
            <ScoreHistoryView history={history} sets={sets} />
          </div>
        </div>
      )}
      <div className="text-center mt-4">
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
      </div>
    </div>
  );
}
