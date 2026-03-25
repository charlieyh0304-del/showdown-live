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

const STATUS_ORDER: MatchStatus[] = ['in_progress', 'pending', 'completed'];

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
  const refereeId = session?.refereeId;
  const { matches, loading } = useMatches(tournamentId);

  const [viewMode, setViewMode] = useState<'my' | 'all'>('my');

  const myMatches = useMemo(() => matches.filter(m => m.refereeId === refereeId), [matches, refereeId]);

  // All scheduled matches (have date or time assigned)
  const allScheduledMatches = useMemo(() =>
    matches.filter(m => m.scheduledDate || m.scheduledTime).sort((a, b) => {
      const dateA = a.scheduledDate || '';
      const dateB = b.scheduledDate || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const timeA = a.scheduledTime || '';
      const timeB = b.scheduledTime || '';
      return timeA.localeCompare(timeB);
    }),
  [matches]);

  // Sort matches by date -> time
  const sortedMyMatches = useMemo(() => {
    return [...myMatches].sort((a, b) => {
      const dateA = a.scheduledDate || '';
      const dateB = b.scheduledDate || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const timeA = a.scheduledTime || '';
      const timeB = b.scheduledTime || '';
      return timeA.localeCompare(timeB);
    });
  }, [myMatches]);

  // Group by date
  const dateGroups = useMemo(() => {
    const dates = [...new Set(sortedMyMatches.map(m => m.scheduledDate || ''))].sort();
    return dates;
  }, [sortedMyMatches]);

  const hasMultipleDates = dateGroups.length > 1 || (dateGroups.length === 1 && dateGroups[0] !== '');

  const stageGroups = useMemo(() => {
    const qualifying = myMatches.filter(m => m.groupId || m.stageId?.includes('qualifying'));
    const finals = myMatches.filter(m => !m.groupId && (m.stageId?.includes('finals') || m.roundLabel) && !m.stageId?.includes('ranking') && !m.roundLabel?.includes('결정전'));
    const ranking = myMatches.filter(m => m.stageId?.includes('ranking') || m.roundLabel?.includes('결정전'));
    const classified = new Set([...qualifying, ...finals, ...ranking].map(m => m.id));
    const other = myMatches.filter(m => !classified.has(m.id));

    return [
      { label: '예선', matches: qualifying, color: 'text-blue-400' },
      { label: '본선', matches: finals, color: 'text-yellow-400' },
      { label: '순위결정전', matches: ranking, color: 'text-purple-400' },
      ...(other.length > 0 ? [{ label: '기타', matches: other, color: 'text-gray-400' }] : []),
    ].filter(g => g.matches.length > 0);
  }, [myMatches]);

  // Group allScheduledMatches by date (must be before early returns to satisfy hooks rules)
  const allScheduleDateGroups = useMemo(() => {
    const dates = [...new Set(allScheduledMatches.map(m => m.scheduledDate || ''))].sort();
    return dates;
  }, [allScheduledMatches]);

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

  const renderMatchCard = (match: Match, showReferee = false) => {
    const score = getCurrentScore(match);
    return (
      <button
        key={match.id}
        className="card w-full text-left hover:border-yellow-400 transition-colors cursor-pointer"
        onClick={() => handleMatchClick(match)}
        aria-label={`${getMatchLabel(match)} - ${STATUS_LABELS[match.status]}`}
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
          {showReferee && match.refereeName && <span>심판: {match.refereeName}</span>}
        </div>
        {score && (
          <div className="mt-2 text-2xl font-bold text-cyan-400" aria-live="polite">
            {score}
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-yellow-400 mb-4">경기 목록</h1>

      {/* Tab buttons */}
      <div className="flex gap-2 mb-6" role="tablist" aria-label="경기 보기 모드">
        <button
          role="tab"
          aria-selected={viewMode === 'my'}
          className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${viewMode === 'my' ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          onClick={() => setViewMode('my')}
        >
          내 배정 경기 ({myMatches.length})
        </button>
        <button
          role="tab"
          aria-selected={viewMode === 'all'}
          className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${viewMode === 'all' ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          onClick={() => setViewMode('all')}
        >
          전체 스케줄 ({allScheduledMatches.length})
        </button>
      </div>

      {/* All scheduled matches view */}
      {viewMode === 'all' ? (
        allScheduledMatches.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-xl text-gray-400">스케줄이 배정된 경기가 없습니다</p>
            <p className="text-sm text-gray-400 mt-2">관리자가 스케줄 탭에서 자동 배정을 실행해주세요.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {allScheduleDateGroups.map(date => {
              const dateMatches = allScheduledMatches.filter(m => (m.scheduledDate || '') === date);
              return (
                <div key={date || 'no-date'} className="mb-4">
                  <h2 className="text-xl font-bold text-yellow-400 mb-3 border-b border-gray-700 pb-2">
                    {date || '날짜 미지정'} ({dateMatches.length}경기)
                  </h2>
                  <div className="flex flex-col gap-3">
                    {dateMatches.map(match => renderMatchCard(match, true))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : myMatches.length === 0 ? (
        <div className="card text-center py-12">
          <div className="space-y-3">
            <p className="text-xl text-gray-400">배정된 경기가 없습니다</p>
            <p className="text-sm text-gray-400">
              관리자가 대진표에서 경기별로 심판을 배정해야 이 화면에 표시됩니다.
            </p>
            <p className="text-sm text-gray-400">
              관리자에게 심판 배정을 요청해주세요.
            </p>
          </div>
        </div>
      ) : hasMultipleDates ? (
        /* Multi-day view: group by date */
        <div className="flex flex-col gap-6">
          {dateGroups.map(date => {
            const dateMatches = sortedMyMatches.filter(m => (m.scheduledDate || '') === date);
            return (
              <div key={date || 'no-date'} className="mb-4">
                <h2 className="text-xl font-bold text-yellow-400 mb-3 border-b border-gray-700 pb-2">
                  {date || '날짜 미지정'} ({dateMatches.length}경기)
                </h2>
                <div className="flex flex-col gap-3">
                  {dateMatches.map(match => renderMatchCard(match))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Single-day or legacy view: group by stage */
        <div className="flex flex-col gap-6">
          {stageGroups.map(group => (
            <div key={group.label} className="mb-6">
              <h2 className={`text-xl font-bold ${group.color} mb-3 border-b border-gray-700 pb-2`}>
                {group.label} ({group.matches.length}경기)
              </h2>
              {STATUS_ORDER.map(status => {
                const statusMatches = group.matches
                  .filter(m => m.status === status)
                  .sort((a, b) => {
                    const timeA = a.scheduledTime || '';
                    const timeB = b.scheduledTime || '';
                    return timeA.localeCompare(timeB);
                  });
                if (statusMatches.length === 0) return null;
                return (
                  <div key={status} className="mb-3">
                    <h3 className="text-sm font-semibold text-gray-400 mb-1">
                      {STATUS_LABELS[status]} ({statusMatches.length})
                    </h3>
                    <div className="flex flex-col gap-3">
                      {statusMatches.map(match => renderMatchCard(match))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
