import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTournament, useMatches, useFavorites, useSchedule, useReferees, useTournamentReferees } from '@shared/hooks/useFirebase';
import { parseTimeDisplay } from '@shared/utils/locale';
import { requestNotificationPermission } from '@shared/utils/notifications';
import { useMatchNotifications } from '../hooks/useMatchNotifications';
import type { Match } from '@shared/types';
import LiveTab from '../components/tournament/LiveTab';
import BracketTab from '../components/tournament/BracketTab';
import GroupsTab from '../components/tournament/GroupsTab';
import RankingTab from '../components/tournament/RankingTab';
import PlayersTab from '../components/tournament/PlayersTab';
import HistoryTab from '../components/tournament/HistoryTab';
import RefereesTab from '../components/tournament/RefereesTab';

/** URL-based tab: mapped from the route path segment after tournament/:id */
type ViewTab = 'overview' | 'players' | 'standings' | 'schedule' | 'referees';

export default function TournamentView({ viewTab = 'overview' }: { viewTab?: ViewTab }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { tournament, loading: tLoading } = useTournament(id || null);
  const { matches, loading: mLoading } = useMatches(id || null);
  const { favoriteIds, isFavorite, toggleFavorite } = useFavorites();
  const { schedule } = useSchedule(id || null);

  const getTournamentTypeLabel = (type: string) => t(`common.tournamentType.${type}`);
  const { referees } = useReferees();
  const { assignments } = useTournamentReferees(id || null);

  useMatchNotifications(favoriteIds, matches, schedule);

  const handleToggleFavorite = useCallback((playerId: string, playerName?: string) => {
    const newFavs = toggleFavorite(playerId, playerName);
    if (newFavs.includes(playerId)) {
      requestNotificationPermission();
    }
  }, [toggleFavorite]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const playerPanelRef = useRef<HTMLDivElement>(null);
  const playerTriggerRef = useRef<HTMLElement | null>(null);
  const [stageFilter, setStageFilter] = useState<'all' | 'qualifying' | 'finals' | 'ranking'>('all');
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  // Set document title for screen readers
  useEffect(() => {
    if (tournament) {
      document.title = t('spectator.tournament.pageTitle', { name: tournament.name });
    } else {
      document.title = t('spectator.tournament.defaultPageTitle');
    }
  }, [tournament, t]);

  useEffect(() => {
    if (selectedPlayer && playerPanelRef.current) {
      playerPanelRef.current.focus();
    }
    if (!selectedPlayer && playerTriggerRef.current) {
      playerTriggerRef.current.focus();
      playerTriggerRef.current = null;
    }
  }, [selectedPlayer]);

  const handleSelectPlayer = useCallback((player: string | null) => {
    if (player) {
      playerTriggerRef.current = document.activeElement as HTMLElement;
    }
    setSelectedPlayer(player);
  }, []);

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

  // 개인전 풀리그: 리그전만 진행 (예선/본선 구분 없음)
  const isFullLeagueOnly = useMemo(() => {
    if (!tournament) return false;
    // formatType이 round_robin이면 풀리그
    if (tournament.formatType === 'round_robin') return true;
    // stages에 finals가 없으면 풀리그
    const hasFinalsStage = tournament.stages?.some(s => (s as { type?: string }).type === 'finals');
    if (!hasFinalsStage && !tournament.finalsConfig) {
      // 실제 본선 경기가 없으면 풀리그
      const hasFinalsMatches = stageMap.finals.length > 0;
      if (!hasFinalsMatches) return true;
    }
    return false;
  }, [tournament, stageMap]);

  const hasGroupStage = useMemo(() => {
    if (isFullLeagueOnly) return false; // 풀리그는 조 없음
    if (tournament?.formatType === 'group_knockout') return true;
    if (tournament?.qualifyingConfig) return true;
    if (tournament?.stages?.some(s => s.type === 'qualifying' || s.format === 'group_knockout' || s.format === 'round_robin')) return true;
    return matches.some(m => m.groupId);
  }, [tournament, matches, isFullLeagueOnly]);

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

      (Array.isArray(m.sets) ? m.sets : []).forEach(s => {
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
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }} role="status" aria-live="polite">
        <p style={{ fontSize: '1.5rem' }}>{t('common.loading')}</p>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }} role="alert">
        <p style={{ fontSize: '1.5rem', color: '#ef4444' }}>{t('spectator.tournament.notFound')}</p>
        <button className="btn btn-primary" onClick={() => navigate('/spectator')} style={{ marginTop: '1rem' }}>
          {t('spectator.tournament.backToList')}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Tournament header */}
      <div style={{ marginBottom: '1rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>
          {tournament.name}
        </h1>
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
          placeholder={t('spectator.tournament.searchPlaceholder')}
          aria-label={t('spectator.tournament.searchAriaLabel')}
        />
      </div>

      {searchResults && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#facc15', marginBottom: '0.5rem', textAlign: 'center' }}>
            {t('spectator.tournament.searchResults', { count: searchResults.length })}
          </h2>
          {searchResults.map(match => {
            const isIndividual = match.type === 'individual';
            const label = isIndividual
              ? `${match.player1Name || t('referee.home.player1Default')} vs ${match.player2Name || t('referee.home.player2Default')}`
              : `${match.team1Name || t('referee.home.team1Default')} vs ${match.team2Name || t('referee.home.team2Default')}`;
            return (
              <button
                key={match.id}
                className="card"
                onClick={() => navigate(`/spectator/match/${id}/${match.id}`)}
                style={{ marginBottom: '0.5rem', padding: '0.75rem', width: '100%', textAlign: 'left', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 'bold' }}>{label}</span>
                  <span style={{ color: match.status === 'completed' ? '#22c55e' : match.status === 'in_progress' ? '#ef4444' : '#d1d5db', fontWeight: 'bold', fontSize: '0.875rem' }}>
                    {match.status === 'completed' ? `\u2713 ${t('common.matchStatus.completed')} \u2192` : match.status === 'in_progress' ? `\u25B6 ${t('common.matchStatus.inProgress')} \u2192` : `\u23F3 ${t('common.matchStatus.pending')}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Player record panel */}
      {selectedPlayer && (
        <div
          ref={playerPanelRef}
          tabIndex={-1}
          role="dialog"
          aria-label={t('spectator.tournament.playerRecord.title', { player: selectedPlayer })}
          aria-modal="true"
          className="card"
          style={{ marginBottom: '1.5rem', border: '2px solid #facc15', outline: 'none' }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleSelectPlayer(null);
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#facc15' }}>{t('spectator.tournament.playerRecord.title', { player: selectedPlayer })}</h2>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {(() => {
                const pId = matches.find(m => m.player1Name === selectedPlayer)?.player1Id
                  || matches.find(m => m.player2Name === selectedPlayer)?.player2Id
                  || matches.find(m => m.team1Name === selectedPlayer)?.team1Id
                  || matches.find(m => m.team2Name === selectedPlayer)?.team2Id
                  || selectedPlayer;
                return (
                  <button
                    onClick={() => handleToggleFavorite(pId, selectedPlayer)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    aria-label={isFavorite(pId) ? t('spectator.favorites.removeFavorite', { name: selectedPlayer }) : t('spectator.favorites.addFavorite', { name: selectedPlayer })}
                    aria-pressed={isFavorite(pId)}
                  >
                    {isFavorite(pId) ? '★' : '☆'}
                  </button>
                );
              })()}
              <button
                className="btn btn-primary"
                style={{ fontSize: '0.875rem', padding: '0.25rem 0.75rem' }}
                onClick={() => navigate(`/spectator/player/${id}/${encodeURIComponent(selectedPlayer)}`)}
              >
                {t('common.profile')}
              </button>
              <button className="btn" style={{ fontSize: '0.875rem', padding: '0.25rem 0.75rem' }} onClick={() => handleSelectPlayer(null)}>{t('common.close')}</button>
            </div>
          </div>
          {playerStats && (() => {
            const completedCount = playerStats.wins + playerStats.losses;
            const winRate = completedCount > 0 ? Math.round((playerStats.wins / completedCount) * 100) : 0;
            const isTeamTournament = tournament.type === 'team' || tournament.type === 'randomTeamLeague';
            return (
              <dl style={{ margin: '0 0 1rem 0', fontSize: '0.9375rem' }}>
                {(() => {
                  const setDiff = playerStats.setsWon - playerStats.setsLost;
                  const goalDiff = playerStats.pointsFor - playerStats.pointsAgainst;
                  const rowStyle = { display: 'flex', justifyContent: 'space-between', padding: '0.375rem 0', borderBottom: '1px solid #374151' } as const;
                  return (<>
                    <div style={rowStyle}>
                      <dt style={{ color: '#d1d5db' }}>{t('spectator.tournament.playerRecord.record')}</dt>
                      <dd style={{ margin: 0 }}><span style={{ color: '#22c55e', fontWeight: 'bold' }}>{t('spectator.tournament.playerRecord.wins', { count: playerStats.wins })}</span>{' '}<span style={{ color: '#ef4444', fontWeight: 'bold' }}>{t('spectator.tournament.playerRecord.losses', { count: playerStats.losses })}</span>{' '}<span style={{ color: '#9ca3af' }}>{t('spectator.tournament.playerRecord.matchCount', { count: completedCount })}</span></dd>
                    </div>
                    <div style={rowStyle}>
                      <dt style={{ color: '#d1d5db' }}>{t('spectator.tournament.playerRecord.winRate')}</dt>
                      <dd style={{ margin: 0, fontWeight: 'bold', color: winRate >= 50 ? '#22c55e' : '#ef4444' }}>{winRate}%</dd>
                    </div>
                    {!isTeamTournament && (
                      <div style={rowStyle}>
                        <dt style={{ color: '#d1d5db' }}>{t('spectator.tournament.playerRecord.setDiff')}</dt>
                        <dd style={{ margin: 0, fontWeight: 'bold', color: setDiff > 0 ? '#22c55e' : setDiff < 0 ? '#ef4444' : '#9ca3af' }}>{setDiff > 0 ? '+' : ''}{setDiff}</dd>
                      </div>
                    )}
                    <div style={{ ...rowStyle, borderBottom: 'none' }}>
                      <dt style={{ color: '#d1d5db' }}>{t('spectator.tournament.playerRecord.goalDiff')}</dt>
                      <dd style={{ margin: 0, fontWeight: 'bold', color: goalDiff > 0 ? '#22c55e' : goalDiff < 0 ? '#ef4444' : '#9ca3af' }}>{goalDiff > 0 ? '+' : ''}{goalDiff} ({t('spectator.tournament.playerRecord.scored', { 'for': playerStats.pointsFor })} {t('spectator.tournament.playerRecord.conceded', { against: playerStats.pointsAgainst })})</dd>
                    </div>
                  </>);
                })()}
              </dl>
            );
          })()}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '20rem', overflowY: 'auto' }}>
            {isFullLeagueOnly ? (
              /* 풀리그: 리그 경기 전체 표시 */
              <div>
                {playerMatches.map(m => (
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} selectedPlayer={selectedPlayer!} expandedMatchId={expandedMatchId} onToggleExpand={setExpandedMatchId} />
                ))}
              </div>
            ) : (<>
            {/* 예선 경기 */}
            {playerMatches.filter(m => m.groupId).length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#60a5fa', marginBottom: '0.25rem', marginTop: '0.25rem' }}>{t('spectator.tournament.playerRecord.qualifyingStage')}</h4>
                {playerMatches.filter(m => m.groupId).map(m => (
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} selectedPlayer={selectedPlayer!} expandedMatchId={expandedMatchId} onToggleExpand={setExpandedMatchId} />
                ))}
              </div>
            )}
            {/* 본선 경기 */}
            {playerMatches.filter(m => !m.groupId && m.stageId?.includes('finals')).length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#4ade80', marginBottom: '0.25rem', marginTop: '0.25rem' }}>{t('spectator.tournament.playerRecord.finalsStage')}</h4>
                {playerMatches.filter(m => !m.groupId && m.stageId?.includes('finals')).map(m => (
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} selectedPlayer={selectedPlayer!} expandedMatchId={expandedMatchId} onToggleExpand={setExpandedMatchId} />
                ))}
              </div>
            )}
            {/* 순위결정전 */}
            {playerMatches.filter(m => m.stageId?.includes('ranking')).length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#c084fc', marginBottom: '0.25rem', marginTop: '0.25rem' }}>{t('spectator.tournament.playerRecord.rankingStage')}</h4>
                {playerMatches.filter(m => m.stageId?.includes('ranking')).map(m => (
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} selectedPlayer={selectedPlayer!} expandedMatchId={expandedMatchId} onToggleExpand={setExpandedMatchId} />
                ))}
              </div>
            )}
            {/* 기타 (분류되지 않은 경기) */}
            {playerMatches.filter(m => !m.groupId && !m.stageId?.includes('finals') && !m.stageId?.includes('ranking')).length > 0 && (
              <div>
                {(playerMatches.some(m => m.groupId) || playerMatches.some(m => m.stageId?.includes('finals'))) && (
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#d1d5db', marginBottom: '0.25rem', marginTop: '0.25rem' }}>{t('spectator.tournament.playerRecord.otherStage')}</h4>
                )}
                {playerMatches.filter(m => !m.groupId && !m.stageId?.includes('finals') && !m.stageId?.includes('ranking')).map(m => (
                  <PlayerMatchRow key={m.id} match={m} navigate={navigate} tournamentId={id!} selectedPlayer={selectedPlayer!} expandedMatchId={expandedMatchId} onToggleExpand={setExpandedMatchId} />
                ))}
              </div>
            )}
            </>)}
          </div>
        </div>
      )}

      {/* Stage filter - shown on standings and schedule views */}
      {(viewTab === 'standings' || viewTab === 'schedule') && !isFullLeagueOnly && (stageMap.qualifying.length > 0 || stageMap.finals.length > 0 || stageMap.ranking.length > 0) && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', overflowX: 'auto', justifyContent: 'center' }} role="group" aria-label={t('spectator.tournament.stageFilter.label')}>
          {([
            { key: 'all' as const, label: t('spectator.tournament.stageFilter.all'), count: matches.length },
            { key: 'qualifying' as const, label: t('spectator.tournament.stageFilter.qualifying'), count: stageMap.qualifying.length },
            { key: 'finals' as const, label: t('spectator.tournament.stageFilter.finals'), count: stageMap.finals.length },
            { key: 'ranking' as const, label: t('spectator.tournament.stageFilter.ranking'), count: stageMap.ranking.length },
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
              aria-pressed={stageFilter === s.key}
            >
              {s.label} ({s.count})
            </button>
          ))}
        </div>
      )}

      {/* View content based on bottom nav tab */}
      <div role="region" aria-label={t(`spectator.layout.tournamentTab.${viewTab}`)}>
        {viewTab === 'overview' && (
          <LiveTab matches={matches} isFavorite={isFavorite} toggleFavorite={handleToggleFavorite} navigate={navigate} tournamentId={id!} />
        )}
        {viewTab === 'players' && (
          <PlayersTab matches={matches} onSelectPlayer={handleSelectPlayer} isTeam={tournament.type === 'team' || tournament.type === 'randomTeamLeague'} isFavorite={isFavorite} toggleFavorite={handleToggleFavorite} tournamentId={id!} navigate={navigate} />
        )}
        {viewTab === 'standings' && (
          <>
            <RankingTab matches={matches} tournamentType={tournament.type} isFavorite={isFavorite} onSelectPlayer={handleSelectPlayer} stageFilter={stageFilter} tournament={tournament} />
            {hasGroupStage && (
              <div style={{ marginTop: '1.5rem' }}>
                <GroupsTab matches={matches} onSelectPlayer={handleSelectPlayer} isTeam={tournament.type === 'team' || tournament.type === 'randomTeamLeague'} isFullLeague={isFullLeagueOnly} />
              </div>
            )}
            <div style={{ marginTop: '1.5rem' }}>
              <BracketTab matches={filteredMatches} tournamentType={tournament.type} onSelectPlayer={handleSelectPlayer} />
            </div>
          </>
        )}
        {viewTab === 'schedule' && (
          <HistoryTab matches={filteredMatches} navigate={navigate} tournamentId={id!} />
        )}
        {viewTab === 'referees' && (
          <RefereesTab referees={referees} assignments={assignments} matches={matches} />
        )}
      </div>
    </div>
  );
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
  const { t } = useTranslation();
  const isP1 = m.player1Name === selectedPlayer || m.team1Name === selectedPlayer;
  const opponentName = isP1
    ? (m.player2Name || m.team2Name || t('common.unknown'))
    : (m.player1Name || m.team1Name || t('common.unknown'));
  const myId = isP1 ? (m.player1Id || m.team1Id) : (m.player2Id || m.team2Id);
  const isWin = m.status === 'completed' && m.winnerId === myId;
  const isCompleted = m.status === 'completed';
  const isExpanded = expandedMatchId === m.id;

  // Per-match point totals
  let matchPointsFor = 0;
  let matchPointsAgainst = 0;
  if (Array.isArray(m.sets)) {
    m.sets.forEach(s => {
      matchPointsFor += isP1 ? s.player1Score : s.player2Score;
      matchPointsAgainst += isP1 ? s.player2Score : s.player1Score;
    });
  }

  // Duration from scoreHistory timestamps
  const duration = useMemo(() => {
    if (!Array.isArray(m.scoreHistory) || m.scoreHistory.length < 2) return null;
    const times = m.scoreHistory.map(e => new Date(e.time).getTime()).filter(t => !isNaN(t));
    if (times.length < 2) return null;
    const diffMs = Math.max(...times) - Math.min(...times);
    const mins = Math.round(diffMs / 60000);
    return mins > 0 ? mins : null;
  }, [m.scoreHistory]);

  return (
    <div style={{ backgroundColor: '#1f2937', borderRadius: '0.5rem', marginBottom: '0.25rem', overflow: 'hidden' }} aria-label={`${selectedPlayer} vs ${opponentName}${isCompleted ? (isWin ? ` ${t('spectator.playerProfile.win')}` : ` ${t('spectator.playerProfile.loss')}`) : ''}`}>
      {/* Main row - clickable to expand/collapse */}
      <div
        style={{ padding: '0.75rem', fontSize: '0.875rem', width: '100%', textAlign: 'left', cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand(isExpanded ? null : m.id);
        }}
      >
        {/* Top line: player vs opponent, result indicator */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 'bold' }}>
              {selectedPlayer} <span style={{ color: '#9ca3af' }}>vs</span> {opponentName}
            </span>
            {isCompleted && (
              <span style={{
                color: isWin ? '#22c55e' : '#ef4444',
                fontWeight: 'bold',
                fontSize: '0.75rem',
              }}>
                {isWin ? t('spectator.playerProfile.win') : t('spectator.playerProfile.loss')}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {duration && (
              <span style={{ color: '#9ca3af', fontSize: '0.6875rem' }}>{duration}{t('common.time.minutes')}</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/spectator/match/${tournamentId}/${m.id}`); }}
              style={{ color: m.status === 'completed' ? '#22c55e' : '#facc15', fontSize: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              aria-label={`${selectedPlayer} vs ${opponentName} ${t('spectator.favorites.viewMatch')}`}
            >
              {m.status === 'completed' ? t('spectator.favorites.viewMatch') : t('spectator.liveMatch.liveStatus')}
            </button>
          </div>
        </div>

        {/* Set score pills - chronological order (Set 1 first) */}
        {Array.isArray(m.sets) && m.sets.length > 0 && (
          <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {[...m.sets].sort((a, b) => (a.player1Score + a.player2Score === 0 ? 1 : 0) - (b.player1Score + b.player2Score === 0 ? 1 : 0)).map((s, i) => {
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
                  {t('common.matchHistory.setLabel', { num: i + 1 })} {myScore}-{oppScore}
                </span>
              );
            })}
          </div>
        )}

        {/* Total points summary */}
        {isCompleted && Array.isArray(m.sets) && m.sets.length > 0 && (
          <div style={{ color: '#9ca3af', marginTop: '0.25rem', fontSize: '0.75rem' }}>
            {t('spectator.tournament.playerRecord.scored', { 'for': matchPointsFor })} / {t('spectator.tournament.playerRecord.conceded', { against: matchPointsAgainst })} ({matchPointsFor - matchPointsAgainst > 0 ? '+' : ''}{matchPointsFor - matchPointsAgainst})
          </div>
        )}
      </div>

      {/* Expandable detail: score history timeline - sorted chronologically (oldest first) */}
      {isExpanded && Array.isArray(m.scoreHistory) && m.scoreHistory.length > 0 && (() => {
        // Sort chronologically: by set ascending, then by time ascending
        const META_TYPES = new Set(['pause', 'resume', 'timeout', 'substitution', 'dead_ball', 'walkover', 'coin_toss', 'warmup_start', 'match_start', 'player_rotation', 'side_change']);
        // History entries are stored newest-first; reverse to get chronological, then group by set
        const filtered = m.scoreHistory.filter(entry => {
          if (entry.actionType === 'resume') return false; // 재개 숨김
          return entry.points > 0 || META_TYPES.has(entry.actionType);
        });
        const sorted = [...filtered].reverse().sort((a, b) => {
          if (a.set !== b.set) return a.set - b.set;
          return 0; // preserve chronological order within same set
        });

        if (sorted.length === 0) return null;

        // Group by set for clean display
        const setGroups = new Map<number, typeof sorted>();
        sorted.forEach(entry => {
          const s = entry.set || 1;
          if (!setGroups.has(s)) setGroups.set(s, []);
          setGroups.get(s)!.push(entry);
        });

        return (
          <div style={{
            borderTop: '1px solid #374151',
            padding: '0.5rem 0.75rem',
            backgroundColor: '#111827',
            maxHeight: '14rem',
            overflowY: 'auto',
          }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#facc15', marginBottom: '0.375rem' }}>{t('spectator.tournament.view.scoreTimeline')}</p>
            {/* Set score summary line */}
            {Array.isArray(m.sets) && m.sets.length > 0 && (
              <p style={{ fontSize: '0.6875rem', color: '#9ca3af', marginBottom: '0.5rem' }}>
                {m.sets.map((s, i) => `${t('common.matchHistory.setLabel', { num: i + 1 })}: ${isP1 ? s.player1Score : s.player2Score}-${isP1 ? s.player2Score : s.player1Score}`).join(', ')}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
              {Array.from(setGroups.entries()).map(([setNum, entries]) => (
                <div key={setNum}>
                  <div style={{
                    fontSize: '0.6875rem', fontWeight: 'bold', color: '#60a5fa',
                    padding: '0.25rem 0', marginTop: setNum > 1 ? '0.25rem' : 0,
                    borderTop: setNum > 1 ? '1px solid #1f2937' : 'none',
                  }}>
                    {t('common.matchHistory.setLabel', { num: setNum })}
                  </div>
                  {entries.map((entry, i) => {
                    const isMine = entry.scoringPlayer === selectedPlayer;
                    const timeStr = entry.time ? parseTimeDisplay(entry.time) : '';

                    const ACTION_LABELS: Record<string, string> = {
                      goal: t('common.scoreActions.goal'),
                      irregular_serve: t('common.scoreActions.irregularServe'),
                      centerboard: t('common.scoreActions.centerboard'),
                      body_touch: t('common.scoreActions.bodyTouch'),
                      illegal_defense: t('common.scoreActions.illegalDefense'),
                      out: t('common.scoreActions.out'),
                      ball_holding: t('common.scoreActions.ballHolding'),
                      mask_touch: t('common.scoreActions.maskTouch'),
                      penalty: t('common.scoreActions.penalty'),
                      walkover: t('common.scoreActions.walkover'),
                    };

                    // Meta events (0 points)
                    const isMetaEvent = entry.points === 0 && META_TYPES.has(entry.actionType);
                    if (isMetaEvent) {
                      const metaIcon = entry.actionType === 'coin_toss' ? '🪙' : entry.actionType === 'warmup_start' ? '🏃' : entry.actionType === 'match_start' ? '🎾' : entry.actionType === 'timeout' ? '⏱️' : entry.actionType === 'side_change' ? '🔄' : entry.actionType === 'player_rotation' ? '🔄' : entry.actionType === 'pause' ? '⏸️' : entry.actionType === 'substitution' ? '🔄' : entry.actionType === 'dead_ball' ? '🔵' : '⚪';
                      const metaDesc = ACTION_LABELS[entry.actionType] || entry.actionType || '';
                      return (
                        <div key={i} style={{
                          display: 'flex',
                          gap: '0.5rem',
                          fontSize: '0.6875rem',
                          color: '#9ca3af',
                          alignItems: 'center',
                          padding: '0.125rem 0',
                        }}>
                          <span style={{ color: '#9ca3af', minWidth: '3rem', fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
                          <span>{metaIcon} {metaDesc}</span>
                        </div>
                      );
                    }

                    const icon = entry.actionType === 'goal' ? '⚽' : entry.actionType === 'walkover' ? '⚪' : entry.points >= 2 ? '🔴' : '🟡';
                    const label = ACTION_LABELS[entry.actionType || ''] || entry.actionType || '';
                    const desc = entry.actionType === 'goal'
                      ? `${entry.scoringPlayer} ${t('common.scoreActions.goal')} +${entry.points}`
                      : entry.actionType === 'walkover'
                      ? `${entry.scoringPlayer || '?'} ${t('common.scoreActions.walkover')}`
                      : `${entry.actionPlayer} ${label} → ${entry.scoringPlayer} +${entry.points}`;

                    return (
                      <div key={i} style={{
                        display: 'flex',
                        gap: '0.5rem',
                        fontSize: '0.6875rem',
                        color: isMine ? '#bbf7d0' : '#fecaca',
                        alignItems: 'center',
                      }}>
                        <span style={{ color: '#9ca3af', minWidth: '3rem', fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
                        <span style={{
                          backgroundColor: isMine ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                          padding: '0 0.25rem',
                          borderRadius: '0.125rem',
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {entry.scoreAfter?.player1 ?? 0}-{entry.scoreAfter?.player2 ?? 0}
                        </span>
                        <span>{icon} {desc}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* If expanded but no scoreHistory */}
      {isExpanded && (!Array.isArray(m.scoreHistory) || m.scoreHistory.length === 0) && (
        <div style={{
          borderTop: '1px solid #374151',
          padding: '0.5rem 0.75rem',
          backgroundColor: '#111827',
        }}>
          <p style={{ fontSize: '0.75rem', color: '#d1d5db', textAlign: 'center' }}>{t('common.matchHistory.noDetailedHistory')}</p>
        </div>
      )}
    </div>
  );
}
