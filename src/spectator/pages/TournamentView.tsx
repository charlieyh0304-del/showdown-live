import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTournament, useMatches, useFavorites, useSchedule } from '@shared/hooks/useFirebase';
import { countSetWins } from '@shared/utils/scoring';
import { calculateIndividualRanking, calculateTeamRanking } from '@shared/utils/ranking';
import { requestNotificationPermission } from '@shared/utils/notifications';
import { useMatchNotifications } from '../hooks/useMatchNotifications';
import type { Match, PlayerRanking, TeamRanking } from '@shared/types';

type TabId = 'live' | 'bracket' | 'groups' | 'ranking' | 'players' | 'history';

const TAB_LABELS: Record<TabId, string> = {
  live: '실시간',
  bracket: '대진표',
  groups: '조 목록',
  ranking: '순위',
  players: '선수',
  history: '히스토리',
};

function getTournamentTypeLabel(type: string): string {
  switch (type) {
    case 'individual': return '개인전';
    case 'team': return '팀전';
    case 'randomTeamLeague': return '랜덤팀리그전';
    default: return type;
  }
}

export default function TournamentView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tournament, loading: tLoading } = useTournament(id || null);
  const { matches, loading: mLoading } = useMatches(id || null);
  const { favoriteIds, isFavorite, toggleFavorite } = useFavorites();
  const { schedule } = useSchedule(id || null);

  useMatchNotifications(favoriteIds, matches, schedule);

  const handleToggleFavorite = useCallback((playerId: string) => {
    const newFavs = toggleFavorite(playerId);
    if (newFavs.includes(playerId)) {
      requestNotificationPermission();
    }
  }, [toggleFavorite]);

  const [activeTab, setActiveTab] = useState<TabId>('live');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<'all' | 'qualifying' | 'finals' | 'ranking'>('all');
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  const stageMap = useMemo(() => {
    const qualifying = matches.filter(m => m.groupId || m.stageId?.includes('qualifying'));
    const finals = matches.filter(m =>
      !m.groupId && (m.stageId?.includes('finals') || m.roundLabel) &&
      !m.stageId?.includes('ranking') && !m.roundLabel?.includes('결정전')
    );
    const ranking = matches.filter(m =>
      m.stageId?.includes('ranking') ||
      m.roundLabel?.includes('결정전')
    );
    const other = matches.filter(m =>
      !m.groupId && !m.stageId && !m.roundLabel
    );
    return { qualifying, finals, ranking, other };
  }, [matches]);

  const hasGroupStage = useMemo(() => {
    if (tournament?.formatType === 'group_knockout') return true;
    if (tournament?.qualifyingConfig) return true;
    if (tournament?.stages?.some(s => s.type === 'qualifying' || s.format === 'group_knockout' || s.format === 'round_robin')) return true;
    return matches.some(m => m.groupId);
  }, [tournament, matches]);

  const filteredMatches = useMemo(() => {
    if (stageFilter === 'all') return matches;
    if (stageFilter === 'qualifying') return stageMap.qualifying;
    if (stageFilter === 'finals') return stageMap.finals;
    return stageMap.ranking;
  }, [stageFilter, matches, stageMap]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.trim().toLowerCase();
    return matches.filter(m =>
      m.player1Name?.toLowerCase().includes(q) ||
      m.player2Name?.toLowerCase().includes(q) ||
      m.team1Name?.toLowerCase().includes(q) ||
      m.team2Name?.toLowerCase().includes(q)
    );
  }, [searchQuery, matches]);

  const playerMatches = useMemo(() => {
    if (!selectedPlayer) return [];
    return matches.filter(m =>
      m.player1Name === selectedPlayer || m.player2Name === selectedPlayer ||
      m.team1Name === selectedPlayer || m.team2Name === selectedPlayer
    );
  }, [selectedPlayer, matches]);

  const playerStats = useMemo(() => {
    if (!playerMatches.length || !selectedPlayer) return null;
    let wins = 0, losses = 0;
    let setsWon = 0, setsLost = 0;
    let pointsFor = 0, pointsAgainst = 0;

    playerMatches.filter(m => m.status === 'completed').forEach(m => {
      const isP1 = m.player1Name === selectedPlayer || m.team1Name === selectedPlayer;
      const winnerId = isP1 ? (m.player1Id || m.team1Id) : (m.player2Id || m.team2Id);

      if (m.winnerId === winnerId) wins++;
      else losses++;

      (m.sets || []).forEach(s => {
        const myScore = isP1 ? s.player1Score : s.player2Score;
        const oppScore = isP1 ? s.player2Score : s.player1Score;
        pointsFor += myScore;
        pointsAgainst += oppScore;
        if (myScore > oppScore) setsWon++;
        else if (oppScore > myScore) setsLost++;
      });
    });

    return {
      total: playerMatches.length,
      wins, losses,
      setsWon, setsLost,
      pointsFor, pointsAgainst,
    };
  }, [playerMatches, selectedPlayer]);

  const loading = tLoading || mLoading;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.5rem' }}>데이터 로딩 중...</p>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.5rem', color: '#ef4444' }}>대회를 찾을 수 없습니다</p>
        <button className="btn btn-primary" onClick={() => navigate('/spectator')} style={{ marginTop: '1rem' }}>
          목록으로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Tournament header */}
      <div style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>
          {tournament.name}
        </h2>
        <p style={{ color: '#d1d5db' }}>
          {tournament.date} · {getTournamentTypeLabel(tournament.type)}
        </p>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '1rem' }}>
        <input
          className="input"
          style={{ width: '100%' }}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="선수 또는 팀 이름 검색"
          aria-label="선수 검색"
        />
      </div>

      {searchResults && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#facc15', marginBottom: '0.5rem' }}>
            검색 결과: {searchResults.length}건
          </h3>
          {searchResults.map(match => {
            const isIndividual = match.type === 'individual';
            const label = isIndividual
              ? `${match.player1Name || '선수1'} vs ${match.player2Name || '선수2'}`
              : `${match.team1Name || '팀1'} vs ${match.team2Name || '팀2'}`;
            return (
              <button
                key={match.id}
                className="card"
                onClick={() => navigate(`/spectator/match/${id}/${match.id}`)}
                style={{ marginBottom: '0.5rem', padding: '0.75rem', width: '100%', textAlign: 'left', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 'bold' }}>{label}</span>
                  <span style={{ color: match.status === 'completed' ? '#22c55e' : match.status === 'in_progress' ? '#ef4444' : '#9ca3af', fontWeight: 'bold', fontSize: '0.875rem' }}>
                    {match.status === 'completed' ? '완료 →' : match.status === 'in_progress' ? '진행중 →' : '대기'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Player record panel */}
      {selectedPlayer && (
        <div className="card" style={{ marginBottom: '1.5rem', border: '2px solid #facc15' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#facc15' }}>{selectedPlayer} 경기 기록</h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-primary"
                style={{ fontSize: '0.875rem', padding: '0.25rem 0.75rem' }}
                onClick={() => navigate(`/spectator/player/${id}/${encodeURIComponent(selectedPlayer)}`)}
              >
                프로필
              </button>
              <button className="btn" style={{ fontSize: '0.875rem', padding: '0.25rem 0.75rem' }} onClick={() => setSelectedPlayer(null)}>닫기</button>
            </div>
          </div>
          {playerStats && (() => {
            const completedCount = playerStats.wins + playerStats.losses;
            const winRate = completedCount > 0 ? Math.round((playerStats.wins / completedCount) * 100) : 0;
            const avgPoints = completedCount > 0 ? (playerStats.pointsFor / completedCount).toFixed(1) : '0';
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', textAlign: 'center', marginBottom: '1rem' }}>
                <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{playerStats.total}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>총 경기</p></div>
                <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#22c55e' }}>{playerStats.wins}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>승</p></div>
                <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ef4444' }}>{playerStats.losses}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>패</p></div>
                <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: winRate >= 50 ? '#22c55e' : '#ef4444' }}>{winRate}%</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>승률</p></div>
                <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#22d3ee' }}>{playerStats.setsWon}-{playerStats.setsLost}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>세트 득실</p></div>
                <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#facc15' }}>{playerStats.pointsFor}-{playerStats.pointsAgainst}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>포인트 득실</p></div>
                <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{playerStats.pointsFor}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>총 득점</p></div>
                <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#a78bfa' }}>{avgPoints}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>경기당 득점</p></div>
              </div>
            );
          })()}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '20rem', overflowY: 'auto' }}>
            {/* 예선 경기 */}
            {playerMatches.filter(m => m.groupId).length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#60a5fa', marginBottom: '0.25rem', marginTop: '0.25rem' }}>예선</h4>
                {playerMatches.filter(m => m.groupId).map(m => (
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} selectedPlayer={selectedPlayer!} expandedMatchId={expandedMatchId} onToggleExpand={setExpandedMatchId} />
                ))}
              </div>
            )}
            {/* 본선 경기 */}
            {playerMatches.filter(m => !m.groupId && m.stageId?.includes('finals')).length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#4ade80', marginBottom: '0.25rem', marginTop: '0.25rem' }}>본선</h4>
                {playerMatches.filter(m => !m.groupId && m.stageId?.includes('finals')).map(m => (
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} selectedPlayer={selectedPlayer!} expandedMatchId={expandedMatchId} onToggleExpand={setExpandedMatchId} />
                ))}
              </div>
            )}
            {/* 순위결정전 */}
            {playerMatches.filter(m => m.stageId?.includes('ranking')).length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#c084fc', marginBottom: '0.25rem', marginTop: '0.25rem' }}>순위결정전</h4>
                {playerMatches.filter(m => m.stageId?.includes('ranking')).map(m => (
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} selectedPlayer={selectedPlayer!} expandedMatchId={expandedMatchId} onToggleExpand={setExpandedMatchId} />
                ))}
              </div>
            )}
            {/* 기타 (분류되지 않은 경기) */}
            {playerMatches.filter(m => !m.groupId && !m.stageId?.includes('finals') && !m.stageId?.includes('ranking')).length > 0 && (
              <div>
                {(playerMatches.some(m => m.groupId) || playerMatches.some(m => m.stageId?.includes('finals'))) && (
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#9ca3af', marginBottom: '0.25rem', marginTop: '0.25rem' }}>기타</h4>
                )}
                {playerMatches.filter(m => !m.groupId && !m.stageId?.includes('finals') && !m.stageId?.includes('ranking')).map(m => (
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} selectedPlayer={selectedPlayer!} expandedMatchId={expandedMatchId} onToggleExpand={setExpandedMatchId} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stage filter */}
      {(stageMap.qualifying.length > 0 || stageMap.finals.length > 0 || stageMap.ranking.length > 0) && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', overflowX: 'auto' }}>
          {([
            { key: 'all' as const, label: '전체', count: matches.length },
            { key: 'qualifying' as const, label: '예선', count: stageMap.qualifying.length },
            { key: 'finals' as const, label: '본선', count: stageMap.finals.length },
            { key: 'ranking' as const, label: '순위결정전', count: stageMap.ranking.length },
          ] as const).filter(s => s.count > 0 || s.key === 'all').map(s => (
            <button
              key={s.key}
              className={`btn ${stageFilter === s.key ? 'btn-primary' : ''}`}
              style={{
                padding: '0.5rem 1rem',
                whiteSpace: 'nowrap',
                backgroundColor: stageFilter === s.key ? undefined : '#374151',
              }}
              onClick={() => setStageFilter(s.key)}
            >
              {s.label} ({s.count})
            </button>
          ))}
        </div>
      )}

      {/* Tab navigation */}
      <div
        role="tablist"
        aria-label="대회 관람 탭"
        style={{
          display: 'flex',
          gap: '0.25rem',
          marginBottom: '1rem',
          backgroundColor: '#1f2937',
          borderRadius: '0.5rem',
          padding: '0.25rem',
        }}
      >
        {(Object.keys(TAB_LABELS) as TabId[]).filter((tab) => {
          if (tab === 'groups') {
            return hasGroupStage;
          }
          return true;
        }).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`panel-${tab}`}
            className={activeTab === tab ? 'btn btn-primary' : 'btn'}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '0.5rem',
              fontSize: '1rem',
              color: activeTab === tab ? '#000' : '#d1d5db',
              backgroundColor: activeTab === tab ? undefined : 'transparent',
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div role="tabpanel" id={`panel-${activeTab}`} aria-label={TAB_LABELS[activeTab]}>
        {activeTab === 'live' && (
          <LiveTab matches={filteredMatches} isFavorite={isFavorite} toggleFavorite={handleToggleFavorite} navigate={navigate} tournamentId={id!} />
        )}
        {activeTab === 'bracket' && (
          <BracketTab matches={filteredMatches} tournamentType={tournament.type} onSelectPlayer={setSelectedPlayer} />
        )}
        {activeTab === 'groups' && (
          <GroupsTab matches={matches} onSelectPlayer={setSelectedPlayer} />
        )}
        {activeTab === 'ranking' && (
          <RankingTab matches={filteredMatches} tournamentType={tournament.type} isFavorite={isFavorite} onSelectPlayer={setSelectedPlayer} stageFilter={stageFilter} />
        )}
        {activeTab === 'players' && (
          <PlayersTab matches={matches} onSelectPlayer={setSelectedPlayer} />
        )}
        {activeTab === 'history' && (
          <HistoryTab matches={filteredMatches} navigate={navigate} tournamentId={id!} />
        )}
      </div>
    </div>
  );
}

// ===== Live Tab =====
function LiveTab({
  matches,
  isFavorite,
  toggleFavorite,
  navigate,
  tournamentId,
}: {
  matches: Match[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  navigate: ReturnType<typeof useNavigate>;
  tournamentId: string;
}) {
  const liveMatches = matches.filter((m) => m.status === 'in_progress');
  const prevScoresRef = useRef<Map<string, string>>(new Map());
  const [announcement, setAnnouncement] = useState('');

  // Detect score changes for aria-live announcements
  useEffect(() => {
    for (const match of liveMatches) {
      if (match.type === 'individual' && match.sets && match.currentSet !== undefined) {
        const currentSetData = match.sets[match.currentSet - 1];
        if (!currentSetData) continue;
        const key = match.id;
        const scoreStr = `${currentSetData.player1Score}-${currentSetData.player2Score}-${match.currentSet}`;
        const prev = prevScoresRef.current.get(key);
        if (prev && prev !== scoreStr) {
          setAnnouncement(
            `${match.player1Name || '선수1'} ${currentSetData.player1Score}점, ${match.player2Name || '선수2'} ${currentSetData.player2Score}점, 제${match.currentSet}세트`
          );
        }
        prevScoresRef.current.set(key, scoreStr);
      } else if (match.type === 'team' && match.sets && match.sets.length > 0) {
        const setData = match.sets[0];
        const key = match.id;
        const scoreStr = `${setData.player1Score}-${setData.player2Score}`;
        const prev = prevScoresRef.current.get(key);
        if (prev && prev !== scoreStr) {
          setAnnouncement(
            `${match.team1Name || '팀1'} ${setData.player1Score}점, ${match.team2Name || '팀2'} ${setData.player2Score}점`
          );
        }
        prevScoresRef.current.set(key, scoreStr);
      }
    }
  }, [liveMatches]);

  if (liveMatches.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>현재 진행 중인 경기가 없습니다</p>
      </div>
    );
  }

  return (
    <div>
      {/* Screen reader score announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {liveMatches.map((match) => (
          <li key={match.id}>
            <button
              className="card"
              onClick={() => navigate(`/spectator/match/${tournamentId}/${match.id}`)}
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: '2px solid #374151' }}
              aria-label={
                match.type === 'individual'
                  ? `${match.player1Name} 대 ${match.player2Name}, 진행중`
                  : `${match.team1Name} 대 ${match.team2Name}, 진행중`
              }
            >
              {/* Status indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <span
                  className="animate-pulse"
                  style={{
                    display: 'inline-block',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    backgroundColor: '#ef4444',
                  }}
                  aria-hidden="true"
                />
                <span style={{ color: '#ef4444', fontWeight: 'bold' }}>진행중</span>
                {match.courtName && (
                  <span style={{ color: '#9ca3af', marginLeft: 'auto' }}>{match.courtName}</span>
                )}
              </div>

              {match.type === 'individual' ? (
                <IndividualMatchCard
                  match={match}
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                />
              ) : (
                <TeamMatchCard match={match} />
              )}

              {match.refereeName && (
                <p style={{ color: '#6b7280', marginTop: '0.5rem', fontSize: '0.875rem' }}>
                  심판: {match.refereeName}
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IndividualMatchCard({
  match,
  isFavorite,
  toggleFavorite,
}: {
  match: Match;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
}) {
  const currentSetData = match.sets && match.currentSet
    ? match.sets[match.currentSet - 1]
    : null;
  const setWins = match.sets ? countSetWins(match.sets) : { player1: 0, player2: 0 };

  return (
    <div>
      {/* Player names and scores */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {/* Player 1 */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{match.player1Name || '선수1'}</span>
            {match.player1Id && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(match.player1Id!); }}
                aria-label={isFavorite(match.player1Id) ? `${match.player1Name} 즐겨찾기 해제` : `${match.player1Name} 즐겨찾기 추가`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: 'var(--color-primary)', padding: '0.25rem' }}
              >
                {isFavorite(match.player1Id) ? '★' : '☆'}
              </button>
            )}
          </div>
        </div>

        {/* Score */}
        <div style={{ textAlign: 'center', minWidth: '120px' }}>
          <div style={{ fontSize: '3rem', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: 'var(--color-primary)' }}>{currentSetData?.player1Score ?? 0}</span>
            <span style={{ color: '#6b7280', margin: '0 0.25rem' }}>-</span>
            <span style={{ color: 'var(--color-secondary)' }}>{currentSetData?.player2Score ?? 0}</span>
          </div>
          <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
            세트 {setWins.player1} - {setWins.player2}
            {match.currentSet && ` (제${match.currentSet}세트)`}
          </div>
        </div>

        {/* Player 2 */}
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
            {match.player2Id && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(match.player2Id!); }}
                aria-label={isFavorite(match.player2Id) ? `${match.player2Name} 즐겨찾기 해제` : `${match.player2Name} 즐겨찾기 추가`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: 'var(--color-primary)', padding: '0.25rem' }}
              >
                {isFavorite(match.player2Id) ? '★' : '☆'}
              </button>
            )}
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{match.player2Name || '선수2'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamMatchCard({ match }: { match: Match }) {
  const setData = match.sets && match.sets.length > 0 ? match.sets[0] : null;
  const team1Score = setData?.player1Score ?? 0;
  const team2Score = setData?.player2Score ?? 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{match.team1Name || '팀1'}</span>
        <div style={{ textAlign: 'center' }}>
          <div className="score-display" style={{ fontSize: '3rem', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: 'var(--color-primary)' }}>{team1Score}</span>
            <span style={{ color: '#6b7280', margin: '0 0.25rem' }}>-</span>
            <span style={{ color: 'var(--color-secondary)' }}>{team2Score}</span>
          </div>
          <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
            31점 경기
          </div>
        </div>
        <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{match.team2Name || '팀2'}</span>
      </div>
    </div>
  );
}

// ===== Bracket Tab =====
function BracketTab({ matches, tournamentType, onSelectPlayer }: { matches: Match[]; tournamentType: string; onSelectPlayer: (name: string) => void }) {
  const isTeam = tournamentType === 'team' || tournamentType === 'randomTeamLeague';
  const hasGroups = matches.some(m => m.groupId);
  const hasFinalsMatches = matches.some(m =>
    !m.groupId && (m.stageId?.includes('finals') || m.roundLabel) &&
    !m.stageId?.includes('ranking') && !m.roundLabel?.includes('결정전')
  );
  const hasRankingMatches = matches.some(m =>
    m.stageId?.includes('ranking') || m.roundLabel?.includes('결정전')
  );

  if (matches.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>대진표 정보가 없습니다</p>
      </div>
    );
  }

  // If filtered to only finals matches (no groups), show FinalsView
  if (hasFinalsMatches && !hasGroups) {
    return <FinalsView matches={matches.filter(m =>
      !m.groupId && (m.stageId?.includes('finals') || m.roundLabel) &&
      !m.stageId?.includes('ranking') && !m.roundLabel?.includes('결정전')
    )} onSelectPlayer={onSelectPlayer} />;
  }

  // If filtered to ranking matches, show them
  if (hasRankingMatches && !hasGroups && !hasFinalsMatches) {
    return <RankingMatchesView matches={matches.filter(m =>
      m.stageId?.includes('ranking') || m.roundLabel?.includes('결정전')
    )} onSelectPlayer={onSelectPlayer} />;
  }

  // Mixed view: show groups first, then finals, then ranking
  if (hasGroups) {
    const groupMatches = matches.filter(m => m.groupId);
    const finalsMatches = matches.filter(m =>
      !m.groupId && (m.stageId?.includes('finals') || m.roundLabel) &&
      !m.stageId?.includes('ranking') && !m.roundLabel?.includes('결정전')
    );
    const rankingMatches = matches.filter(m =>
      m.stageId?.includes('ranking') || m.roundLabel?.includes('결정전')
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <GroupStageView matches={groupMatches} onSelectPlayer={onSelectPlayer} />
        {finalsMatches.length > 0 && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#4ade80', marginBottom: '1rem', borderBottom: '2px solid rgba(74, 222, 128, 0.3)', paddingBottom: '0.5rem' }}>
              본선
            </h2>
            <FinalsView matches={finalsMatches} onSelectPlayer={onSelectPlayer} />
          </div>
        )}
        {rankingMatches.length > 0 && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#c084fc', marginBottom: '1rem', borderBottom: '2px solid rgba(192, 132, 252, 0.3)', paddingBottom: '0.5rem' }}>
              순위결정전
            </h2>
            <RankingMatchesView matches={rankingMatches} onSelectPlayer={onSelectPlayer} />
          </div>
        )}
      </div>
    );
  }

  if (isTeam) {
    return <TeamBracket matches={matches} onSelectPlayer={onSelectPlayer} />;
  }

  return <IndividualBracket matches={matches} onSelectPlayer={onSelectPlayer} />;
}

// ===== Finals View =====
function FinalsView({ matches, onSelectPlayer }: { matches: Match[]; onSelectPlayer: (name: string) => void }) {
  const rounds = useMemo(() => {
    const roundOrder = ['32강', '16강', '8강', '4강', '결승'];
    const map = new Map<string, Match[]>();
    matches.forEach(m => {
      const label = m.roundLabel || `라운드 ${m.round || '?'}`;
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(m);
    });
    return Array.from(map.entries()).sort(([a], [b]) =>
      roundOrder.indexOf(a) - roundOrder.indexOf(b)
    );
  }, [matches]);

  if (matches.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>본선 경기가 없습니다</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {rounds.map(([roundLabel, roundMatches]) => (
        <div key={roundLabel}>
          <h3 style={{
            fontSize: '1.25rem',
            fontWeight: 'bold',
            color: '#facc15',
            marginBottom: '0.75rem',
            borderBottom: '1px solid rgba(250, 204, 21, 0.3)',
            paddingBottom: '0.5rem',
          }}>
            {roundLabel}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {roundMatches.map(m => (
              <MatchResultCard key={m.id} match={m} onSelectPlayer={onSelectPlayer} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchResultCard({ match, onSelectPlayer }: { match: Match; onSelectPlayer?: (name: string) => void }) {
  const p1 = match.player1Name || match.team1Name || '?';
  const p2 = match.player2Name || match.team2Name || '?';
  const isP1Winner = match.winnerId === (match.player1Id || match.team1Id);
  const isCompleted = match.status === 'completed';
  const sets = match.sets || [];

  const nameButton = (name: string, isWinner: boolean, align: 'left' | 'right') => {
    const style: React.CSSProperties = {
      fontSize: '1.125rem',
      fontWeight: 'bold',
      color: isCompleted ? (isWinner ? '#22c55e' : '#9ca3af') : '#d1d5db',
    };
    if (onSelectPlayer) {
      return (
        <button
          onClick={() => onSelectPlayer(name)}
          style={{ ...style, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: align }}
          className="hover:underline hover:text-yellow-400"
        >
          {isCompleted && isWinner && align === 'left' ? '🏆 ' : ''}{name}{isCompleted && isWinner && align === 'right' ? ' 🏆' : ''}
        </button>
      );
    }
    return <span style={style}>{isCompleted && isWinner && align === 'left' ? '🏆 ' : ''}{name}{isCompleted && isWinner && align === 'right' ? ' 🏆' : ''}</span>;
  };

  return (
    <div style={{
      backgroundColor: '#1f2937',
      borderRadius: '0.5rem',
      padding: '1rem',
      border: isCompleted ? '1px solid #374151' : '1px solid #374151',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ flex: 1 }}>
          {nameButton(p1, isP1Winner, 'left')}
        </div>
        <div style={{ textAlign: 'center', padding: '0 1rem' }}>
          {isCompleted && sets.length > 0 ? (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {sets.map((s, i) => (
                <span key={i} style={{
                  fontSize: '0.875rem',
                  color: '#9ca3af',
                  backgroundColor: '#374151',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                }}>
                  {s.player1Score}-{s.player2Score}
                </span>
              ))}
            </div>
          ) : (
            <span style={{ color: match.status === 'in_progress' ? '#ef4444' : '#6b7280', fontWeight: 'bold' }}>
              {match.status === 'in_progress' ? '진행중' : 'vs'}
            </span>
          )}
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          {nameButton(p2, !isP1Winner && isCompleted, 'right')}
        </div>
      </div>
    </div>
  );
}

// ===== Ranking Matches View =====
function RankingMatchesView({ matches, onSelectPlayer }: { matches: Match[]; onSelectPlayer: (name: string) => void }) {
  const rounds = useMemo(() => {
    const map = new Map<string, Match[]>();
    matches.forEach(m => {
      const label = m.roundLabel || '순위결정전';
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(m);
    });
    return Array.from(map.entries());
  }, [matches]);

  if (matches.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>순위결정전 경기가 없습니다</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {rounds.map(([roundLabel, roundMatches]) => (
        <div key={roundLabel}>
          <h3 style={{
            fontSize: '1.25rem',
            fontWeight: 'bold',
            color: '#c084fc',
            marginBottom: '0.75rem',
            borderBottom: '1px solid rgba(192, 132, 252, 0.3)',
            paddingBottom: '0.5rem',
          }}>
            {roundLabel}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {roundMatches.map(m => (
              <MatchResultCard key={m.id} match={m} onSelectPlayer={onSelectPlayer} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== Group Stage View =====
function GroupStageView({ matches, onSelectPlayer }: { matches: Match[]; onSelectPlayer: (name: string) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, Match[]>();
    matches.forEach(m => {
      const gid = m.groupId || 'default';
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(m);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [matches]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {groups.map(([groupId, groupMatches]) => (
        <div key={groupId} className="card">
          <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#facc15', marginBottom: '1rem' }}>
            {groupId === 'default' ? '경기' : `${groupId}조`}
          </h3>

          {/* 조별 순위표 */}
          <GroupRankingTable matches={groupMatches} onSelectPlayer={onSelectPlayer} />

          {/* 조별 경기 결과 */}
          <div style={{ marginTop: '1rem' }}>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#9ca3af', marginBottom: '0.5rem' }}>경기 결과</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {groupMatches.map(m => (
                <MatchResultRow key={m.id} match={m} onSelectPlayer={onSelectPlayer} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== Groups Tab =====
function GroupsTab({ matches, onSelectPlayer }: { matches: Match[]; onSelectPlayer: (name: string) => void }) {
  const groupMatches = useMemo(() => matches.filter(m => m.groupId), [matches]);

  const groups = useMemo(() => {
    const map = new Map<string, Match[]>();
    groupMatches.forEach(m => {
      const gid = m.groupId || 'default';
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(m);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [groupMatches]);

  if (groups.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>조 편성 정보가 없습니다</p>
      </div>
    );
  }

  const totalCompleted = groupMatches.filter(m => m.status === 'completed').length;
  const totalMatches = groupMatches.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <p style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
        총 {groups.length}개 조 | 예선 경기 {totalCompleted}/{totalMatches} 완료
      </p>
      {groups.map(([groupId, gMatches]) => {
        const completed = gMatches.filter(m => m.status === 'completed').length;
        const inProgress = gMatches.filter(m => m.status === 'in_progress').length;
        return (
          <div key={groupId} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#facc15' }}>
                {groupId === 'default' ? '경기' : `${groupId}조`}
              </h3>
              <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                {completed}/{gMatches.length} 완료
                {inProgress > 0 && (
                  <span style={{ color: '#ef4444', marginLeft: '0.5rem' }}>{inProgress} 진행중</span>
                )}
              </span>
            </div>
            <GroupRankingTable matches={gMatches} onSelectPlayer={onSelectPlayer} />
          </div>
        );
      })}
    </div>
  );
}

function GroupRankingTable({ matches, onSelectPlayer }: { matches: Match[]; onSelectPlayer: (name: string) => void }) {
  const rankings = useMemo(() => {
    const stats = new Map<string, {
      name: string; played: number; wins: number; losses: number;
      setsWon: number; setsLost: number; pointsFor: number; pointsAgainst: number;
    }>();

    matches.filter(m => m.status === 'completed').forEach(m => {
      const p1Id = m.player1Id || m.team1Id || '';
      const p2Id = m.player2Id || m.team2Id || '';
      const p1Name = m.player1Name || m.team1Name || '';
      const p2Name = m.player2Name || m.team2Name || '';

      if (!p1Id || !p2Id) return;

      if (!stats.has(p1Id)) stats.set(p1Id, { name: p1Name, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 });
      if (!stats.has(p2Id)) stats.set(p2Id, { name: p2Name, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 });

      const s1 = stats.get(p1Id)!;
      const s2 = stats.get(p2Id)!;
      s1.played++; s2.played++;

      if (m.winnerId === p1Id) { s1.wins++; s2.losses++; }
      else if (m.winnerId === p2Id) { s2.wins++; s1.losses++; }

      (m.sets || []).forEach(set => {
        if (set.player1Score > set.player2Score) { s1.setsWon++; s2.setsLost++; }
        else if (set.player2Score > set.player1Score) { s2.setsWon++; s1.setsLost++; }
        s1.pointsFor += set.player1Score; s1.pointsAgainst += set.player2Score;
        s2.pointsFor += set.player2Score; s2.pointsAgainst += set.player1Score;
      });
    });

    // Add participants from pending matches who haven't completed any
    matches.forEach(m => {
      const p1Id = m.player1Id || m.team1Id || '';
      const p2Id = m.player2Id || m.team2Id || '';
      const p1Name = m.player1Name || m.team1Name || '';
      const p2Name = m.player2Name || m.team2Name || '';
      if (p1Id && !stats.has(p1Id)) stats.set(p1Id, { name: p1Name, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 });
      if (p2Id && !stats.has(p2Id)) stats.set(p2Id, { name: p2Name, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 });
    });

    return Array.from(stats.values()).sort((a, b) =>
      b.wins - a.wins ||
      (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost) ||
      (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst)
    );
  }, [matches]);

  if (rankings.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #374151' }}>
            <th style={{ textAlign: 'left', padding: '0.5rem', color: '#9ca3af', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>순위</th>
            <th style={{ textAlign: 'left', padding: '0.5rem', color: '#9ca3af', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>이름</th>
            <th style={{ textAlign: 'center', padding: '0.5rem', color: '#9ca3af', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>경기</th>
            <th style={{ textAlign: 'center', padding: '0.5rem', color: '#9ca3af', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>승</th>
            <th style={{ textAlign: 'center', padding: '0.5rem', color: '#9ca3af', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>패</th>
            <th style={{ textAlign: 'center', padding: '0.5rem', color: '#9ca3af', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>세트득실</th>
            <th style={{ textAlign: 'center', padding: '0.5rem', color: '#9ca3af', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>세트차</th>
            <th style={{ textAlign: 'center', padding: '0.5rem', color: '#9ca3af', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>점수득실</th>
            <th style={{ textAlign: 'center', padding: '0.5rem', color: '#9ca3af', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>득실차</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map((r, i) => (
            <tr
              key={r.name}
              style={{
                borderBottom: '1px solid #1f2937',
                backgroundColor: i < 2 ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
              }}
            >
              <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>{i + 1}</td>
              <td style={{ padding: '0.5rem', fontWeight: 600, color: '#fff' }}>
                <button
                  className="text-left hover:underline hover:text-yellow-400"
                  onClick={() => onSelectPlayer(r.name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 600, padding: 0 }}
                >
                  {r.name}
                </button>
                {i < 2 && (
                  <span style={{
                    marginLeft: '0.5rem',
                    fontSize: '0.75rem',
                    backgroundColor: '#16a34a',
                    color: '#fff',
                    padding: '0.125rem 0.375rem',
                    borderRadius: '0.25rem',
                  }}>
                    진출
                  </span>
                )}
              </td>
              <td style={{ textAlign: 'center', padding: '0.5rem' }}>{r.played}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem', color: '#22c55e' }}>{r.wins}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem', color: '#ef4444' }}>{r.losses}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem' }}>{r.setsWon}-{r.setsLost}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem', color: formatDiff(r.setsWon - r.setsLost).color, fontWeight: 'bold' }}>{formatDiff(r.setsWon - r.setsLost).text}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem' }}>{r.pointsFor}-{r.pointsAgainst}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem', color: formatDiff(r.pointsFor - r.pointsAgainst).color, fontWeight: 'bold' }}>{formatDiff(r.pointsFor - r.pointsAgainst).text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchResultRow({ match, onSelectPlayer }: { match: Match; onSelectPlayer?: (name: string) => void }) {
  const p1 = match.player1Name || match.team1Name || '?';
  const p2 = match.player2Name || match.team2Name || '?';
  const isP1Winner = match.winnerId === (match.player1Id || match.team1Id);
  const isCompleted = match.status === 'completed';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: '#1f2937',
      borderRadius: '0.5rem',
      padding: '0.5rem 0.75rem',
      fontSize: '0.875rem',
    }}>
      <span style={{
        color: isCompleted && isP1Winner ? '#22c55e' : '#d1d5db',
        fontWeight: isCompleted && isP1Winner ? 'bold' : 'normal',
        flex: 1,
      }}>
        {onSelectPlayer ? (
          <button
            className="text-left hover:underline hover:text-yellow-400"
            onClick={(e) => { e.stopPropagation(); onSelectPlayer(p1); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'inherit', padding: 0 }}
          >
            {p1}
          </button>
        ) : p1}
      </span>
      <div style={{ textAlign: 'center', minWidth: '80px' }}>
        {isCompleted && match.sets ? (
          match.sets.map((s, i) => (
            <span key={i} style={{ color: '#9ca3af', margin: '0 0.25rem' }}>{s.player1Score}-{s.player2Score}</span>
          ))
        ) : (
          <span style={{ color: '#6b7280' }}>
            {match.status === 'in_progress' ? '진행중' : 'vs'}
          </span>
        )}
      </div>
      <span style={{
        color: isCompleted && !isP1Winner ? '#22c55e' : '#d1d5db',
        fontWeight: isCompleted && !isP1Winner ? 'bold' : 'normal',
        flex: 1,
        textAlign: 'right',
      }}>
        {onSelectPlayer ? (
          <button
            className="hover:underline hover:text-yellow-400"
            onClick={(e) => { e.stopPropagation(); onSelectPlayer(p2); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'inherit', padding: 0 }}
          >
            {p2}
          </button>
        ) : p2}
      </span>
    </div>
  );
}

function IndividualBracket({ matches, onSelectPlayer }: { matches: Match[]; onSelectPlayer: (name: string) => void }) {
  // Collect unique players
  const players = useMemo(() => {
    const playerMap = new Map<string, string>();
    for (const m of matches) {
      if (m.player1Id && m.player1Name) playerMap.set(m.player1Id, m.player1Name);
      if (m.player2Id && m.player2Name) playerMap.set(m.player2Id, m.player2Name);
    }
    return Array.from(playerMap.entries()).map(([id, name]) => ({ id, name }));
  }, [matches]);

  // Build result lookup
  const resultMap = useMemo(() => {
    const map = new Map<string, Match>();
    for (const m of matches) {
      if (m.player1Id && m.player2Id) {
        map.set(`${m.player1Id}_${m.player2Id}`, m);
        map.set(`${m.player2Id}_${m.player1Id}`, m);
      }
    }
    return map;
  }, [matches]);

  function getCellContent(p1Id: string, p2Id: string): { text: string; bg: string } {
    if (p1Id === p2Id) return { text: '-', bg: '#374151' };
    const match = resultMap.get(`${p1Id}_${p2Id}`);
    if (!match) return { text: '미진행', bg: 'transparent' };
    if (match.status !== 'completed') return { text: '진행중', bg: '#1e3a5f' };

    const isP1 = match.player1Id === p1Id;
    const won = match.winnerId === p1Id;
    if (match.sets) {
      const setWins = countSetWins(match.sets);
      const myWins = isP1 ? setWins.player1 : setWins.player2;
      const oppWins = isP1 ? setWins.player2 : setWins.player1;
      return {
        text: `${won ? '승' : '패'} ${myWins}-${oppWins}`,
        bg: won ? '#14532d' : '#7f1d1d',
      };
    }
    return { text: won ? '승' : '패', bg: won ? '#14532d' : '#7f1d1d' };
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: `${players.length * 80 + 120}px` }}>
        <caption className="sr-only">개인전 대진표</caption>
        <thead>
          <tr>
            <th
              scope="col"
              style={{ padding: '0.5rem', borderBottom: '2px solid #374151', textAlign: 'left', color: 'var(--color-primary)' }}
            >
              선수
            </th>
            {players.map((p) => (
              <th
                key={p.id}
                scope="col"
                style={{
                  padding: '0.5rem',
                  borderBottom: '2px solid #374151',
                  textAlign: 'center',
                  color: 'var(--color-secondary)',
                  fontSize: '0.875rem',
                  minWidth: '70px',
                }}
              >
                <button
                  className="hover:underline hover:text-yellow-400"
                  onClick={() => onSelectPlayer(p.name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'inherit', padding: 0 }}
                >
                  {p.name}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((rowPlayer) => (
            <tr key={rowPlayer.id}>
              <th
                scope="row"
                style={{
                  padding: '0.5rem',
                  borderBottom: '1px solid #1f2937',
                  textAlign: 'left',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                }}
              >
                <button
                  className="text-left hover:underline hover:text-yellow-400"
                  onClick={() => onSelectPlayer(rowPlayer.name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: 0 }}
                >
                  {rowPlayer.name}
                </button>
              </th>
              {players.map((colPlayer) => {
                const cell = getCellContent(rowPlayer.id, colPlayer.id);
                return (
                  <td
                    key={colPlayer.id}
                    style={{
                      padding: '0.5rem',
                      borderBottom: '1px solid #1f2937',
                      textAlign: 'center',
                      backgroundColor: cell.bg,
                      fontSize: '0.875rem',
                    }}
                  >
                    {cell.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamBracket({ matches, onSelectPlayer }: { matches: Match[]; onSelectPlayer: (name: string) => void }) {
  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {matches.map((match) => {
        const setData = match.sets && match.sets.length > 0 ? match.sets[0] : null;

        return (
          <li
            key={match.id}
            className="card"
            style={{ border: match.status === 'completed' ? '2px solid #16a34a' : '1px solid #1f2937' }}
            aria-label={`${match.team1Name || '팀1'} 대 ${match.team2Name || '팀2'}, ${match.status === 'completed' ? '완료' : match.status === 'in_progress' ? '진행중' : '대기'}`}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 'bold', flex: 1 }}>
                <button
                  className="text-left hover:underline hover:text-yellow-400"
                  onClick={(e) => { e.stopPropagation(); onSelectPlayer(match.team1Name || '팀1'); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: 0 }}
                >
                  {match.team1Name || '팀1'}
                </button>
              </span>
              <div style={{ textAlign: 'center', minWidth: '120px' }}>
                {match.status !== 'pending' && setData ? (
                  <span style={{ fontSize: '1.5rem', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: 'var(--color-primary)' }}>{setData.player1Score}</span>
                    <span style={{ color: '#6b7280', margin: '0 0.25rem' }}>-</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{setData.player2Score}</span>
                  </span>
                ) : (
                  <span style={{ color: '#9ca3af' }}>vs</span>
                )}
              </div>
              <span style={{ fontSize: '1.25rem', fontWeight: 'bold', flex: 1, textAlign: 'right' }}>
                <button
                  className="hover:underline hover:text-yellow-400"
                  onClick={(e) => { e.stopPropagation(); onSelectPlayer(match.team2Name || '팀2'); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: 0 }}
                >
                  {match.team2Name || '팀2'}
                </button>
              </span>
              <span style={{
                padding: '0.25rem 0.5rem',
                borderRadius: '0.25rem',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                backgroundColor: match.status === 'completed' ? '#16a34a' : match.status === 'in_progress' ? '#dc2626' : '#6b7280',
                color: '#fff',
                marginLeft: '0.75rem',
              }}>
                {match.status === 'completed' ? '완료' : match.status === 'in_progress' ? '진행중' : '대기'}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ===== Tournament Results Summary =====
function TournamentResultsSummary({
  matches,
  tournamentType,
}: {
  matches: Match[];
  tournamentType: string;
}) {
  const summary = useMemo(() => {
    const isTeam = tournamentType === 'team' || tournamentType === 'randomTeamLeague';
    const completedMatches = matches.filter(m => m.status === 'completed');
    const totalMatches = matches.length;
    const completedCount = completedMatches.length;
    const isFinished = totalMatches > 0 && completedCount === totalMatches;

    // Calculate rankings to find top 3
    let top3: { name: string; rank: number }[] = [];
    if (isTeam) {
      const rankings = calculateTeamRanking(matches);
      top3 = rankings.slice(0, 3).map(r => ({ name: r.teamName, rank: r.rank }));
    } else {
      const rankings = calculateIndividualRanking(matches);
      top3 = rankings.slice(0, 3).map(r => ({ name: r.playerName, rank: r.rank }));
    }

    // Total sets played
    let totalSets = 0;
    completedMatches.forEach(m => {
      totalSets += (m.sets || []).length;
    });

    // Highest scoring match
    let highestMatch: { name: string; totalPoints: number } | null = null;
    completedMatches.forEach(m => {
      let total = 0;
      (m.sets || []).forEach(s => {
        total += s.player1Score + s.player2Score;
      });
      if (total > 0 && (!highestMatch || total > highestMatch.totalPoints)) {
        const label = isTeam
          ? `${m.team1Name || '?'} vs ${m.team2Name || '?'}`
          : `${m.player1Name || '?'} vs ${m.player2Name || '?'}`;
        const entry: { name: string; totalPoints: number } = { name: label, totalPoints: total };
        highestMatch = entry;
      }
    });

    return { top3, totalMatches, completedCount, totalSets, highestMatch, isFinished };
  }, [matches, tournamentType]);

  if (summary.top3.length === 0) return null;

  const medalStyles: { bg: string; border: string; text: string; label: string }[] = [
    { bg: 'rgba(250, 204, 21, 0.15)', border: '#facc15', text: '#facc15', label: '1st' },
    { bg: 'rgba(192, 192, 192, 0.12)', border: '#a8a8a8', text: '#c0c0c0', label: '2nd' },
    { bg: 'rgba(205, 127, 50, 0.12)', border: '#cd7f32', text: '#cd7f32', label: '3rd' },
  ];

  return (
    <div style={{
      backgroundColor: '#1f2937',
      borderRadius: '0.75rem',
      padding: '1rem 1.25rem',
      marginBottom: '1.25rem',
      border: '1px solid #374151',
    }}>
      {/* Status badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#9ca3af' }}>대회 결과 요약</span>
        <span style={{
          fontSize: '0.75rem',
          fontWeight: 'bold',
          padding: '0.25rem 0.625rem',
          borderRadius: '9999px',
          backgroundColor: summary.isFinished ? '#16a34a' : '#d97706',
          color: '#fff',
        }}>
          {summary.isFinished ? '완료' : '진행중'}
        </span>
      </div>

      {/* Podium */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {summary.top3.map((entry, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            backgroundColor: medalStyles[i].bg,
            border: `1px solid ${medalStyles[i].border}`,
            borderRadius: '0.5rem',
            padding: i === 0 ? '0.75rem 1rem' : '0.5rem 1rem',
          }}>
            <span style={{
              fontSize: i === 0 ? '1.5rem' : '1.125rem',
              fontWeight: 'bold',
              color: medalStyles[i].text,
              minWidth: '2rem',
              textAlign: 'center',
            }}>
              {medalStyles[i].label}
            </span>
            <span style={{
              fontSize: i === 0 ? '1.375rem' : '1rem',
              fontWeight: 'bold',
              color: i === 0 ? '#facc15' : '#d1d5db',
            }}>
              {entry.name}
            </span>
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '0.5rem',
        textAlign: 'center',
        borderTop: '1px solid #374151',
        paddingTop: '0.75rem',
      }}>
        <div>
          <p style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#60a5fa' }}>
            {summary.completedCount}/{summary.totalMatches}
          </p>
          <p style={{ fontSize: '0.6875rem', color: '#9ca3af' }}>경기 완료</p>
        </div>
        <div>
          <p style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#c084fc' }}>
            {summary.totalSets}
          </p>
          <p style={{ fontSize: '0.6875rem', color: '#9ca3af' }}>총 세트</p>
        </div>
        <div>
          <p style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#f472b6' }}>
            {summary.highestMatch ? summary.highestMatch.totalPoints : '-'}
          </p>
          <p style={{ fontSize: '0.6875rem', color: '#9ca3af' }}>최고 득점</p>
        </div>
      </div>

      {/* Highest scoring match detail */}
      {summary.highestMatch && (
        <p style={{ fontSize: '0.75rem', color: '#6b7280', textAlign: 'center', marginTop: '0.375rem' }}>
          최고 득점 경기: {summary.highestMatch.name} ({summary.highestMatch.totalPoints}점)
        </p>
      )}
    </div>
  );
}

// ===== Ranking Tab =====
function RankingTab({
  matches,
  tournamentType,
  isFavorite,
  onSelectPlayer,
  stageFilter,
}: {
  matches: Match[];
  tournamentType: string;
  isFavorite: (id: string) => boolean;
  onSelectPlayer: (name: string) => void;
  stageFilter: 'all' | 'qualifying' | 'finals' | 'ranking';
}) {
  if (stageFilter === 'qualifying') {
    return (
      <div>
        <TournamentResultsSummary matches={matches} tournamentType={tournamentType} />
        <GroupRankingView matches={matches} onSelectPlayer={onSelectPlayer} />
      </div>
    );
  }

  const isTeam = tournamentType === 'team' || tournamentType === 'randomTeamLeague';

  if (isTeam) {
    return (
      <div>
        <TournamentResultsSummary matches={matches} tournamentType={tournamentType} />
        <TeamRankingTable matches={matches} onSelectPlayer={onSelectPlayer} />
      </div>
    );
  }

  return (
    <div>
      <TournamentResultsSummary matches={matches} tournamentType={tournamentType} />
      <IndividualRankingTable matches={matches} isFavorite={isFavorite} onSelectPlayer={onSelectPlayer} />
    </div>
  );
}

function GroupRankingView({ matches, onSelectPlayer }: { matches: Match[]; onSelectPlayer: (name: string) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, Match[]>();
    matches.forEach(m => {
      const gid = m.groupId || 'default';
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(m);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [matches]);

  if (groups.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>예선 순위 정보가 없습니다</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {groups.map(([groupId, groupMatches]) => (
        <div key={groupId} className="card">
          <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#facc15', marginBottom: '0.75rem' }}>
            {groupId === 'default' ? '순위' : `${groupId}조 순위`}
          </h3>
          <GroupRankingTable matches={groupMatches} onSelectPlayer={onSelectPlayer} />
        </div>
      ))}
    </div>
  );
}

function IndividualRankingTable({
  matches,
  isFavorite,
  onSelectPlayer,
}: {
  matches: Match[];
  isFavorite: (id: string) => boolean;
  onSelectPlayer: (name: string) => void;
}) {
  const rankings: PlayerRanking[] = useMemo(() => calculateIndividualRanking(matches), [matches]);

  if (rankings.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>순위 정보가 없습니다</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <caption className="sr-only">개인전 순위표</caption>
        <thead>
          <tr style={{ backgroundColor: '#1f2937' }}>
            <th scope="col" style={thStyle}>순위</th>
            <th scope="col" style={{ ...thStyle, textAlign: 'left' }}>선수명</th>
            <th scope="col" style={thStyle}>경기수</th>
            <th scope="col" style={thStyle}>승</th>
            <th scope="col" style={thStyle}>패</th>
            <th scope="col" style={thStyle}>세트</th>
            <th scope="col" style={thStyle}>세트차</th>
            <th scope="col" style={thStyle}>포인트</th>
            <th scope="col" style={thStyle}>득실차</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map((r) => (
            <tr
              key={r.playerId}
              style={{
                backgroundColor: isFavorite(r.playerId) ? '#1e3a5f' : 'transparent',
                borderBottom: '1px solid #1f2937',
              }}
            >
              <td style={tdStyle}>{r.rank}</td>
              <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 'bold' }}>
                {isFavorite(r.playerId) && <span style={{ color: 'var(--color-primary)', marginRight: '0.25rem' }}>★</span>}
                <button
                  onClick={() => onSelectPlayer(r.playerName)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: 0, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                >
                  {r.playerName}
                </button>
              </td>
              <td style={tdStyle}>{r.played}</td>
              <td style={{ ...tdStyle, color: 'var(--color-success)' }}>{r.wins}</td>
              <td style={{ ...tdStyle, color: 'var(--color-danger)' }}>{r.losses}</td>
              <td style={tdStyle}>{r.setsWon}/{r.setsLost}</td>
              <td style={{ ...tdStyle, color: formatDiff(r.setsWon - r.setsLost).color, fontWeight: 'bold' }}>{formatDiff(r.setsWon - r.setsLost).text}</td>
              <td style={tdStyle}>{r.pointsFor}/{r.pointsAgainst}</td>
              <td style={{ ...tdStyle, color: formatDiff(r.pointsFor - r.pointsAgainst).color, fontWeight: 'bold' }}>{formatDiff(r.pointsFor - r.pointsAgainst).text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamRankingTable({ matches, onSelectPlayer }: { matches: Match[]; onSelectPlayer: (name: string) => void }) {
  const rankings: TeamRanking[] = useMemo(() => calculateTeamRanking(matches), [matches]);

  if (rankings.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>순위 정보가 없습니다</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <caption className="sr-only">팀전 순위표</caption>
        <thead>
          <tr style={{ backgroundColor: '#1f2937' }}>
            <th scope="col" style={thStyle}>순위</th>
            <th scope="col" style={{ ...thStyle, textAlign: 'left' }}>팀명</th>
            <th scope="col" style={thStyle}>승</th>
            <th scope="col" style={thStyle}>패</th>
            <th scope="col" style={thStyle}>득점</th>
            <th scope="col" style={thStyle}>실점</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map((r) => (
            <tr key={r.teamId} style={{ borderBottom: '1px solid #1f2937' }}>
              <td style={tdStyle}>{r.rank}</td>
              <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 'bold' }}>
                <button
                  onClick={() => onSelectPlayer(r.teamName)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: 0, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                >
                  {r.teamName}
                </button>
              </td>
              <td style={{ ...tdStyle, color: 'var(--color-success)' }}>{r.wins}</td>
              <td style={{ ...tdStyle, color: 'var(--color-danger)' }}>{r.losses}</td>
              <td style={tdStyle}>{r.pointsFor}</td>
              <td style={tdStyle}>{r.pointsAgainst}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDiff(value: number): { text: string; color: string } {
  if (value > 0) return { text: `+${value}`, color: '#22c55e' };
  if (value < 0) return { text: `${value}`, color: '#ef4444' };
  return { text: '0', color: '#6b7280' };
}

const thStyle: React.CSSProperties = {
  padding: '0.75rem 0.5rem',
  textAlign: 'center',
  fontWeight: 'bold',
  color: 'var(--color-primary)',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  backgroundColor: '#1f2937',
  zIndex: 1,
};

const tdStyle: React.CSSProperties = {
  padding: '0.75rem 0.5rem',
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

function getMatchStageBadge(m: Match): { label: string; color: string; bg: string } | null {
  if (m.groupId || m.stageId?.includes('qualifying')) {
    return { label: '예선', color: '#fff', bg: '#2563eb' };
  }
  if (m.stageId?.includes('ranking') || m.roundLabel?.includes('결정전')) {
    return { label: '순위결정전', color: '#fff', bg: '#ea580c' };
  }
  if (m.stageId?.includes('finals') || m.roundLabel) {
    return { label: m.roundLabel || '본선', color: '#000', bg: '#eab308' };
  }
  return null;
}

function PlayerMatchRow({
  match: m,
  navigate,
  tournamentId,
  selectedPlayer,
  expandedMatchId,
  onToggleExpand,
}: {
  match: Match;
  navigate: ReturnType<typeof useNavigate>;
  tournamentId: string;
  selectedPlayer: string;
  expandedMatchId: string | null;
  onToggleExpand: (id: string | null) => void;
}) {
  const isP1 = m.player1Name === selectedPlayer || m.team1Name === selectedPlayer;
  const opponentName = isP1
    ? (m.player2Name || m.team2Name || '?')
    : (m.player1Name || m.team1Name || '?');
  const myId = isP1 ? (m.player1Id || m.team1Id) : (m.player2Id || m.team2Id);
  const isWin = m.status === 'completed' && m.winnerId === myId;
  const isCompleted = m.status === 'completed';
  const isExpanded = expandedMatchId === m.id;

  // Per-match point totals
  let matchPointsFor = 0;
  let matchPointsAgainst = 0;
  if (m.sets) {
    m.sets.forEach(s => {
      matchPointsFor += isP1 ? s.player1Score : s.player2Score;
      matchPointsAgainst += isP1 ? s.player2Score : s.player1Score;
    });
  }

  // Stage badge
  const stageBadge = getMatchStageBadge(m);

  // Duration from scoreHistory timestamps
  const duration = useMemo(() => {
    if (!m.scoreHistory || m.scoreHistory.length < 2) return null;
    const times = m.scoreHistory.map(e => new Date(e.time).getTime()).filter(t => !isNaN(t));
    if (times.length < 2) return null;
    const diffMs = Math.max(...times) - Math.min(...times);
    const mins = Math.round(diffMs / 60000);
    return mins > 0 ? mins : null;
  }, [m.scoreHistory]);

  return (
    <div style={{ backgroundColor: '#1f2937', borderRadius: '0.5rem', marginBottom: '0.25rem', overflow: 'hidden' }}>
      {/* Main row - clickable to expand/collapse */}
      <div
        style={{ padding: '0.75rem', fontSize: '0.875rem', width: '100%', textAlign: 'left', cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand(isExpanded ? null : m.id);
        }}
      >
        {/* Top line: win/loss, opponent, stage badge, navigate arrow */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {isCompleted && (
              <span style={{
                color: isWin ? '#22c55e' : '#ef4444',
                fontWeight: 'bold',
                fontSize: '0.875rem',
                minWidth: '1.25rem',
              }}>
                {isWin ? '승' : '패'}
              </span>
            )}
            <span style={{ fontWeight: 'bold' }}>vs {opponentName}</span>
            {stageBadge && (
              <span style={{
                fontSize: '0.6875rem',
                fontWeight: 'bold',
                color: stageBadge.color,
                backgroundColor: stageBadge.bg,
                padding: '0.125rem 0.375rem',
                borderRadius: '0.25rem',
                lineHeight: 1.2,
              }}>
                {stageBadge.label}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {duration && (
              <span style={{ color: '#6b7280', fontSize: '0.6875rem' }}>{duration}분</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/spectator/match/${tournamentId}/${m.id}`); }}
              style={{ color: m.status === 'completed' ? '#22c55e' : '#facc15', fontSize: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {m.status === 'completed' ? '상세 >' : '진행중 >'}
            </button>
          </div>
        </div>

        {/* Set score pills */}
        {m.sets && m.sets.length > 0 && (
          <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {m.sets.map((s, i) => {
              const myScore = isP1 ? s.player1Score : s.player2Score;
              const oppScore = isP1 ? s.player2Score : s.player1Score;
              const setWon = myScore > oppScore;
              return (
                <span key={i} style={{
                  fontSize: '0.75rem',
                  fontWeight: 'bold',
                  color: setWon ? '#bbf7d0' : '#fecaca',
                  backgroundColor: setWon ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  border: `1px solid ${setWon ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                  padding: '0.125rem 0.5rem',
                  borderRadius: '9999px',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {myScore}-{oppScore}
                </span>
              );
            })}
          </div>
        )}

        {/* Total points summary */}
        {isCompleted && m.sets && m.sets.length > 0 && (
          <div style={{ color: '#9ca3af', marginTop: '0.25rem', fontSize: '0.75rem' }}>
            득 {matchPointsFor} - 실 {matchPointsAgainst}
          </div>
        )}
      </div>

      {/* Expandable detail: score history timeline */}
      {isExpanded && m.scoreHistory && m.scoreHistory.length > 0 && (
        <div style={{
          borderTop: '1px solid #374151',
          padding: '0.5rem 0.75rem',
          backgroundColor: '#111827',
          maxHeight: '12rem',
          overflowY: 'auto',
        }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#facc15', marginBottom: '0.375rem' }}>득점 타임라인</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
            {m.scoreHistory.map((entry, i) => {
              const isMine = entry.scoringPlayer === selectedPlayer;
              const timeStr = entry.time ? new Date(entry.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
              return (
                <div key={i} style={{
                  display: 'flex',
                  gap: '0.5rem',
                  fontSize: '0.6875rem',
                  color: isMine ? '#bbf7d0' : '#fecaca',
                  alignItems: 'center',
                }}>
                  <span style={{ color: '#6b7280', minWidth: '4rem', fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
                  <span style={{ fontWeight: 'bold', minWidth: '1rem' }}>S{entry.set}</span>
                  <span style={{
                    backgroundColor: isMine ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                    padding: '0 0.25rem',
                    borderRadius: '0.125rem',
                  }}>
                    {entry.scoreBefore.player1}-{entry.scoreBefore.player2}
                  </span>
                  <span style={{ color: '#9ca3af' }}>{entry.actionLabel}</span>
                  <span style={{ color: '#6b7280' }}>({entry.actionPlayer})</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* If expanded but no scoreHistory */}
      {isExpanded && (!m.scoreHistory || m.scoreHistory.length === 0) && (
        <div style={{
          borderTop: '1px solid #374151',
          padding: '0.5rem 0.75rem',
          backgroundColor: '#111827',
        }}>
          <p style={{ fontSize: '0.75rem', color: '#6b7280', textAlign: 'center' }}>상세 득점 기록이 없습니다</p>
        </div>
      )}
    </div>
  );
}

// ===== Players Tab =====
function PlayersTab({ matches, onSelectPlayer }: { matches: Match[]; onSelectPlayer: (name: string) => void }) {
  const [playerSearch, setPlayerSearch] = useState('');

  const playerList = useMemo(() => {
    const stats = new Map<string, {
      id: string; name: string; wins: number; losses: number;
      setsWon: number; setsLost: number; pointsFor: number; pointsAgainst: number;
    }>();

    for (const m of matches) {
      const p1Id = m.player1Id || m.team1Id || '';
      const p2Id = m.player2Id || m.team2Id || '';
      const p1Name = m.player1Name || m.team1Name || '';
      const p2Name = m.player2Name || m.team2Name || '';

      if (p1Id && p1Name && !stats.has(p1Id)) {
        stats.set(p1Id, { id: p1Id, name: p1Name, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 });
      }
      if (p2Id && p2Name && !stats.has(p2Id)) {
        stats.set(p2Id, { id: p2Id, name: p2Name, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 });
      }

      if (m.status === 'completed' && p1Id && p2Id) {
        const s1 = stats.get(p1Id);
        const s2 = stats.get(p2Id);
        if (s1 && s2) {
          if (m.winnerId === p1Id) { s1.wins++; s2.losses++; }
          else if (m.winnerId === p2Id) { s2.wins++; s1.losses++; }

          (m.sets || []).forEach(set => {
            if (set.player1Score > set.player2Score) { s1.setsWon++; s2.setsLost++; }
            else if (set.player2Score > set.player1Score) { s2.setsWon++; s1.setsLost++; }
            s1.pointsFor += set.player1Score; s1.pointsAgainst += set.player2Score;
            s2.pointsFor += set.player2Score; s2.pointsAgainst += set.player1Score;
          });
        }
      }
    }

    return Array.from(stats.values()).sort((a, b) =>
      b.wins - a.wins || (b.setsWon - b.setsLost) - (a.setsWon - a.setsLost) || a.name.localeCompare(b.name)
    );
  }, [matches]);

  const filteredPlayers = useMemo(() => {
    if (!playerSearch.trim()) return playerList;
    const q = playerSearch.trim().toLowerCase();
    return playerList.filter(p => p.name.toLowerCase().includes(q));
  }, [playerList, playerSearch]);

  if (playerList.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>등록된 선수가 없습니다</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <input
          className="input"
          style={{ width: '100%' }}
          value={playerSearch}
          onChange={e => setPlayerSearch(e.target.value)}
          placeholder="선수 이름 검색"
          aria-label="선수 이름 검색"
        />
      </div>
      <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
        총 {filteredPlayers.length}명{playerSearch.trim() ? ` (검색: "${playerSearch.trim()}")` : ''}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {filteredPlayers.map(p => (
          <button
            key={p.id}
            className="card"
            onClick={() => onSelectPlayer(p.name)}
            style={{
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer',
              padding: '0.75rem 1rem',
              border: '1px solid #374151',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 'bold', fontSize: '1.125rem', color: '#facc15' }}>{p.name}</span>
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem' }}>
                <span>
                  <span style={{ color: '#22c55e' }}>{p.wins}승</span>
                  {' '}
                  <span style={{ color: '#ef4444' }}>{p.losses}패</span>
                </span>
                <span style={{ color: '#9ca3af' }}>{p.setsWon}-{p.setsLost}</span>
              </div>
            </div>
          </button>
        ))}
        {filteredPlayers.length === 0 && playerSearch.trim() && (
          <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ color: '#9ca3af' }}>"{playerSearch.trim()}"에 해당하는 선수가 없습니다</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== History Tab =====
const HISTORY_ITEMS_PER_PAGE = 30;

function HistoryMatchStatusBadge({ status }: { status: string }) {
  if (status === 'in_progress') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
        padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold',
        backgroundColor: 'rgba(234, 179, 8, 0.15)', color: '#eab308', border: '1px solid rgba(234, 179, 8, 0.3)',
      }}>
        <span className="animate-pulse" style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#eab308' }} />
        진행중
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
        padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold',
        backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.3)',
      }}>
        완료
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold',
      backgroundColor: 'rgba(107, 114, 128, 0.15)', color: '#9ca3af', border: '1px solid rgba(107, 114, 128, 0.3)',
    }}>
      예정
    </span>
  );
}

function HistoryMatchCard({
  match,
  navigate,
  tournamentId,
}: {
  match: Match;
  navigate: ReturnType<typeof useNavigate>;
  tournamentId: string;
}) {
  const isIndividual = match.type === 'individual';
  const p1 = isIndividual ? (match.player1Name || '선수1') : (match.team1Name || '팀1');
  const p2 = isIndividual ? (match.player2Name || '선수2') : (match.team2Name || '팀2');
  const isCompleted = match.status === 'completed';
  const isP1Winner = isCompleted && match.winnerId === (match.player1Id || match.team1Id);
  const isP2Winner = isCompleted && match.winnerId === (match.player2Id || match.team2Id);
  const sets = match.sets || [];
  const setWins = isIndividual && sets.length > 0 ? countSetWins(sets) : null;

  const borderColor = match.status === 'in_progress' ? '#eab308' : isCompleted ? '#374151' : '#1f2937';

  return (
    <button
      className="card"
      onClick={() => navigate(`/spectator/match/${tournamentId}/${match.id}`)}
      style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: `1px solid ${borderColor}`, padding: '0.75rem 1rem' }}
      aria-label={`${p1} 대 ${p2}, ${isCompleted ? '완료' : match.status === 'in_progress' ? '진행중' : '예정'}`}
    >
      {/* Top row: badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <HistoryMatchStatusBadge status={match.status} />
        {match.courtName && (
          <span style={{
            padding: '0.125rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 600,
            backgroundColor: 'rgba(96, 165, 250, 0.15)', color: '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.3)',
          }}>
            {match.courtName}
          </span>
        )}
        {match.refereeName && (
          <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
            심판: {match.refereeName}
          </span>
        )}
      </div>

      {/* Players / teams row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span style={{
          flex: 1, fontWeight: 'bold', fontSize: '1.05rem',
          color: isP1Winner ? '#22c55e' : isCompleted && isP2Winner ? '#9ca3af' : '#d1d5db',
        }}>
          {p1}
        </span>

        {/* Score area */}
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          {sets.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.125rem' }}>
              {/* Set wins for individual, or total score for team */}
              {isIndividual && setWins ? (
                <span style={{ fontSize: '1.125rem', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: isP1Winner ? '#22c55e' : '#d1d5db' }}>{setWins.player1}</span>
                  <span style={{ color: '#6b7280', margin: '0 0.125rem' }}>-</span>
                  <span style={{ color: isP2Winner ? '#22c55e' : '#d1d5db' }}>{setWins.player2}</span>
                </span>
              ) : !isIndividual && sets.length > 0 ? (
                <span style={{ fontSize: '1.125rem', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: isP1Winner ? '#22c55e' : '#d1d5db' }}>{sets[0].player1Score}</span>
                  <span style={{ color: '#6b7280', margin: '0 0.125rem' }}>-</span>
                  <span style={{ color: isP2Winner ? '#22c55e' : '#d1d5db' }}>{sets[0].player2Score}</span>
                </span>
              ) : null}
              {/* Inline set scores for individual */}
              {isIndividual && sets.length > 0 && (
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {sets.map((s, i) => {
                    const p1Won = s.player1Score > s.player2Score;
                    return (
                      <span key={i} style={{
                        fontSize: '0.6875rem', fontVariantNumeric: 'tabular-nums',
                        color: '#9ca3af', backgroundColor: '#374151',
                        padding: '0.0625rem 0.375rem', borderRadius: '0.25rem',
                        border: match.status === 'in_progress' && i === sets.length - 1 ? '1px solid #eab308' : 'none',
                      }}>
                        <span style={{ color: p1Won ? '#4ade80' : undefined }}>{s.player1Score}</span>
                        -
                        <span style={{ color: !p1Won && s.player2Score > s.player1Score ? '#4ade80' : undefined }}>{s.player2Score}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <span style={{ color: '#6b7280', fontWeight: 'bold', fontSize: '0.875rem' }}>vs</span>
          )}
        </div>

        <span style={{
          flex: 1, fontWeight: 'bold', fontSize: '1.05rem', textAlign: 'right',
          color: isP2Winner ? '#22c55e' : isCompleted && isP1Winner ? '#9ca3af' : '#d1d5db',
        }}>
          {p2}
        </span>
      </div>
    </button>
  );
}

function HistoryStageSectionHeader({
  title,
  color,
  completedCount,
  totalCount,
}: {
  title: string;
  color: string;
  completedCount: number;
  totalCount: number;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderBottom: `2px solid ${color}33`, paddingBottom: '0.5rem', marginBottom: '0.75rem', marginTop: '0.25rem',
    }}>
      <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color }}>{title}</h3>
      <span style={{ fontSize: '0.8125rem', color: '#9ca3af' }}>
        {completedCount}/{totalCount} 완료
      </span>
    </div>
  );
}

function HistoryTab({
  matches,
  navigate,
  tournamentId,
}: {
  matches: Match[];
  navigate: ReturnType<typeof useNavigate>;
  tournamentId: string;
}) {
  const [page, setPage] = useState(1);

  // Classify matches into stages
  const stageGroups = useMemo(() => {
    const qualifying: Match[] = [];
    const finals: Match[] = [];
    const ranking: Match[] = [];
    const other: Match[] = [];

    matches.forEach(m => {
      if (m.groupId || m.stageId?.includes('qualifying')) {
        qualifying.push(m);
      } else if (m.stageId?.includes('ranking') || m.roundLabel?.includes('결정전')) {
        ranking.push(m);
      } else if (m.stageId?.includes('finals') || m.roundLabel) {
        finals.push(m);
      } else {
        other.push(m);
      }
    });

    return { qualifying, finals, ranking, other };
  }, [matches]);

  // Sub-group qualifying by groupId
  const qualifyingGroups = useMemo(() => {
    const map = new Map<string, Match[]>();
    stageGroups.qualifying.forEach(m => {
      const gid = m.groupId || 'default';
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(m);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [stageGroups.qualifying]);

  // Sub-group finals by roundLabel
  const finalsRounds = useMemo(() => {
    const roundOrder = ['128강', '64강', '32강', '16강', '8강', '4강', '결승'];
    const map = new Map<string, Match[]>();
    stageGroups.finals.forEach(m => {
      const label = m.roundLabel || `라운드 ${m.round || '?'}`;
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(m);
    });
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = roundOrder.indexOf(a);
      const bi = roundOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [stageGroups.finals]);

  // Sub-group ranking matches by roundLabel
  const rankingRounds = useMemo(() => {
    const map = new Map<string, Match[]>();
    stageGroups.ranking.forEach(m => {
      const label = m.roundLabel || '순위결정전';
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(m);
    });
    return Array.from(map.entries());
  }, [stageGroups.ranking]);

  const totalMatchCount = matches.length;
  const totalPages = Math.ceil(totalMatchCount / HISTORY_ITEMS_PER_PAGE);
  const safePage = Math.min(page, Math.max(totalPages, 1));

  const completedCount = matches.filter(m => m.status === 'completed').length;
  const inProgressCount = matches.filter(m => m.status === 'in_progress').length;
  const pendingCount = matches.filter(m => m.status === 'pending').length;

  if (matches.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>경기가 없습니다</p>
      </div>
    );
  }

  const countCompleted = (ms: Match[]) => ms.filter(m => m.status === 'completed').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
        전체 {matches.length}경기 | 완료 {completedCount}경기 | 진행중 {inProgressCount}경기 | 대기 {pendingCount}경기
      </p>

      {/* Qualifying (Group stage) */}
      {stageGroups.qualifying.length > 0 && (
        <div>
          <HistoryStageSectionHeader
            title="예선 (조별리그)"
            color="#60a5fa"
            completedCount={countCompleted(stageGroups.qualifying)}
            totalCount={stageGroups.qualifying.length}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {qualifyingGroups.map(([groupId, gMatches]) => (
              <div key={groupId}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: '0.5rem', paddingLeft: '0.25rem',
                }}>
                  <h4 style={{ fontSize: '0.9375rem', fontWeight: 'bold', color: '#facc15' }}>
                    {groupId === 'default' ? '경기' : `${groupId}조`}
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    {countCompleted(gMatches)}/{gMatches.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {gMatches.map(m => (
                    <HistoryMatchCard key={m.id} match={m} navigate={navigate} tournamentId={tournamentId} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Finals (Tournament bracket) */}
      {stageGroups.finals.length > 0 && (
        <div>
          <HistoryStageSectionHeader
            title="본선 (토너먼트)"
            color="#4ade80"
            completedCount={countCompleted(stageGroups.finals)}
            totalCount={stageGroups.finals.length}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {finalsRounds.map(([roundLabel, rMatches]) => (
              <div key={roundLabel}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: '0.5rem', paddingLeft: '0.25rem',
                }}>
                  <h4 style={{ fontSize: '0.9375rem', fontWeight: 'bold', color: '#facc15' }}>
                    {roundLabel}
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    {countCompleted(rMatches)}/{rMatches.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {rMatches.map(m => (
                    <HistoryMatchCard key={m.id} match={m} navigate={navigate} tournamentId={tournamentId} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ranking matches */}
      {stageGroups.ranking.length > 0 && (
        <div>
          <HistoryStageSectionHeader
            title="순위결정전"
            color="#c084fc"
            completedCount={countCompleted(stageGroups.ranking)}
            totalCount={stageGroups.ranking.length}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {rankingRounds.map(([roundLabel, rMatches]) => (
              <div key={roundLabel}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: '0.5rem', paddingLeft: '0.25rem',
                }}>
                  <h4 style={{ fontSize: '0.9375rem', fontWeight: 'bold', color: '#facc15' }}>
                    {roundLabel}
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    {countCompleted(rMatches)}/{rMatches.length}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {rMatches.map(m => (
                    <HistoryMatchCard key={m.id} match={m} navigate={navigate} tournamentId={tournamentId} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Other (unclassified) */}
      {stageGroups.other.length > 0 && (
        <div>
          {(stageGroups.qualifying.length > 0 || stageGroups.finals.length > 0 || stageGroups.ranking.length > 0) && (
            <HistoryStageSectionHeader
              title="기타"
              color="#9ca3af"
              completedCount={countCompleted(stageGroups.other)}
              totalCount={stageGroups.other.length}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {stageGroups.other.map(m => (
              <HistoryMatchCard key={m.id} match={m} navigate={navigate} tournamentId={tournamentId} />
            ))}
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
          <button className="btn btn-sm btn-secondary" disabled={safePage === 1} onClick={() => setPage(p => p - 1)}>이전</button>
          <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{safePage} / {totalPages}</span>
          <button className="btn btn-sm btn-secondary" disabled={safePage === totalPages} onClick={() => setPage(p => p + 1)}>다음</button>
        </div>
      )}
    </div>
  );
}
