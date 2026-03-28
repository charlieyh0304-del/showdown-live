import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface ScoresheetGridProps {
  playerAName: string;
  playerBName: string;
  playerAScore: number;
  playerBScore: number;
  maxPoints: number; // 18 for individual, 38 for team
  highlightPoint: number; // 11 for individual (6 in deciding set), 16 for team
  currentServe: 'player1' | 'player2';
  serveCount: number; // 0-based
  servesPerTurn: number; // 2 for individual, 3 for team
  warnings: { player1: number; player2: number };
  penalties: { player1: number; player2: number };
  timeouts: { player1: number; player2: number };
  setLabel: string;
  coachA?: string;
  coachB?: string;
}

export default function ScoresheetGrid({
  playerAName, playerBName,
  playerAScore, playerBScore,
  maxPoints, highlightPoint,
  currentServe, serveCount, servesPerTurn,
  warnings, penalties, timeouts,
  setLabel, coachA, coachB,
}: ScoresheetGridProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to show current score area
  const maxScore = Math.max(playerAScore, playerBScore);
  useEffect(() => {
    if (scrollRef.current) {
      // Scroll to show the current score area (a bit ahead)
      const cellWidth = 32;
      const targetCol = Math.max(0, maxScore - 3);
      scrollRef.current.scrollLeft = targetCol * cellWidth;
    }
  }, [maxScore]);

  const pointNumbers = Array.from({ length: maxPoints }, (_, i) => i + 1);

  // Calculate total points scored (for serve tracking display)
  const totalPoints = playerAScore + playerBScore;

  // Build serve history: for each point index (0-based total), who served and which serve number
  // Serve pattern: servesPerTurn serves per player, then switch
  const serveHistory: Array<{ server: 'player1' | 'player2'; serveNum: number }> = [];
  {
    // We need to know who served first - derive from current state
    // Total serves done = totalPoints, current serve state tells us who serves next
    // Walk backwards to figure out first server
    let firstServer = currentServe;
    let remainingPoints = totalPoints;
    let tempServeCount = serveCount;
    while (remainingPoints > 0) {
      if (tempServeCount > 0) {
        tempServeCount--;
        remainingPoints--;
      } else {
        // Switch server
        firstServer = firstServer === 'player1' ? 'player2' : 'player1';
        tempServeCount = servesPerTurn - 1;
        remainingPoints--;
      }
    }

    // Now walk forward from firstServer
    let server = firstServer;
    let count = 0;
    for (let i = 0; i < totalPoints + servesPerTurn; i++) {
      serveHistory.push({ server, serveNum: (count % servesPerTurn) + 1 });
      count++;
      if (count >= servesPerTurn) {
        count = 0;
        server = server === 'player1' ? 'player2' : 'player1';
      }
    }
  }

  // For each point position (1-based), determine which serve it was scored on
  // Point N for player A was the Nth point scored by A
  // But on the scoresheet, the serve row is shared and shows serve order for ALL points

  // Compute which points in the grid have been "crossed off"
  // Player A's points 1..playerAScore are scored
  // Player B's points 1..playerBScore are scored

  return (
    <div className="bg-gray-900 border border-gray-600 rounded-lg overflow-hidden">
      {/* Set label header */}
      <div className="bg-gray-800 px-3 py-1.5 text-center text-sm font-bold text-gray-300 border-b border-gray-600">
        {setLabel}
      </div>

      <div ref={scrollRef} className="overflow-x-auto scoresheet-scroll">
        <table className="scoresheet-table" style={{ borderCollapse: 'collapse', minWidth: maxPoints * 32 + 130 }}>
          <tbody>
            {/* Player A row */}
            <tr className="border-b border-gray-700">
              <td className="scoresheet-name-cell bg-yellow-900/30 text-yellow-400">
                <div className="font-bold text-xs truncate" style={{ maxWidth: 60 }}>
                  {currentServe === 'player1' && <span className="mr-0.5">🎾</span>}
                  {playerAName}
                </div>
                {coachA && <div className="text-[10px] text-gray-500 truncate">{coachA}</div>}
              </td>
              <td className="scoresheet-wpt-cell">
                <span className="scoresheet-badge bg-amber-800/60 text-amber-300" title="W">
                  W{warnings.player1}
                </span>
              </td>
              <td className="scoresheet-wpt-cell">
                <span className="scoresheet-badge bg-red-800/60 text-red-300" title="P">
                  P{penalties.player1}
                </span>
              </td>
              <td className="scoresheet-wpt-cell">
                <span className="scoresheet-badge bg-blue-800/60 text-blue-300" title="T.O.">
                  T{timeouts.player1}
                </span>
              </td>
              {pointNumbers.map(n => {
                const scored = n <= playerAScore;
                const isHighlight = n === highlightPoint;
                return (
                  <td
                    key={n}
                    className={`scoresheet-point-cell ${scored ? 'scoresheet-scored-a' : ''} ${isHighlight ? 'scoresheet-highlight' : ''}`}
                    aria-label={scored ? `${playerAName} ${n}${t('common.units.point')}` : `${n}`}
                  >
                    {scored ? (
                      <span className="scoresheet-cross">✕</span>
                    ) : (
                      <span className="text-gray-500 text-xs">{n}</span>
                    )}
                  </td>
                );
              })}
              {/* Result */}
              <td className="scoresheet-result-cell text-yellow-400 font-bold text-lg">
                {playerAScore}
              </td>
            </tr>

            {/* Serve indicator rows */}
            <tr className="border-b border-gray-700 bg-gray-800/50">
              <td className="scoresheet-name-cell text-[10px] text-gray-500 text-right pr-1" colSpan={4}>
                Serv.
              </td>
              {pointNumbers.map((n, i) => {
                const isHighlight = n === highlightPoint;
                // Serve number for the i-th total point
                const serveInfo = i < serveHistory.length ? serveHistory[i] : null;
                const isCurrentPoint = i === totalPoints;
                return (
                  <td
                    key={n}
                    className={`scoresheet-serve-cell ${isHighlight ? 'scoresheet-highlight' : ''} ${isCurrentPoint ? 'scoresheet-current-serve' : ''}`}
                  >
                    {serveInfo ? (
                      <span className={`text-[10px] ${serveInfo.server === 'player1' ? 'text-yellow-500' : 'text-cyan-500'}`}>
                        {serveInfo.serveNum}
                      </span>
                    ) : i === totalPoints ? (
                      <span className={`text-[10px] font-bold ${currentServe === 'player1' ? 'text-yellow-400' : 'text-cyan-400'}`}>
                        {serveCount + 1}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-700">
                        {(i % servesPerTurn) + 1}
                      </span>
                    )}
                  </td>
                );
              })}
              <td className="scoresheet-result-cell"></td>
            </tr>

            {/* Player B row */}
            <tr>
              <td className="scoresheet-name-cell bg-cyan-900/30 text-cyan-400">
                <div className="font-bold text-xs truncate" style={{ maxWidth: 60 }}>
                  {currentServe === 'player2' && <span className="mr-0.5">🎾</span>}
                  {playerBName}
                </div>
                {coachB && <div className="text-[10px] text-gray-500 truncate">{coachB}</div>}
              </td>
              <td className="scoresheet-wpt-cell">
                <span className="scoresheet-badge bg-amber-800/60 text-amber-300" title="W">
                  W{warnings.player2}
                </span>
              </td>
              <td className="scoresheet-wpt-cell">
                <span className="scoresheet-badge bg-red-800/60 text-red-300" title="P">
                  P{penalties.player2}
                </span>
              </td>
              <td className="scoresheet-wpt-cell">
                <span className="scoresheet-badge bg-blue-800/60 text-blue-300" title="T.O.">
                  T{timeouts.player2}
                </span>
              </td>
              {pointNumbers.map(n => {
                const scored = n <= playerBScore;
                const isHighlight = n === highlightPoint;
                return (
                  <td
                    key={n}
                    className={`scoresheet-point-cell ${scored ? 'scoresheet-scored-b' : ''} ${isHighlight ? 'scoresheet-highlight' : ''}`}
                  >
                    {scored ? (
                      <span className="scoresheet-cross">✕</span>
                    ) : (
                      <span className="text-gray-500 text-xs">{n}</span>
                    )}
                  </td>
                );
              })}
              {/* Result */}
              <td className="scoresheet-result-cell text-cyan-400 font-bold text-lg">
                {playerBScore}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
