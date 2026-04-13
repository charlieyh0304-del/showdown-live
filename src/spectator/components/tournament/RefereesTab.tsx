import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Match, Referee } from '@shared/types';

export interface RefereesTabProps {
  referees: Referee[];
  assignments: Record<string, { assignedMatchIds: string[] }>;
  matches: Match[];
}

export default function RefereesTab({
  referees,
  assignments,
  matches,
}: RefereesTabProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRefereeId, setExpandedRefereeId] = useState<string | null>(null);
  const [matchFilter, setMatchFilter] = useState<'all' | 'in_progress' | 'completed' | 'pending'>('all');

  // Build list of referees assigned to this tournament
  const tournamentReferees = useMemo(() => {
    const refIds = new Set<string>();
    for (const m of matches) {
      if (m.refereeId) refIds.add(m.refereeId);
      if (m.assistantRefereeId) refIds.add(m.assistantRefereeId);
    }
    for (const rid of Object.keys(assignments)) {
      refIds.add(rid);
    }

    return Array.from(refIds).map(rid => {
      const refData = referees.find(r => r.id === rid);
      const assignedMatchIds = assignments[rid]?.assignedMatchIds || [];
      const matchAssigned = matches.filter(m => m.refereeId === rid || m.assistantRefereeId === rid);
      const allMatchIds = [...new Set([...assignedMatchIds, ...matchAssigned.map(m => m.id)])];
      const refMatches = allMatchIds
        .map(mid => matches.find(m => m.id === mid))
        .filter((m): m is Match => !!m);

      return {
        id: rid,
        name: refData?.name || matches.find(m => m.refereeId === rid)?.refereeName || matches.find(m => m.assistantRefereeId === rid)?.assistantRefereeName || rid,
        role: refData?.role || 'main',
        matches: refMatches,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [referees, assignments, matches]);

  const filteredReferees = useMemo(() => {
    if (!searchQuery.trim()) return tournamentReferees;
    const q = searchQuery.trim().toLowerCase();
    return tournamentReferees.filter(r => r.name.toLowerCase().includes(q));
  }, [tournamentReferees, searchQuery]);

  if (tournamentReferees.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }} role="status">
          {t('spectator.tournament.referees.noReferees')}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <input
          className="input"
          style={{ width: '100%' }}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t('spectator.tournament.referees.searchPlaceholder')}
          aria-label={t('spectator.tournament.referees.searchAriaLabel')}
        />
      </div>

      <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '1rem', textAlign: 'center' }}>
        {t('spectator.tournament.referees.count', { count: filteredReferees.length })}
      </p>

      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {filteredReferees.map(refItem => {
          const isExpanded = expandedRefereeId === refItem.id;
          const completedCount = refItem.matches.filter(m => m.status === 'completed').length;
          const liveCount = refItem.matches.filter(m => m.status === 'in_progress').length;

          return (
            <li key={refItem.id}>
              <button
                className="card"
                onClick={() => setExpandedRefereeId(isExpanded ? null : refItem.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  border: isExpanded ? '2px solid var(--color-primary)' : '2px solid #374151',
                }}
                aria-expanded={isExpanded}
                aria-label={`${refItem.name}, ${t('spectator.tournament.referees.matchCount', { count: refItem.matches.length })}`}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <span style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{refItem.name}</span>
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.875rem', color: '#9ca3af' }}>
                      ({refItem.role === 'main' ? t('spectator.tournament.referees.mainReferee') : t('spectator.tournament.referees.assistantReferee')})
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {liveCount > 0 && (
                      <span style={{ backgroundColor: '#ef4444', color: '#fff', borderRadius: '9999px', padding: '0.125rem 0.5rem', fontSize: '0.75rem', fontWeight: 'bold' }}>
                        {t('spectator.tournament.referees.live')} {liveCount}
                      </span>
                    )}
                    <span style={{ color: '#d1d5db', fontSize: '0.875rem' }}>
                      {t('spectator.tournament.referees.matchSummary', { completed: completedCount, total: refItem.matches.length })}
                    </span>
                    <span style={{ color: '#9ca3af', fontSize: '1.25rem' }} aria-hidden="true">
                      {isExpanded ? '\u25B2' : '\u25BC'}
                    </span>
                  </div>
                </div>
              </button>

              {isExpanded && refItem.matches.length > 0 && (() => {
                const inProgressMatches = refItem.matches.filter(m => m.status === 'in_progress');
                const completedMatches = refItem.matches.filter(m => m.status === 'completed');
                const pendingMatches = refItem.matches.filter(m => m.status !== 'in_progress' && m.status !== 'completed');
                const filteredMatches = matchFilter === 'all' ? refItem.matches
                  : matchFilter === 'in_progress' ? inProgressMatches
                  : matchFilter === 'completed' ? completedMatches
                  : pendingMatches;

                return (
                  <div style={{ marginTop: '0.5rem', paddingLeft: '0.5rem', borderLeft: '3px solid #374151' }}>
                    {/* Status filter tabs */}
                    <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                      {([
                        { key: 'all' as const, label: `${t('common.all')} (${refItem.matches.length})`, color: '#6b7280' },
                        { key: 'in_progress' as const, label: `${t('common.matchStatus.inProgress')} (${inProgressMatches.length})`, color: '#ef4444' },
                        { key: 'pending' as const, label: `${t('common.matchStatus.pending')} (${pendingMatches.length})`, color: '#9ca3af' },
                        { key: 'completed' as const, label: `${t('common.matchStatus.completed')} (${completedMatches.length})`, color: '#22c55e' },
                      ]).map(tab => (
                        <button
                          key={tab.key}
                          className="btn"
                          style={{
                            fontSize: '0.75rem', padding: '4px 10px',
                            background: matchFilter === tab.key ? tab.color : '#1f2937',
                            color: matchFilter === tab.key ? '#fff' : '#9ca3af',
                            border: matchFilter === tab.key ? 'none' : '1px solid #374151',
                          }}
                          onClick={() => setMatchFilter(matchFilter === tab.key ? 'all' : tab.key)}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <div role="list" aria-label={t('spectator.tournament.referees.assignedMatches')}>
                      {filteredMatches.length === 0 ? (
                        <p style={{ color: '#6b7280', fontSize: '0.875rem', textAlign: 'center', padding: '1rem' }}>
                          {t('common.noResults')}
                        </p>
                      ) : filteredMatches.map(m => {
                        const isIndividual = m.type === 'individual';
                        const p1 = isIndividual ? m.player1Name : m.team1Name;
                        const p2 = isIndividual ? m.player2Name : m.team2Name;
                        const statusColor = m.status === 'completed' ? '#22c55e' : m.status === 'in_progress' ? '#ef4444' : '#9ca3af';

                        return (
                          <div
                            key={m.id}
                            role="listitem"
                            className="card"
                            style={{ marginBottom: '0.5rem', padding: '0.75rem', border: '1px solid #374151' }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.25rem' }}>
                              <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>
                                {p1 || '?'} vs {p2 || '?'}
                              </span>
                              <span style={{ color: statusColor, fontWeight: 'bold', fontSize: '0.875rem' }}>
                                {m.status === 'completed' ? t('common.matchStatus.completed')
                                  : m.status === 'in_progress' ? t('common.matchStatus.inProgress')
                                  : t('common.matchStatus.pending')}
                              </span>
                            </div>
                            {m.courtName && (
                              <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                                {m.courtName}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
