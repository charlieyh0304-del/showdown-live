import { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTournament, useMatches, useFavorites } from '@shared/hooks/useFirebase';
import { countSetWins } from '@shared/utils/scoring';
import { calculateIndividualRanking, calculateTeamRanking } from '@shared/utils/ranking';
import type { Match, PlayerRanking, TeamRanking } from '@shared/types';

type TabId = 'live' | 'bracket' | 'ranking' | 'history';

const TAB_LABELS: Record<TabId, string> = {
  live: '실시간',
  bracket: '대진표',
  ranking: '순위',
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
  const { isFavorite, toggleFavorite } = useFavorites();
  const [activeTab, setActiveTab] = useState<TabId>('live');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<'all' | 'qualifying' | 'finals' | 'ranking'>('all');

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
            <button className="btn" style={{ fontSize: '0.875rem', padding: '0.25rem 0.75rem' }} onClick={() => setSelectedPlayer(null)}>닫기</button>
          </div>
          {playerStats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', textAlign: 'center', marginBottom: '1rem' }}>
              <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{playerStats.total}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>총 경기</p></div>
              <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#22c55e' }}>{playerStats.wins}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>승</p></div>
              <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ef4444' }}>{playerStats.losses}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>패</p></div>
              <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#22d3ee' }}>{playerStats.setsWon}-{playerStats.setsLost}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>세트 득실</p></div>
              <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#facc15' }}>{playerStats.pointsFor}-{playerStats.pointsAgainst}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>포인트 득실</p></div>
              <div><p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{playerStats.pointsFor}</p><p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>총 포인트</p></div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '20rem', overflowY: 'auto' }}>
            {/* 예선 경기 */}
            {playerMatches.filter(m => m.groupId).length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#60a5fa', marginBottom: '0.25rem', marginTop: '0.25rem' }}>예선</h4>
                {playerMatches.filter(m => m.groupId).map(m => (
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} />
                ))}
              </div>
            )}
            {/* 본선 경기 */}
            {playerMatches.filter(m => !m.groupId && m.stageId?.includes('finals')).length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#4ade80', marginBottom: '0.25rem', marginTop: '0.25rem' }}>본선</h4>
                {playerMatches.filter(m => !m.groupId && m.stageId?.includes('finals')).map(m => (
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} />
                ))}
              </div>
            )}
            {/* 순위결정전 */}
            {playerMatches.filter(m => m.stageId?.includes('ranking')).length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#c084fc', marginBottom: '0.25rem', marginTop: '0.25rem' }}>순위결정전</h4>
                {playerMatches.filter(m => m.stageId?.includes('ranking')).map(m => (
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} />
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
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} />
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
        {(Object.keys(TAB_LABELS) as TabId[]).map((tab) => (
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
          <LiveTab matches={filteredMatches} isFavorite={isFavorite} toggleFavorite={toggleFavorite} navigate={navigate} tournamentId={id!} />
        )}
        {activeTab === 'bracket' && (
          <BracketTab matches={filteredMatches} tournamentType={tournament.type} onSelectPlayer={setSelectedPlayer} />
        )}
        {activeTab === 'ranking' && (
          <RankingTab matches={filteredMatches} tournamentType={tournament.type} isFavorite={isFavorite} onSelectPlayer={setSelectedPlayer} />
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
            <th style={{ textAlign: 'left', padding: '0.5rem', color: '#9ca3af' }}>순위</th>
            <th style={{ textAlign: 'left', padding: '0.5rem', color: '#9ca3af' }}>이름</th>
            <th style={{ textAlign: 'center', padding: '0.5rem', color: '#9ca3af' }}>경기</th>
            <th style={{ textAlign: 'center', padding: '0.5rem', color: '#9ca3af' }}>승</th>
            <th style={{ textAlign: 'center', padding: '0.5rem', color: '#9ca3af' }}>패</th>
            <th style={{ textAlign: 'center', padding: '0.5rem', color: '#9ca3af' }}>세트득실</th>
            <th style={{ textAlign: 'center', padding: '0.5rem', color: '#9ca3af' }}>점수득실</th>
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
              <td style={{ textAlign: 'center', padding: '0.5rem' }}>{r.pointsFor}-{r.pointsAgainst}</td>
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

// ===== Ranking Tab =====
function RankingTab({
  matches,
  tournamentType,
  isFavorite,
  onSelectPlayer,
}: {
  matches: Match[];
  tournamentType: string;
  isFavorite: (id: string) => boolean;
  onSelectPlayer: (name: string) => void;
}) {
  const isTeam = tournamentType === 'team' || tournamentType === 'randomTeamLeague';

  if (isTeam) {
    return <TeamRankingTable matches={matches} onSelectPlayer={onSelectPlayer} />;
  }

  return <IndividualRankingTable matches={matches} isFavorite={isFavorite} onSelectPlayer={onSelectPlayer} />;
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
            <th scope="col" style={thStyle}>승</th>
            <th scope="col" style={thStyle}>패</th>
            <th scope="col" style={thStyle}>세트</th>
            <th scope="col" style={thStyle}>포인트</th>
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
              <td style={{ ...tdStyle, color: 'var(--color-success)' }}>{r.wins}</td>
              <td style={{ ...tdStyle, color: 'var(--color-danger)' }}>{r.losses}</td>
              <td style={tdStyle}>{r.setsWon}/{r.setsLost}</td>
              <td style={tdStyle}>{r.pointsFor}/{r.pointsAgainst}</td>
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

const thStyle: React.CSSProperties = {
  padding: '0.75rem 0.5rem',
  textAlign: 'center',
  fontWeight: 'bold',
  color: 'var(--color-primary)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '0.75rem 0.5rem',
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

function PlayerMatchRow({ match: m, navigate, tournamentId }: { match: Match; navigate: ReturnType<typeof useNavigate>; tournamentId: string }) {
  return (
    <button
      onClick={() => navigate(`/spectator/match/${tournamentId}/${m.id}`)}
      style={{ backgroundColor: '#1f2937', borderRadius: '0.5rem', padding: '0.75rem', fontSize: '0.875rem', width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none', color: 'inherit', marginBottom: '0.25rem', display: 'block' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{m.player1Name || m.team1Name} vs {m.player2Name || m.team2Name}</span>
        <span style={{ color: m.status === 'completed' ? '#22c55e' : '#facc15' }}>
          {m.status === 'completed' ? '완료 →' : '진행중 →'}
        </span>
      </div>
      {m.sets && m.sets.length > 0 && (
        <div style={{ color: '#9ca3af', marginTop: '0.25rem' }}>
          {m.sets.map((s, i) => `세트${i + 1}: ${s.player1Score}-${s.player2Score}`).join(' | ')}
        </div>
      )}
    </button>
  );
}

// ===== History Tab =====
function HistoryTab({
  matches,
  navigate,
  tournamentId,
}: {
  matches: Match[];
  navigate: ReturnType<typeof useNavigate>;
  tournamentId: string;
}) {
  const completedMatches = useMemo(
    () =>
      matches
        .filter((m) => m.status === 'completed')
        .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)),
    [matches]
  );

  const groups = useMemo(() => {
    const map = new Map<string, Match[]>();
    completedMatches.forEach(m => {
      let key: string;
      if (m.groupId) {
        key = m.groupId;
      } else if (m.stageId?.includes('ranking') || m.roundLabel?.includes('결정전')) {
        key = '순위결정전';
      } else if (m.stageId?.includes('finals') || m.roundLabel) {
        key = '본선';
      } else {
        key = '기타';
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    });
    // Sort: groups first (alphabetical), then 본선, 순위결정전, 기타
    const order = ['본선', '순위결정전', '기타'];
    return Array.from(map.entries()).sort(([a], [b]) => {
      const aIdx = order.indexOf(a);
      const bIdx = order.indexOf(b);
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
      if (aIdx === -1) return -1;
      if (bIdx === -1) return 1;
      return aIdx - bIdx;
    });
  }, [completedMatches]);

  if (completedMatches.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>완료된 경기가 없습니다</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {groups.map(([groupId, groupMatches]) => (
        <div key={groupId}>
          {groupId === '본선' && (
            <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#4ade80', marginBottom: '0.5rem' }}>
              본선 경기 기록
            </h3>
          )}
          {groupId === '순위결정전' && (
            <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#c084fc', marginBottom: '0.5rem' }}>
              순위결정전 경기 기록
            </h3>
          )}
          {groupId !== '기타' && groupId !== '본선' && groupId !== '순위결정전' && (
            <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#facc15', marginBottom: '0.5rem' }}>
              {groupId}조 경기 기록
            </h3>
          )}
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {groupMatches.map((match) => {
              const isIndividual = match.type === 'individual';
              const setWins = isIndividual && match.sets ? countSetWins(match.sets) : null;
              const label = isIndividual
                ? `${match.player1Name} vs ${match.player2Name}`
                : `${match.team1Name} vs ${match.team2Name}`;

              return (
                <li key={match.id}>
                  <button
                    className="card"
                    onClick={() => navigate(`/spectator/match/${tournamentId}/${match.id}`)}
                    style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: '2px solid #14532d' }}
                    aria-label={`${label}, 완료`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <p style={{ fontWeight: 'bold', fontSize: '1.25rem' }}>{label}</p>
                        {isIndividual && setWins && (
                          <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                            세트 {setWins.player1} - {setWins.player2}
                          </p>
                        )}
                        {!isIndividual && match.sets && match.sets.length > 0 && (
                          <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                            {match.sets[0].player1Score} - {match.sets[0].player2Score}
                          </p>
                        )}
                      </div>
                      <span style={{ color: '#16a34a', fontWeight: 'bold' }}>완료 →</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
