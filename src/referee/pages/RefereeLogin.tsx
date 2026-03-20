import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@shared/hooks/useAuth';
import { useTournaments, useReferees } from '@shared/hooks/useFirebase';
import type { Tournament, Referee, TournamentStatus } from '@shared/types';

type Step = 'tournament' | 'referee' | 'pin';

const TOURNAMENT_STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: '준비중',
  registration: '접수중',
  in_progress: '진행중',
  paused: '일시중지',
  completed: '완료',
};

const TOURNAMENT_STATUS_COLORS: Record<TournamentStatus, string> = {
  draft: 'bg-gray-600 text-gray-200',
  registration: 'bg-blue-700 text-blue-100',
  in_progress: 'bg-green-700 text-green-100',
  paused: 'bg-yellow-700 text-yellow-100',
  completed: 'bg-gray-600 text-gray-300',
};

export default function RefereeLogin() {
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

  const activeTournaments = tournaments.filter(t => t.status !== 'completed');

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
      setError('4자리 PIN을 입력해주세요.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const success = await loginReferee(selectedReferee.id, pin, selectedTournament.id);
      if (success) {
        navigate('/referee/games');
      } else {
        setError('PIN이 올바르지 않습니다. 다시 시도해주세요.');
        setPin('');
      }
    } catch {
      setError('인증 중 오류가 발생했습니다.');
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
          심판 모드
        </h1>

        {error && (
          <div
            className="bg-red-900 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6 text-center text-lg"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </div>
        )}

        {step === 'tournament' && (
          <div>
            <h2 className="text-2xl font-bold text-center mb-6">대회 선택</h2>
            {tournamentsLoading ? (
              <p className="text-center text-gray-400 text-xl animate-pulse">
                대회 목록 로딩 중...
              </p>
            ) : activeTournaments.length === 0 ? (
              <p className="text-center text-gray-400 text-xl">
                등록된 대회가 없습니다.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {activeTournaments.map(t => (
                  <button
                    key={t.id}
                    className="btn btn-primary btn-large w-full text-left"
                    onClick={() => handleSelectTournament(t)}
                    aria-label={`대회 선택: ${t.name}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-bold">{t.name}</div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TOURNAMENT_STATUS_COLORS[t.status]}`}>
                        {TOURNAMENT_STATUS_LABELS[t.status]}
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
            <h2 className="text-2xl font-bold text-center mb-2">심판 선택</h2>
            <p className="text-center text-gray-400 mb-6">
              {selectedTournament?.name}
            </p>
            {refereesLoading ? (
              <p className="text-center text-gray-400 text-xl animate-pulse">
                심판 목록 로딩 중...
              </p>
            ) : referees.length === 0 ? (
              <p className="text-center text-gray-400 text-xl">
                등록된 심판이 없습니다.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {referees.map(r => (
                  <button
                    key={r.id}
                    className="btn btn-secondary btn-large w-full"
                    onClick={() => handleSelectReferee(r)}
                    aria-label={`심판 선택: ${r.name}`}
                  >
                    {r.name} ({r.role === 'main' ? '주심' : '부심'})
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'pin' && (
          <div>
            <h2 className="text-2xl font-bold text-center mb-2">PIN 입력</h2>
            <p className="text-center text-gray-400 mb-6">
              {selectedReferee?.name} 심판
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
              placeholder="0000"
              autoFocus
              aria-label="4자리 PIN 입력"
            />
            <button
              className="btn btn-primary btn-large w-full"
              onClick={handleSubmitPin}
              disabled={pin.length !== 4 || submitting}
              aria-label="로그인"
            >
              {submitting ? '인증 중...' : '로그인'}
            </button>
          </div>
        )}

        {step === 'tournament' && (
          <button
            className="btn btn-large w-full mt-6"
            style={{ backgroundColor: '#7c3aed', color: '#ffffff', fontSize: '1.5rem', border: '3px solid #a78bfa' }}
            onClick={() => navigate('/referee/practice')}
            aria-label="심판 연습 모드 시작"
          >
            연습 모드 (인증 불필요)
          </button>
        )}

        <button
          className="btn btn-accent btn-large w-full mt-4"
          onClick={handleBack}
          aria-label="뒤로가기"
        >
          {step === 'tournament' ? '모드 선택으로' : '뒤로'}
        </button>
      </div>
    </div>
  );
}
