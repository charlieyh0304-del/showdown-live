import { useRef, useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMatch, useTournament } from '@shared/hooks/useFirebase';
import { countSetWins, getEffectiveGameConfig, getMaxServes } from '@shared/utils/scoring';
import type { ScoreHistoryEntry } from '@shared/types';

export default function LiveMatchView() {
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { match, loading: mLoading } = useMatch(tournamentId || null, matchId || null);
  const { tournament, loading: tLoading } = useTournament(tournamentId || null);
  const [announcement, setAnnouncement] = useState('');
  const [historyOrder, setHistoryOrder] = useState<'newest' | 'oldest'>('oldest');
  const prevScoreRef = useRef('');

  const loading = mLoading || tLoading;

  // Set document title for screen readers
  useEffect(() => {
    if (match) {
      const p1 = match.type === 'team' ? (match.team1Name || t('referee.home.team1Default')) : (match.player1Name || t('referee.home.player1Default'));
      const p2 = match.type === 'team' ? (match.team2Name || t('referee.home.team2Default')) : (match.player2Name || t('referee.home.player2Default'));
      document.title = t('spectator.liveMatch.pageTitle', { p1, p2 });
    } else {
      document.title = t('spectator.liveMatch.defaultPageTitle');
    }
  }, [match, t]);

  // 점수 변경 감지 → 음성 안내
  useEffect(() => {
    if (!match || !Array.isArray(match.sets) || match.sets.length === 0) return;
    const currentSetData = match.type === 'team'
      ? match.sets[0]
      : match.sets[(match.currentSet ?? 1) - 1];
    if (!currentSetData) return;

    const scoreStr = `${currentSetData.player1Score}-${currentSetData.player2Score}-${match.currentSet}`;
    if (prevScoreRef.current && prevScoreRef.current !== scoreStr) {
      const p1 = match.type === 'team' ? (match.team1Name || t('referee.home.team1Default')) : (match.player1Name || t('referee.home.player1Default'));
      const p2 = match.type === 'team' ? (match.team2Name || t('referee.home.team2Default')) : (match.player2Name || t('referee.home.player2Default'));
      setAnnouncement(t('spectator.liveMatch.scoreAriaLabel', { p1, p1Score: currentSetData.player1Score, p2, p2Score: currentSetData.player2Score }));
    }
    prevScoreRef.current = scoreStr;
  }, [match]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem 1rem' }} role="status" aria-live="polite"><p style={{ fontSize: '1.5rem' }}>{t('common.loading')}</p></div>;
  }

  if (!match) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.5rem', color: '#ef4444' }}>{t('spectator.liveMatch.notFound')}</p>
        <button className="btn btn-primary" onClick={() => navigate(-1)} style={{ marginTop: '1rem' }}>{t('spectator.liveMatch.backButton')}</button>
      </div>
    );
  }

  const isLive = match.status === 'in_progress';
  const isCompleted = match.status === 'completed';

  return (
    <div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only">{announcement}</div>

      <button className="btn" onClick={() => navigate(`/spectator/tournament/${tournamentId}`)}
        style={{ background: 'none', color: 'var(--color-secondary)', padding: '0.5rem 0', marginBottom: '1rem', fontSize: '1rem' }}>
        {t('spectator.liveMatch.backToTournament')}
      </button>

      {/* 상태 표시 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }} role="status" aria-live="polite">
        {isLive && (
          <>
            <span className="animate-pulse" style={{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%', backgroundColor: '#ef4444' }} aria-hidden="true" />
            <h1 style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '1.25rem', margin: 0 }}>{t('spectator.liveMatch.liveStatus')}</h1>
          </>
        )}
        {isCompleted && <h1 style={{ color: '#22c55e', fontWeight: 'bold', fontSize: '1.25rem', margin: 0 }}><span aria-hidden="true">{'● '}</span>{t('spectator.liveMatch.completedStatus')}</h1>}
        {match.status === 'pending' && <h1 style={{ color: '#d1d5db', fontWeight: 'bold', fontSize: '1.25rem', margin: 0 }}>{t('spectator.liveMatch.pendingStatus')}</h1>}
        {match.isPaused && <span style={{ color: '#fbbf24', fontWeight: 'bold', marginLeft: '0.5rem' }}><span aria-hidden="true">{'⏸ '}</span>{t('spectator.liveMatch.pausedStatus')}</span>}
      </div>

      {tournament && <p style={{ color: '#d1d5db', marginBottom: '1rem' }}>{tournament.name}</p>}

      {match.type === 'individual' ? (
        <IndividualMatchDetail match={match} gameConfig={tournament?.gameConfig} />
      ) : (
        <TeamMatchDetail match={match} />
      )}

      {/* 서브 정보 */}
      {isLive && match.currentServe && match.serveSelected && (
        <ServeIndicator match={match} />
      )}

      {/* 경기장/심판 */}
      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', color: '#d1d5db' }}>
        {match.courtName && <span>{t('spectator.liveMatch.court')}: {match.courtName}</span>}
        {match.refereeName && <span>{t('spectator.liveMatch.mainReferee')}: {match.refereeName}</span>}
        {match.assistantRefereeName && <span>{t('spectator.liveMatch.assistantReferee')}: {match.assistantRefereeName}</span>}
      </div>

      {/* 경기 기록 (최신순/시간순 토글) */}
      <ScoreHistorySection
        history={Array.isArray(match.scoreHistory) ? match.scoreHistory : []}
        sets={Array.isArray(match.sets) ? match.sets : undefined}
        order={historyOrder}
        onToggle={() => setHistoryOrder(o => o === 'newest' ? 'oldest' : 'newest')}
      />
    </div>
  );
}

// ===== 서브 표시 =====
function ServeIndicator({ match }: { match: NonNullable<ReturnType<typeof useMatch>['match']> }) {
  const { t } = useTranslation();
  const isTeam = match.type === 'team';
  const p1 = isTeam ? (match.team1Name ?? t('referee.home.team1Default')) : (match.player1Name ?? t('referee.home.player1Default'));
  const p2 = isTeam ? (match.team2Name ?? t('referee.home.team2Default')) : (match.player2Name ?? t('referee.home.player2Default'));
  const serverName = match.currentServe === 'player1' ? p1 : p2;
  const maxServes = getMaxServes(match.type ?? 'individual');
  const serveCount = match.serveCount ?? 0;

  return (
    <div style={{
      backgroundColor: '#1e3a5f', padding: '0.75rem', borderRadius: '0.5rem',
      textAlign: 'center', marginTop: '1rem', fontSize: '1.1rem', color: '#93c5fd',
    }} role="status" aria-live="polite">
      <span aria-hidden="true">{'🎾 '}</span>{t('spectator.liveMatch.serveCount', { name: serverName, current: serveCount + 1, max: maxServes })}
    </div>
  );
}

// ===== 경기 기록 (최신순/시간순) =====
function ScoreHistorySection({
  history, sets, order, onToggle,
}: {
  history: ScoreHistoryEntry[];
  sets?: { player1Score: number; player2Score: number; winnerId?: string | null }[];
  order: 'newest' | 'oldest';
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  // Known meta-event types that are meaningful even with 0 points
  const META_ACTION_TYPES = new Set([
    'pause', 'resume', 'timeout', 'timeout_player', 'timeout_medical', 'timeout_referee',
    'substitution', 'dead_ball', 'walkover', 'side_change', 'coin_toss', 'warmup_start',
    'match_start', 'player_rotation'
  ]);
  // Keep scoring entries AND meaningful meta events, filter out only serve-start 0-point entries
  const meaningfulHistory = useMemo(() => {
    return history.filter(h => h.points > 0 || META_ACTION_TYPES.has(h.actionType) || h.penaltyWarning);
  }, [history]);

  const sortedHistory = useMemo(() => {
    if (order === 'newest') return meaningfulHistory;
    return [...meaningfulHistory].reverse();
  }, [meaningfulHistory, order]);

  if (meaningfulHistory.length === 0) {
    return (
      <div className="card" style={{ marginTop: '1.5rem', padding: '1rem' }}>
        <p style={{ color: '#d1d5db', textAlign: 'center' }}>{t('common.matchHistory.noDetailedHistory')}</p>
        {Array.isArray(sets) && sets.length > 0 && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#d1d5db' }}>{t('common.matchHistory.setResult')}</h3>
            {sets.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', backgroundColor: '#1f2937', borderRadius: '0.5rem', padding: '0.75rem' }}>
                <span>{t('common.matchHistory.setLabel', { num: i + 1 })}</span>
                <span style={{ fontWeight: 'bold' }}>{s.player1Score} - {s.player2Score}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h2 style={{ fontWeight: 'bold', color: 'var(--color-primary)', margin: 0 }}>
          {t('common.matchHistory.titleWithCount', { count: meaningfulHistory.length })}
        </h2>
        <button
          className="btn"
          onClick={onToggle}
          style={{ fontSize: '0.75rem', padding: '4px 10px', background: '#374151' }}
          aria-label={order === 'newest' ? t('common.matchHistory.sortNewestAriaLabel') : t('common.matchHistory.sortOldestAriaLabel')}
        >
          <span aria-hidden="true">{order === 'newest' ? '🔽 ' : '🔼 '}</span>{order === 'newest' ? t('common.matchHistory.newestFirst') : t('common.matchHistory.oldestFirst')}
        </button>
      </div>

      <HistoryBySet history={sortedHistory} sets={sets} order={order} />
    </div>
  );
}

// ===== Set-grouped history (spectator) =====
const ACTION_LABEL_KEYS: Record<string, string> = {
  goal: 'common.scoreActions.goal', irregular_serve: 'common.scoreActions.irregularServe', centerboard: 'common.scoreActions.centerboard',
  body_touch: 'common.scoreActions.bodyTouch', illegal_defense: 'common.scoreActions.illegalDefense', out: 'common.scoreActions.out',
  ball_holding: 'common.scoreActions.ballHolding', mask_touch: 'common.scoreActions.maskTouch', penalty: 'common.scoreActions.penalty',
  penalty_table_pushing: 'common.scoreActions.penaltyTablePushing', penalty_electronic: 'common.scoreActions.penaltyElectronic',
  penalty_talking: 'common.scoreActions.penaltyTalking', walkover: 'common.scoreActions.walkover',
};

function parseTimeStr(time: string | undefined): string {
  if (!time) return '';
  if (time.includes('오전') || time.includes('오후') || time.match(/^\d{1,2}:\d{2}/)) {
    return time.replace(/:\d{2}$/, '');
  }
  const d = new Date(time);
  if (!isNaN(d.getTime())) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return time;
}

function HistoryBySet({ history, sets, order }: {
  history: ScoreHistoryEntry[];
  sets?: { player1Score: number; player2Score: number }[];
  order: 'newest' | 'oldest';
}) {
  const { t } = useTranslation();
  // Group by set
  const setGroups = useMemo(() => {
    const groups = new Map<number, ScoreHistoryEntry[]>();
    history.forEach(h => {
      const s = h.set || 1;
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s)!.push(h);
    });
    const entries = Array.from(groups.entries());
    return order === 'newest' ? entries.sort((a, b) => b[0] - a[0]) : entries.sort((a, b) => a[0] - b[0]);
  }, [history, order]);

  if (history.length === 0) return null;

  return (
    <div style={{ maxHeight: '400px', overflowY: 'auto' }} role="region" aria-label={t('common.matchHistory.title')} tabIndex={0}>
      {/* 시간순일 때 경기 시작 마커 */}
      {order === 'oldest' && (
        <div style={{
          textAlign: 'center', padding: '0.5rem', marginBottom: '0.5rem',
          background: 'linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%)',
          borderRadius: '0.5rem', color: '#93c5fd', fontSize: '0.9rem',
        }}>
          🎾 {t('common.matchHistory.matchStart')}
        </div>
      )}
      {setGroups.map(([setNum, entries]) => {
        const setData = sets?.[setNum - 1];
        return (
          <div key={setNum}>
            {/* 세트 헤딩 */}
            <div style={{
              padding: '0.5rem 0.75rem', fontWeight: 'bold', fontSize: '0.875rem',
              color: '#60a5fa', borderBottom: '2px solid rgba(96,165,250,0.3)',
              backgroundColor: '#111827', position: 'sticky', top: 0, zIndex: 1,
            }}>
              {t('common.matchHistory.setLabel', { num: setNum })} {setData ? `(${setData.player1Score} : ${setData.player2Score})` : ''}
            </div>
            {entries.map((h, i) => {
              const isMeta = h.points === 0 || h.penaltyWarning === true;
              const icon = h.penaltyWarning ? '⚠️' : h.actionType === 'dead_ball' ? '🔵' : h.actionType === 'goal' ? '⚽' : h.actionType === 'pause' ? '⏸️' : h.actionType === 'resume' ? '▶' : h.actionType === 'timeout' ? '⏱️' : h.actionType === 'timeout_player' ? '⏱️' : h.actionType === 'timeout_medical' ? '🏥' : h.actionType === 'timeout_referee' ? '🟨' : h.actionType === 'substitution' ? '🔄' : h.actionType === 'walkover' ? '⚪' : h.actionType === 'coin_toss' ? '🪙' : h.actionType === 'warmup_start' ? '🏃' : h.actionType === 'match_start' ? '🎾' : h.actionType === 'player_rotation' ? '🔄' : h.actionType === 'side_change' ? '🔄' : h.actionType?.startsWith('penalty_') ? '🔴' : h.points >= 2 ? '🔴' : '🟡';
              const timeStr = parseTimeStr(h.time);

              if (isMeta) {
                const actionLabel = ACTION_LABEL_KEYS[h.actionType || ''] ? t(ACTION_LABEL_KEYS[h.actionType || '']) : (h.actionLabel || '');
                const desc = h.penaltyWarning ? t('common.matchHistory.warning', { player: h.actionPlayer || '?', action: actionLabel })
                  : h.actionType === 'dead_ball' ? t('common.matchHistory.deadBall', { server: h.server || '?' })
                  : h.actionType === 'timeout' ? t('common.matchHistory.timeout', { player: h.actionPlayer || '' })
                  : h.actionType === 'timeout_player' ? t('common.matchHistory.playerTimeout', { player: h.actionPlayer || '' })
                  : h.actionType === 'timeout_medical' ? t('common.matchHistory.medicalTimeout', { player: h.actionPlayer || '' })
                  : h.actionType === 'timeout_referee' ? t('common.matchHistory.refereeTimeout')
                  : h.actionType === 'pause' ? t('common.matchHistory.pause', { player: h.actionPlayer || '' })
                  : h.actionType === 'substitution' ? (h.actionLabel || t('common.matchHistory.substitution'))
                  : h.actionType === 'walkover' ? `${h.scoringPlayer || '?'} ${t('common.scoreActions.walkover')}`
                  : h.actionType === 'coin_toss' ? (h.actionLabel || t('common.matchHistory.coinToss'))
                  : h.actionType === 'warmup_start' ? (h.actionLabel || t('common.matchHistory.warmup'))
                  : h.actionType === 'match_start' ? (h.actionLabel || t('common.matchHistory.matchStart'))
                  : h.actionType === 'player_rotation' ? (h.actionLabel || t('common.matchHistory.playerRotation'))
                  : h.actionType === 'side_change' ? (h.actionLabel || t('common.matchHistory.sideChange'))
                  : (h.actionLabel || '');
                const hideScore = ['timeout', 'timeout_player', 'timeout_medical', 'timeout_referee', 'side_change', 'pause', 'warmup_start', 'coin_toss'].includes(h.actionType) || h.penaltyWarning === true;
                return (
                  <div key={`${setNum}-${i}`} style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem', color: '#d1d5db', borderBottom: '1px solid #1f2937', backgroundColor: '#0d1117' }}>
                    <div>{timeStr} {icon} {desc}</div>
                    {!hideScore && <div style={{ fontSize: '0.75rem' }}>{t('common.matchHistory.score')}: {(() => { const p1 = h.scoreAfter?.player1 ?? 0; const p2 = h.scoreAfter?.player2 ?? 0; return h.serverSide === 'player2' ? `${p2} : ${p1}` : `${p1} : ${p2}`; })()}</div>}
                  </div>
                );
              }

              const isGoal = h.actionType === 'goal';
              const label = ACTION_LABEL_KEYS[h.actionType || ''] ? t(ACTION_LABEL_KEYS[h.actionType || '']) : (h.actionType || '');
              const actionDesc = isGoal
                ? t('common.matchHistory.goalScored', { player: h.scoringPlayer, points: h.points })
                : h.actionType === 'walkover'
                ? `${h.scoringPlayer || '?'} ${t('common.scoreActions.walkover')}`
                : t('common.matchHistory.penaltyScored', { actionPlayer: h.actionPlayer, action: label, scoringPlayer: h.scoringPlayer, points: h.points });
              const actionColor = isGoal ? '#22c55e' : h.points >= 2 ? '#ef4444' : '#eab308';

              return (
                <div key={`${setNum}-${i}`} style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #1f2937', fontSize: '0.875rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#d1d5db' }}>
                    <span aria-hidden="true">🎾</span> {h.server || '?'} {t('common.matchHistory.serve')} {h.serveNumber ? t('common.matchHistory.serveNumber', { num: h.serveNumber }) : ''} {timeStr && `· ${timeStr}`}
                  </div>
                  <div style={{ color: actionColor, fontWeight: 'bold' }}>
                    {icon} {actionDesc}
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: '#d1d5db' }}>
                    {t('common.matchHistory.score')}: {(() => { const p1 = h.scoreAfter?.player1 ?? 0; const p2 = h.scoreAfter?.player2 ?? 0; return h.serverSide === 'player2' ? `${p2} : ${p1}` : `${p1} : ${p2}`; })()}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ===== 개인전 상세 =====
function IndividualMatchDetail({
  match, gameConfig,
}: {
  match: NonNullable<ReturnType<typeof useMatch>['match']>;
  gameConfig?: { winScore: number; setsToWin: number };
}) {
  const { t } = useTranslation();
  const sets = Array.isArray(match.sets) ? match.sets : [];
  const currentSet = match.currentSet ?? 1;
  const currentSetData = sets[currentSet - 1];
  const effectiveConfig = gameConfig ? getEffectiveGameConfig(gameConfig) : undefined;
  const setWins = countSetWins(sets, effectiveConfig);
  const hasTimeout = match.activeTimeout != null;

  return (
    <div>
      {hasTimeout && (
        <div style={{ backgroundColor: '#92400e', color: '#fbbf24', padding: '0.75rem', borderRadius: '0.5rem', textAlign: 'center', fontWeight: 'bold', fontSize: '1.25rem', marginBottom: '1rem' }}>
          {t('spectator.liveMatch.timeoutInProgress')}
        </div>
      )}

      {/* 선수 이름 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '1.75rem', fontWeight: 'bold', flex: 1 }}>
          {match.status === 'in_progress' && match.currentServe === 'player1' && match.serveSelected ? '🎾 ' : ''}{match.player1Name || t('referee.home.player1Default')}
        </span>
        <span style={{ fontSize: '1.75rem', fontWeight: 'bold', flex: 1, textAlign: 'right' }}>
          {match.status === 'in_progress' && match.currentServe === 'player2' && match.serveSelected ? '🎾 ' : ''}{match.player2Name || t('referee.home.player2Default')}
        </span>
      </div>

      {/* 현재 세트 점수 */}
      <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem', marginBottom: '1rem', border: '2px solid #374151' }} aria-live="polite" aria-atomic="true">
        <p style={{ color: '#d1d5db', marginBottom: '0.5rem', fontSize: '1rem' }}>{t('common.matchHistory.setLabel', { num: currentSet })}</p>
        <div className="score-display" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }} aria-label={t('spectator.liveMatch.scoreAriaLabel', { p1: match.player1Name || t('referee.home.player1Default'), p1Score: currentSetData?.player1Score ?? 0, p2: match.player2Name || t('referee.home.player2Default'), p2Score: currentSetData?.player2Score ?? 0 })}>
          <span style={{ color: 'var(--color-primary)' }}>{currentSetData?.player1Score ?? 0}</span>
          <span style={{ color: '#9ca3af', fontSize: '3rem' }} aria-hidden="true">-</span>
          <span style={{ color: 'var(--color-secondary)' }}>{currentSetData?.player2Score ?? 0}</span>
        </div>
        <p style={{ color: '#d1d5db', marginTop: '0.5rem', fontSize: '1.25rem' }}>{t('spectator.liveMatch.setScore', { p1: setWins.player1, p2: setWins.player2 })}</p>
      </div>

      {/* 세트 기록 */}
      {sets.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontWeight: 'bold', color: 'var(--color-primary)', marginBottom: '0.75rem' }}>{t('common.matchHistory.setResult')}</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption className="sr-only">{t('common.matchHistory.setResult')}</caption>
            <thead>
              <tr>
                <th scope="col" style={thStyle}>{t('common.units.set')}</th>
                <th scope="col" style={thStyle}>{match.player1Name || t('referee.home.player1Default')}</th>
                <th scope="col" style={thStyle}>{match.player2Name || t('referee.home.player2Default')}</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={tdStyle}>{t('common.matchHistory.setLabel', { num: i + 1 })}</td>
                  <td style={{ ...tdStyle, fontWeight: 'bold', color: s.winnerId && s.player1Score > s.player2Score ? 'var(--color-success)' : undefined }}>{s.player1Score}</td>
                  <td style={{ ...tdStyle, fontWeight: 'bold', color: s.winnerId && s.player2Score > s.player1Score ? 'var(--color-success)' : undefined }}>{s.player2Score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ===== 팀전 상세 =====
function TeamMatchDetail({ match }: { match: NonNullable<ReturnType<typeof useMatch>['match']> }) {
  const { t } = useTranslation();
  const safeSets = Array.isArray(match.sets) ? match.sets : [];
  const setData = safeSets.length > 0 ? safeSets[0] : null;
  const team1Score = setData?.player1Score ?? 0;
  const team2Score = setData?.player2Score ?? 0;
  const hasTimeout = match.activeTimeout != null;

  return (
    <div>
      {hasTimeout && (
        <div style={{ backgroundColor: '#92400e', color: '#fbbf24', padding: '0.75rem', borderRadius: '0.5rem', textAlign: 'center', fontWeight: 'bold', fontSize: '1.25rem', marginBottom: '1rem' }}>
          {t('spectator.liveMatch.timeoutInProgress')}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '1.75rem', fontWeight: 'bold', flex: 1 }}>
          {match.status === 'in_progress' && match.currentServe === 'player1' && match.serveSelected ? '🎾 ' : ''}{match.team1Name || t('referee.home.team1Default')}
        </span>
        <span style={{ fontSize: '1.75rem', fontWeight: 'bold', flex: 1, textAlign: 'right' }}>
          {match.status === 'in_progress' && match.currentServe === 'player2' && match.serveSelected ? '🎾 ' : ''}{match.team2Name || t('referee.home.team2Default')}
        </span>
      </div>

      <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem', marginBottom: '1rem', border: '2px solid #374151' }} aria-live="polite" aria-atomic="true">
        <p style={{ color: '#d1d5db', marginBottom: '0.5rem' }}>{t('spectator.liveMatch.teamMatchPoints')}</p>
        <div className="score-display" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }} aria-label={t('spectator.liveMatch.scoreAriaLabel', { p1: match.team1Name || t('referee.home.team1Default'), p1Score: team1Score, p2: match.team2Name || t('referee.home.team2Default'), p2Score: team2Score })}>
          <span style={{ color: 'var(--color-primary)' }}>{team1Score}</span>
          <span style={{ color: '#9ca3af', fontSize: '3rem' }} aria-hidden="true">-</span>
          <span style={{ color: 'var(--color-secondary)' }}>{team2Score}</span>
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '0.5rem', textAlign: 'center', fontWeight: 'bold',
  color: 'var(--color-secondary)', borderBottom: '2px solid #374151', fontSize: '0.875rem',
};

const tdStyle: React.CSSProperties = {
  padding: '0.5rem', textAlign: 'center',
};
