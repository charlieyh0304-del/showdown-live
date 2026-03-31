import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMatches, useTournament, usePlayers } from '@shared/hooks/useFirebase';
import { countSetWins } from '@shared/utils/scoring';
import type { Match, TournamentStage } from '@shared/types';

export default function PlayerProfileView() {
  const { tournamentId: rawTournamentId, playerName } = useParams<{ tournamentId: string; playerName: string }>();
  const tournamentId = rawTournamentId && rawTournamentId !== 'undefined' ? rawTournamentId : null;
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { tournament, loading: tLoading } = useTournament(tournamentId);
  const { matches, loading: mLoading } = useMatches(tournamentId);
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

  useEffect(() => {
    document.title = decodedName ? t('spectator.playerProfile.pageTitle', { name: decodedName }) : t('spectator.playerProfile.defaultPageTitle');
  }, [decodedName, t]);


  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }} role="status" aria-live="polite">
        <p style={{ fontSize: '1.5rem' }}>{t('common.loading')}</p>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }} role="alert">
        <p style={{ fontSize: '1.5rem', color: '#ef4444' }}>{t('spectator.playerProfile.notFound')}</p>
        <button className="btn btn-primary" onClick={() => navigate('/spectator')} style={{ marginTop: '1rem' }}>
          {t('spectator.playerProfile.backToList')}
        </button>
      </div>
    );
  }

  function getOpponent(m: Match): string {
    const isP1 = m.player1Name === decodedName || m.team1Name === decodedName;
    if (m.type === 'team') {
      return isP1 ? (m.team2Name || t('referee.home.team2Default')) : (m.team1Name || t('referee.home.team1Default'));
    }
    return isP1 ? (m.player2Name || t('referee.home.player2Default')) : (m.player1Name || t('referee.home.player1Default'));
  }

  function getMatchResult(m: Match): string | null {
    if (m.status !== 'completed') return null;
    const isP1 = m.player1Name === decodedName || m.team1Name === decodedName;
    const myId = isP1 ? (m.player1Id || m.team1Id) : (m.player2Id || m.team2Id);
    return m.winnerId === myId ? t('spectator.playerProfile.win') : t('spectator.playerProfile.loss');
  }

  return (
    <div style={{ maxWidth: '40rem', margin: '0 auto', padding: '1rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <button
          className="btn"
          onClick={() => navigate(-1)}
          style={{ marginBottom: '0.5rem', fontSize: '0.875rem', padding: '0.25rem 0.75rem' }}
          aria-label={t('spectator.playerProfile.backButton')}
        >
          {t('spectator.playerProfile.backButton')}
        </button>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#facc15', textAlign: 'center' }}>{decodedName}</h1>
        {playerInfo && (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.25rem', justifyContent: 'center' }}>
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
              <span style={{ fontSize: '0.875rem', backgroundColor: '#1f2937', padding: '0.125rem 0.5rem', borderRadius: '0.25rem', color: '#d1d5db' }}>
                {playerInfo.gender === 'male' ? t('common.gender.maleLabel') : t('common.gender.femaleLabel')}
              </span>
            )}
          </div>
        )}
        <p style={{ color: '#d1d5db', marginTop: '0.25rem', textAlign: 'center' }}>{tournament.name}</p>
      </div>

      {/* Stats */}
      {completedMatches.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '0.75rem', textAlign: 'center' }}>{t('spectator.playerProfile.record')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', textAlign: 'center' }}>
            <div>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#22c55e' }}>{stats.wins}</p>
              <p style={{ fontSize: '0.75rem', color: '#d1d5db' }}>{t('spectator.playerProfile.wins')}</p>
            </div>
            <div>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ef4444' }}>{stats.losses}</p>
              <p style={{ fontSize: '0.75rem', color: '#d1d5db' }}>{t('spectator.playerProfile.losses')}</p>
            </div>
            <div>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#22d3ee' }}>{stats.setsWon}-{stats.setsLost}</p>
              <p style={{ fontSize: '0.75rem', color: '#d1d5db' }}>{t('spectator.playerProfile.setDiff')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Matches grouped by stage + status tabs */}
      <PlayerMatchesByStage
        playerMatches={playerMatches}
        stages={tournament.stages}
        decodedName={decodedName}
        tournamentId={tournamentId!}
        navigate={navigate}
        getOpponent={getOpponent}
        getMatchResult={getMatchResult}
      />
    </div>
  );
}

function PlayerMatchesByStage({
  playerMatches, stages, decodedName, tournamentId, navigate, getOpponent, getMatchResult,
}: {
  playerMatches: Match[];
  stages?: TournamentStage[];
  decodedName: string;
  tournamentId: string;
  navigate: ReturnType<typeof import('react-router-dom').useNavigate>;
  getOpponent: (m: Match) => string;
  getMatchResult: (m: Match) => string | null;
}) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_progress' | 'pending' | 'completed'>('all');

  const stageMap = useMemo(() => {
    const map = new Map<string, string>();
    if (stages) {
      const stageArr = Array.isArray(stages) ? stages : Object.values(stages) as TournamentStage[];
      stageArr.forEach(s => map.set(s.id, s.name));
    }
    return map;
  }, [stages]);

  const stageGroups = useMemo(() => {
    // Collect unique stage IDs in order
    const stageIds: string[] = [];
    const seen = new Set<string>();
    for (const m of playerMatches) {
      const sid = m.stageId || '__none__';
      if (!seen.has(sid)) { seen.add(sid); stageIds.push(sid); }
    }

    // Sort: use stage order if available, else keep original
    if (stages) {
      const stageArr = Array.isArray(stages) ? stages : Object.values(stages) as TournamentStage[];
      const orderMap = new Map(stageArr.map(s => [s.id, s.order ?? 0]));
      stageIds.sort((a, b) => (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999));
    }

    return stageIds.map(sid => ({
      stageId: sid,
      stageName: sid === '__none__' ? '' : (stageMap.get(sid) || sid),
      matches: playerMatches.filter(m => (m.stageId || '__none__') === sid),
    }));
  }, [playerMatches, stages, stageMap]);

  const hasStages = stageGroups.length > 1 || (stageGroups.length === 1 && stageGroups[0].stageId !== '__none__');

  const inProgressCount = playerMatches.filter(m => m.status === 'in_progress').length;
  const pendingCount = playerMatches.filter(m => m.status === 'pending' || (m.status as string) === 'scheduled').length;
  const completedCount = playerMatches.filter(m => m.status === 'completed').length;

  const filterMatch = (m: Match) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'in_progress') return m.status === 'in_progress';
    if (statusFilter === 'pending') return m.status === 'pending' || (m.status as string) === 'scheduled';
    return m.status === 'completed';
  };

  return (
    <div>
      {/* Status filter tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        {([
          { key: 'all' as const, label: `${t('common.all', '전체')} ${playerMatches.length}`, color: '#6b7280' },
          { key: 'in_progress' as const, label: `${t('common.matchStatus.inProgress')} ${inProgressCount}`, color: '#ef4444' },
          { key: 'pending' as const, label: `${t('common.matchStatus.pending')} ${pendingCount}`, color: '#eab308' },
          { key: 'completed' as const, label: `${t('common.matchStatus.completed')} ${completedCount}`, color: '#22c55e' },
        ]).map(tab => (
          <button
            key={tab.key}
            className="btn"
            style={{
              fontSize: '0.8rem', padding: '6px 12px',
              background: statusFilter === tab.key ? tab.color : '#1f2937',
              color: statusFilter === tab.key ? '#fff' : '#9ca3af',
              border: statusFilter === tab.key ? 'none' : '1px solid #374151',
              fontWeight: statusFilter === tab.key ? 'bold' : 'normal',
            }}
            onClick={() => setStatusFilter(statusFilter === tab.key ? 'all' : tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Stage groups */}
      {stageGroups.map(({ stageId, stageName, matches: stageMatches }) => {
        const filtered = stageMatches.filter(filterMatch);
        if (filtered.length === 0) return null;

        return (
          <div key={stageId} className="card" style={{ marginBottom: '1rem' }}>
            {hasStages && (
              <h2 style={{
                fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '0.75rem',
                color: '#60a5fa', borderBottom: '2px solid rgba(96,165,250,0.3)', paddingBottom: '0.5rem',
              }}>
                {stageName}
              </h2>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {filtered.map(m => {
                if (m.status === 'completed') {
                  return (
                    <CompletedMatchCard
                      key={m.id}
                      match={m}
                      decodedName={decodedName}
                      opponent={getOpponent(m)}
                      result={getMatchResult(m)}
                      navigate={navigate}
                      tournamentId={tournamentId}
                    />
                  );
                }
                return (
                  <ScheduleMatchCard
                    key={m.id}
                    match={m}
                    opponent={getOpponent(m)}
                    navigate={navigate}
                    tournamentId={tournamentId}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {playerMatches.filter(filterMatch).length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <p style={{ color: '#6b7280' }}>{t('common.noResults', '해당 경기가 없습니다')}</p>
        </div>
      )}
    </div>
  );
}

function CompletedMatchCard({
  match: m, decodedName, opponent, result, navigate, tournamentId,
}: {
  match: Match; decodedName: string; opponent: string; result: string | null;
  navigate: ReturnType<typeof import('react-router-dom').useNavigate>; tournamentId: string;
}) {
  const { t } = useTranslation();
  const isP1 = m.player1Name === decodedName || m.team1Name === decodedName;
  const setWins = Array.isArray(m.sets) && m.sets.length > 0 ? countSetWins(m.sets) : { player1: 0, player2: 0 };
  const mySetWins = isP1 ? setWins.player1 : setWins.player2;
  const oppSetWins = isP1 ? setWins.player2 : setWins.player1;

  return (
    <button
      onClick={() => navigate(`/spectator/match/${tournamentId}/${m.id}`)}
      style={{
        backgroundColor: '#1f2937', borderRadius: '0.5rem', padding: '0.75rem',
        fontSize: '0.875rem', width: '100%', textAlign: 'left',
        cursor: 'pointer', border: 'none', color: 'inherit', display: 'block',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 'bold' }}>vs {opponent}</span>
          {m.roundLabel && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#d1d5db' }}>{m.roundLabel}</span>}
          {m.groupId && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#60a5fa' }}>{m.groupId}{t('common.units.group')}</span>}
        </div>
        <span style={{ fontWeight: 'bold', color: result === t('spectator.playerProfile.win') ? '#22c55e' : '#ef4444' }}>
          {result} ({mySetWins}-{oppSetWins})
        </span>
      </div>
      <div style={{ marginTop: '0.25rem', color: '#9ca3af', fontSize: '0.75rem' }}>
        {[m.scheduledDate, m.scheduledTime, m.courtName].filter(Boolean).join(' · ')}
      </div>
      {Array.isArray(m.sets) && m.sets.length > 0 && (
        <div style={{ color: '#d1d5db', marginTop: '0.25rem', fontSize: '0.75rem' }}>
          {m.sets.map(s => {
            const myScore = isP1 ? s.player1Score : s.player2Score;
            const oppScore = isP1 ? s.player2Score : s.player1Score;
            return `${myScore}-${oppScore}`;
          }).join(' / ')}
        </div>
      )}
    </button>
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
  const { t } = useTranslation();
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
        <span style={{ fontWeight: 'bold' }}>vs {opponent}</span>
        <span style={{
          fontWeight: 'bold',
          fontSize: '0.75rem',
          padding: '0.125rem 0.5rem',
          borderRadius: '0.25rem',
          backgroundColor: m.status === 'in_progress' ? '#7f1d1d' : '#422006',
          color: m.status === 'in_progress' ? '#fca5a5' : '#fde68a',
        }}>
          {m.status === 'in_progress' ? t('common.matchStatus.inProgress') : t('common.matchStatus.pending')}
        </span>
      </div>
      <div style={{ marginTop: '0.25rem', color: '#9ca3af', fontSize: '0.75rem' }}>
        {[m.scheduledDate, m.scheduledTime, m.courtName].filter(Boolean).join(' · ')}
        {m.roundLabel && ` · ${m.roundLabel}`}
      </div>
    </button>
  );
}
