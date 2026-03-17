import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTournaments } from '@shared/hooks/useFirebase';
import type { TournamentType, GameConfig, TeamMatchSettings } from '@shared/types';

const TYPE_OPTIONS: { value: TournamentType; label: string }[] = [
  { value: 'individual', label: '개인전' },
  { value: 'team', label: '팀전' },
  { value: 'randomTeamLeague', label: '랜덤 팀리그전' },
];

const WIN_SCORE_OPTIONS = [11, 21, 31] as const;
const SETS_TO_WIN_OPTIONS = [1, 2, 3] as const;

export default function TournamentCreate() {
  const navigate = useNavigate();
  const { addTournament } = useTournaments();

  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [type, setType] = useState<TournamentType>('individual');
  const [winScore, setWinScore] = useState<11 | 21 | 31>(11);
  const [setsToWin, setSetsToWin] = useState<number>(2);
  const [teamWinScore, setTeamWinScore] = useState<11 | 21 | 31>(11);
  const [teamSetsToWin, setTeamSetsToWin] = useState<1 | 2 | 3>(2);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('대회명을 입력해주세요.');
      return;
    }

    setSaving(true);
    try {
      const gameConfig: GameConfig = { winScore, setsToWin };
      const isTeamType = type === 'team' || type === 'randomTeamLeague';
      const teamMatchSettings: TeamMatchSettings | undefined = isTeamType
        ? { winScore: teamWinScore, setsToWin: teamSetsToWin, minLead: 2 }
        : undefined;

      const id = await addTournament({
        name: name.trim(),
        date,
        type,
        format: 'full_league',
        status: 'draft',
        gameConfig,
        ...(teamMatchSettings ? { teamMatchSettings } : {}),
      });

      if (id) {
        navigate(`/admin/tournament/${id}`);
      }
    } catch {
      setError('대회 생성 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }, [name, date, type, winScore, setsToWin, teamWinScore, teamSetsToWin, addTournament, navigate]);

  const isTeamType = type === 'team' || type === 'randomTeamLeague';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-yellow-400">새 대회 만들기</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card space-y-4">
          <div>
            <label htmlFor="tournament-name" className="block mb-2 font-semibold text-lg">대회명</label>
            <input
              id="tournament-name"
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="대회명을 입력하세요"
              aria-label="대회명"
            />
          </div>

          <div>
            <label htmlFor="tournament-date" className="block mb-2 font-semibold text-lg">날짜</label>
            <input
              id="tournament-date"
              type="date"
              className="input"
              value={date}
              onChange={e => setDate(e.target.value)}
              aria-label="대회 날짜"
            />
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="text-xl font-bold">유형 선택</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {TYPE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`btn text-lg py-4 ${type === opt.value ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                onClick={() => setType(opt.value)}
                aria-pressed={type === opt.value}
                aria-label={`유형: ${opt.label}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="text-xl font-bold">진행 방식</h2>
          <button
            type="button"
            className="btn btn-primary w-full py-4"
            aria-pressed="true"
            aria-label="풀리그 (라운드로빈)"
          >
            풀리그 (라운드로빈)
          </button>
        </div>

        <div className="card space-y-4">
          <h2 className="text-xl font-bold">게임 설정 (개인전)</h2>

          <div>
            <p className="mb-2 font-semibold">승점</p>
            <div className="flex gap-3">
              {WIN_SCORE_OPTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  className={`btn flex-1 ${winScore === s ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                  onClick={() => setWinScore(s)}
                  aria-pressed={winScore === s}
                  aria-label={`승점 ${s}점`}
                >
                  {s}점
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 font-semibold">세트 선승</p>
            <div className="flex gap-3">
              {SETS_TO_WIN_OPTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  className={`btn flex-1 ${setsToWin === s ? 'btn-secondary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                  onClick={() => setSetsToWin(s)}
                  aria-pressed={setsToWin === s}
                  aria-label={`${s}세트 선승`}
                >
                  {s}세트
                </button>
              ))}
            </div>
          </div>
        </div>

        {isTeamType && (
          <div className="card space-y-4">
            <h2 className="text-xl font-bold">팀전 경기 설정</h2>

            <div>
              <p className="mb-2 font-semibold">승점</p>
              <div className="flex gap-3">
                {WIN_SCORE_OPTIONS.map(s => (
                  <button
                    key={s}
                    type="button"
                    className={`btn flex-1 ${teamWinScore === s ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                    onClick={() => setTeamWinScore(s)}
                    aria-pressed={teamWinScore === s}
                    aria-label={`팀전 승점 ${s}점`}
                  >
                    {s}점
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 font-semibold">세트 선승</p>
              <div className="flex gap-3">
                {SETS_TO_WIN_OPTIONS.map(s => (
                  <button
                    key={s}
                    type="button"
                    className={`btn flex-1 ${teamSetsToWin === s ? 'btn-secondary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                    onClick={() => setTeamSetsToWin(s)}
                    aria-pressed={teamSetsToWin === s}
                    aria-label={`팀전 ${s}세트 선승`}
                  >
                    {s}세트
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-red-500 font-semibold" role="alert">{error}</p>}

        <div className="flex gap-4">
          <button
            type="submit"
            className="btn btn-primary flex-1"
            disabled={saving}
            aria-label="대회 생성"
          >
            {saving ? '생성 중...' : '대회 생성'}
          </button>
          <button
            type="button"
            className="btn btn-secondary flex-1"
            onClick={() => navigate('/admin')}
            aria-label="취소"
          >
            취소
          </button>
        </div>
      </form>
    </div>
  );
}
