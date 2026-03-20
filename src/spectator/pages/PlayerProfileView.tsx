import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMatches, useTournament, usePlayers } from '@shared/hooks/useFirebase';
import { countSetWins } from '@shared/utils/scoring';
import type { Match } from '@shared/types';

export default function PlayerProfileView() {
  const { tournamentId, playerName } = useParams<{ tournamentId: string; playerName: string }>();
  const navigate = useNavigate();
  const { tournament, loading: tLoading } = useTournament(tournamentId || null);
  const { matches, loading: mLoading } = useMatches(tournamentId || null);
  const { players, loading: pLoading } = usePlayers();

  const decodedName = decodeURIComponent(playerName || '');

  const playerInfo = useMemo(() => {
    return players.find(p => p.name === decodedName) || null;
  }, [players, decodedName]);

  const playerMatches = useMemo(() => {
    return matches.filter(m =>
      m.player1Name === decodedName || m.player2Name === decodedName ||
      m.team1Name === decodedName || m.team2Name === decodedName
    );
  }, [matches, decodedName]);

  const upcomingMatches = useMemo(() => {
    return playerMatches
      .filter(m => m.status === 'pending' || m.status === 'in_progress')
      .sort((a, b) => {
        const dateA = a.scheduledDate || '';
        const dateB = b.scheduledDate || '';
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        const timeA = a.scheduledTime || '';
        const timeB = b.scheduledTime || '';
        return timeA.localeCompare(timeB);
      });
  }, [playerMatches]);

  const completedMatches = useMemo(() => {
    return playerMatches
      .filter(m => m.status === 'completed')
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  }, [playerMatches]);

  const stats = useMemo(() => {
    let wins = 0, losses = 0;
    let setsWon = 0, setsLost = 0;
    let pointsFor = 0, pointsAgainst = 0;

    completedMatches.forEach(m => {
      const isP1 = m.player1Name === decodedName || m.team1Name === decodedName;
      const myId = isP1 ? (m.player1Id || m.team1Id) : (m.player2Id || m.team2Id);
      if (m.winnerId === myId) wins++;
      else losses++;

      (Array.isArray(m.sets) ? m.sets : []).forEach(s => {
        const myScore = isP1 ? s.player1Score : s.player2Score;
        const oppScore = isP1 ? s.player2Score : s.player1Score;
        pointsFor += myScore;
        pointsAgainst += oppScore;
        if (myScore > oppScore) setsWon++;
        else if (oppScore > myScore) setsLost++;
      });
    });

    return { wins, losses, setsWon, setsLost, pointsFor, pointsAgainst };
  }, [completedMatches, decodedName]);

  const loading = tLoading || mLoading || pLoading;

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

  function getOpponent(m: Match): string {
    const isP1 = m.player1Name === decodedName || m.team1Name === decodedName;
    if (m.type === 'team') {
      return isP1 ? (m.team2Name || '팀2') : (m.team1Name || '팀1');
    }
    return isP1 ? (m.player2Name || '선수2') : (m.player1Name || '선수1');
  }

  function getMatchResult(m: Match): string | null {
    if (m.status !== 'completed') return null;
    const isP1 = m.player1Name === decodedName || m.team1Name === decodedName;
    const myId = isP1 ? (m.player1Id || m.team1Id) : (m.player2Id || m.team2Id);
    return m.winnerId === myId ? '승' : '패';
  }

  // Group upcoming by date
  const upcomingDateGroups = useMemo(() => {
    const dates = [...new Set(upcomingMatches.map(m => m.scheduledDate || ''))].sort();
    return dates.map(date => ({
      date,
      matches: upcomingMatches.filter(m => (m.scheduledDate || '') === date),
    }));
  }, [upcomingMatches]);

  const hasMultipleUpcomingDates = upcomingDateGroups.length > 1 || (upcomingDateGroups.length === 1 && upcomingDateGroups[0].date !== '');

  return (
    <div style={{ maxWidth: '40rem', margin: '0 auto', padding: '1rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <button
          className="btn"
          onClick={() => navigate(-1)}
          style={{ marginBottom: '0.5rem', fontSize: '0.875rem', padding: '0.25rem 0.75rem' }}
          aria-label="뒤로가기"
        >
          뒤로
        </button>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#facc15' }}>{decodedName}</h1>
        {playerInfo && (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
            {playerInfo.club && (
              <span style={{ fontSize: '0.875rem', backgroundColor: '#1f2937', padding: '0.125rem 0.5rem', borderRadius: '0.25rem', color: '#60a5fa' }}>
                {playerInfo.club}
              </span>
            )}
            {playerInfo.class && (
              <span style={{ fontSize: '0.875rem', backgroundColor: '#1f2937', padding: '0.125rem 0.5rem', borderRadius: '0.25rem', color: '#c084fc' }}>
                {playerInfo.class}
              </span>
            )}
            {playerInfo.gender && (
              <span style={{ fontSize: '0.875rem', backgroundColor: '#1f2937', padding: '0.125rem 0.5rem', borderRadius: '0.25rem', color: '#9ca3af' }}>
                {playerInfo.gender === 'male' ? '남성' : '여성'}
              </span>
            )}
          </div>
        )}
        <p style={{ color: '#9ca3af', marginTop: '0.25rem' }}>{tournament.name}</p>
      </div>

      {/* Stats */}
      {completedMatches.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '0.75rem' }}>전적</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', textAlign: 'center' }}>
            <div>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#22c55e' }}>{stats.wins}</p>
              <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>승</p>
            </div>
            <div>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ef4444' }}>{stats.losses}</p>
              <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>패</p>
            </div>
            <div>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#22d3ee' }}>{stats.setsWon}-{stats.setsLost}</p>
              <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>세트 득실</p>
            </div>
          </div>
        </div>
      )}

      {/* Upcoming matches */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#facc15', marginBottom: '0.75rem' }}>
          예정된 경기 ({upcomingMatches.length})
        </h2>
        {upcomingMatches.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>예정된 경기가 없습니다</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {hasMultipleUpcomingDates ? (
              upcomingDateGroups.map(({ date, matches: dateMatches }) => (
                <div key={date || 'no-date'}>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#60a5fa', marginBottom: '0.25rem', marginTop: '0.5rem' }}>
                    {date || '날짜 미지정'}
                  </h3>
                  {dateMatches.map(m => (
                    <ScheduleMatchCard
                      key={m.id}
                      match={m}
                      opponent={getOpponent(m)}
                      navigate={navigate}
                      tournamentId={tournamentId!}
                    />
                  ))}
                </div>
              ))
            ) : (
              upcomingMatches.map(m => (
                <ScheduleMatchCard
                  key={m.id}
                  match={m}
                  opponent={getOpponent(m)}
                  navigate={navigate}
                  tournamentId={tournamentId!}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Completed matches */}
      <div className="card">
        <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#22c55e', marginBottom: '0.75rem' }}>
          완료된 경기 ({completedMatches.length})
        </h2>
        {completedMatches.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>완료된 경기가 없습니다</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {completedMatches.map(m => {
              const result = getMatchResult(m);
              const opponent = getOpponent(m);
              const isP1 = m.player1Name === decodedName || m.team1Name === decodedName;
              const setWins = Array.isArray(m.sets) && m.sets.length > 0 ? countSetWins(m.sets) : { player1: 0, player2: 0 };
              const mySetWins = isP1 ? setWins.player1 : setWins.player2;
              const oppSetWins = isP1 ? setWins.player2 : setWins.player1;

              return (
                <button
                  key={m.id}
                  onClick={() => navigate(`/spectator/match/${tournamentId}/${m.id}`)}
                  style={{
                    backgroundColor: '#1f2937',
                    borderRadius: '0.5rem',
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: 'none',
                    color: 'inherit',
                    display: 'block',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 'bold' }}>vs {opponent}</span>
                      {m.roundLabel && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>{m.roundLabel}</span>
                      )}
                      {m.groupId && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#60a5fa' }}>{m.groupId}조</span>
                      )}
                    </div>
                    <span style={{
                      fontWeight: 'bold',
                      color: result === '승' ? '#22c55e' : '#ef4444',
                    }}>
                      {result} ({mySetWins}-{oppSetWins})
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem', color: '#9ca3af', fontSize: '0.75rem' }}>
                    {m.scheduledDate && <span>{m.scheduledDate}</span>}
                    {m.scheduledTime && <span>{m.scheduledTime}</span>}
                    {m.courtName && <span>{m.courtName}</span>}
                  </div>
                  {Array.isArray(m.sets) && m.sets.length > 0 && (
                    <div style={{ color: '#6b7280', marginTop: '0.25rem', fontSize: '0.75rem' }}>
                      {m.sets.map((s) => `${s.player1Score}-${s.player2Score}`).join(' / ')}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleMatchCard({
  match: m,
  opponent,
  navigate,
  tournamentId,
}: {
  match: Match;
  opponent: string;
  navigate: ReturnType<typeof import('react-router-dom').useNavigate>;
  tournamentId: string;
}) {
  return (
    <button
      onClick={() => navigate(`/spectator/match/${tournamentId}/${m.id}`)}
      style={{
        backgroundColor: m.status === 'in_progress' ? '#1e3a5f' : '#1f2937',
        borderRadius: '0.5rem',
        padding: '0.75rem',
        fontSize: '0.875rem',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        border: m.status === 'in_progress' ? '1px solid #3b82f6' : 'none',
        color: 'inherit',
        display: 'block',
        marginBottom: '0.25rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 'bold' }}>vs {opponent}</span>
          {m.roundLabel && (
            <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>{m.roundLabel}</span>
          )}
          {m.groupId && (
            <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#60a5fa' }}>{m.groupId}조</span>
          )}
        </div>
        <span style={{
          fontWeight: 'bold',
          fontSize: '0.75rem',
          color: m.status === 'in_progress' ? '#ef4444' : '#facc15',
        }}>
          {m.status === 'in_progress' ? '진행중' : '대기'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem', color: '#9ca3af', fontSize: '0.75rem' }}>
        {m.scheduledDate && <span>{m.scheduledDate}</span>}
        {m.scheduledTime && <span>{m.scheduledTime}</span>}
        {m.courtName && <span>{m.courtName}</span>}
      </div>
    </button>
  );
}
