import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { countSetWins } from '@shared/utils/scoring';
import type { Match } from '@shared/types';
import type { useNavigate } from 'react-router-dom';

export interface HistoryTabProps {
  matches: Match[];
  navigate: ReturnType<typeof useNavigate>;
  tournamentId: string;
}

const HISTORY_ITEMS_PER_PAGE = 30;
const SECTION_INITIAL_LIMIT = 20;

export default function HistoryTab({
  matches,
  navigate,
  tournamentId,
}: HistoryTabProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) => setExpandedSections(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Classify matches into stages
  const stageGroups = useMemo(() => {
    const qualifying: Match[] = [];
    const finals: Match[] = [];
    const ranking: Match[] = [];
    const other: Match[] = [];

    matches.forEach(m => {
      if (m.groupId || m.stageId?.includes('qualifying')) {
        qualifying.push(m);
      } else if (m.stageId?.includes('ranking') || m.roundLabel?.includes('\uacb0\uc815\uc804')) {
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
    const roundOrder = ['128\uac15', '64\uac15', '32\uac15', '16\uac15', '8\uac15', '4\uac15', '\uacb0\uc2b9'];
    const map = new Map<string, Match[]>();
    stageGroups.finals.forEach(m => {
      const label = m.roundLabel || t('spectator.tournament.view.roundLabel', { round: m.round || '?' });
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
      const label = m.roundLabel || t('spectator.tournament.view.rankingMatchLabel');
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
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }}>{t('spectator.tournament.tabs.history')} - {t('common.matchStatus.pending')}</p>
      </div>
    );
  }

  const countCompleted = (ms: Match[]) => ms.filter(m => m.status === 'completed').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ fontSize: '0.875rem', color: '#9ca3af', textAlign: 'center' }}>
        {t('spectator.tournament.view.historySummary', { total: matches.length, completed: completedCount, inProgress: inProgressCount, pending: pendingCount })}
      </p>

      {/* Qualifying (Group stage) */}
      {stageGroups.qualifying.length > 0 && (
        <div>
          <HistoryStageSectionHeader
            title={t('spectator.tournament.view.qualifyingGroupLeague')}
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
                    {groupId === 'default' ? t('spectator.tournament.view.matchLabel') : t('spectator.tournament.view.groupLabel', { id: groupId })}
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                    {countCompleted(gMatches)}/{gMatches.length}
                  </span>
                </div>
                <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(expandedSections.has(`q_${groupId}`) ? gMatches : gMatches.slice(0, SECTION_INITIAL_LIMIT)).map((m, mi) => (
                    <HistoryMatchCard key={m.id} match={m} navigate={navigate} tournamentId={tournamentId} index={mi} total={gMatches.length} />
                  ))}
                </div>
                {gMatches.length > SECTION_INITIAL_LIMIT && (
                  <button className="text-sm text-cyan-400 underline mt-2" style={{ minHeight: '44px' }} aria-label={expandedSections.has(`q_${groupId}`) ? `${t('common.showLess')} - ${groupId === 'default' ? t('spectator.tournament.view.matchLabel') : t('spectator.tournament.view.groupLabel', { id: groupId })}` : `${t('common.showMore', { remaining: gMatches.length - SECTION_INITIAL_LIMIT })} - ${groupId === 'default' ? t('spectator.tournament.view.matchLabel') : t('spectator.tournament.view.groupLabel', { id: groupId })}`} onClick={() => toggleSection(`q_${groupId}`)}>
                    {expandedSections.has(`q_${groupId}`) ? t('common.showLess') : t('common.showMore', { remaining: gMatches.length - SECTION_INITIAL_LIMIT })}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Finals (Tournament bracket) */}
      {stageGroups.finals.length > 0 && (
        <div>
          <HistoryStageSectionHeader
            title={t('spectator.tournament.view.finalsTournament')}
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
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                    {countCompleted(rMatches)}/{rMatches.length}
                  </span>
                </div>
                <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(expandedSections.has(`f_${roundLabel}`) ? rMatches : rMatches.slice(0, SECTION_INITIAL_LIMIT)).map((m, mi) => (
                    <HistoryMatchCard key={m.id} match={m} navigate={navigate} tournamentId={tournamentId} index={mi} total={rMatches.length} />
                  ))}
                </div>
                {rMatches.length > SECTION_INITIAL_LIMIT && (
                  <button className="text-sm text-cyan-400 underline mt-2" style={{ minHeight: '44px' }} aria-label={expandedSections.has(`f_${roundLabel}`) ? `${t('common.showLess')} - ${roundLabel}` : `${t('common.showMore', { remaining: rMatches.length - SECTION_INITIAL_LIMIT })} - ${roundLabel}`} onClick={() => toggleSection(`f_${roundLabel}`)}>
                    {expandedSections.has(`f_${roundLabel}`) ? t('common.showLess') : t('common.showMore', { remaining: rMatches.length - SECTION_INITIAL_LIMIT })}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ranking matches */}
      {stageGroups.ranking.length > 0 && (
        <div>
          <HistoryStageSectionHeader
            title={t('spectator.tournament.stageFilter.ranking')}
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
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                    {countCompleted(rMatches)}/{rMatches.length}
                  </span>
                </div>
                <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(expandedSections.has(`r_${roundLabel}`) ? rMatches : rMatches.slice(0, SECTION_INITIAL_LIMIT)).map((m, mi) => (
                    <HistoryMatchCard key={m.id} match={m} navigate={navigate} tournamentId={tournamentId} index={mi} total={rMatches.length} />
                  ))}
                </div>
                {rMatches.length > SECTION_INITIAL_LIMIT && (
                  <button className="text-sm text-cyan-400 underline mt-2" style={{ minHeight: '44px' }} aria-label={expandedSections.has(`r_${roundLabel}`) ? `${t('common.showLess')} - ${roundLabel}` : `${t('common.showMore', { remaining: rMatches.length - SECTION_INITIAL_LIMIT })} - ${roundLabel}`} onClick={() => toggleSection(`r_${roundLabel}`)}>
                    {expandedSections.has(`r_${roundLabel}`) ? t('common.showLess') : t('common.showMore', { remaining: rMatches.length - SECTION_INITIAL_LIMIT })}
                  </button>
                )}
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
              title={t('spectator.tournament.playerRecord.otherStage')}
              color="#9ca3af"
              completedCount={countCompleted(stageGroups.other)}
              totalCount={stageGroups.other.length}
            />
          )}
          <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {(expandedSections.has('other') ? stageGroups.other : stageGroups.other.slice(0, SECTION_INITIAL_LIMIT)).map((m, mi) => (
              <HistoryMatchCard key={m.id} match={m} navigate={navigate} tournamentId={tournamentId} index={mi} total={stageGroups.other.length} />
            ))}
          </div>
          {stageGroups.other.length > SECTION_INITIAL_LIMIT && (
            <button className="text-sm text-cyan-400 underline mt-2" style={{ minHeight: '44px' }} onClick={() => toggleSection('other')}>
              {expandedSections.has('other') ? t('common.showLess') : t('common.showMore', { remaining: stageGroups.other.length - SECTION_INITIAL_LIMIT })}
            </button>
          )}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
          <button className="btn btn-sm btn-secondary" disabled={safePage === 1} onClick={() => setPage(p => p - 1)}>{t('common.previous')}</button>
          <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{safePage} / {totalPages}</span>
          <button className="btn btn-sm btn-secondary" disabled={safePage === totalPages} onClick={() => setPage(p => p + 1)}>{t('common.next')}</button>
        </div>
      )}
    </div>
  );
}

function HistoryMatchStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (status === 'in_progress') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
        padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold',
        backgroundColor: 'rgba(234, 179, 8, 0.15)', color: '#eab308', border: '1px solid rgba(234, 179, 8, 0.3)',
      }}>
        <span className="animate-pulse" style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#eab308' }} />
        {'\u25B6'} {t('common.matchStatus.inProgress')}
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
        {'\u2713'} {t('common.matchStatus.completed')}
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold',
      backgroundColor: 'rgba(107, 114, 128, 0.15)', color: '#9ca3af', border: '1px solid rgba(107, 114, 128, 0.3)',
    }}>
      {'\u23F3'} {t('common.matchStatus.pending')}
    </span>
  );
}

function HistoryMatchCard({
  match,
  navigate,
  tournamentId,
  index,
  total,
}: {
  match: Match;
  navigate: ReturnType<typeof useNavigate>;
  tournamentId: string;
  index?: number;
  total?: number;
}) {
  const { t } = useTranslation();
  const isIndividual = match.type === 'individual';
  const p1 = isIndividual ? (match.player1Name || t('referee.home.player1Default')) : (match.team1Name || t('referee.home.team1Default'));
  const p2 = isIndividual ? (match.player2Name || t('referee.home.player2Default')) : (match.team2Name || t('referee.home.team2Default'));
  const isCompleted = match.status === 'completed';
  const isP1Winner = isCompleted && match.winnerId === (match.player1Id || match.team1Id);
  const isP2Winner = isCompleted && match.winnerId === (match.player2Id || match.team2Id);
  const sets = Array.isArray(match.sets) ? match.sets : [];
  const setWins = isIndividual && sets.length > 0 ? countSetWins(sets) : null;

  const borderColor = match.status === 'in_progress' ? '#eab308' : isCompleted ? '#374151' : '#1f2937';

  // Build formatted score string for readable display
  const scoreText = (() => {
    if (sets.length === 0 || match.status === 'pending') return null;
    if (isIndividual && setWins) {
      const setScoreDetails = sets.map((s, i) => `${t('common.matchHistory.setLabel', { num: i + 1 })}: ${s.player1Score}-${s.player2Score}`).join(', ');
      return { p1Score: String(setWins.player1), p2Score: String(setWins.player2), label: t('common.units.set'), detail: setScoreDetails };
    }
    if (!isIndividual && sets.length > 0) {
      return { p1Score: String(sets[0].player1Score), p2Score: String(sets[0].player2Score), label: t('common.matchHistory.score'), detail: null };
    }
    return null;
  })();

  return (
    <button
      className="card"
      role="listitem"
      aria-label={`${p1} vs ${p2}, ${t(`common.matchStatus.${match.status}`)}`}
      {...(total !== undefined && index !== undefined ? { 'aria-setsize': total, 'aria-posinset': index + 1 } : {})}
      onClick={() => navigate(`/spectator/match/${tournamentId}/${match.id}`)}
      style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: `1px solid ${borderColor}`, padding: '0.75rem 1rem' }}
    >
      {/* Row 1: Player/Team names with "vs" */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem' }}>
        <span style={{
          fontWeight: 'bold', fontSize: '1.05rem',
          color: isP1Winner ? '#22c55e' : isCompleted && isP2Winner ? '#9ca3af' : '#d1d5db',
        }}>
          {p1}
        </span>
        <span style={{ color: '#9ca3af', fontSize: '0.875rem', flexShrink: 0 }}>vs</span>
        <span style={{
          fontWeight: 'bold', fontSize: '1.05rem',
          color: isP2Winner ? '#22c55e' : isCompleted && isP1Winner ? '#9ca3af' : '#d1d5db',
        }}>
          {p2}
        </span>
      </div>

      {/* Row 2: Score */}
      {scoreText && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem', marginBottom: '0.375rem' }}>
          <span style={{
            fontSize: '1rem', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums', color: '#d1d5db',
          }}>
            {scoreText.label}{' '}
            <span style={{ color: isP1Winner ? '#22c55e' : '#d1d5db' }}>{scoreText.p1Score}</span>
            <span style={{ color: '#9ca3af' }}> - </span>
            <span style={{ color: isP2Winner ? '#22c55e' : '#d1d5db' }}>{scoreText.p2Score}</span>
          </span>
          {scoreText.detail && (
            <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
              {scoreText.detail}
            </span>
          )}
        </div>
      )}

      {/* Row 3: Status badges + meta info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
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
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
            {t('common.refereeRole.main')}: {match.refereeName}
          </span>
        )}
        {match.assistantRefereeName && (
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
            {t('common.refereeRole.assistant')}: {match.assistantRefereeName}
          </span>
        )}
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
  const { t } = useTranslation();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderBottom: `2px solid ${color}33`, paddingBottom: '0.5rem', marginBottom: '0.75rem', marginTop: '0.25rem',
    }}>
      <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color }}>{title}</h3>
      <span style={{ fontSize: '0.8125rem', color: '#9ca3af' }}>
        {completedCount}/{totalCount} {t('common.matchStatus.completed')}
      </span>
    </div>
  );
}
