import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTournaments } from '@shared/hooks/useFirebase';
import type { TournamentType, GameConfig, TeamMatchSettings } from '@shared/types';

const TYPE_OPTIONS: { value: TournamentType; label: string; rules: string }[] = [
  { value: 'individual', label: '개인전', rules: '11점 | 2세트 선승 (최대 3세트) | 2점차' },
  { value: 'team', label: '팀전', rules: '31점 | 1세트 | 팀 3명 로테이션 | 2점차' },
  { value: 'randomTeamLeague', label: '랜덤 팀리그전', rules: '31점 | 1세트 | 팀 3명 | 풀리그 | 2점차' },
];

export default function TournamentCreate() {
  const navigate = useNavigate();
  const { addTournament } = useTournaments();

  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [type, setType] = useState<TournamentType>('individual');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedTypeOption = TYPE_OPTIONS.find(t => t.value === type)!;

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('대회명을 입력해주세요.');
      return;
    }

    setSaving(true);
    try {
      const isTeamType = type === 'team' || type === 'randomTeamLeague';

      const gameConfig: GameConfig = isTeamType
        ? { winScore: 31, setsToWin: 1 }
        : { winScore: 11, setsToWin: 2 };

      const teamMatchSettings: TeamMatchSettings | undefined = isTeamType
        ? { winScore: 31, setsToWin: 1, minLead: 2 }
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
  }, [name, date, type, addTournament, navigate]);

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

        <div className="card space-y-2">
          <h2 className="text-xl font-bold">경기 규칙</h2>
          <p className="text-lg text-cyan-400 font-semibold">{selectedTypeOption.rules}</p>
        </div>

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
