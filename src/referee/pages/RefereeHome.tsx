import { useMemo } from 'react';
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

  const myMatches = matches.filter(m => m.refereeId === refereeId);

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
      <h1 className="text-2xl font-bold text-yellow-400 mb-6">내 배정 경기</h1>

      {myMatches.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-xl text-gray-400">배정된 경기가 없습니다</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {stageGroups.map(group => (
            <div key={group.label} className="mb-6">
              <h2 className={`text-xl font-bold ${group.color} mb-3 border-b border-gray-700 pb-2`}>
                {group.label} ({group.matches.length}경기)
              </h2>
              {STATUS_ORDER.map(status => {
                const statusMatches = group.matches.filter(m => m.status === status);
                if (statusMatches.length === 0) return null;
                return (
                  <div key={status} className="mb-3">
                    <h3 className="text-sm font-semibold text-gray-500 mb-1">
                      {STATUS_LABELS[status]} ({statusMatches.length})
                    </h3>
                    <div className="flex flex-col gap-3">
                      {statusMatches.map(match => {
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
                              {match.scheduledTime && <span>{match.scheduledTime}</span>}
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
