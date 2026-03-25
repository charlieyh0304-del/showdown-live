import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@shared/hooks/useAuth';
import { useMatches } from '@shared/hooks/useFirebase';
import type { Match, MatchStatus } from '@shared/types';

const STATUS_LABELS: Record<MatchStatus, string> = {
  in_progress: '진행중',
  pending: '대기',
  completed: '완료',
};

const STATUS_COLORS: Record<MatchStatus, string> = {
  in_progress: 'bg-green-700 text-green-100',
  pending: 'bg-yellow-700 text-yellow-100',
  completed: 'bg-gray-600 text-gray-200',
};

function getMatchLabel(match: Match): string {
  if (match.type === 'team') {
    return `${match.team1Name ?? '팀1'} vs ${match.team2Name ?? '팀2'}`;
  }
  return `${match.player1Name ?? '선수1'} vs ${match.player2Name ?? '선수2'}`;
}

function getCurrentScore(match: Match): string | null {
  if (match.status !== 'in_progress' || !match.sets || match.currentSet === undefined) return null;
  const currentSetData = match.sets[match.currentSet];
  if (!currentSetData) return null;
  return `${currentSetData.player1Score} - ${currentSetData.player2Score}`;
}

export default function RefereeHome() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const tournamentId = session?.tournamentId ?? null;
  const { matches, loading } = useMatches(tournamentId);

  const [viewMode, setViewMode] = useState<'active' | 'completed'>('active');

  // Active matches: pending or in_progress (sorted by date/time)
  const activeMatches = useMemo(() =>
    matches.filter(m => m.status === 'pending' || m.status === 'in_progress').sort((a, b) => {
      // in_progress first, then pending
      if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
      const dateA = a.scheduledDate || '';
      const dateB = b.scheduledDate || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return (a.scheduledTime || '').localeCompare(b.scheduledTime || '');
    }),
  [matches]);

  // Completed matches (newest first)
  const completedMatches = useMemo(() =>
    matches.filter(m => m.status === 'completed').sort((a, b) => {
      const dateA = a.scheduledDate || '';
      const dateB = b.scheduledDate || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return (b.scheduledTime || '').localeCompare(a.scheduledTime || '');
    }),
  [matches]);

  const currentList = viewMode === 'active' ? activeMatches : completedMatches;

  const handleMatchClick = (match: Match) => {
    if (match.type === 'team') {
      navigate(`/referee/team/${tournamentId}/${match.id}`);
    } else {
      navigate(`/referee/match/${tournamentId}/${match.id}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-2xl text-gray-400 animate-pulse">경기 목록 로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-yellow-400 mb-4">경기 목록</h1>

      {/* Tab buttons */}
      <div className="flex gap-2 mb-6" role="tablist" aria-label="경기 보기 모드">
        <button
          role="tab"
          aria-selected={viewMode === 'active'}
          className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${viewMode === 'active' ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          onClick={() => setViewMode('active')}
        >
          진행/대기 ({activeMatches.length})
        </button>
        <button
          role="tab"
          aria-selected={viewMode === 'completed'}
          className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${viewMode === 'completed' ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          onClick={() => setViewMode('completed')}
        >
          완료 ({completedMatches.length})
        </button>
      </div>

      {currentList.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-xl text-gray-400">
            {viewMode === 'active' ? '진행할 경기가 없습니다' : '완료된 경기가 없습니다'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {currentList.map(match => {
            const score = getCurrentScore(match);
            return (
              <button
                key={match.id}
                className="card w-full text-left hover:border-yellow-400 transition-colors cursor-pointer"
                onClick={() => handleMatchClick(match)}
                aria-label={`${getMatchLabel(match)}, ${STATUS_LABELS[match.status]}${match.courtName ? `, 코트 ${match.courtName}` : ''}${match.scheduledTime ? `, ${match.scheduledTime}` : ''}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {match.type === 'team' && (
                      <span className="px-2 py-0.5 rounded bg-purple-700 text-purple-100 text-xs font-bold">팀전</span>
                    )}
                    <span className="text-lg font-bold">{getMatchLabel(match)}</span>
                    {match.roundLabel && <span className="text-xs bg-gray-700 px-2 py-0.5 rounded">{match.roundLabel}</span>}
                    {match.groupId && <span className="text-xs bg-blue-900 px-2 py-0.5 rounded">{match.groupId}조</span>}
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[match.status]}`}>
                    {STATUS_LABELS[match.status]}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-gray-400 text-sm">
                  {match.courtName && <span>코트: {match.courtName}</span>}
                  {match.scheduledDate && <span>{match.scheduledDate}</span>}
                  {match.scheduledTime && <span>{match.scheduledTime}</span>}
                  {match.refereeName && <span>심판: {match.refereeName}</span>}
                </div>
                {score && (
                  <div className="mt-2 text-2xl font-bold text-cyan-400" aria-live="polite">
                    {score}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
