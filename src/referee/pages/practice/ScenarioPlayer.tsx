import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PRACTICE_SCENARIOS } from '../../data/scenarios';
import { usePracticeMatch } from '../../hooks/usePracticeMatch';
import { usePracticeHistory } from '../../hooks/usePracticeHistory';
import { checkSetWinner, createEmptySet } from '@shared/utils/scoring';
import type { SetScore } from '@shared/types';

export default function ScenarioPlayer() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const { addSession } = usePracticeHistory();

  const scenario = PRACTICE_SCENARIOS.find(s => s.id === scenarioId);

  const isTeam = scenario?.matchType === 'team';
  const config = isTeam
    ? { SETS_TO_WIN: 1, MAX_SETS: 1, POINTS_TO_WIN: 31, MIN_POINT_DIFF: 2 }
    : { SETS_TO_WIN: 2, MAX_SETS: 3, POINTS_TO_WIN: 11, MIN_POINT_DIFF: 2 };

  const { match, updateMatch, addAction } = usePracticeMatch({
    matchType: scenario?.matchType || 'individual',
    player1Name: isTeam ? '팀1' : '선수1',
    player2Name: isTeam ? '팀2' : '선수2',
    config,
    initialSets: scenario?.initialState?.sets,
    initialCurrentSet: scenario?.initialState?.currentSet,
  });

  const [currentEventIndex, setCurrentEventIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; message: string } | null>(null);
  const [started, setStarted] = useState(false);

  if (!scenario) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-4">
        <p className="text-2xl text-red-400">시나리오를 찾을 수 없습니다.</p>
        <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/practice/scenarios')}>목록으로</button>
      </div>
    );
  }

  const currentEvent = scenario.events[currentEventIndex];
  const expectedAction = scenario.expectedActions[currentEventIndex];
  const isComplete = currentEventIndex >= scenario.events.length;

  const checkAction = useCallback((actionType: string, player: 1 | 2, detail?: string) => {
    if (isComplete || !expectedAction) return;

    const correct = expectedAction.type === actionType && expectedAction.player === player;

    if (correct) {
      setCorrectCount(p => p + 1);
      setFeedback({ correct: true, message: '정답!' });
    } else {
      setWrongCount(p => p + 1);
      setFeedback({ correct: false, message: `오답. 정답: ${expectedAction.type === 'score' ? `선수${expectedAction.player} +1점` : expectedAction.type === 'fault' ? `선수${expectedAction.player} 폴트` : `선수${expectedAction.player} 타임아웃`}` });
    }

    addAction({ type: actionType as any, player, detail });

    // Apply the action to match state
    const sets = [...match.sets.map(s => ({ ...s }))];
    const ci = match.currentSet;
    const cs = { ...sets[ci] };

    if (actionType === 'score') {
      if (player === 1) cs.player1Score += 1;
      else cs.player2Score += 1;
    } else if (actionType === 'fault') {
      if (player === 1) cs.player1Faults += 1;
      else cs.player2Faults += 1;
    }
    sets[ci] = cs;

    const setWinner = checkSetWinner(cs.player1Score, cs.player2Score, config);
    if (setWinner) {
      cs.winnerId = setWinner === 1 ? 'player1' : 'player2';
      sets[ci] = cs;
    }

    updateMatch({ sets });

    setTimeout(() => {
      setFeedback(null);
      const nextIndex = currentEventIndex + 1;
      setCurrentEventIndex(nextIndex);

      if (nextIndex >= scenario.events.length) {
        const total = correctCount + wrongCount + 1;
        const correct2 = correctCount + (correct ? 1 : 0);
        addSession({
          id: crypto.randomUUID(),
          date: Date.now(),
          matchType: scenario.matchType,
          sessionType: 'scenario',
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          duration: Math.floor((Date.now() - match.startedAt) / 1000),
          accuracy: Math.round((correct2 / total) * 100),
          totalActions: total,
          correctActions: correct2,
          finalScore: sets.map(s => `${s.player1Score}-${s.player2Score}`).join(', '),
        });
      }
    }, 1500);
  }, [match, config, expectedAction, currentEventIndex, correctCount, wrongCount, updateMatch, addAction, addSession, scenario, isComplete]);

  if (!started) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 p-4">
        <h1 className="text-3xl font-bold" style={{ color: '#c084fc' }}>{scenario.name}</h1>
        <p className="text-xl text-gray-300 text-center">{scenario.description}</p>
        <p className="text-lg text-gray-400">{scenario.events.length}개 이벤트 | {scenario.matchType === 'individual' ? '개인전' : '팀전'}</p>
        <button className="btn btn-success btn-large text-3xl px-12 py-6" onClick={() => { setStarted(true); updateMatch({ status: 'in_progress' }); }} aria-label="시나리오 시작">
          시작
        </button>
        <button className="btn btn-accent" onClick={() => navigate('/referee/practice/scenarios')}>뒤로</button>
      </div>
    );
  }

  if (isComplete) {
    const total = correctCount + wrongCount;
    const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 p-4">
        <h1 className="text-3xl font-bold" style={{ color: '#c084fc' }}>시나리오 완료!</h1>
        <div className="text-6xl font-bold" style={{ color: accuracy >= 80 ? '#22c55e' : accuracy >= 50 ? '#f59e0b' : '#ef4444' }}>
          {accuracy}%
        </div>
        <p className="text-xl text-gray-300">정답 {correctCount} / 오답 {wrongCount}</p>
        <div className="text-lg text-gray-400">
          최종 점수: {match.sets.map((s: SetScore, i: number) => `세트${i + 1}: ${s.player1Score}-${s.player2Score}`).join(' | ')}
        </div>
        <div className="flex gap-4">
          <button className="btn btn-primary btn-large" onClick={() => navigate('/referee/practice/scenarios')}>시나리오 목록</button>
          <button className="btn btn-secondary btn-large" onClick={() => navigate('/referee/practice')}>연습 홈</button>
        </div>
      </div>
    );
  }

  const cs = match.sets[match.currentSet] ?? createEmptySet();
  const p1Name = isTeam ? '팀1' : '선수1';
  const p2Name = isTeam ? '팀2' : '선수2';

  return (
    <div className="min-h-screen flex flex-col">
      {/* Event display */}
      <div style={{ backgroundColor: '#1e1b4b', borderBottom: '2px solid #7c3aed', padding: '1rem' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">이벤트 {currentEventIndex + 1}/{scenario.events.length}</span>
          <span className="text-sm">
            <span className="text-green-400">정답 {correctCount}</span> / <span className="text-red-400">오답 {wrongCount}</span>
          </span>
        </div>
        <p className="text-xl text-white font-bold text-center">{currentEvent.description}</p>
        <p className="text-sm text-gray-400 text-center mt-1">→ {currentEvent.expectedRefereeAction}</p>
      </div>

      {/* Feedback overlay */}
      {feedback && (
        <div
          style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 200, padding: '2rem 3rem', borderRadius: '1rem',
            backgroundColor: feedback.correct ? '#052e16' : '#450a0a',
            border: `3px solid ${feedback.correct ? '#22c55e' : '#ef4444'}`,
            fontSize: '1.5rem', fontWeight: 'bold',
            color: feedback.correct ? '#22c55e' : '#ef4444',
          }}
          role="alert"
        >
          {feedback.message}
        </div>
      )}

      {/* Scoring area */}
      <div className="flex-1 flex">
        {[{ player: 1 as const, name: p1Name, color: 'text-yellow-400' }, { player: 2 as const, name: p2Name, color: 'text-cyan-400' }].map(({ player, name, color }) => {
          const score = player === 1 ? cs.player1Score : cs.player2Score;
          const faults = player === 1 ? cs.player1Faults : cs.player2Faults;

          return (
            <div key={player} className={`flex-1 flex flex-col items-center justify-center gap-4 p-4 ${player === 1 ? 'border-r border-gray-700' : ''}`}>
              <h2 className={`text-2xl font-bold ${color}`}>{name}</h2>
              <div className={`score-display ${color}`}>{score}</div>
              <button className="btn btn-success btn-large w-full text-4xl" style={{ minHeight: '80px' }}
                onClick={() => checkAction('score', player, '+1')} aria-label={`${name} 득점`}>+1</button>
              <div className="flex gap-2 w-full">
                <button className="btn btn-accent flex-1 text-sm" onClick={() => checkAction('fault', player)}
                  aria-label={`${name} 폴트`}>폴트 ({faults})</button>
                <button className="btn btn-accent flex-1 text-sm" onClick={() => checkAction('violation', player)}
                  aria-label={`${name} 반칙`}>반칙</button>
              </div>
              <button className="btn btn-secondary w-full text-sm" onClick={() => checkAction('timeout', player)}
                aria-label={`${name} 타임아웃`}>타임아웃</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
