import { useTranslation } from 'react-i18next';

export interface PracticeCoinTossProps {
  p1Name: string;
  p2Name: string;
  matchType: 'individual' | 'team';
  config: { POINTS_TO_WIN: number; SETS_TO_WIN: number };
  coinTossStep: 'toss' | 'choice' | 'court_change' | 'warmup_ask';
  tossWinner: 'player1' | 'player2' | null;
  pendingFirstServe: 'player1' | 'player2' | null;
  onTossWinner: (winner: 'player1' | 'player2') => void;
  onCoinTossStep: (step: 'toss' | 'choice' | 'court_change' | 'warmup_ask') => void;
  onPendingFirstServe: (serve: 'player1' | 'player2') => void;
  onCourtChange: (change: boolean) => void;
  onStartMatch: (firstServe: 'player1' | 'player2', withWarmup: boolean) => void;
  onBack: () => void;
  initAudio: () => void;
}

export default function PracticeCoinToss({
  p1Name,
  p2Name,
  matchType,
  config,
  coinTossStep,
  tossWinner,
  pendingFirstServe,
  onTossWinner,
  onCoinTossStep,
  onPendingFirstServe,
  onCourtChange,
  onStartMatch,
  onBack,
  initAudio,
}: PracticeCoinTossProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 p-4">
      <h1 className="text-3xl font-bold text-center" style={{ color: '#c084fc' }}>{t('referee.practice.home.title')}</h1>
      <div className="flex items-center justify-center gap-8 text-2xl">
        <span className="text-yellow-400 font-bold">{p1Name}</span>
        <span className="text-gray-400">vs</span>
        <span className="text-cyan-400 font-bold">{p2Name}</span>
      </div>
      <p className="text-gray-400 text-center">
        {matchType === 'team' ? t('referee.practice.scoring.rulesDisplayTeam') : t('referee.practice.scoring.rulesDisplay', { points: config.POINTS_TO_WIN, setsToWin: config.SETS_TO_WIN })}
      </p>

      {coinTossStep === 'toss' && (
        <div className="card w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-center">{t('referee.scoring.coinToss')}</h2>
          <div className="flex gap-4">
            <button className="btn btn-primary btn-large flex-1 text-xl py-6" onClick={() => { initAudio(); onTossWinner('player1'); onCoinTossStep('choice'); }}>
              {p1Name}
            </button>
            <button className="btn btn-primary btn-large flex-1 text-xl py-6" onClick={() => { initAudio(); onTossWinner('player2'); onCoinTossStep('choice'); }}>
              {p2Name}
            </button>
          </div>
        </div>
      )}
      {coinTossStep === 'choice' && tossWinner && (
        <div className="card w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-center">
            {tossWinner === 'player1' ? p1Name : p2Name} !
          </h2>
          <p className="text-gray-400 text-center">{t('referee.scoring.serveChoice')} / {t('referee.scoring.receiveChoice')}</p>
          <div className="flex gap-4">
            <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => { onPendingFirstServe(tossWinner); onCoinTossStep('court_change'); }} aria-label={`${tossWinner === 'player1' ? p1Name : p2Name} ${t('referee.scoring.serveChoice')}`}>
              {t('referee.scoring.serveChoice')}
            </button>
            <button className="btn btn-accent btn-large flex-1 text-xl py-6" onClick={() => { onPendingFirstServe(tossWinner === 'player1' ? 'player2' : 'player1'); onCoinTossStep('court_change'); }} aria-label={`${tossWinner === 'player1' ? p1Name : p2Name} ${t('referee.scoring.receiveChoice')}`}>
              {t('referee.scoring.receiveChoice')}
            </button>
          </div>
          <div className="text-center">
            <button className="text-sm text-gray-400 underline" onClick={() => { onCoinTossStep('toss'); onTossWinner(null!); }} aria-label={t('referee.practice.scoring.coinTossBackAriaLabel')} style={{ minHeight: '44px' }}>
              {t('common.back')}
            </button>
          </div>
        </div>
      )}
      {coinTossStep === 'court_change' && tossWinner && (
        <div className="card w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-center">{t('referee.scoring.courtChangeTitle')}</h2>
          <p className="text-gray-400 text-center" aria-live="polite">
            {t('referee.scoring.courtChangeQuestion', { loser: tossWinner === 'player1' ? p2Name : p1Name })}
          </p>
          <div className="flex gap-4" role="group" aria-label={t('referee.scoring.courtChangeAriaLabel')}>
            <button
              className="btn btn-primary btn-large flex-1 text-xl py-6"
              onClick={() => { onCourtChange(true); onCoinTossStep('warmup_ask'); }}
              aria-label={`${tossWinner === 'player1' ? p2Name : p1Name}: ${t('referee.scoring.courtChangeYesButton')}`}
            >
              {t('referee.scoring.courtChangeYesButton')}
            </button>
            <button
              className="btn bg-gray-700 text-white btn-large flex-1 text-xl py-6"
              onClick={() => { onCourtChange(false); onCoinTossStep('warmup_ask'); }}
              aria-label={`${tossWinner === 'player1' ? p2Name : p1Name}: ${t('referee.scoring.courtChangeNoButton')}`}
            >
              {t('referee.scoring.courtChangeNoButton')}
            </button>
          </div>
          <div className="text-center">
            <button className="text-sm text-gray-400 underline" onClick={() => onCoinTossStep('choice')} aria-label={t('common.back')} style={{ minHeight: '44px' }}>
              {t('common.back')}
            </button>
          </div>
        </div>
      )}
      {coinTossStep === 'warmup_ask' && pendingFirstServe && (
        <div className="card w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-center">{t('referee.scoring.warmupStart')}</h2>
          <p className="text-gray-400 text-center">{t('referee.practice.scoring.coinTossWarmupAsk', { duration: matchType === 'team' ? `90${t('common.time.seconds')}` : `60${t('common.time.seconds')}` })}</p>
          <div className="flex gap-4">
            <button className="btn btn-success btn-large flex-1 text-xl py-6" onClick={() => {
              onStartMatch(pendingFirstServe, true);
            }}>
              {t('referee.scoring.warmupStart')}
            </button>
            <button className="btn btn-secondary btn-large flex-1 text-xl py-6" onClick={() => {
              onStartMatch(pendingFirstServe, false);
            }}>
              {t('referee.scoring.matchStartLabel')}
            </button>
          </div>
        </div>
      )}

      <div className="text-center">
        <button className="btn btn-accent" onClick={onBack}>{t('common.back')}</button>
      </div>
    </div>
  );
}
