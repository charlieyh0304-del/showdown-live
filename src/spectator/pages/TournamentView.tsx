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
          <LiveTab matches={matches} isFavorite={isFavorite} toggleFavorite={toggleFavorite} navigate={navigate} tournamentId={id!} />
        )}
        {activeTab === 'bracket' && (
          <BracketTab matches={matches} tournamentType={tournament.type} />
        )}
        {activeTab === 'ranking' && (
          <RankingTab matches={matches} tournamentType={tournament.type} isFavorite={isFavorite} />
        )}
        {activeTab === 'history' && (
          <HistoryTab matches={matches} navigate={navigate} tournamentId={id!} />
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
function BracketTab({ matches, tournamentType }: { matches: Match[]; tournamentType: string }) {
  const isTeam = tournamentType === 'team' || tournamentType === 'randomTeamLeague';

  if (matches.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>대진표 정보가 없습니다</p>
      </div>
    );
  }

  if (isTeam) {
    return <TeamBracket matches={matches} />;
  }

  return <IndividualBracket matches={matches} />;
}

function IndividualBracket({ matches }: { matches: Match[] }) {
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
                {p.name}
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
                {rowPlayer.name}
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

function TeamBracket({ matches }: { matches: Match[] }) {
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
                {match.team1Name || '팀1'}
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
                {match.team2Name || '팀2'}
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
}: {
  matches: Match[];
  tournamentType: string;
  isFavorite: (id: string) => boolean;
}) {
  const isTeam = tournamentType === 'team' || tournamentType === 'randomTeamLeague';

  if (isTeam) {
    return <TeamRankingTable matches={matches} />;
  }

  return <IndividualRankingTable matches={matches} isFavorite={isFavorite} />;
}

function IndividualRankingTable({
  matches,
  isFavorite,
}: {
  matches: Match[];
  isFavorite: (id: string) => boolean;
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
                {r.playerName}
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

function TeamRankingTable({ matches }: { matches: Match[] }) {
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
              <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 'bold' }}>{r.teamName}</td>
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

  if (completedMatches.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>완료된 경기가 없습니다</p>
      </div>
    );
  }

  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {completedMatches.map((match) => {
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
  );
}
