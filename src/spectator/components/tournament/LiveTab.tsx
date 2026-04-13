import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { countSetWins } from '@shared/utils/scoring';
import type { Match } from '@shared/types';
import type { useNavigate } from 'react-router-dom';

export interface LiveTabProps {
  matches: Match[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string, name?: string) => void;
  navigate: ReturnType<typeof useNavigate>;
  tournamentId: string;
}

// CSS keyframes injected once for score flash animation
const scoreFlashStyleId = 'live-score-flash-styles';
if (typeof document !== 'undefined' && !document.getElementById(scoreFlashStyleId)) {
  const style = document.createElement('style');
  style.id = scoreFlashStyleId;
  style.textContent = `
    @keyframes scoreFlash {
      0% { background-color: rgba(250, 204, 21, 0.5); transform: scale(1.15); }
      50% { background-color: rgba(250, 204, 21, 0.2); transform: scale(1.05); }
      100% { background-color: transparent; transform: scale(1); }
    }
    @keyframes toastSlideIn {
      0% { opacity: 0; transform: translateY(-100%); }
      10% { opacity: 1; transform: translateY(0); }
      85% { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(-100%); }
    }
    .live-score-pulse {
      animation: scoreFlash 1.5s ease-out;
      border-radius: 0.5rem;
    }
  `;
  document.head.appendChild(style);
}

export default function LiveTab({
  matches,
  isFavorite,
  toggleFavorite,
  navigate,
  tournamentId,
}: LiveTabProps) {
  const liveMatches = matches.filter((m) => m.status === 'in_progress');
  const prevScoresRef = useRef<Map<string, string>>(new Map());
  const [announcement, setAnnouncement] = useState('');
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);
  const [changedMatchId, setChangedMatchId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const matchRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // Detect score changes for aria-live announcements, toast, and auto-scroll
  useEffect(() => {
    for (const match of liveMatches) {
      if (match.type === 'individual' && Array.isArray(match.sets) && match.currentSet != null) {
        const currentSetData = match.sets[match.currentSet] ?? match.sets[match.sets.length - 1];
        if (!currentSetData) continue;
        const key = match.id;
        const scoreStr = `${currentSetData.player1Score}-${currentSetData.player2Score}-${match.currentSet}`;
        const prev = prevScoresRef.current.get(key);
        if (prev && prev !== scoreStr) {
          // Determine who scored
          const prevParts = prev.split('-').map(Number);
          const p1Diff = currentSetData.player1Score - prevParts[0];
          const p2Diff = currentSetData.player2Score - prevParts[1];
          let scorer = '';
          if (p1Diff > 0) scorer = `${match.player1Name || t('referee.home.player1Default')} +${p1Diff}`;
          else if (p2Diff > 0) scorer = `${match.player2Name || t('referee.home.player2Default')} +${p2Diff}`;

          const announcementText = t('spectator.tournament.view.scoreAnnouncement', { p1: match.player1Name || t('referee.home.player1Default'), p1Score: currentSetData.player1Score, p2: match.player2Name || t('referee.home.player2Default'), p2Score: currentSetData.player2Score, set: match.currentSet });
          setAnnouncement(announcementText);
          setToast({ message: scorer || announcementText, key: Date.now() });
          setChangedMatchId(match.id);

          // Auto-scroll to the match that just scored
          const el = matchRefs.current.get(match.id);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
        prevScoresRef.current.set(key, scoreStr);
      } else if (match.type === 'team' && Array.isArray(match.sets) && match.sets.length > 0) {
        const setData = match.sets[0];
        const key = match.id;
        const scoreStr = `${setData.player1Score}-${setData.player2Score}`;
        const prev = prevScoresRef.current.get(key);
        if (prev && prev !== scoreStr) {
          const prevParts = prev.split('-').map(Number);
          const p1Diff = setData.player1Score - prevParts[0];
          const p2Diff = setData.player2Score - prevParts[1];
          let scorer = '';
          if (p1Diff > 0) scorer = `${match.team1Name || t('referee.home.team1Default')} +${p1Diff}`;
          else if (p2Diff > 0) scorer = `${match.team2Name || t('referee.home.team2Default')} +${p2Diff}`;

          const announcementText = t('spectator.tournament.view.teamScoreAnnouncement', { p1: match.team1Name || t('referee.home.team1Default'), p1Score: setData.player1Score, p2: match.team2Name || t('referee.home.team2Default'), p2Score: setData.player2Score });
          setAnnouncement(announcementText);
          setToast({ message: scorer || announcementText, key: Date.now() });
          setChangedMatchId(match.id);

          const el = matchRefs.current.get(match.id);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
        prevScoresRef.current.set(key, scoreStr);
      }
    }
  }, [liveMatches]);

  // Clear changedMatchId after animation completes
  useEffect(() => {
    if (!changedMatchId) return;
    const timer = setTimeout(() => setChangedMatchId(null), 1600);
    return () => clearTimeout(timer);
  }, [changedMatchId]);

  const { t } = useTranslation();

  if (liveMatches.length === 0) {
    const pending = matches.filter(m => m.status === 'pending').length;
    const completed = matches.filter(m => m.status === 'completed').length;
    const inProgress = matches.filter(m => m.status === 'in_progress').length;
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.25rem', color: '#d1d5db' }} role="status">{t('spectator.tournament.live.noLiveMatches')}</p>
        {matches.length > 0 && (
          <p style={{ fontSize: '0.8125rem', color: '#6b7280', marginTop: '0.5rem' }}>
            {t('spectator.tournament.live.matchSummary', { total: matches.length, pending, inProgress, completed })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Visible toast banner for score changes */}
      {toast && (
        <div
          key={toast.key}
          aria-live="assertive"
          aria-atomic="true"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 50,
            textAlign: 'center',
            padding: '0.625rem 1rem',
            marginBottom: '0.75rem',
            backgroundColor: 'rgba(250, 204, 21, 0.15)',
            border: '1px solid rgba(250, 204, 21, 0.4)',
            borderRadius: '0.5rem',
            color: '#facc15',
            fontWeight: 'bold',
            fontSize: '1rem',
            animation: 'toastSlideIn 3s ease-out forwards',
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Screen reader score announcements */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <ul ref={listRef} style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {liveMatches.map((match) => (
          <li
            key={match.id}
            ref={(el) => { if (el) matchRefs.current.set(match.id, el); }}
          >
            <button
              className="card"
              onClick={() => navigate(`/spectator/match/${tournamentId}/${match.id}`)}
              style={{
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                border: changedMatchId === match.id ? '2px solid #facc15' : '2px solid #374151',
                transition: 'border-color 0.3s ease',
              }}
              aria-label={
                match.type === 'individual'
                  ? t('spectator.tournament.view.matchAriaLive', { p1: match.player1Name, p2: match.player2Name })
                  : t('spectator.tournament.view.matchAriaLive', { p1: match.team1Name, p2: match.team2Name })
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
                <span style={{ color: '#ef4444', fontWeight: 'bold' }}>{t('common.matchStatus.inProgress')}</span>
                {match.courtName && (
                  <span style={{ color: '#d1d5db', marginLeft: 'auto' }}>{match.courtName}</span>
                )}
              </div>

              {match.type === 'individual' ? (
                <IndividualMatchCard
                  match={match}
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                  justChanged={changedMatchId === match.id}
                />
              ) : (
                <TeamMatchCard match={match} justChanged={changedMatchId === match.id} />
              )}

              {(match.refereeName || match.assistantRefereeName) && (
                <p style={{ color: '#d1d5db', marginTop: '0.5rem', fontSize: '0.875rem' }}>
                  {match.refereeName && `${t('common.refereeRole.main')}: ${match.refereeName}`}
                  {match.refereeName && match.assistantRefereeName && ' / '}
                  {match.assistantRefereeName && `${t('common.refereeRole.assistant')}: ${match.assistantRefereeName}`}
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
  justChanged,
}: {
  match: Match;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string, name?: string) => void;
  justChanged?: boolean;
}) {
  const { t } = useTranslation();
  const safeSets = Array.isArray(match.sets) ? match.sets : [];
  const currentSetData = safeSets.length > 0 && match.currentSet != null
    ? safeSets[match.currentSet] ?? safeSets[safeSets.length - 1] ?? null
    : null;
  const setWins = safeSets.length > 0 ? countSetWins(safeSets) : { player1: 0, player2: 0 };
  const scoreKey = `${currentSetData?.player1Score}-${currentSetData?.player2Score}`;

  return (
    <div>
      {/* 경기 정보: 선수명 vs 선수명 + 점수 */}
      <div aria-label={`${match.player1Name} vs ${match.player2Name}, ${currentSetData?.player1Score ?? 0}:${currentSetData?.player2Score ?? 0}, ${t('spectator.tournament.view.setScoreDisplay', { p1: setWins.player1, p2: setWins.player2 })}`}>
        {/* 선수 이름 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }} aria-hidden="true">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{match.player1Name || t('referee.home.player1Default')}</span>
            {match.player1Id && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(match.player1Id!, match.player1Name || undefined); }}
                aria-label={isFavorite(match.player1Id) ? t('spectator.favorites.removeFavorite', { name: match.player1Name }) : t('spectator.favorites.addFavorite', { name: match.player1Name })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: 'var(--color-primary)', padding: '0.125rem' }}
              >
                {isFavorite(match.player1Id) ? '\u2605' : '\u2606'}
              </button>
            )}
          </div>
          <span style={{ color: '#9ca3af', fontWeight: 'bold' }}>vs</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {match.player2Id && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(match.player2Id!, match.player2Name || undefined); }}
                aria-label={isFavorite(match.player2Id) ? t('spectator.favorites.removeFavorite', { name: match.player2Name }) : t('spectator.favorites.addFavorite', { name: match.player2Name })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: 'var(--color-primary)', padding: '0.125rem' }}
              >
                {isFavorite(match.player2Id) ? '\u2605' : '\u2606'}
              </button>
            )}
            <span style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{match.player2Name || t('referee.home.player2Default')}</span>
          </div>
        </div>

        {/* 점수 */}
        <div
          key={scoreKey}
          className={justChanged ? 'live-score-pulse' : ''}
          style={{ textAlign: 'center', padding: '0.25rem 0' }}
          aria-hidden="true"
        >
          <div style={{ fontSize: '3rem', fontWeight: '900', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            <span style={{ color: '#fff' }}>{currentSetData?.player1Score ?? 0}</span>
            <span style={{ color: '#9ca3af', margin: '0 0.5rem', fontSize: '2rem' }}>:</span>
            <span style={{ color: '#fff' }}>{currentSetData?.player2Score ?? 0}</span>
          </div>
          <div style={{ fontSize: '0.875rem', color: '#d1d5db', marginTop: '0.25rem' }}>
            {t('spectator.tournament.view.setScoreDisplay', { p1: setWins.player1, p2: setWins.player2 })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamMatchCard({ match, justChanged }: { match: Match; justChanged?: boolean }) {
  const { t } = useTranslation();
  const safeSets = Array.isArray(match.sets) ? match.sets : [];
  const setData = safeSets.length > 0 ? safeSets[0] : null;
  const team1Score = setData?.player1Score ?? 0;
  const team2Score = setData?.player2Score ?? 0;
  const scoreKey = `${team1Score}-${team2Score}`;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{match.team1Name || t('referee.home.team1Default')}</span>
          {match.team1?.coachName && <div style={{ fontSize: '0.75rem', color: '#d1d5db' }}>{t('spectator.tournament.view.coachLabel')}: {match.team1.coachName}</div>}
        </div>
        <div
          key={scoreKey}
          className={justChanged ? 'live-score-pulse' : ''}
          style={{ textAlign: 'center', padding: '0.25rem 0.5rem' }}
        >
          <div className="score-display" style={{ fontSize: '3.5rem', fontWeight: '900', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
            <span style={{ color: '#fff', textShadow: '0 0 12px var(--color-primary)' }}>{team1Score}</span>
            <span style={{ color: '#9ca3af', margin: '0 0.25rem', fontSize: '2.5rem' }}>:</span>
            <span style={{ color: '#fff', textShadow: '0 0 12px var(--color-secondary)' }}>{team2Score}</span>
          </div>
          <div style={{ fontSize: '0.875rem', color: '#d1d5db', marginTop: '0.25rem' }}>
            {t('spectator.tournament.view.teamMatchPoints')}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{match.team2Name || t('referee.home.team2Default')}</span>
          {match.team2?.coachName && <div style={{ fontSize: '0.75rem', color: '#d1d5db' }}>{t('spectator.tournament.view.coachLabel')}: {match.team2.coachName}</div>}
        </div>
      </div>
    </div>
  );
}
