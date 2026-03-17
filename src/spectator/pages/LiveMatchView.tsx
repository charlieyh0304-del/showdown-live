import { useRef, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMatch, useTournament } from '@shared/hooks/useFirebase';
import { countSetWins, getEffectiveGameConfig } from '@shared/utils/scoring';

export default function LiveMatchView() {
  const { tournamentId, matchId } = useParams<{ tournamentId: string; matchId: string }>();
  const navigate = useNavigate();
  const { match, loading: mLoading } = useMatch(tournamentId || null, matchId || null);
  const { tournament, loading: tLoading } = useTournament(tournamentId || null);
  const [announcement, setAnnouncement] = useState('');
  const prevScoreRef = useRef('');

  const loading = mLoading || tLoading;

  // Score change announcements
  useEffect(() => {
    if (!match || match.type !== 'individual' || !match.sets || !match.currentSet) return;
    const currentSetData = match.sets[match.currentSet - 1];
    if (!currentSetData) return;
    const scoreStr = `${currentSetData.player1Score}-${currentSetData.player2Score}-${match.currentSet}`;
    if (prevScoreRef.current && prevScoreRef.current !== scoreStr) {
      setAnnouncement(
        `${match.player1Name || '선수1'} ${currentSetData.player1Score}점, ${match.player2Name || '선수2'} ${currentSetData.player2Score}점, 제${match.currentSet}세트`
      );
    }
    prevScoreRef.current = scoreStr;
  }, [match]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.5rem' }}>데이터 로딩 중...</p>
      </div>
    );
  }

  if (!match) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <p style={{ fontSize: '1.5rem', color: '#ef4444' }}>경기를 찾을 수 없습니다</p>
        <button className="btn btn-primary" onClick={() => navigate(-1)} style={{ marginTop: '1rem' }}>
          뒤로 가기
        </button>
      </div>
    );
  }

  const isLive = match.status === 'in_progress';
  const isCompleted = match.status === 'completed';

  return (
    <div>
      {/* Score change announcements for screen readers */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {/* Back button */}
      <button
        className="btn"
        onClick={() => navigate(`/spectator/tournament/${tournamentId}`)}
        style={{
          background: 'none',
          color: 'var(--color-secondary)',
          padding: '0.5rem 0',
          marginBottom: '1rem',
          fontSize: '1rem',
        }}
      >
        ← 대회로 돌아가기
      </button>

      {/* Status indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        {isLive && (
          <>
            <span
              className="animate-pulse"
              style={{
                display: 'inline-block',
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                backgroundColor: '#ef4444',
              }}
              aria-hidden="true"
            />
            <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '1.25rem' }}>실시간 진행중</span>
          </>
        )}
        {isCompleted && (
          <span style={{ color: '#16a34a', fontWeight: 'bold', fontSize: '1.25rem' }}>● 경기 완료</span>
        )}
        {match.status === 'pending' && (
          <span style={{ color: '#9ca3af', fontWeight: 'bold', fontSize: '1.25rem' }}>대기중</span>
        )}
      </div>

      {/* Tournament info */}
      {tournament && (
        <p style={{ color: '#6b7280', marginBottom: '1rem' }}>{tournament.name}</p>
      )}

      {match.type === 'individual' ? (
        <IndividualMatchDetail match={match} gameConfig={tournament?.gameConfig} />
      ) : (
        <TeamMatchDetail match={match} />
      )}

      {/* Court and referee info */}
      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', color: '#9ca3af' }}>
        {match.courtName && <span>경기장: {match.courtName}</span>}
        {match.refereeName && <span>심판: {match.refereeName}</span>}
      </div>
    </div>
  );
}

function IndividualMatchDetail({
  match,
  gameConfig,
}: {
  match: NonNullable<ReturnType<typeof useMatch>['match']>;
  gameConfig?: { winScore: 11 | 21 | 31; setsToWin: number };
}) {
  const sets = match.sets || [];
  const currentSet = match.currentSet || 1;
  const currentSetData = sets[currentSet - 1];
  const setWins = countSetWins(sets, gameConfig ? getEffectiveGameConfig(gameConfig) : undefined);

  const totalFaults1 = sets.reduce((sum, s) => sum + (s.player1Faults || 0), 0);
  const totalFaults2 = sets.reduce((sum, s) => sum + (s.player2Faults || 0), 0);
  const totalViolations1 = sets.reduce((sum, s) => sum + (s.player1Violations || 0), 0);
  const totalViolations2 = sets.reduce((sum, s) => sum + (s.player2Violations || 0), 0);

  const hasTimeout = match.activeTimeout != null;

  return (
    <div>
      {/* Timeout indicator */}
      {hasTimeout && (
        <div
          style={{
            backgroundColor: '#92400e',
            color: '#fbbf24',
            padding: '0.75rem',
            borderRadius: '0.5rem',
            textAlign: 'center',
            fontWeight: 'bold',
            fontSize: '1.25rem',
            marginBottom: '1rem',
          }}
        >
          타임아웃 진행중
        </div>
      )}

      {/* Player names */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '1.75rem', fontWeight: 'bold', flex: 1 }}>
          {match.player1Name || '선수1'}
        </span>
        <span style={{ fontSize: '1.75rem', fontWeight: 'bold', flex: 1, textAlign: 'right' }}>
          {match.player2Name || '선수2'}
        </span>
      </div>

      {/* Current set score - VERY LARGE */}
      <div
        className="card"
        style={{
          textAlign: 'center',
          padding: '2rem 1rem',
          marginBottom: '1rem',
          border: '2px solid #374151',
        }}
      >
        <p style={{ color: '#9ca3af', marginBottom: '0.5rem', fontSize: '1rem' }}>
          제{currentSet}세트
        </p>
        <div className="score-display" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: 'var(--color-primary)' }}>
            {currentSetData?.player1Score ?? 0}
          </span>
          <span style={{ color: '#6b7280', fontSize: '3rem' }}>-</span>
          <span style={{ color: 'var(--color-secondary)' }}>
            {currentSetData?.player2Score ?? 0}
          </span>
        </div>
        <p style={{ color: '#d1d5db', marginTop: '0.5rem', fontSize: '1.25rem' }}>
          세트 {setWins.player1} - {setWins.player2}
        </p>
      </div>

      {/* Set history */}
      {sets.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontWeight: 'bold', color: 'var(--color-primary)', marginBottom: '0.75rem' }}>
            세트 기록
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption className="sr-only">세트별 점수 기록</caption>
            <thead>
              <tr>
                <th scope="col" style={detailThStyle}>세트</th>
                <th scope="col" style={detailThStyle}>{match.player1Name || '선수1'}</th>
                <th scope="col" style={detailThStyle}>{match.player2Name || '선수2'}</th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={detailTdStyle}>제{i + 1}세트</td>
                  <td style={{
                    ...detailTdStyle,
                    fontWeight: 'bold',
                    color: s.winnerId && s.player1Score > s.player2Score ? 'var(--color-success)' : undefined,
                  }}>
                    {s.player1Score}
                  </td>
                  <td style={{
                    ...detailTdStyle,
                    fontWeight: 'bold',
                    color: s.winnerId && s.player2Score > s.player1Score ? 'var(--color-success)' : undefined,
                  }}>
                    {s.player2Score}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Faults & Violations */}
      {(totalFaults1 > 0 || totalFaults2 > 0 || totalViolations1 > 0 || totalViolations2 > 0) && (
        <div className="card">
          <h3 style={{ fontWeight: 'bold', color: 'var(--color-primary)', marginBottom: '0.75rem' }}>
            반칙/바이올레이션
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption className="sr-only">반칙 및 바이올레이션 기록</caption>
            <thead>
              <tr>
                <th scope="col" style={detailThStyle}>구분</th>
                <th scope="col" style={detailThStyle}>{match.player1Name || '선수1'}</th>
                <th scope="col" style={detailThStyle}>{match.player2Name || '선수2'}</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={detailTdStyle}>반칙</td>
                <td style={detailTdStyle}>{totalFaults1}</td>
                <td style={detailTdStyle}>{totalFaults2}</td>
              </tr>
              <tr>
                <td style={detailTdStyle}>바이올레이션</td>
                <td style={detailTdStyle}>{totalViolations1}</td>
                <td style={detailTdStyle}>{totalViolations2}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TeamMatchDetail({
  match,
}: {
  match: NonNullable<ReturnType<typeof useMatch>['match']>;
}) {
  const individualMatches = match.individualMatches || [];
  const team1Wins = individualMatches.filter((m) => m.status === 'completed' && m.winnerId === m.player1Id).length;
  const team2Wins = individualMatches.filter((m) => m.status === 'completed' && m.winnerId === m.player2Id).length;

  return (
    <div>
      {/* Team names and score */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '1.75rem', fontWeight: 'bold', flex: 1 }}>
          {match.team1Name || '팀1'}
        </span>
        <span style={{ fontSize: '1.75rem', fontWeight: 'bold', flex: 1, textAlign: 'right' }}>
          {match.team2Name || '팀2'}
        </span>
      </div>

      {/* Team score */}
      <div
        className="card"
        style={{
          textAlign: 'center',
          padding: '2rem 1rem',
          marginBottom: '1rem',
          border: '2px solid #374151',
        }}
      >
        <p style={{ color: '#9ca3af', marginBottom: '0.5rem' }}>팀 스코어</p>
        <div className="score-display" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: 'var(--color-primary)' }}>{team1Wins}</span>
          <span style={{ color: '#6b7280', fontSize: '3rem' }}>-</span>
          <span style={{ color: 'var(--color-secondary)' }}>{team2Wins}</span>
        </div>
        <p style={{ color: '#d1d5db', marginTop: '0.5rem' }}>
          {individualMatches.filter((m) => m.status === 'completed').length}/{individualMatches.length} 경기 완료
        </p>
      </div>

      {/* Individual match results */}
      <div className="card">
        <h3 style={{ fontWeight: 'bold', color: 'var(--color-primary)', marginBottom: '0.75rem' }}>
          개별 경기 결과
        </h3>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {individualMatches.map((im, idx) => (
            <li
              key={im.id || idx}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem',
                backgroundColor: im.status === 'completed' ? '#14532d' : im.status === 'in_progress' ? '#1e3a5f' : '#1f2937',
                borderRadius: '0.5rem',
              }}
            >
              <span style={{ flex: 1, fontWeight: 'bold' }}>{im.player1Name || '선수1'}</span>
              <span style={{ fontWeight: 'bold', fontVariantNumeric: 'tabular-nums', minWidth: '80px', textAlign: 'center' }}>
                {im.status === 'completed'
                  ? `${im.player1Score} - ${im.player2Score}`
                  : im.status === 'in_progress'
                    ? '진행중'
                    : '대기중'}
              </span>
              <span style={{ flex: 1, fontWeight: 'bold', textAlign: 'right' }}>{im.player2Name || '선수2'}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const detailThStyle: React.CSSProperties = {
  padding: '0.5rem',
  textAlign: 'center',
  fontWeight: 'bold',
  color: 'var(--color-secondary)',
  borderBottom: '2px solid #374151',
  fontSize: '0.875rem',
};

const detailTdStyle: React.CSSProperties = {
  padding: '0.5rem',
  textAlign: 'center',
};
