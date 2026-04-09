import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ScoreHistoryView from '@shared/components/ScoreHistoryView';
import type { ScoreHistoryEntry } from '@shared/types';

interface MatchLike {
  winnerId?: string | null;
  team2Id?: string | null;
  sets?: Array<{ player1Score: number; player2Score: number }>;
  scoreHistory?: ScoreHistoryEntry[];
}

interface Props {
  match: MatchLike;
  team1Name: string;
  team2Name: string;
}

/**
 * 팀전 점수판 — 완료(completed) 상태 뷰
 * 우승팀, 최종 스코어, 상세 경기 기록 표시.
 */
export default function TeamMatchCompletedView({ match, team1Name, team2Name }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const isT2Winner = match.winnerId === match.team2Id;
  const winnerName = isT2Winner ? team2Name : team1Name;
  const loserName = isT2Winner ? team1Name : team2Name;
  const finalSet = match.sets?.[0];
  const winScore = finalSet ? (isT2Winner ? finalSet.player2Score : finalSet.player1Score) : 0;
  const loseScore = finalSet ? (isT2Winner ? finalSet.player1Score : finalSet.player2Score) : 0;
  const history: ScoreHistoryEntry[] = match.scoreHistory ?? [];

  return (
    <div className="min-h-screen flex flex-col p-4">
      <div className="text-center mb-4">
        <h1 className="text-3xl font-bold text-yellow-400">{t('common.matchStatus.completed')}</h1>
        <div className="text-4xl font-bold text-green-400 mt-2" role="status" aria-live="assertive">🏆 {winnerName}!</div>
        {finalSet && (
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
      </div>
      {/* 상세 경기 기록 */}
      {history.length > 0 && (
        <div className="w-full max-w-lg mx-auto flex-1 flex flex-col min-h-0">
          <h3 className="text-lg font-bold text-gray-300 mb-2 text-center">{t('common.matchHistory.titleWithCount', { count: history.length })}</h3>
          <div className="flex-1 min-h-0">
            <ScoreHistoryView history={history} sets={match.sets ?? []} />
          </div>
        </div>
      )}
      <div className="text-center mt-4">
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
      </div>
    </div>
  );
}
