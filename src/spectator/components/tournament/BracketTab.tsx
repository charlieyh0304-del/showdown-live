import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { countSetWins, getSetScoresByServer } from '@shared/utils/scoring';
import { calculateGroupRanking } from '@shared/utils/ranking';
import type { Match } from '@shared/types';

export interface BracketTabProps {
  matches: Match[];
  tournamentType: string;
  onSelectPlayer: (name: string) => void;
}

export default function BracketTab({ matches, tournamentType, onSelectPlayer }: BracketTabProps) {
  const { t } = useTranslation();
  const isTeam = tournamentType === 'team' || tournamentType === 'randomTeamLeague';
  const hasGroups = matches.some(m => m.groupId);
  const hasFinalsMatches = matches.some(m =>
    !m.groupId && (m.stageId?.includes('finals') || m.roundLabel) &&
    !m.stageId?.includes('ranking') && !m.roundLabel?.includes('\uacb0\uc815\uc804')
  );
  const hasRankingMatches = matches.some(m =>
    m.stageId?.includes('ranking') || m.roundLabel?.includes('\uacb0\uc815\uc804')
  );

  if (matches.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }}>{t('spectator.tournament.tabs.bracket')} - {t('common.matchStatus.pending')}</p>
      </div>
    );
  }

  // If filtered to only finals matches (no groups), show FinalsView
  if (hasFinalsMatches && !hasGroups) {
    return <FinalsView matches={matches.filter(m =>
      !m.groupId && (m.stageId?.includes('finals') || m.roundLabel) &&
      !m.stageId?.includes('ranking') && !m.roundLabel?.includes('\uacb0\uc815\uc804')
    )} onSelectPlayer={onSelectPlayer} />;
  }

  // If filtered to ranking matches, show them
  if (hasRankingMatches && !hasGroups && !hasFinalsMatches) {
    return <RankingMatchesView matches={matches.filter(m =>
      m.stageId?.includes('ranking') || m.roundLabel?.includes('\uacb0\uc815\uc804')
    )} onSelectPlayer={onSelectPlayer} />;
  }

  // Mixed view: show groups first, then finals, then ranking
  if (hasGroups) {
    const groupMatches = matches.filter(m => m.groupId);
    const finalsMatches = matches.filter(m =>
      !m.groupId && (m.stageId?.includes('finals') || m.roundLabel) &&
      !m.stageId?.includes('ranking') && !m.roundLabel?.includes('\uacb0\uc815\uc804')
    );
    const rankingMatches = matches.filter(m =>
      m.stageId?.includes('ranking') || m.roundLabel?.includes('\uacb0\uc815\uc804')
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <GroupStageView matches={groupMatches} onSelectPlayer={onSelectPlayer} isTeam={isTeam} />
        {finalsMatches.length > 0 && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#4ade80', marginBottom: '1rem', borderBottom: '2px solid rgba(74, 222, 128, 0.3)', paddingBottom: '0.5rem', textAlign: 'center' }}>
              {t('spectator.tournament.stageFilter.finals')}
            </h2>
            <FinalsView matches={finalsMatches} onSelectPlayer={onSelectPlayer} />
          </div>
        )}
        {rankingMatches.length > 0 && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#c084fc', marginBottom: '1rem', borderBottom: '2px solid rgba(192, 132, 252, 0.3)', paddingBottom: '0.5rem', textAlign: 'center' }}>
              {t('spectator.tournament.stageFilter.ranking')}
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
  const { t } = useTranslation();
  const roundOrder = ['128\uac15', '64\uac15', '32\uac15', '16\uac15', '8\uac15', '4\uac15', '\uacb0\uc2b9'];

  const rounds = useMemo(() => {
    const map = new Map<string, Match[]>();
    matches.forEach(m => {
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
  }, [matches]);

  if (matches.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }}>{t('spectator.tournament.stageFilter.finals')} - {t('common.matchStatus.pending')}</p>
      </div>
    );
  }

  const roundColors: Record<string, string> = {
    '128\uac15': '#6366f1',
    '64\uac15': '#8b5cf6',
    '32\uac15': '#3b82f6',
    '16\uac15': '#06b6d4',
    '8\uac15': '#10b981',
    '4\uac15': '#f59e0b',
    '\uacb0\uc2b9': '#ef4444',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
      {rounds.map(([roundLabel, roundMatches], roundIdx) => {
        const color = roundColors[roundLabel] || '#9ca3af';
        const isFinal = roundLabel === '\uacb0\uc2b9';

        return (
          <div key={roundLabel} style={{ position: 'relative' }}>
            {/* Round header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.625rem 1rem',
              backgroundColor: `${color}20`,
              borderLeft: `4px solid ${color}`,
              marginBottom: '0',
            }}>
              <span style={{
                fontSize: isFinal ? '1.125rem' : '0.9375rem',
                fontWeight: 'bold',
                color: color,
              }}>
                {isFinal ? '\ud83c\udfc6 ' : ''}{roundLabel}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                {roundMatches.filter(m => m.status === 'completed').length}/{roundMatches.length}
              </span>
            </div>

            {/* Matches with bracket connector lines */}
            <div style={{
              borderLeft: roundIdx < rounds.length - 1 ? `2px solid ${color}40` : 'none',
              marginLeft: '1px',
              paddingLeft: '1rem',
              paddingTop: '0.5rem',
              paddingBottom: '0.75rem',
            }}>
              {roundMatches.map((m, matchIdx) => {
                const p1 = m.player1Name || m.team1Name || 'TBD';
                const p2 = m.player2Name || m.team2Name || 'TBD';
                const isP1Winner = m.winnerId === (m.player1Id || m.team1Id);
                const isP2Winner = m.winnerId === (m.player2Id || m.team2Id);
                const isCompleted = m.status === 'completed';
                const isInProgress = m.status === 'in_progress';
                const sets = Array.isArray(m.sets) ? m.sets : [];
                const setWins = sets.length > 0 ? countSetWins(sets) : null;

                return (
                  <div
                    key={m.id}
                    style={{
                      position: 'relative',
                      marginBottom: matchIdx < roundMatches.length - 1 ? '0.5rem' : '0',
                    }}
                  >
                    {/* Horizontal connector dot */}
                    <div style={{
                      position: 'absolute',
                      left: '-1.125rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: isCompleted ? (color) : '#374151',
                      border: `2px solid ${isCompleted ? color : '#4b5563'}`,
                    }} />

                    {/* Match card */}
                    <div style={{
                      backgroundColor: isFinal ? '#1a1a2e' : '#1f2937',
                      borderRadius: '0.5rem',
                      border: isInProgress
                        ? '1px solid #eab308'
                        : isFinal && isCompleted
                        ? `1px solid ${color}60`
                        : '1px solid #374151',
                      overflow: 'hidden',
                      boxShadow: isFinal ? `0 0 12px ${color}20` : 'none',
                    }}>
                      {/* Player 1 row */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.5rem 0.75rem',
                        backgroundColor: isCompleted && isP1Winner ? 'rgba(34, 197, 94, 0.08)' : 'transparent',
                        borderBottom: '1px solid #2d3748',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0 }}>
                          {isCompleted && (
                            <span style={{
                              width: '4px',
                              height: '1.25rem',
                              borderRadius: '2px',
                              backgroundColor: isP1Winner ? '#22c55e' : '#4b5563',
                              flexShrink: 0,
                            }} />
                          )}
                          {onSelectPlayer ? (
                            <button
                              onClick={() => onSelectPlayer(p1)}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                fontWeight: isCompleted && isP1Winner ? 'bold' : 'normal',
                                color: p1 === 'TBD' ? '#9ca3af' : isCompleted ? (isP1Winner ? '#22c55e' : '#d1d5db') : '#d1d5db',
                                fontSize: '0.9375rem',
                                textAlign: 'left',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              className="hover:underline hover:text-yellow-400"
                            >
                              {p1}
                            </button>
                          ) : (
                            <span style={{
                              fontWeight: isCompleted && isP1Winner ? 'bold' : 'normal',
                              color: p1 === 'TBD' ? '#9ca3af' : isCompleted ? (isP1Winner ? '#22c55e' : '#d1d5db') : '#d1d5db',
                              fontSize: '0.9375rem',
                            }}>
                              {p1}
                            </span>
                          )}
                        </div>
                        {setWins && (
                          <span style={{
                            fontWeight: 'bold',
                            fontSize: '0.9375rem',
                            color: isP1Winner ? '#22c55e' : '#9ca3af',
                            fontVariantNumeric: 'tabular-nums',
                            flexShrink: 0,
                          }}>
                            {setWins.player1}
                          </span>
                        )}
                      </div>

                      {/* Player 2 row */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.5rem 0.75rem',
                        backgroundColor: isCompleted && isP2Winner ? 'rgba(34, 197, 94, 0.08)' : 'transparent',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0 }}>
                          {isCompleted && (
                            <span style={{
                              width: '4px',
                              height: '1.25rem',
                              borderRadius: '2px',
                              backgroundColor: isP2Winner ? '#22c55e' : '#4b5563',
                              flexShrink: 0,
                            }} />
                          )}
                          {onSelectPlayer ? (
                            <button
                              onClick={() => onSelectPlayer(p2)}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                fontWeight: isCompleted && isP2Winner ? 'bold' : 'normal',
                                color: p2 === 'TBD' ? '#9ca3af' : isCompleted ? (isP2Winner ? '#22c55e' : '#d1d5db') : '#d1d5db',
                                fontSize: '0.9375rem',
                                textAlign: 'left',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              className="hover:underline hover:text-yellow-400"
                            >
                              {p2}
                            </button>
                          ) : (
                            <span style={{
                              fontWeight: isCompleted && isP2Winner ? 'bold' : 'normal',
                              color: p2 === 'TBD' ? '#9ca3af' : isCompleted ? (isP2Winner ? '#22c55e' : '#d1d5db') : '#d1d5db',
                              fontSize: '0.9375rem',
                            }}>
                              {p2}
                            </span>
                          )}
                        </div>
                        {setWins && (
                          <span style={{
                            fontWeight: 'bold',
                            fontSize: '0.9375rem',
                            color: isP2Winner ? '#22c55e' : '#9ca3af',
                            fontVariantNumeric: 'tabular-nums',
                            flexShrink: 0,
                          }}>
                            {setWins.player2}
                          </span>
                        )}
                      </div>

                      {/* Score detail & status bar */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.25rem 0.75rem 0.375rem',
                        backgroundColor: '#111827',
                        borderTop: '1px solid #2d3748',
                      }}>
                        {/* Set scores */}
                        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                          {getSetScoresByServer(m).map((ss, i) => (
                            <span key={i} style={{
                              fontSize: '0.6875rem',
                              color: '#9ca3af',
                              backgroundColor: '#374151',
                              padding: '0.0625rem 0.375rem',
                              borderRadius: '0.25rem',
                              fontVariantNumeric: 'tabular-nums',
                            }} title={`${t('spectator.tournament.view.serveLabel')}: ${ss.serverSide === 'player1' ? (m.player1Name || m.team1Name || 'P1') : (m.player2Name || m.team2Name || 'P2')}`}>
                              {ss.serverScore}-{ss.receiverScore}
                            </span>
                          ))}
                        </div>

                        {/* Court name & Status badge */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          {m.courtName && (
                            <span style={{
                              fontSize: '0.6875rem',
                              fontWeight: 600,
                              color: '#60a5fa',
                              backgroundColor: 'rgba(96, 165, 250, 0.15)',
                              padding: '0.0625rem 0.375rem',
                              borderRadius: '0.25rem',
                              border: '1px solid rgba(96, 165, 250, 0.3)',
                            }}>
                              {m.courtName}
                            </span>
                          )}
                          {isInProgress && (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              fontSize: '0.6875rem',
                              fontWeight: 'bold',
                              color: '#eab308',
                              backgroundColor: 'rgba(234, 179, 8, 0.15)',
                              padding: '0.125rem 0.5rem',
                              borderRadius: '9999px',
                            }}>
                              <span style={{
                                display: 'inline-block',
                                width: '5px',
                                height: '5px',
                                borderRadius: '50%',
                                backgroundColor: '#eab308',
                                animation: 'pulse 2s infinite',
                              }} />
                              {t('common.matchStatus.inProgress')}
                            </span>
                          )}
                          {!isCompleted && !isInProgress && (
                            <span style={{
                              fontSize: '0.6875rem',
                              color: '#9ca3af',
                            }}>
                              {t('common.matchStatus.pending')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MatchResultCard({ match, onSelectPlayer }: { match: Match; onSelectPlayer?: (name: string) => void }) {
  const { t } = useTranslation();
  const p1 = match.player1Name || match.team1Name || '?';
  const p2 = match.player2Name || match.team2Name || '?';
  const isP1Winner = match.winnerId === (match.player1Id || match.team1Id);
  const isCompleted = match.status === 'completed';
  const sets = Array.isArray(match.sets) ? match.sets : [];

  const nameButton = (name: string, isWinner: boolean, align: 'left' | 'right') => {
    const style: React.CSSProperties = {
      fontSize: '1.125rem',
      fontWeight: 'bold',
      color: isCompleted ? (isWinner ? '#22c55e' : '#d1d5db') : '#d1d5db',
    };
    if (onSelectPlayer) {
      return (
        <button
          onClick={() => onSelectPlayer(name)}
          style={{ ...style, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: align }}
          className="hover:underline hover:text-yellow-400"
        >
          {isCompleted && isWinner && align === 'left' ? '\ud83c\udfc6 ' : ''}{name}{isCompleted && isWinner && align === 'right' ? ' \ud83c\udfc6' : ''}
        </button>
      );
    }
    return <span style={style}>{isCompleted && isWinner && align === 'left' ? '\ud83c\udfc6 ' : ''}{name}{isCompleted && isWinner && align === 'right' ? ' \ud83c\udfc6' : ''}</span>;
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
          {match.team1?.memberNames && (
            <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.25rem' }}>
              {match.team1?.memberNames.join(', ')}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'center', padding: '0 1rem' }}>
          {isCompleted && sets.length > 0 ? (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {getSetScoresByServer(match).map((ss, i) => (
                <span key={i} style={{
                  fontSize: '0.875rem',
                  color: '#9ca3af',
                  backgroundColor: '#374151',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                }} title={`${t('spectator.tournament.view.serveLabel')}: ${ss.serverSide === 'player1' ? (match.player1Name || match.team1Name || 'P1') : (match.player2Name || match.team2Name || 'P2')}`}>
                  {ss.serverScore}-{ss.receiverScore}
                </span>
              ))}
            </div>
          ) : (
            <span style={{ color: match.status === 'in_progress' ? '#ef4444' : '#9ca3af', fontWeight: 'bold' }}>
              {match.status === 'in_progress' ? `\u25B6 ${t('common.matchStatus.inProgress')}` : 'vs'}
            </span>
          )}
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          {nameButton(p2, !isP1Winner && isCompleted, 'right')}
          {match.team2?.memberNames && (
            <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.25rem', textAlign: 'right' }}>
              {match.team2?.memberNames.join(', ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== Ranking Matches View =====
function RankingMatchesView({ matches, onSelectPlayer }: { matches: Match[]; onSelectPlayer: (name: string) => void }) {
  const { t } = useTranslation();
  const rounds = useMemo(() => {
    const map = new Map<string, Match[]>();
    matches.forEach(m => {
      const label = m.roundLabel || t('spectator.tournament.view.rankingMatchLabel');
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(m);
    });
    return Array.from(map.entries());
  }, [matches]);

  if (matches.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }}>{t('spectator.tournament.stageFilter.ranking')} - {t('common.matchStatus.pending')}</p>
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
            textAlign: 'center',
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
function GroupStageView({ matches, onSelectPlayer, isTeam = false }: { matches: Match[]; onSelectPlayer: (name: string) => void; isTeam?: boolean }) {
  const { t } = useTranslation();
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
          <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#facc15', marginBottom: '1rem', textAlign: 'center' }}>
            {groupId === 'default' ? t('spectator.tournament.view.matchLabel') : t('spectator.tournament.view.groupLabel', { id: groupId })}
          </h3>

          {/* 조별 순위표 */}
          <GroupRankingTable matches={groupMatches} onSelectPlayer={onSelectPlayer} isTeam={isTeam} />

          {/* 조별 경기 결과 */}
          <div style={{ marginTop: '1rem' }}>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#d1d5db', marginBottom: '0.5rem' }}>{t('spectator.tournament.view.matchResult')}</h4>
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

function formatDiff(value: number): { text: string; color: string } {
  if (value > 0) return { text: `+${value}`, color: '#22c55e' };
  if (value < 0) return { text: `${value}`, color: '#ef4444' };
  return { text: '0', color: '#9ca3af' };
}

function GroupRankingTable({ matches, onSelectPlayer, isTeam = false }: { matches: Match[]; onSelectPlayer: (name: string) => void; isTeam?: boolean }) {
  const { t } = useTranslation();
  const rankings = useMemo(() => {
    const r = calculateGroupRanking(matches);
    return r.map(p => ({
      name: p.playerName || '',
      played: p.played,
      wins: p.wins,
      losses: p.losses,
      setsWon: p.setsWon,
      setsLost: p.setsLost,
      pointsFor: p.pointsFor,
      pointsAgainst: p.pointsAgainst,
    }));
  }, [matches]);

  if (rankings.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.875rem' }}>
        <caption className="sr-only">{t('spectator.tournament.tabs.groups')}</caption>
        <thead>
          <tr style={{ borderBottom: '2px solid #374151' }}>
            <th scope="col" style={{ textAlign: 'left', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.rankLabel')}</th>
            <th scope="col" style={{ textAlign: 'left', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.nameLabel')}</th>
            <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.matchesLabel')}</th>
            <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.winsLabel')}</th>
            <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.lossesLabel')}</th>
            {!isTeam && <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.setWinsLosses')}</th>}
            {!isTeam && <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.setDiff')}</th>}
            <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.pointsDiff')}</th>
            <th scope="col" style={{ textAlign: 'center', padding: '0.5rem', color: '#d1d5db', position: 'sticky', top: 0, backgroundColor: '#111827', zIndex: 1 }}>{t('spectator.tournament.view.goalDiff')}</th>
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
                    {t('spectator.tournament.view.advanceBadge')}
                  </span>
                )}
              </td>
              <td style={{ textAlign: 'center', padding: '0.5rem' }}>{r.played}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem', color: '#22c55e' }}>{r.wins}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem', color: '#ef4444' }}>{r.losses}</td>
              {!isTeam && <td style={{ textAlign: 'center', padding: '0.5rem' }}>{t('spectator.tournament.view.setWL', { w: r.setsWon, l: r.setsLost })}</td>}
              {!isTeam && <td style={{ textAlign: 'center', padding: '0.5rem', color: formatDiff(r.setsWon - r.setsLost).color, fontWeight: 'bold' }}>{formatDiff(r.setsWon - r.setsLost).text}</td>}
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
  const { t } = useTranslation();
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
        {isCompleted && Array.isArray(match.sets) && match.sets.length > 0 ? (
          getSetScoresByServer(match).map((ss, i) => (
            <span key={i} style={{ color: '#9ca3af', margin: '0 0.25rem' }}>{ss.serverScore}-{ss.receiverScore}</span>
          ))
        ) : (
          <span style={{ color: '#9ca3af' }}>
            {match.status === 'in_progress' ? `\u25B6 ${t('common.matchStatus.inProgress')}` : 'vs'}
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
  const { t } = useTranslation();
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
    if (!match) return { text: `\u23F3 ${t('common.matchStatus.pending')}`, bg: 'transparent' };
    if (match.status !== 'completed') return { text: `\u25B6 ${t('common.matchStatus.inProgress')}`, bg: '#1e3a5f' };

    const isP1 = match.player1Id === p1Id;
    const won = match.winnerId === p1Id;
    if (Array.isArray(match.sets) && match.sets.length > 0) {
      const setWins = countSetWins(match.sets);
      const myWins = isP1 ? setWins.player1 : setWins.player2;
      const oppWins = isP1 ? setWins.player2 : setWins.player1;
      return {
        text: `${won ? t('spectator.tournament.view.win') : t('spectator.tournament.view.loss')} ${myWins}-${oppWins}`,
        bg: won ? '#14532d' : '#7f1d1d',
      };
    }
    return { text: won ? t('spectator.tournament.view.win') : t('spectator.tournament.view.loss'), bg: won ? '#14532d' : '#7f1d1d' };
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: `${players.length * 80 + 120}px` }}>
        <caption className="sr-only">{t('spectator.tournament.tabs.bracket')}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              style={{ padding: '0.5rem', borderBottom: '2px solid #374151', textAlign: 'left', color: 'var(--color-primary)' }}
            >
              {t('spectator.tournament.view.playerLabel')}
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
  const { t } = useTranslation();
  return (
    <ul role="list" aria-label={`${t('spectator.tournament.tabs.bracket')} (${matches.length})`} style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {matches.map((match, matchIdx) => {
        const teamSets = Array.isArray(match.sets) ? match.sets : [];
        const setData = teamSets.length > 0 ? teamSets[0] : null;

        return (
          <li
            key={match.id}
            className="card"
            role="listitem"
            aria-setsize={matches.length}
            aria-posinset={matchIdx + 1}
            style={{ border: match.status === 'completed' ? '2px solid #16a34a' : '1px solid #1f2937' }}
            aria-label={t('spectator.tournament.view.matchAriaTeam', { p1: match.team1Name || t('referee.home.team1Default'), p2: match.team2Name || t('referee.home.team2Default'), status: t(`common.matchStatus.${match.status === 'in_progress' ? 'inProgress' : match.status}`) })}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 'bold', flex: 1 }}>
                <button
                  className="text-left hover:underline hover:text-yellow-400"
                  onClick={(e) => { e.stopPropagation(); onSelectPlayer(match.team1Name || t('referee.home.team1Default')); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: 0 }}
                >
                  {match.team1Name || t('referee.home.team1Default')}
                </button>
                {match.team1?.memberNames && (
                  <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.25rem' }}>
                    {match.team1?.memberNames.join(', ')}
                  </div>
                )}
              </span>
              <div style={{ textAlign: 'center', minWidth: '120px' }}>
                {match.status !== 'pending' && setData ? (
                  <span style={{ fontSize: '1.5rem', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: 'var(--color-primary)' }}>{setData.player1Score}</span>
                    <span style={{ color: '#9ca3af', margin: '0 0.25rem' }}>-</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{setData.player2Score}</span>
                  </span>
                ) : (
                  <span style={{ color: '#9ca3af' }}>vs</span>
                )}
              </div>
              <span style={{ fontSize: '1.25rem', fontWeight: 'bold', flex: 1, textAlign: 'right' }}>
                <button
                  className="hover:underline hover:text-yellow-400"
                  onClick={(e) => { e.stopPropagation(); onSelectPlayer(match.team2Name || t('referee.home.team2Default')); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: 0 }}
                >
                  {match.team2Name || t('referee.home.team2Default')}
                </button>
                {match.team2?.memberNames && (
                  <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.25rem', textAlign: 'right' }}>
                    {match.team2?.memberNames.join(', ')}
                  </div>
                )}
              </span>
              <span style={{
                padding: '0.25rem 0.5rem',
                borderRadius: '0.25rem',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                backgroundColor: match.status === 'completed' ? '#16a34a' : match.status === 'in_progress' ? '#dc2626' : '#9ca3af',
                color: '#fff',
                marginLeft: '0.75rem',
              }}>
                {match.status === 'completed' ? `\u2713 ${t('common.matchStatus.completed')}` : match.status === 'in_progress' ? `\u25B6 ${t('common.matchStatus.inProgress')}` : `\u23F3 ${t('common.matchStatus.pending')}`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
