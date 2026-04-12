import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { showError } from '@shared/utils/toast';

type CoinTossStep = 'team_order' | 'toss' | 'choice' | 'court_change' | 'warmup_ask';
type TossWinner = 'team1' | 'team2' | null;
type PendingChoice = 'serve' | 'receive' | null;
type Order = { ids: string[]; names: string[] };
type SetOrder = (o: Order) => void;

interface MatchLike {
  team1?: { coachName?: string };
  team2?: { coachName?: string };
  courtName?: string;
}

interface Props {
  match: MatchLike;
  team1Name: string;
  team2Name: string;
  coinTossStep: CoinTossStep;
  setCoinTossStep: (s: CoinTossStep) => void;
  tossWinner: TossWinner;
  setTossWinner: (w: TossWinner) => void;
  pendingChoice: PendingChoice;
  setPendingChoice: (c: PendingChoice) => void;
  team1Order: Order;
  setTeam1Order: SetOrder;
  team2Order: Order;
  setTeam2Order: SetOrder;
  setCourtChangeByLoser: (b: boolean) => void;
  initAudio: () => void;
  handleStartMatch: (winner: 'team1' | 'team2', choice: 'serve' | 'receive') => Promise<void>;
  handleWalkover: (winnerSide: 1 | 2) => void | Promise<void>;
  updateMatch: (patch: Record<string, unknown>) => Promise<unknown>;
  warmupTimer: { start: (seconds: number) => void };
  setShowWarmup: (b: boolean) => void;
}

/**
 * 팀전 점수판 — 대기(pending) 상태 뷰
 * 라인업 → 코인토스 → 서브/리시브 선택 → 코트 변경 → 워밍업/시작
 */
export default function TeamMatchPendingView({
  match,
  team1Name,
  team2Name,
  coinTossStep,
  setCoinTossStep,
  tossWinner,
  setTossWinner,
  pendingChoice,
  setPendingChoice,
  team1Order,
  setTeam1Order,
  team2Order,
  setTeam2Order,
  setCourtChangeByLoser,
  initAudio,
  handleStartMatch,
  handleWalkover,
  updateMatch,
  warmupTimer,
  setShowWarmup,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-4">
      <h1 className="text-3xl font-bold text-yellow-400">{t('referee.home.teamMatch')} {t('referee.scoring.matchStartLabel')}</h1>
      <div className="flex items-center gap-8 text-2xl">
        <div className="text-center">
          <span className="text-yellow-400 font-bold">{team1Name}</span>
          {match.team1?.coachName && <div className="text-sm text-gray-400">{match.team1.coachName}</div>}
        </div>
        <span className="text-gray-400">vs</span>
        <div className="text-center">
          <span className="text-cyan-400 font-bold">{team2Name}</span>
          {match.team2?.coachName && <div className="text-sm text-gray-400">{match.team2.coachName}</div>}
        </div>
      </div>
      <p className="text-lg text-gray-400 text-center">{t('referee.practice.setup.teamRuleSummary')}</p>
      {match.courtName && <p className="text-gray-400 text-center">{t('referee.home.court')}: {match.courtName}</p>}

      {coinTossStep === 'team_order' && (() => {
        const swapOrder = (setter: SetOrder, order: Order, i: number, dir: -1 | 1) => {
          const j = i + dir;
          if (j < 0 || j >= order.ids.length) return;
          const newIds = [...order.ids];
          const newNames = [...order.names];
          [newIds[i], newIds[j]] = [newIds[j], newIds[i]];
          [newNames[i], newNames[j]] = [newNames[j], newNames[i]];
          setter({ ids: newIds, names: newNames });
        };
        const renderOrder = (label: string, order: Order, setter: SetOrder, color: string) => (
          <div>
            <h3 className={`text-sm font-bold ${color} mb-2`}>{label}</h3>
            <div className="space-y-1">
              {order.names.map((name, i) => (
                <div key={order.ids[i] ?? i} className="flex items-center gap-2 bg-gray-700 rounded px-3 py-2">
                  <span className="text-gray-400 text-sm w-6">{i + 1}</span>
                  <span className="flex-1 text-white">{name}</span>
                  <button className="text-gray-400 hover:text-white px-1" disabled={i === 0} onClick={() => swapOrder(setter, order, i, -1)} style={{ minHeight: '44px', minWidth: '44px' }} aria-label={`${name} ${t('admin.tournamentDetail.bracketTab.orderUpAriaLabel')}`}>▲</button>
                  <button className="text-gray-400 hover:text-white px-1" disabled={i === order.names.length - 1} onClick={() => swapOrder(setter, order, i, 1)} style={{ minHeight: '44px', minWidth: '44px' }} aria-label={`${name} ${t('admin.tournamentDetail.bracketTab.orderDownAriaLabel')}`}>▼</button>
                </div>
              ))}
            </div>
          </div>
        );
        return (
          <div className="card w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold text-center">{t('referee.scoring.teamOrderTitle')}</h2>
            <p className="text-sm text-gray-400 text-center">{t('referee.practice.setup.memberInfo', { reserve: '' })}</p>
            {renderOrder(team1Name, team1Order, setTeam1Order, 'text-yellow-400')}
            {renderOrder(team2Name, team2Order, setTeam2Order, 'text-cyan-400')}
            <button
              className="btn btn-primary btn-large w-full"
              onClick={() => setCoinTossStep('toss')}
              aria-label={t('referee.scoring.teamOrderConfirm')}
            >
              {t('referee.scoring.teamOrderConfirm')}
            </button>
          </div>
        );
      })()}
      {coinTossStep === 'toss' && (
        <div className="card w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-center">{t('referee.scoring.coinToss')}</h2>
          <div className="flex gap-4">
            <button className="btn btn-primary btn-large flex-1" onClick={() => { initAudio(); setTossWinner('team1'); setCoinTossStep('choice'); }} aria-label={`${team1Name} ${t('referee.scoring.coinToss')}`}>
              {team1Name}
            </button>
            <button className="btn btn-primary btn-large flex-1" onClick={() => { initAudio(); setTossWinner('team2'); setCoinTossStep('choice'); }} aria-label={`${team2Name} ${t('referee.scoring.coinToss')}`}>
              {team2Name}
            </button>
          </div>
          <div className="text-center">
            <button className="text-sm text-gray-400 underline" onClick={() => setCoinTossStep('team_order')} style={{ minHeight: '44px' }}>
              {t('common.back')}
            </button>
          </div>
        </div>
      )}
      {coinTossStep === 'choice' && tossWinner && (
        <div className="card w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-center">
            {tossWinner === 'team1' ? team1Name : team2Name}!
          </h2>
          <p className="text-gray-400 text-center">{t('referee.scoring.serveChoice')} / {t('referee.scoring.receiveChoice')}</p>
          <div className="flex gap-4">
            <button className="btn btn-success btn-large flex-1" onClick={() => { setPendingChoice('serve'); setCoinTossStep('court_change'); }} aria-label={`${tossWinner === 'team1' ? team1Name : team2Name} ${t('referee.scoring.serveChoice')}`}>
              {t('referee.scoring.serveChoice')}
            </button>
            <button className="btn btn-accent btn-large flex-1" onClick={() => { setPendingChoice('receive'); setCoinTossStep('court_change'); }} aria-label={`${tossWinner === 'team1' ? team1Name : team2Name} ${t('referee.scoring.receiveChoice')}`}>
              {t('referee.scoring.receiveChoice')}
            </button>
          </div>
          <div className="text-center">
            <button className="text-sm text-gray-400 underline" onClick={() => { setCoinTossStep('toss'); setTossWinner(null); }} aria-label={t('common.back')} style={{ minHeight: '44px' }}>
              {t('common.back')}
            </button>
          </div>
        </div>
      )}
      {coinTossStep === 'court_change' && tossWinner && (
        <div className="card w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-center">{t('referee.scoring.courtChangeTitle')}</h2>
          <p className="text-gray-400 text-center" aria-live="polite">
            {t('referee.scoring.courtChangeQuestion', { loser: tossWinner === 'team1' ? team2Name : team1Name })}
          </p>
          <div className="flex gap-4" role="group" aria-label={t('referee.scoring.courtChangeAriaLabel')}>
            <button
              className="btn btn-primary btn-large flex-1 text-xl py-6"
              onClick={() => { setCourtChangeByLoser(true); setCoinTossStep('warmup_ask'); }}
              aria-label={`${tossWinner === 'team1' ? team2Name : team1Name}: ${t('referee.scoring.courtChangeYesButton')}`}
            >
              {t('referee.scoring.courtChangeYesButton')}
            </button>
            <button
              className="btn bg-gray-700 text-white btn-large flex-1 text-xl py-6"
              onClick={() => { setCourtChangeByLoser(false); setCoinTossStep('warmup_ask'); }}
              aria-label={`${tossWinner === 'team1' ? team2Name : team1Name}: ${t('referee.scoring.courtChangeNoButton')}`}
            >
              {t('referee.scoring.courtChangeNoButton')}
            </button>
          </div>
          <div className="text-center">
            <button className="text-sm text-gray-400 underline" onClick={() => setCoinTossStep('choice')} aria-label={t('common.back')} style={{ minHeight: '44px' }}>
              {t('common.back')}
            </button>
          </div>
        </div>
      )}
      {coinTossStep === 'warmup_ask' && tossWinner && pendingChoice && (
        <div className="card w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-center">{t('referee.scoring.warmupStart')}</h2>
          <p className="text-gray-400 text-center">{t('referee.scoring.warmupStart')} (90{t('common.time.seconds')})?</p>
          <div className="flex gap-4">
            <button
              className="btn btn-success btn-large flex-1 text-xl py-6"
              onClick={async () => {
                try {
                  await handleStartMatch(tossWinner!, pendingChoice!);
                } catch (err) {
                  showError(String(err));
                  return;
                }
                await updateMatch({ warmupUsed: true });
                warmupTimer.start(90);
                setShowWarmup(true);
              }}
              aria-label={t('referee.scoring.warmupStart')}
            >
              {t('referee.scoring.warmupStart')}
            </button>
            <button
              className="btn btn-accent btn-large flex-1 text-xl py-6"
              onClick={async () => {
                try {
                  await handleStartMatch(tossWinner!, pendingChoice!);
                } catch (err) {
                  showError(String(err));
                }
              }}
              aria-label={t('referee.scoring.matchStartLabel')}
            >
              {t('referee.scoring.matchStartLabel')}
            </button>
          </div>
        </div>
      )}
      <div className="card w-full max-w-md space-y-4">
        <div className="border-t border-gray-700 pt-3">
          <h3 className="text-sm font-bold text-gray-400 mb-2 text-center">{t('common.scoreActions.walkover')}</h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
              onClick={() => handleWalkover(1)}
            >
              {team1Name} {t('common.scoreActions.walkover')}
            </button>
            <button
              className="btn bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm py-2"
              onClick={() => handleWalkover(2)}
            >
              {team2Name} {t('common.scoreActions.walkover')}
            </button>
          </div>
        </div>
      </div>

      <div className="text-center">
        <button className="btn btn-accent" onClick={() => navigate('/referee/games')}>{t('referee.home.title')}</button>
      </div>
    </div>
  );
}
