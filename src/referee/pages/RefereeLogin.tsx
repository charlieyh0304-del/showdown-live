import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@shared/hooks/useAuth';
import { useTournaments, useReferees } from '@shared/hooks/useFirebase';
import { createRateLimiter } from '@shared/utils/crypto';
import type { Tournament, Referee, TournamentStatus } from '@shared/types';

type Step = 'tournament' | 'referee' | 'pin';

const TOURNAMENT_STATUS_COLORS: Record<TournamentStatus, string> = {
  draft: 'bg-gray-600 text-gray-200',
  registration: 'bg-blue-700 text-blue-100',
  in_progress: 'bg-green-700 text-green-100',
  paused: 'bg-yellow-700 text-yellow-100',
  completed: 'bg-gray-600 text-gray-300',
};

const TOURNAMENT_STATUS_ICONS: Record<TournamentStatus, string> = {
  draft: '\u270E',
  registration: '\u{1F4CB}',
  in_progress: '\u25B6',
  paused: '\u23F8',
  completed: '\u2713',
};

export default function RefereeLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loginReferee } = useAuth();
  const { tournaments, loading: tournamentsLoading } = useTournaments();
  const { referees, loading: refereesLoading } = useReferees();

  const [step, setStep] = useState<Step>('tournament');
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [selectedReferee, setSelectedReferee] = useState<Referee | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  // 레이트 리미터 (5회 실패 시 30초 잠금)
  const rateLimiter = useMemo(() => createRateLimiter(5, 30000), []);

  // 잠금 타이머 업데이트
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = rateLimiter.remainingLockout();
      setLockoutSeconds(Math.ceil(remaining / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [rateLimiter]);

  const isLocked = lockoutSeconds > 0;

  const activeTournaments = tournaments.filter(t => t.status !== 'completed');

  const TOURNAMENT_STATUS_LABELS: Record<TournamentStatus, string> = {
    draft: t('referee.login.tournamentStatusLabels.draft'),
    registration: t('referee.login.tournamentStatusLabels.registration'),
    in_progress: t('referee.login.tournamentStatusLabels.inProgress'),
    paused: t('referee.login.tournamentStatusLabels.paused'),
    completed: t('referee.login.tournamentStatusLabels.completed'),
  };

  const handleSelectTournament = (tournament: Tournament) => {
    setSelectedTournament(tournament);
    setStep('referee');
    setError('');
  };

  const handleSelectReferee = (referee: Referee) => {
    setSelectedReferee(referee);
    setStep('pin');
    setError('');
    setPin('');
  };

  const handleSubmitPin = async () => {
    if (!selectedReferee || !selectedTournament) return;
    if (pin.length !== 4) {
      setError(t('referee.login.pinLength4'));
      return;
    }
    if (!rateLimiter.canAttempt()) {
      setError(t('referee.login.tooManyAttempts', { seconds: Math.ceil(rateLimiter.remainingLockout() / 1000) }));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const success = await loginReferee(selectedReferee.id, pin, selectedTournament.id);
      if (success) {
        rateLimiter.recordSuccess();
        navigate('/referee/games');
      } else {
        rateLimiter.recordFailure();
        const remaining = rateLimiter.remainingLockout();
        if (remaining > 0) {
          setError(t('referee.login.lockedMessage', { seconds: Math.ceil(remaining / 1000) }));
        } else {
          setError(t('referee.login.incorrectPin'));
        }
        setPin('');
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'NETWORK_TIMEOUT') {
        setError(t('common.error.networkError'));
      } else {
        setError(t('common.error.authFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    setError('');
    if (step === 'pin') {
      setStep('referee');
      setSelectedReferee(null);
      setPin('');
    } else if (step === 'referee') {
      setStep('tournament');
      setSelectedTournament(null);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4" style={{ paddingTop: '2rem' }}>
      <div className="w-full max-w-lg">
        <h1 className="text-3xl font-bold text-yellow-400 text-center mb-8">
          {t('referee.login.title')}
        </h1>

        {error && (
          <div
            id="referee-pin-error"
            className="bg-red-900 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6 text-center text-lg"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </div>
        )}

        {step === 'tournament' && (
          <div>
            <h2 className="text-2xl font-bold text-center mb-6">{t('referee.login.selectTournament')}</h2>
            {tournamentsLoading ? (
              <p className="text-center text-gray-400 text-xl animate-pulse">
                {t('referee.login.loadingTournaments')}
              </p>
            ) : activeTournaments.length === 0 ? (
              <p className="text-center text-gray-400 text-xl">
                {t('referee.login.noTournaments')}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {activeTournaments.map(t => (
                  <button
                    key={t.id}
                    className="btn btn-primary btn-large w-full text-left"
                    onClick={() => handleSelectTournament(t)}
                    aria-label={`${TOURNAMENT_STATUS_LABELS[t.status]}: ${t.name}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-bold">{t.name}</div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TOURNAMENT_STATUS_COLORS[t.status]}`}>
                        {TOURNAMENT_STATUS_ICONS[t.status]} {TOURNAMENT_STATUS_LABELS[t.status]}
                      </span>
                    </div>
                    <div className="text-sm opacity-80">{t.date}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'referee' && (
          <div>
            <h2 className="text-2xl font-bold text-center mb-2">{t('referee.login.selectReferee')}</h2>
            <p className="text-center text-gray-400 mb-6">
              {selectedTournament?.name}
            </p>
            {refereesLoading ? (
              <p className="text-center text-gray-400 text-xl animate-pulse">
                {t('referee.login.loadingReferees')}
              </p>
            ) : referees.length === 0 ? (
              <p className="text-center text-gray-400 text-xl">
                {t('referee.login.noReferees')}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {referees.map(r => (
                  <button
                    key={r.id}
                    className="btn btn-secondary btn-large w-full"
                    onClick={() => handleSelectReferee(r)}
                    aria-label={`${r.name} (${r.role === 'main' ? t('common.refereeRole.main') : t('common.refereeRole.assistant')})`}
                  >
                    {r.name} ({r.role === 'main' ? t('common.refereeRole.main') : t('common.refereeRole.assistant')})
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'pin' && (
          <div>
            <h2 className="text-2xl font-bold text-center mb-2">{t('referee.login.enterPin')}</h2>
            <p className="text-center text-gray-400 mb-6">
              {t('referee.login.refereePinLabel', { name: selectedReferee?.name })}
            </p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSubmitPin();
              }}
              className="input text-center text-4xl tracking-widest mb-6"
              placeholder={t('referee.login.pinPlaceholder')}
              autoFocus
              aria-label={t('referee.login.pinAriaLabel')}
              aria-required="true"
              aria-invalid={!!error}
              aria-describedby={error ? 'referee-pin-error' : undefined}
              disabled={isLocked}
            />
            {isLocked && (
              <p className="text-orange-400 font-semibold text-center mb-4" role="alert">
                {t('referee.login.retryAfter', { seconds: lockoutSeconds })}
              </p>
            )}
            <button
              className="btn btn-primary btn-large w-full"
              onClick={handleSubmitPin}
              disabled={pin.length !== 4 || submitting || isLocked}
              aria-label={t('referee.login.loginAriaLabel')}
            >
              {submitting ? t('referee.login.authenticating') : isLocked ? t('referee.login.locked') : t('referee.login.loginButton')}
            </button>
          </div>
        )}

        {step === 'tournament' && (
          <button
            className="btn btn-large w-full mt-6"
            style={{ backgroundColor: '#7c3aed', color: '#ffffff', fontSize: '1.5rem', border: '3px solid #a78bfa' }}
            onClick={() => navigate('/referee/practice')}
            aria-label={t('referee.login.practiceAriaLabel')}
          >
            {t('referee.login.practiceMode')}
          </button>
        )}

        <button
          className="btn btn-accent btn-large w-full mt-4"
          onClick={handleBack}
          aria-label={t('common.back')}
        >
          {step === 'tournament' ? t('referee.login.backToModeSelect') : t('common.back')}
        </button>
      </div>
    </div>
  );
}
