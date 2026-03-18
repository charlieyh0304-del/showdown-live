import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PRACTICE_SCENARIOS } from '../../data/scenarios';
import type { ScenarioCategory } from '@shared/types';

const CATEGORIES: { value: ScenarioCategory | 'all'; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'deuce', label: '듀스' },
  { value: 'close_game', label: '접전' },
  { value: 'fault_heavy', label: '폴트' },
  { value: 'timeout', label: '타임아웃' },
  { value: 'violation', label: '반칙' },
];

const DIFFICULTY_COLORS = {
  beginner: '#22c55e',
  intermediate: '#f59e0b',
  advanced: '#ef4444',
};

const DIFFICULTY_LABELS = {
  beginner: '초급',
  intermediate: '중급',
  advanced: '고급',
};

export default function ScenarioList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ScenarioCategory | 'all'>('all');

  const filtered = filter === 'all'
    ? PRACTICE_SCENARIOS
    : PRACTICE_SCENARIOS.filter(s => s.category === filter);

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-center" style={{ color: '#c084fc' }}>시나리오 훈련</h1>

      <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="카테고리 필터">
        {CATEGORIES.map(cat => (
          <button
            key={cat.value}
            role="radio"
            aria-checked={filter === cat.value}
            className={`btn text-sm ${filter === cat.value ? 'btn-primary' : 'bg-gray-700 text-white'}`}
            onClick={() => setFilter(cat.value)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        {filtered.map(scenario => (
          <button
            key={scenario.id}
            className="card hover:bg-gray-800 transition-colors text-left p-6"
            onClick={() => navigate(`/referee/practice/scenario/${scenario.id}`)}
            aria-label={`시나리오: ${scenario.name}`}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-bold text-white">{scenario.name}</h2>
              <div className="flex gap-2">
                <span
                  style={{
                    backgroundColor: DIFFICULTY_COLORS[scenario.difficulty],
                    color: '#000',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                  }}
                >
                  {DIFFICULTY_LABELS[scenario.difficulty]}
                </span>
                <span className="text-sm text-gray-400">
                  {scenario.matchType === 'individual' ? '개인전' : '팀전'}
                </span>
              </div>
            </div>
            <p className="text-gray-400">{scenario.description}</p>
            <p className="text-sm text-gray-500 mt-2">{scenario.events.length}개 이벤트</p>
          </button>
        ))}
      </div>

      <button className="btn btn-accent btn-large w-full" onClick={() => navigate('/referee/practice')} aria-label="뒤로">
        뒤로
      </button>
    </div>
  );
}
