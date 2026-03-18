import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MatchType } from '@shared/types';

export default function PracticeSetup() {
  const navigate = useNavigate();
  const [matchType, setMatchType] = useState<MatchType>('individual');
  const [player1Name, setPlayer1Name] = useState('연습선수A');
  const [player2Name, setPlayer2Name] = useState('연습선수B');
  const [setsToWin, setSetsToWin] = useState(2);

  const handleStart = () => {
    const config = matchType === 'team'
      ? { SETS_TO_WIN: 1, MAX_SETS: 1, POINTS_TO_WIN: 31, MIN_POINT_DIFF: 2 }
      : { SETS_TO_WIN: setsToWin, MAX_SETS: setsToWin * 2 - 1, POINTS_TO_WIN: 11, MIN_POINT_DIFF: 2 };

    const params = new URLSearchParams({
      type: matchType,
      p1: player1Name,
      p2: player2Name,
      config: JSON.stringify(config),
    });

    navigate(`/referee/practice/play?${params.toString()}`);
  };

  return (
    <div className="p-4 max-w-lg mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-center" style={{ color: '#c084fc' }}>연습 경기 설정</h1>

      <div className="card space-y-4">
        <h2 className="text-xl font-bold">경기 유형</h2>
        <div className="flex gap-3">
          <button
            className={`btn flex-1 text-lg py-4 ${matchType === 'individual' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
            onClick={() => { setMatchType('individual'); setSetsToWin(2); }}
            aria-pressed={matchType === 'individual'}
          >
            개인전
          </button>
          <button
            className={`btn flex-1 text-lg py-4 ${matchType === 'team' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
            onClick={() => setMatchType('team')}
            aria-pressed={matchType === 'team'}
          >
            팀전
          </button>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="text-xl font-bold">선수/팀 이름</h2>
        <input
          className="input"
          value={player1Name}
          onChange={e => setPlayer1Name(e.target.value)}
          placeholder="선수/팀 1 이름"
          aria-label="선수 1 이름"
        />
        <input
          className="input"
          value={player2Name}
          onChange={e => setPlayer2Name(e.target.value)}
          placeholder="선수/팀 2 이름"
          aria-label="선수 2 이름"
        />
      </div>

      {matchType === 'individual' && (
        <div className="card space-y-4">
          <h2 className="text-xl font-bold">경기 규칙</h2>
          <div className="flex items-center gap-2">
            <span className="text-gray-300">승리 점수:</span>
            <span className="text-white font-bold">11점</span>
            <span className="text-gray-500 text-sm">(IBSA 공식 규칙)</span>
          </div>
          <div>
            <label className="block mb-2 text-gray-300">세트 수 (선승)</label>
            <div className="flex gap-2">
              {[1, 2, 3].map(v => (
                <button
                  key={v}
                  className={`btn flex-1 ${setsToWin === v ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                  onClick={() => setSetsToWin(v)}
                  aria-pressed={setsToWin === v}
                >
                  {v}세트
                </button>
              ))}
            </div>
          </div>
          <p className="text-cyan-400 font-semibold">
            11점 | {setsToWin}세트 선승 | 최대 {setsToWin * 2 - 1}세트 | 2점차
          </p>
        </div>
      )}

      {matchType === 'team' && (
        <div className="card">
          <p className="text-cyan-400 font-semibold">31점 | 1세트 단판 | 2점차</p>
        </div>
      )}

      <div className="flex gap-4">
        <button className="btn btn-success btn-large flex-1" onClick={handleStart} aria-label="연습 시작">
          연습 시작
        </button>
        <button className="btn btn-accent flex-1" onClick={() => navigate('/referee/practice')} aria-label="뒤로">
          뒤로
        </button>
      </div>
    </div>
  );
}
