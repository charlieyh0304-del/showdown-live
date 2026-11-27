import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMatches, useTournament, useTournamentLocalPlayers } from '@shared/hooks/useFirebase';
import { countSetWins, getEffectiveScoringRules } from '@shared/utils/scoring';
import { normalizeResult, resultContextFor } from '@shared/rules/standings';
import { walkoverKind } from '@shared/rules/walkover';
import type { Match, Tournament, TournamentStage } from '@shared/types';

export default function PlayerProfileView() {
  const { tournamentId: rawTournamentId, playerName } = useParams<{ tournamentId: string; playerName: string }>();
  const tournamentId = rawTournamentId && rawTournamentId !== 'undefined' ? rawTournamentId : null;
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { tournament, loading: tLoading } = useTournament(tournamentId);
  const { matches, loading: mLoading } = useMatches(tournamentId);
  const { players, loading: pLoading } = useTournamentLocalPlayers(tournamentId);

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

  // 전적/통계는 대회 규칙을 따른다: 부전승(기권승·BYE)은 기본으로 기록된 점수(11:0)대로 일반 승리처럼 센다
  // (walkover.countInPlayerStats / byeCountsAsWalkover로 끌 수 있다). 양쪽 다 빈 BYE는 경기 없음.
  const statsCtx = useMemo(() => resultContextFor(tournament, 'stats'), [tournament]);
  const counted = useMemo(() => {
    return playerMatches
      .map(m => ({ m, r: normalizeResult(m, statsCtx) }))
      .filter((x): x is { m: Match; r: NonNullable<ReturnType<typeof normalizeResult>> } => x.r !== null)
      .sort((a, b) => (b.m.updatedAt || b.m.createdAt) - (a.m.updatedAt || a.m.createdAt));
  }, [playerMatches, statsCtx]);
  const completedMatches = useMemo(() => counted.map(x => x.m), [counted]);

  const stats = useMemo(() => {
    let wins = 0, losses = 0;
    let setsWon = 0, setsLost = 0;
    let pointsFor = 0, pointsAgainst = 0;

    counted.forEach(({ m, r }) => {
      const isP1 = m.player1Name === decodedName || m.team1Name === decodedName;
      const myId = isP1 ? r.a : r.b;
      if (r.winner && r.winner === myId) wins++;
      else if (r.winner) losses++;
      setsWon += isP1 ? r.setsA : r.setsB;
      setsLost += isP1 ? r.setsB : r.setsA;
      pointsFor += isP1 ? r.ptsA : r.ptsB;
      pointsAgainst += isP1 ? r.ptsB : r.ptsA;
    });

    return { wins, losses, setsWon, setsLost, pointsFor, pointsAgainst };
  }, [counted, decodedName]);

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
        tournament={tournament}
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
  playerMatches, stages, tournament, decodedName, tournamentId, navigate, getOpponent, getMatchResult,
}: {
  playerMatches: Match[];
  stages?: TournamentStage[];
  tournament: Tournament;
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
          { key: 'all' as const, label: `${t('common.all')} ${playerMatches.length}`, color: '#6b7280' },
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
                      tournament={tournament}
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
          <p style={{ color: '#6b7280' }}>{t('common.noResults')}</p>
        </div>
      )}
    </div>
  );
}

function CompletedMatchCard({
  match: m, tournament, decodedName, opponent, result, navigate, tournamentId,
}: {
  match: Match; tournament: Tournament | null; decodedName: string; opponent: string; result: string | null;
  navigate: ReturnType<typeof import('react-router-dom').useNavigate>; tournamentId: string;
}) {
  const { t } = useTranslation();
  const isP1 = m.player1Name === decodedName || m.team1Name === decodedName;
  // 세트 승수는 그 경기의 유효 규칙(팀 31점 등)으로 센다
  const setWins = Array.isArray(m.sets) && m.sets.length > 0 ? countSetWins(m.sets, getEffectiveScoringRules(m, tournament)) : { player1: 0, player2: 0 };
  const wo = walkoverKind(m);
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
          {wo && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#fb923c' }}>{wo === 'bye' ? t('common.competitionRules.byeBadge') : t('admin.tournamentDetail.bracketTab.walkoverBadge')}</span>}
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
